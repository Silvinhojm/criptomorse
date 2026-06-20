import { realSwap, NETWORKS, type NetworkKey, type TokenSymbol } from "./real-swap-executor"
import { pregão, type OrdemExecucao } from "./pregão"
import { blockIfPanicked, recordTradeResult } from "./circuit-breaker"
import { positionManager } from "./position-manager"
import { feeMonetization } from "./fee-monetization"
import { transactionMemos } from "./transaction-memos"
import { accountant } from "./accountant"
import { nanopaymentSystem } from "./nanopayment-system"

const AGENTES_CONHECIDOS = new Set([
  "Quantum", "Technical", "TrendFollower", "MeanReversion",
  "QuantumTrader", "ArbitrageHunter", "MarketMaker", "BTCTrader",
  "Liquidator", "MomentumTrader", "NVIDIAgent", "Synthesis",
  "Morse",
])

class Corretor {
  private onLogCallback: ((msg: string) => void) | null = null
  private onTradeCallback: ((ordem: OrdemExecucao) => void) | null = null

  onLog(cb: (msg: string) => void) {
    this.onLogCallback = cb
  }

  onTrade(cb: (ordem: OrdemExecucao) => void) {
    this.onTradeCallback = cb
  }

  private log(msg: string) {
    console.log(`[CORRETOR] ${msg}`)
    this.onLogCallback?.(msg)
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

    try {
      const fee = feeMonetization.calculateFee(
        `${ordem.fromToken}_${ordem.toToken}`,
        valorTrade
      )
      const valorLiquido = fee.netAmount

      this.log(`💱 Executando: ${ordem.fromToken}→${ordem.toToken} $${valorLiquido.toFixed(2)} (fee: $${fee.fee.toFixed(4)})`)

      const resultado = await realSwap.executeSwap(fromKey, toKey, valorLiquido, (msg) => this.log(msg), ordem.id)

      if (resultado.success) {
        const memo = transactionMemos.createTradeMemo(
          ordem.id,
          "Corretor",
          { par: ordem.par, fee: fee.fee.toFixed(4) }
        )
        this.log(`📝 Memo: ${memo.hex.slice(0, 30)}...`)

        let profit = (resultado.profit ?? 0) - fee.fee
        const isStableTo = ["USDC", "USDT", "DAI", "EURC"].includes(ordem.toToken)
        const isStableFrom = ["USDC", "USDT", "DAI", "EURC"].includes(ordem.fromToken)

        if (isStableFrom && !isStableTo) {
          profit = 0
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
          // Busca posição pelo token exato ou variante (ex: "WETH" e "ETH")
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

        // Aprendizado: pontua cada agente que votou nesta ordem
        const profitPorAgente = profit / Math.max(1, ordem.pregueiros.filter(n => AGENTES_CONHECIDOS.has(n.replace("Agente:", ""))).length)
        for (const nome of ordem.pregueiros) {
          const agente = nome.replace("Agente:", "")
          if (!AGENTES_CONHECIDOS.has(agente)) continue
          accountant.addReport({
            id: `${ordem.id}_${agente}`,
            agentName: agente,
            action: isStableFrom && !isStableTo ? "buy" : !isStableFrom && isStableTo ? "sell" : "hold",
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

        // Recompensa financeira por performance: 10% do lucro como pool proporcional
        const agentesQueVotaram = ordem.pregueiros.filter(n => AGENTES_CONHECIDOS.has(n.replace("Agente:", "")))
        if (profit > 0 && agentesQueVotaram.length > 0) {
          const rewardPool = profit * 0.1 // 10% do lucro
          const rewardPerAgent = rewardPool / agentesQueVotaram.length
          for (const nome of agentesQueVotaram) {
            const agente = nome.replace("Agente:", "")
            nanopaymentSystem.rewardAgentForTrade(agente, rewardPerAgent, ordem.id, ordem.par)
          }
          this.log(`🏅 Pool de recompensa: 10% do lucro = $${rewardPool.toFixed(4)} — $${rewardPerAgent.toFixed(4)} para cada um dos ${agentesQueVotaram.length} agentes`)
        }

        const { isPanicActive } = recordTradeResult(profit)
        if (isPanicActive) {
          this.log(`🚨 Circuit breaker ativado após trade!`)
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
        this.onTradeCallback?.(ordem)
      } else {
        this.log(`❌ Falha na execução: ${resultado.message}`)
        pregão.atualizarOrdem(ordem.id, { status: "falhou" })
        recordTradeResult(-valorTrade * 0.1)
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
    };
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
