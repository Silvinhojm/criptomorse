import { realSwap, NETWORKS, type NetworkKey, type TokenSymbol, TOKEN_DECIMALS, isStable } from "./real-swap-executor"
import { pairProfitability } from "./pair-profitability"
import { pregão, type OrdemExecucao } from "./pregão"
import { blockIfPanicked, recordTradeResult } from "./circuit-breaker"
import { initializeTradingBudgetDailyLimit, isBudgetExceeded, recordTradingSpend } from "./trading-budget"
import { authorizeRiskBoxTradeFresh, recordRiskBoxEconomicResult } from "./risk-boxes"
import { positionManager } from "./position-manager"
import { capitalController } from "./capital-controller"
// feeMonetization removido — taxa fantasma que só encolhe o trade sem beneficiar ninguém

import { accountant } from "./accountant"
import { nanopaymentSystem } from "./nanopayment-system"
import { batchApprove, executeBatch, type UltraFlashSwap } from "./ultraflash"
import { getQuote } from "./lifi-executor"
import { hasDirectDex, getDirectDexQuote, calculateAmountOutMin } from "./direct-dex"
import { ethers } from "ethers"
import { gasPriceOracle } from "./gas-price-oracle"
import { COIN_IDS } from "./coin-ids"
import { recordRouteFailure } from "./route-verifier"
import { frameworkSettlementRegistry } from "./agent-framework/singletons"
import type { SettlementStatus } from "./agent-framework/settlement-registry"

const AGENTES_CONHECIDOS = new Set([
  "Quantum", "Technical", "TrendFollower", "MeanReversion",
  "QuantumTrader", "ArbitrageHunter", "MarketMaker", "BTCTrader",
  "Liquidator", "MomentumTrader", "NVIDIAgent", "Synthesis",
  "Morse",
])

class Corretor {
  private onLogCallbacks: Array<(msg: string) => void> = []
  private onTradeCallbacks: Array<(ordem: OrdemExecucao) => void> = []

  onLog(cb: (msg: string) => void) {
    this.onLogCallbacks.push(cb)
    return () => { this.onLogCallbacks = this.onLogCallbacks.filter(c => c !== cb) }
  }

  onTrade(cb: (ordem: OrdemExecucao) => void) {
    this.onTradeCallbacks.push(cb)
    return () => { this.onTradeCallbacks = this.onTradeCallbacks.filter(c => c !== cb) }
  }

  private log(msg: string) {
    console.log(`[CORRETOR] ${msg}`)
    for (const cb of this.onLogCallbacks) cb(msg)
  }

  private isZeroTxHash(txHash?: string): boolean {
    if (!txHash) return false
    const normalized = txHash.toLowerCase()
    return normalized === "0x00000000" || /^0x0+$/.test(normalized)
  }

  private settlementCorrelationId(ordem: OrdemExecucao): string | undefined {
    return ordem.metadata?.settlementCorrelationId ||
      ordem.metadata?.correlationId ||
      ordem.metadata?.intentId
  }

  private recordSettlementUpdate(ordem: OrdemExecucao, input: {
    success: boolean
    txHash?: string
    fromAmount?: number
    toAmount?: number
    synthetic?: boolean
    canonicalSettlement?: boolean
    confirmed?: boolean
    errorMsg?: string
  }): void {
    const correlationId = this.settlementCorrelationId(ordem)
    if (!correlationId) return

    const synthetic = input.synthetic === true || this.isZeroTxHash(input.txHash)
    const canonicalSettlement = input.canonicalSettlement === true && !synthetic
    let status: SettlementStatus

    if (synthetic) {
      status = "synthetic"
    } else if (!input.success) {
      status = "failed"
    } else if (input.confirmed === true && canonicalSettlement) {
      status = "confirmed"
    } else if (input.txHash) {
      status = "submitted"
    } else {
      status = "failed"
    }

    const record = frameworkSettlementRegistry.recordUpdate({
      correlationId,
      intentId: ordem.metadata?.intentId,
      proposalId: ordem.metadata?.proposalId,
      decisionReportId: ordem.metadata?.decisionReportId,
      ordemId: ordem.id,
      adapter: "trading",
      source: "corretor",
      status,
      txHash: input.txHash,
      fromToken: ordem.fromToken,
      toToken: ordem.toToken,
      amountIn: input.fromAmount === undefined ? undefined : String(input.fromAmount),
      actualAmountOut: input.toAmount === undefined ? undefined : String(input.toAmount),
      synthetic,
      canonicalSettlement,
      errorMsg: input.errorMsg,
      timestamp: Date.now(),
    })

    if (record) {
      this.log(`Settlement update recorded correlation:${record.correlationId} status:${record.status}`)
    }
  }

