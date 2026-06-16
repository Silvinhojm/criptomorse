import { realSwap, NETWORKS } from "./real-swap-executor"
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

  async prepararOrdem(ordem: OrdemExecucao) {
    this.log(`📋 Preparando ordem: ${ordem.par} na ${ordem.rede}`)
    this.log(`   Pregueiros: ${ordem.pregueiros.join(", ")}`)
    this.log(`   Confiança média: ${ordem.confiancaMedia}%`)

    pregão.atualizarOrdem(ordem.id, { status: "pronto" })

    const fromToken = ordem.fromToken
    let valorTrade = VALOR_PADRAO_TRADE

    const netConf = NETWORKS[ordem.rede as keyof typeof NETWORKS]
    const isTestnet = netConf?.isTestnet ?? true

    // Usar saldo local da wallet (Caixa removido — só confunde)
    let saldoAtual = realSwap.getBalance(fromToken)
    if (saldoAtual < 1) {
      if (isTestnet) this.log(`🔄 Saldo ${fromToken}=${saldoAtual.toFixed(2)} — refresh on-chain...`)
      await realSwap.refreshAllBalances()
      saldoAtual = realSwap.getBalance(fromToken)
      if (isTestnet) this.log(`📊 Após refresh: ${saldoAtual.toFixed(2)} ${fromToken}`)
    }
    valorTrade = isTestnet
      ? Math.min(VALOR_PADRAO_TRADE, saldoAtual * 0.9)
      : saldoAtual * 0.9

    if (valorTrade < 1) {
      this.log(`❌ Saldo insuficiente de ${fromToken} na ${ordem.rede}`)
      pregão.atualizarOrdem(ordem.id, { status: "falhou" })
      return
    }

    this.log(`💰 Valor preparado: $${valorTrade.toFixed(2)} ${fromToken} → ${ordem.toToken}`)
    this.log(`🔗 Encaminhando para o Corretor executar...`)

    await corretor.executar(ordem, valorTrade)
  }
}

export const escriturário = new Escriturário()
