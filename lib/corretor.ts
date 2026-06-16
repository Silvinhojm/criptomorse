import { realSwap, NETWORKS, type NetworkKey, type TokenSymbol } from "./real-swap-executor"
import { pregão, type OrdemExecucao } from "./pregão"
import { blockIfPanicked, recordTradeResult } from "./circuit-breaker"
import { positionManager } from "./position-manager"
import { feeMonetization } from "./fee-monetization"
import { transactionMemos } from "./transaction-memos"

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

      const resultado = await realSwap.executeSwap(fromKey, toKey, valorLiquido, (msg) => this.log(msg))

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
          const currentPrice = await this.buscarPreco(toKey)
          positionManager.openPosition(
            redeKey,
            toKey,
            fromKey,
            resultado.toAmount,
            valorTrade,
            currentPrice
          )
          this.log(`📦 Posição ${toKey} aberta: ${resultado.toAmount.toFixed(6)} @ $${currentPrice.toFixed(2)}`)
        }

        if (!isStableFrom && isStableTo) {
          const pos = positionManager.getOpenPositions()
            .find(p => p.boughtToken === ordem.fromToken && p.status === "open")
          if (pos) {
            const currentPrice = await this.buscarPreco(fromKey)
            positionManager.closePosition(pos.id, currentPrice)
            this.log(`🔒 Posição ${ordem.fromToken} fechada!`)
          }
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
    try {
      const res = await fetch(`/api/price?ids=${token}`)
      const data = await res.json()
      return data[token] ?? 1
    } catch {
      return 1
    }
  }
}

export const corretor = new Corretor()