  async executar(ordem: OrdemExecucao, valorTrade: number) {
    const fromKey = ordem.fromToken as TokenSymbol
    const toKey = ordem.toToken as TokenSymbol
    const redeKey = ordem.rede as NetworkKey

    try {
      // 🔒 CapitalController: verifica se pode executar
      const ccId = `agentes:${ordem.par}:${redeKey}:${Date.now()}`
      const approval = capitalController.request({
        id: ccId, strategy: 'agentes',
        pair: ordem.par, network: redeKey,
        amountUSD: valorTrade, score: 50,
        estimatedProfit: 0, requestedAt: Date.now(),
      })
      if (!approval.authorized) {
        this.log(`⏳ Capital ocupado — ordem ${ordem.id} na fila (${approval.reason})`)
        pregão.atualizarOrdem(ordem.id, { status: "preparando" })
        return
      }

      pregão.atualizarOrdem(ordem.id, { status: "executando" })

      if (blockIfPanicked()) {
        this.log(`🚨 Circuit breaker ativo — ordem ${ordem.id} bloqueada`)
        pregão.atualizarOrdem(ordem.id, { status: "falhou" })
        return
      }

      // RI-BANK-11 Trilha B — orçamento por janela de tempo, mesmo padrão
      // de blockIfPanicked() logo acima. RI-BANK-14 fechou D3 em $50;
      // a inicialização abaixo só preenche o campo ainda ausente e nunca
      // sobrescreve uma configuração posterior.
      await initializeTradingBudgetDailyLimit()
      if (isBudgetExceeded(valorTrade)) {
        this.log(`💰 Orçamento de trading da janela esgotado — ordem ${ordem.id} bloqueada`)
        pregão.atualizarOrdem(ordem.id, { status: "falhou" })
        return
      }

      // RI-BANK-12: origem A/B é obrigatória e cada caixa tem gate próprio.
      // Ausência de origem nunca cai silenciosamente em A (fail-closed).
      const riskAuthorization = await authorizeRiskBoxTradeFresh(ordem.riskBox, valorTrade)
      if (!riskAuthorization.allowed) {
        this.log(`⚠️ Caixa de risco bloqueou ordem ${ordem.id}: ${riskAuthorization.reason}`)
        pregão.atualizarOrdem(ordem.id, { status: "falhou" })
        return
      }

      // 🔥 Multi-chain: alterna rede se necessário (CCTP bridge + auto-gas no executeSwap)
      const currentNet = realSwap.getNetworkKey()
      if (currentNet !== redeKey) {
        this.log(`🔀 Alternando rede: ${currentNet} → ${redeKey}`)
        await realSwap.switchNetwork(redeKey)
      }

      this.log(`💱 Executando: ${ordem.fromToken}→${ordem.toToken} $${valorTrade.toFixed(2)}`)

      const resultado = await realSwap.executeSwap(fromKey, toKey, valorTrade, (msg) => this.log(msg), ordem.id)

      if (resultado.success) {
        // RI-BANK-11 Trilha B — mede exposição de fato deployada (chamado
        // depois de success, não antes de tentar).
        await recordTradingSpend(valorTrade)
        const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000"
        const isSyntheticSettlement = (resultado as any).synthetic === true ||
          (resultado as any).canonicalSettlement === false ||
          resultado.txHash === zeroHash
        this.log(isSyntheticSettlement
          ? `🧪 Trade sintético/testnet concluído: ${ordem.par} (não settlement canônico)`
          : `📝 Trade concluído: ${ordem.par}`)

        if (isSyntheticSettlement) {
          this.log(`Synthetic/testnet result for ${ordem.par}: non-canonical settlement, tx hash is not proof of on-chain economic finality`)
        }

        let profit = (resultado.profit ?? 0)
        const isStableTo = ["USDC", "USDT", "DAI", "EURC"].includes(ordem.toToken)
        const isStableFrom = ["USDC", "USDT", "DAI", "EURC"].includes(ordem.fromToken)
        const netConf = NETWORKS[ordem.rede as NetworkKey]

        const isBuyOpening = isStableFrom && !isStableTo

        if (isBuyOpening) {
          const currentPrice = resultado.toAmount > 0
            ? valorTrade / resultado.toAmount
            : await this.buscarPreco(toKey)
          positionManager.openPosition(
            redeKey,
            toKey,
            fromKey,
            resultado.toAmount,
            valorTrade,
            currentPrice,
            ordem.riskBox,
          )
          this.log(`📦 Posição ${toKey} aberta: ${resultado.toAmount.toFixed(6)} @ $${currentPrice.toFixed(2)} (entrada real via swap)`)
        }

        if (!isStableFrom && isStableTo) {
          const pos = positionManager.getOpenPositions()
            .find(p => (p.boughtToken === ordem.fromToken || p.boughtToken === `W${ordem.fromToken}` || `W${p.boughtToken}` === ordem.fromToken) && p.status === "open")
          if (pos) {
            const currentPrice = await this.buscarPreco(pos.boughtToken as TokenSymbol)
            positionManager.closePosition(pos.id, currentPrice)
            this.log(`🔒 Posição ${pos.boughtToken} fechada! (via ordem ${ordem.fromToken}→${ordem.toToken})`)
          } else {
            this.log(`⚠️ Nenhuma posição aberta encontrada para ${ordem.fromToken} ao vender`)
          }
        }

        // FIX: não afeta aprendizado nem circuit breaker em três casos:
        // 1. Testnet com fee simulada (perda entre -$0.02 e +$0.02)
        // 2. Mainnet com perda pequena de fechamento forçado (stale/stop < $2.00)
        // 3. Compra (abertura de posição) — lucro só realizado na venda
        const isTestnetSwap = netConf?.isTestnet && profit <= 0.02 && profit >= -0.02
        const isSmallForcedLoss = !netConf?.isTestnet && profit < 0 && profit > -2.00

        if (!isTestnetSwap && !isBuyOpening) {
          const profitPorAgente = profit / Math.max(1, ordem.pregueiros.filter(n => AGENTES_CONHECIDOS.has(n.replace("Agente:", ""))).length)
          for (const nome of ordem.pregueiros) {
            const agente = nome.replace("Agente:", "")
            if (!AGENTES_CONHECIDOS.has(agente)) continue
            accountant.addReport({
              id: `${ordem.id}_${agente}`,
              agentName: agente,
              action: "sell",
              fromToken: ordem.fromToken,
              toToken: ordem.toToken,
              amount: valorTrade,
              toAmount: resultado.toAmount,
              profit: profitPorAgente,
              profitPercent: resultado.fromAmount > 0 ? (profitPorAgente / resultado.fromAmount) * 100 : 0,
              entryPrice: resultado.fromAmount / Math.max(1, resultado.toAmount),
              exitPrice: resultado.toAmount > 0 ? resultado.toAmount / Math.max(1, resultado.fromAmount) : 1,
              status: "completed",
              duration: Date.now() - ordem.timestamp,
              timestamp: Date.now(),
              networkKey: ordem.rede,
            })
          }
          this.log(`🧠 Agentes pontuados: ${ordem.pregueiros.filter(n => AGENTES_CONHECIDOS.has(n.replace("Agente:", ""))).join(", ")} (profit: $${profitPorAgente.toFixed(4)} cada)`)
        } else if (isBuyOpening) {
          this.log(`📦 Posição ${toKey} — lucro contabilizado apenas no fechamento da posição`)
        } else {
          this.log(`🧪 Testnet: pulando pontuação (fee simulada $${profit.toFixed(4)} não afeta ranking)`)
        }

        // Recompensa financeira por performance (apenas vendas com lucro)
        const agentesQueVotaram = ordem.pregueiros.filter(n => AGENTES_CONHECIDOS.has(n.replace("Agente:", "")))
        if (profit > 0 && agentesQueVotaram.length > 0 && !isBuyOpening) {
          const rewardPool = profit * 0.1
          const rewardPerAgent = rewardPool / agentesQueVotaram.length
          for (const nome of agentesQueVotaram) {
            const agente = nome.replace("Agente:", "")
            nanopaymentSystem.rewardAgentForTrade(agente, rewardPerAgent, ordem.id, ordem.par)
          }
          this.log(`🏅 Pool de recompensa: 10% do lucro = $${rewardPool.toFixed(4)} — $${rewardPerAgent.toFixed(4)} para cada um dos ${agentesQueVotaram.length} agentes`)
        }

        if (!isBuyOpening) {
          pairProfitability.recordTrade(ordem.par, profit, profit > 0)
        }

        // As caixas observam todo resultado realizado, inclusive em testnet.
        // Abertura de posição ainda não é resultado realizado.
        if (!isBuyOpening) {
          await recordRiskBoxEconomicResult(ordem.riskBox!, profit)
        }

        // FIX: circuit breaker global não ativa para perdas pequenas de gestão de risco
        if (!isTestnetSwap && !isSmallForcedLoss && !isBuyOpening) {
          const { isPanicActive } = await recordTradeResult(profit)
          if (isPanicActive) {
            this.log(`🚨 Circuit breaker ativado após trade!`)
          }
        } else if (isBuyOpening) {
          this.log(`🔒 Circuit breaker preservado: abertura de posição sem lucro contabilizado`)
        } else {
          const motivo = isTestnetSwap
            ? `fee simulada testnet $${profit.toFixed(4)}`
            : `fechamento forçado mainnet $${profit.toFixed(4)} (< $2.00)`
          this.log(`🛡️ Circuit breaker preservado: ${motivo}`)
        }

        pregão.atualizarOrdem(ordem.id, {
          status: "concluido",
          resultado: {
            txHash: resultado.txHash,
            explorerUrl: resultado.explorerUrl,
            fromAmount: valorTrade,
            toAmount: resultado.toAmount,
            profit,
            synthetic: isSyntheticSettlement,
            canonicalSettlement: !isSyntheticSettlement,
            settlementStatus: isSyntheticSettlement ? "synthetic" : "confirmed",
          }
        })

        this.log(`${isSyntheticSettlement ? "🧪 ORDEM SINTÉTICA/TESTNET CONCLUÍDA" : "✅ ORDEM CONCLUÍDA"}: ${ordem.par} | TX: ${resultado.txHash.slice(0, 10)}... | Lucro: $${profit.toFixed(4)}`)
        this.recordSettlementUpdate(ordem, {
          success: true,
          txHash: resultado.txHash,
          fromAmount: valorTrade,
          toAmount: resultado.toAmount,
          synthetic: isSyntheticSettlement,
          canonicalSettlement: !isSyntheticSettlement && (resultado as any).canonicalSettlement === true,
          confirmed: resultado.confirmed,
        })
        for (const cb of this.onTradeCallbacks) cb(ordem)
      } else {
        this.log(`❌ Falha na execução: ${resultado.message}`)
        pregão.atualizarOrdem(ordem.id, { status: "falhou" })
        this.recordSettlementUpdate(ordem, {
          success: false,
          txHash: resultado.txHash,
          fromAmount: valorTrade,
          toAmount: resultado.toAmount,
          synthetic: (resultado as any).synthetic === true,
          canonicalSettlement: false,
          confirmed: resultado.confirmed,
          errorMsg: resultado.message,
        })
        if (resultado.txHash) {
          const estimatedLoss = -valorTrade * 0.1
          await recordRiskBoxEconomicResult(ordem.riskBox!, estimatedLoss)
          await recordTradeResult(estimatedLoss)
        }
      }
    } catch (err: any) {
      this.log(`❌ Erro na execução: ${err.message}`)
      pregão.atualizarOrdem(ordem.id, { status: "falhou" })
      this.recordSettlementUpdate(ordem, {
        success: false,
        fromAmount: valorTrade,
        canonicalSettlement: false,
        errorMsg: err.message,
      })
    } finally {
      const unlockKey = ordem.par.split('→')[1] + ':' + redeKey
      this.log(`🔓 Unlock: ${unlockKey} (finally)`)
      capitalController.unlock(unlockKey)
    }
  }

