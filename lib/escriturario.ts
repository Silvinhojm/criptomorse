import { realSwap, NETWORKS, type TokenSymbol, type NetworkKey, isStable } from "./real-swap-executor"
import { pregão, type OrdemExecucao } from "./pregão"
import { corretor } from "./corretor"
import { unifiedBalance } from "./unified-balance"
import { caixa } from "./caixa"
import { COIN_IDS } from "./coin-ids"

const VALOR_PADRAO_TRADE = 5
const emExecucao = new Set<string>()

class Escriturário {
  private onLogCallbacks: Array<(msg: string) => void> = []

  onLog(cb: (msg: string) => void) {
    this.onLogCallbacks.push(cb)
    return () => { this.onLogCallbacks = this.onLogCallbacks.filter(c => c !== cb) }
  }

  private log(msg: string) {
    console.log(`[ESCRITURÁRIO] ${msg}`)
    for (const cb of this.onLogCallbacks) cb(msg)
  }

  private async fetchTokenPrice(token: string): Promise<number> {
    const coinId = COIN_IDS[token] ?? token.toLowerCase()
    try {
      const res = await fetch(`/api/price?ids=${coinId}`)
      if (!res.ok) return 1
      const body = await res.json()
      const prices = body?.prices
      return (prices && prices[coinId]) ?? 1
    } catch {
      return 1
    }
  }

  async prepararOrdem(ordem: OrdemExecucao) {
    const lockKey = `${ordem.fromToken}→${ordem.toToken}@${ordem.rede}`
    if (emExecucao.has(lockKey)) {
      this.log(`⛔ ${lockKey} já em execução — descartando`)
      pregão.atualizarOrdem(ordem.id, { status: "falhou" })
      return
    }
    emExecucao.add(lockKey)

    try {
      this.log(`📋 Preparando ordem: ${ordem.par} na ${ordem.rede}`)
      this.log(`   Pregueiros: ${ordem.pregueiros.join(", ")}`)
      this.log(`   Confiança média: ${ordem.confiancaMedia}%`)

      pregão.atualizarOrdem(ordem.id, { status: "pronto" })

      const fromToken = ordem.fromToken
      const isFromStable = isStable(fromToken as TokenSymbol)

      const netConf = NETWORKS[ordem.rede as keyof typeof NETWORKS]
      const isTestnet = netConf?.isTestnet ?? true

      const currentNet = realSwap.getNetworkKey()
      const ordemNet = ordem.rede as NetworkKey
      if (currentNet !== ordemNet) {
        await realSwap.switchNetwork(ordemNet)
      }

      let saldoTokens = realSwap.getBalance(fromToken as TokenSymbol)
      if (saldoTokens < 1) {
        if (isTestnet) this.log(`🔄 Saldo ${fromToken}=${saldoTokens.toFixed(4)} — refresh on-chain...`)
        await realSwap.refreshAllBalances()
        saldoTokens = realSwap.getBalance(fromToken as TokenSymbol)
        if (isTestnet) this.log(`📊 Após refresh: ${saldoTokens.toFixed(4)} ${fromToken}`)
        if (saldoTokens < 0.0001 && fromToken === "USDC") {
          let totalUb = 0
          try {
            if (isTestnet) {
              totalUb = unifiedBalance.getUnifiedBalance()
            } else {
              const s = await caixa.getSaldo("mainnet")
              totalUb = s.totalUSD
            }
          } catch {
            totalUb = 0
          }
          if (totalUb > saldoTokens) {
            this.log(`🏦 Usando unified balance: $${totalUb.toFixed(2)} USDC disponível (CCTP bridge fará a ponte)`)
            saldoTokens = totalUb
          }
        }
      }

      if (saldoTokens < 0.0001) {
        this.log(`❌ Saldo insuficiente de ${fromToken} na ${ordem.rede}`)
        pregão.atualizarOrdem(ordem.id, { status: "falhou" })
        return
      }

      let saldoUsd: number
      if (isFromStable) {
        saldoUsd = saldoTokens
      } else {
        const price = await this.fetchTokenPrice(fromToken)
        saldoUsd = saldoTokens * price
        this.log(`💰 ${fromToken}: ${saldoTokens.toFixed(4)} tokens × $${price.toFixed(2)} = $${saldoUsd.toFixed(2)}`)
      }

      let valorTrade: number
      if (ordem.amountUsd && ordem.amountUsd > 0) {
        valorTrade = Math.min(ordem.amountUsd, saldoUsd * 0.9)
      } else if (isTestnet) {
        valorTrade = Math.min(VALOR_PADRAO_TRADE, saldoUsd * 0.9)
      } else {
        valorTrade = saldoUsd * 0.9
      }

      if (valorTrade < 0.5) {
        this.log(`❌ Saldo insuficiente de ${fromToken} na ${ordem.rede} (USD: $${saldoUsd.toFixed(2)})`)
        pregão.atualizarOrdem(ordem.id, { status: "falhou" })
        return
      }

      this.log(`💰 Valor preparado: $${valorTrade.toFixed(2)} ${fromToken} → ${ordem.toToken}`)

      if (!isTestnet) {
        this.log(`📦 Ordem ${ordem.par} na mainnet — aguardando batch via Professor`)
        return
      }

      await corretor.executar(ordem, valorTrade)
    } finally {
      emExecucao.delete(lockKey)
    }
  }
}

export const escriturário = new Escriturário()
