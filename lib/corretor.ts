import { realSwap, NETWORKS, type NetworkKey, type TokenSymbol } from "./real-swap-executor"
import { pairProfitability } from "./pair-profitability"
import { pregão, type OrdemExecucao } from "./pregão"
import { blockIfPanicked, recordTradeResult } from "./circuit-breaker"
import { positionManager } from "./position-manager"
// feeMonetization removido — taxa fantasma que só encolhe o trade sem beneficiar ninguém

import { accountant } from "./accountant"
import { nanopaymentSystem } from "./nanopayment-system"

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

  async executar(ordem: OrdemExecucao, valorTrade: number) {
    pregão.atualizarOrdem(ordem.id, { status: "executando" })

    if (blockIfPanicked()) {
      this.log(`🚨 Circuit breaker ativo — ordem ${ordem.id} bloqueada`)
      pregão.atualizarOrdem(ordem.id, { status: "falhou" })
      return
    }

    const fromKey = ordem.fromToken as TokenSymbol
    const toKey = ordem.toToken as TokenSymbol
    const redeKey = ordem.rede as NetworkKey

    // 🔥 Multi-chain: alterna rede se necessário (CCTP bridge + auto-gas no executeSwap)
    const currentNet = realSwap.getNetworkKey()
    if (currentNet !== redeKey) {
      this.log(`🔀 Alternando rede: ${currentNet} → ${redeKey}`)
      await realSwap.switchNetwork(redeKey)
    }

    try {
      this.log(`💱 Executando: ${ordem.fromToken}→${ordem.toToken} $${valorTrade.toFixed(2)}`)

      const resultado = await realSwap.executeSwap(fromKey, toKey, valorTrade, (msg) => this.log(msg), ordem.id)

      if (resultado.success) {
        this.log(`📝 Trade concluído: ${ordem.par}`)

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
            currentPrice
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

        // FIX: circuit breaker não ativa para perdas pequenas de gestão de risco
        if (!isTestnetSwap && !isSmallForcedLoss && !isBuyOpening) {
          const { isPanicActive } = recordTradeResult(profit)
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
            profit
          }
        })

        this.log(`✅ ORDEM CONCLUÍDA: ${ordem.par} | TX: ${resultado.txHash.slice(0, 10)}... | Lucro: $${profit.toFixed(4)}`)
        for (const cb of this.onTradeCallbacks) cb(ordem)
      } else {
        this.log(`❌ Falha na execução: ${resultado.message}`)
        pregão.atualizarOrdem(ordem.id, { status: "falhou" })
        if (resultado.txHash) {
          recordTradeResult(-valorTrade * 0.1)
        }
      }
    } catch (err: any) {
      this.log(`❌ Erro na execução: ${err.message}`)
      pregão.atualizarOrdem(ordem.id, { status: "falhou" })
    }
  }

  private async buscarPreco(token: TokenSymbol): Promise<number> {
    const coinIds: Record<string, string> = {
      WETH: "ethereum", WMATIC: "matic-network", WBTC: "bitcoin",
      ARB: "arbitrum", SOL: "solana",
    }
    const coinId = coinIds[token] || token.toLowerCase()
    try {
      const res = await fetch(`/api/price?ids=${coinId}`)
      const body = await res.json()
      const data = body.prices ?? body
      return data[coinId] ?? 1
    } catch {
      return 1
    }
  }
}

export const corretor = new Corretor()