  async executarBatch(ordens: OrdemExecucao[], valores: number[]) {
    if (ordens.length < 2 || ordens.length !== valores.length) return

    const redeKey = ordens[0].rede as NetworkKey
    for (const o of ordens) {
      if (o.rede !== redeKey) {
        this.log(`❌ executarBatch: todas ordens devem ser na mesma rede`)
        return
      }
    }

    if (blockIfPanicked()) {
      for (const o of ordens) {
        pregão.atualizarOrdem(o.id, { status: "falhou" })
      }
      this.log(`🚨 Circuit breaker ativo — batch ${redeKey} bloqueado`)
      return
    }

    // RI-BANK-12: cada item do batch precisa declarar e passar pelo gate
    // da própria caixa antes de qualquer preparação, aprovação ou swap.
    for (let i = 0; i < ordens.length; i++) {
      const authorization = await authorizeRiskBoxTradeFresh(ordens[i].riskBox, valores[i])
      if (!authorization.allowed) {
        for (const o of ordens) pregão.atualizarOrdem(o.id, { status: "falhou" })
        this.log(`⚠️ Caixa de risco bloqueou batch em ${ordens[i].id}: ${authorization.reason}`)
        return
      }
    }

    // 🔒 CapitalController: verifica capital para o batch
    const totalValor = valores.reduce((s, v) => s + v, 0)
    const ccId = `agentes:batch:${redeKey}:${Date.now()}`
    const pairs = ordens.map(o => o.par).join("+")
    const approval = capitalController.request({
      id: ccId, strategy: 'agentes',
      pair: pairs, network: redeKey,
      amountUSD: totalValor, score: 50,
      estimatedProfit: 0, requestedAt: Date.now(),
    })
    if (!approval.authorized) {
      for (const o of ordens) {
        pregão.atualizarOrdem(o.id, { status: "preparando" })
      }
      this.log(`⏳ Capital ocupado — batch ${pairs} na fila (${approval.reason})`)
      return
    }

    const currentNet = realSwap.getNetworkKey()
    if (currentNet !== redeKey) {
      this.log(`🔀 Alternando rede: ${currentNet} → ${redeKey}`)
      await realSwap.switchNetwork(redeKey)
    }

    const net = NETWORKS[redeKey]
    const swaps: UltraFlashSwap[] = []
    const erros: string[] = []
    const log = (msg: string) => this.log(msg)

    // ─── CCTP pre-batch: garante USDC suficiente na rede alvo ──
    const totalUsdcNeeded = ordens.reduce((s, o, i) => {
      const from = o.fromToken as TokenSymbol
      return isStable(from) ? s + valores[i] : s
    }, 0) * 1.05 // 5% buffer

    if (totalUsdcNeeded > 0 && !net.isTestnet) {
      await realSwap.refreshAllBalances()
      const saldoUSDC = realSwap.getBalance("USDC")
      if (saldoUSDC < totalUsdcNeeded) {
        log(`🌉 Saldo USDC baixo: $${saldoUSDC.toFixed(2)} < $${totalUsdcNeeded.toFixed(2)} — acionando CCTP bridge pre-batch`)
        const bridged = await realSwap.bridgeIfNeeded("USDC", totalUsdcNeeded, (m) => log(m))
        if (bridged) {
          await realSwap.refreshAllBalances()
          const novoSaldo = realSwap.getBalance("USDC")
          log(`✅ CCTP bridge concluído — saldo: $${novoSaldo.toFixed(2)} USDC em ${redeKey}`)
        } else {
          log(`⚠️ CCTP bridge falhou — batch prossegue com saldo disponível`)
        }
      }
    }

    const swapPrepResults = await Promise.all(ordens.map(async (ordem, i) => {
      const valorTrade = valores[i]
      const fromToken = ordem.fromToken as TokenSymbol
      const toToken = ordem.toToken as TokenSymbol
      const fromDecimals = TOKEN_DECIMALS[fromToken] ?? 6
      const toDecimals = TOKEN_DECIMALS[toToken] ?? 6
      const fromTokenAddr = (net.tokens as any)[fromToken]
      const toTokenAddr = (net.tokens as any)[toToken]

      if (!fromTokenAddr || !toTokenAddr) {
        pregão.atualizarOrdem(ordem.id, { status: "falhou" })
        return null
      }

      try {
        const fromPrice = await realSwap.fetchTokenPrice(fromToken).catch(() => 1)
        const fromAmountRaw = ethers.parseUnits((valorTrade / fromPrice).toFixed(fromDecimals), fromDecimals)

        const [dexQuote, lifiQuote] = await Promise.all([
          !net.isTestnet && hasDirectDex(redeKey)
            ? getDirectDexQuote(redeKey, realSwap.getProvider()!, fromTokenAddr, toTokenAddr, fromAmountRaw).catch(() => null)
            : Promise.resolve(null),
          valorTrade >= 20 ? getQuote({
            fromChain: net.chainId, toChain: net.chainId,
            fromToken: fromTokenAddr, toToken: toTokenAddr,
            fromAmount: fromAmountRaw.toString(),
            fromAddress: realSwap.getAddress(),
            toAddress: realSwap.getAddress(), slippage: 0.005,
          }).catch(() => null) : Promise.resolve(null),
        ])

        let target: string
        let calldata: string
        let value = 0n
        let spender: string
        let expectedToAmount = 0

        if (dexQuote && dexQuote.amountOut > 0n) {
          const amountOutMin = calculateAmountOutMin(dexQuote.amountOut, 100)
          const deadline = Math.floor(Date.now() / 1000) + 600
          const iface = new ethers.Interface([
            "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)",
          ])
          calldata = iface.encodeFunctionData("swapExactTokensForTokens", [
            fromAmountRaw, amountOutMin, dexQuote.path, realSwap.getAddress(), deadline,
          ])
          target = dexQuote.router
          spender = dexQuote.router
          expectedToAmount = Number(ethers.formatUnits(dexQuote.amountOut, toDecimals))
        } else if (lifiQuote?.transactionRequest?.data && lifiQuote.transactionRequest?.to) {
          target = lifiQuote.transactionRequest.to
          calldata = lifiQuote.transactionRequest.data
          value = BigInt(lifiQuote.transactionRequest.value ?? "0")
          spender = lifiQuote.transactionRequest.to
          expectedToAmount = parseFloat(lifiQuote.toAmount ?? "0") / Math.pow(10, toDecimals)
        } else {
          pregão.atualizarOrdem(ordem.id, { status: "falhou" })
          log(`❌ Sem rota para ${ordem.par}`)
          recordRouteFailure(ordem.fromToken, redeKey)
          return null
        }

        pregão.atualizarOrdem(ordem.id, { status: "executando" })
        return { fromToken, toToken, amountRaw: fromAmountRaw, amountUsd: valorTrade,
          target, calldata, value, spender, expectedToAmount, network: redeKey } as UltraFlashSwap
      } catch (err: any) {
        pregão.atualizarOrdem(ordem.id, { status: "falhou" })
        log(`❌ Erro preparando ${ordem.par}: ${err.message.slice(0, 100)}`)
        return null
      }
    }))

    for (const r of swapPrepResults) {
      if (r) swaps.push(r)
      else erros.push("swap_failed")
    }

    if (swaps.length === 0) {
      this.log(`❌ Batch vazio — todas ordens falharam na preparação`)
      return
    }

    log(`⚡ UltraFlash batch: ${swaps.length}/${ordens.length} swaps preparados`)

    try {
      await batchApprove(realSwap.getSigner()!, realSwap.getAddress(), redeKey, swaps, (m) => log(m))
      const batchResult = await executeBatch(realSwap.getSigner()!, redeKey, swaps, (m) => log(m))

      if (!batchResult.success) {
        for (const s of swaps) {
          const ordem = ordens.find(o => o.fromToken === s.fromToken && o.toToken === s.toToken)
          if (ordem) {
            pregão.atualizarOrdem(ordem.id, { status: "falhou" })
            this.recordSettlementUpdate(ordem, {
              success: false,
              txHash: batchResult.txHash,
              fromAmount: s.amountUsd,
              toAmount: s.expectedToAmount,
              canonicalSettlement: false,
              errorMsg: "Batch execution failed",
            })
          }
        }
        return
      }

      for (const r of batchResult.results) {
        const ordem = ordens.find(o =>
          o.fromToken === r.swap.fromToken && o.toToken === r.swap.toToken
        )
        if (!ordem) continue

        if (!r.success) {
          pregão.atualizarOrdem(ordem.id, { status: "falhou" })
          log(`❌ Swap ${ordem.par} falhou no batch`)
          this.recordSettlementUpdate(ordem, {
            success: false,
            txHash: r.txHash ?? batchResult.txHash,
            fromAmount: r.swap.amountUsd,
            toAmount: r.swap.expectedToAmount,
            canonicalSettlement: false,
            errorMsg: r.error ?? "Batch swap failed",
          })
          continue
        }

        const isStableTo = ["USDC", "USDT", "DAI", "EURC"].includes(ordem.toToken)
        const isStableFrom = ["USDC", "USDT", "DAI", "EURC"].includes(ordem.fromToken)
        const isBuyOpening = isStableFrom && !isStableTo
        const profit = isStableTo
          ? (r.swap.expectedToAmount * (await realSwap.fetchTokenPrice(ordem.toToken as TokenSymbol).catch(() => 1))) - r.swap.amountUsd
          : 0

        if (isBuyOpening) {
          const entryPrice = r.swap.expectedToAmount > 0
            ? r.swap.amountUsd / r.swap.expectedToAmount
            : 0
          positionManager.openPosition(
            redeKey, ordem.toToken as TokenSymbol, ordem.fromToken as TokenSymbol,
            r.swap.expectedToAmount, r.swap.amountUsd, entryPrice, ordem.riskBox,
          )
          log(`📦 Posição ${ordem.toToken} aberta (batch): ${r.swap.expectedToAmount.toFixed(6)} @ $${entryPrice.toFixed(2)}`)
        }

        if (!isStableFrom && isStableTo) {
          const pos = positionManager.getOpenPositions()
            .find(p => (p.boughtToken === ordem.fromToken || `W${p.boughtToken}` === ordem.fromToken) && p.status === "open")
          if (pos) {
            const cp = await this.buscarPreco(pos.boughtToken as TokenSymbol)
            positionManager.closePosition(pos.id, cp)
            log(`🔒 Posição ${pos.boughtToken} fechada (batch)!`)
          }
        }

        if (!isBuyOpening) {
          const agentes = ordem.pregueiros.filter(n => AGENTES_CONHECIDOS.has(n.replace("Agente:", "")))
          const profitPorAgente = profit / Math.max(1, agentes.length)
          for (const nome of agentes) {
            accountant.addReport({
              id: `${ordem.id}_${nome.replace("Agente:", "")}`,
              agentName: nome.replace("Agente:", ""),
              action: "sell", fromToken: ordem.fromToken, toToken: ordem.toToken,
              amount: r.swap.amountUsd, toAmount: r.swap.expectedToAmount,
              profit: profitPorAgente, profitPercent: 0,
              entryPrice: 0, exitPrice: 0,
              status: "completed", duration: Date.now() - ordem.timestamp,
              timestamp: Date.now(), networkKey: ordem.rede,
            })
          }
          pairProfitability.recordTrade(ordem.par, profit, profit > 0)
          if (profit > 0 && agentes.length > 0) {
            const rewardPerAgent = (profit * 0.1) / agentes.length
            for (const nome of agentes) {
              nanopaymentSystem.rewardAgentForTrade(nome.replace("Agente:", ""), rewardPerAgent, ordem.id, ordem.par)
            }
          }
          await recordRiskBoxEconomicResult(ordem.riskBox!, profit)
          const { isPanicActive } = await recordTradeResult(profit)
          if (isPanicActive) log(`🚨 Circuit breaker ativado após batch!`)
        }

        pregão.atualizarOrdem(ordem.id, {
          status: "concluido",
          resultado: {
            txHash: batchResult.txHash || "",
            explorerUrl: `${net.explorer}/tx/${batchResult.txHash}`,
            fromAmount: r.swap.amountUsd,
            toAmount: r.swap.expectedToAmount,
            profit,
          },
        })
        log(`✅ BATCH CONCLUÍDO: ${ordem.par} | TX: ${(batchResult.txHash ?? "").slice(0, 10)}... | Lucro: $${profit.toFixed(4)}`)
        this.recordSettlementUpdate(ordem, {
          success: true,
          txHash: r.txHash ?? batchResult.txHash,
          fromAmount: r.swap.amountUsd,
          toAmount: r.swap.expectedToAmount,
          canonicalSettlement: false,
        })
        for (const cb of this.onTradeCallbacks) cb(ordem)
      }
    } catch (err: any) {
      log(`❌ Erro no batch UltraFlash: ${err.message.slice(0, 150)}`)
      for (const s of swaps) {
        const ordem = ordens.find(o => o.fromToken === s.fromToken && o.toToken === s.toToken)
        if (ordem) {
          pregão.atualizarOrdem(ordem.id, { status: "falhou" })
          this.recordSettlementUpdate(ordem, {
            success: false,
            fromAmount: s.amountUsd,
            toAmount: s.expectedToAmount,
            canonicalSettlement: false,
            errorMsg: err.message,
          })
        }
      }
    } finally {
      capitalController.unlockNetwork(redeKey)
    }
  }

  private async buscarPreco(token: TokenSymbol): Promise<number> {
    const coinId = COIN_IDS[token] || token.toLowerCase()
    try {
      const res = await fetch(`/api/price?ids=${coinId}`)
      const body = await res.json()
      const prices = body?.prices
      return (prices && prices[coinId]) ?? 1
    } catch {
      return 1
    }
  }
}

export const corretor = new Corretor()
