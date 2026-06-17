import { realSwap, NETWORKS, type TokenSymbol, isStable } from "./real-swap-executor"
import { pregão, type OrdemExecucao } from "./pregão"
import { corretor } from "./corretor"

const VALOR_PADRAO_TRADE = 5

class Escriturário {
  private onLogCallback: ((msg: string) => void) | null = null

  onLog(cb: (msg: string) => void) {
    this.onLogCallback = cb
  }

  private log(msg: string) {
    console.log(`[ESCRITURÁRIO] ${msg}`)
    this.onLogCallback?.(msg)
  }

  private async fetchTokenPrice(token: string): Promise<number> {
    const coinIds: Record<string, string> = {
      WETH: "ethereum", WMATIC: "matic-network", ARB: "arbitrum",
      WBTC: "bitcoin", SOL: "solana",
    }
    const coinId = coinIds[token] ?? token.toLowerCase()
    try {
      const res = await fetch(`/api/price?ids=${coinId}`)
      const data = await res.json()
      return data[coinId] ?? 1
    } catch {
      return 1
    }
  }

  async prepararOrdem(ordem: OrdemExecucao) {
    this.log(`📋 Preparando ordem: ${ordem.par} na ${ordem.rede}`)
    this.log(`   Pregueiros: ${ordem.pregueiros.join(", ")}`)
    this.log(`   Confiança média: ${ordem.confiancaMedia}%`)

    pregão.atualizarOrdem(ordem.id, { status: "pronto" })

    const fromToken = ordem.fromToken
    const isFromStable = isStable(fromToken as TokenSymbol)

    const netConf = NETWORKS[ordem.rede as keyof typeof NETWORKS]
    const isTestnet = netConf?.isTestnet ?? true

    // Refresh saldo on-chain se parecer desatualizado
    let saldoTokens = realSwap.getBalance(fromToken as TokenSymbol)
    if (saldoTokens < 1) {
      if (isTestnet) this.log(`🔄 Saldo ${fromToken}=${saldoTokens.toFixed(4)} — refresh on-chain...`)
      await realSwap.refreshAllBalances()
      saldoTokens = realSwap.getBalance(fromToken as TokenSymbol)
      if (isTestnet) this.log(`📊 Após refresh: ${saldoTokens.toFixed(4)} ${fromToken}`)
    }

    if (saldoTokens < 0.0001) {
      this.log(`❌ Saldo insuficiente de ${fromToken} na ${ordem.rede}`)
      pregão.atualizarOrdem(ordem.id, { status: "falhou" })
      return
    }

    // Converter saldo para USD (voláteis precisam de preço, stables são 1:1)
    let saldoUsd: number
    if (isFromStable) {
      saldoUsd = saldoTokens
    } else {
      const price = await this.fetchTokenPrice(fromToken)
      saldoUsd = saldoTokens * price
      this.log(`💰 ${fromToken}: ${saldoTokens.toFixed(4)} tokens × $${price.toFixed(2)} = $${saldoUsd.toFixed(2)}`)
    }

    // Usar no máximo 90% do saldo disponível
    let valorTrade: number
    if (isTestnet) {
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
    this.log(`🔗 Encaminhando para o Corretor executar...`)

    await corretor.executar(ordem, valorTrade)
  }
}

export const escriturário = new Escriturário()
