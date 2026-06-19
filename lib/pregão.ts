export interface OkSignal {
  pregueiro: string
  rede: string
  par: string
  confianca: number
  timestamp: number
  fromToken: string
  toToken: string
}

export interface OrdemExecucao {
  id: string
  rede: string
  par: string
  fromToken: string
  toToken: string
  pregueiros: string[]
  confiancaMedia: number
  timestamp: number
  status: "preparando" | "pronto" | "executando" | "concluido" | "falhou"
  resultado?: {
    txHash: string
    explorerUrl: string
    fromAmount: number
    toAmount: number
    profit: number
  }
}

export interface CashBoxState {
  saldoUSDC: number
  saldosPorRede: Record<string, Record<string, number>>
  ultimaAtualizacao: number
  unifiedBalance?: {
    totalUSD: number
    porRede: Record<string, number>
  }
}

type OkIndex = Map<string, Map<string, OkSignal[]>>

class Pregão {
  private oks: OkIndex = new Map()
  private ordens: OrdemExecucao[] = []
  private cashBox: CashBoxState = {
    saldoUSDC: 0,
    saldosPorRede: {},
    ultimaAtualizacao: Date.now()
  }
  private LIMIAR_OK = 3
  private JANELA_MS = 30_000
  private ORDEM_TIMEOUT_MS = 120_000 // 2 min — trava em "preparando" = falha
  private onOrdemCallback: ((ordem: OrdemExecucao) => void) | null = null
  private onLogCallback: ((msg: string) => void) | null = null
  private onCashBoxChangeCallback: ((state: CashBoxState) => void) | null = null

  onOrdem(cb: (ordem: OrdemExecucao) => void) {
    this.onOrdemCallback = cb
  }

  onLog(cb: (msg: string) => void) {
    this.onLogCallback = cb
  }

  onCashBoxChange(cb: (state: CashBoxState) => void) {
    this.onCashBoxChangeCallback = cb
  }

  adicionarLog(msg: string) {
    this.onLogCallback?.(msg)
  }

  private log(msg: string) {
    console.log(`[PREGÃO] ${msg}`)
    this.onLogCallback?.(msg)
  }

  registrarCashBox(
    saldoUSDC: number,
    saldosPorRede: Record<string, Record<string, number>>,
    unifiedBalance?: { totalUSD: number; porRede: Record<string, number> }
  ) {
    this.cashBox = { saldoUSDC, saldosPorRede, ultimaAtualizacao: Date.now(), unifiedBalance }
    this.onCashBoxChangeCallback?.(this.cashBox)
  }

  atualizarUnifiedBalance(totalUSD: number, porRede: Record<string, number>) {
    this.cashBox.unifiedBalance = { totalUSD, porRede }
    this.cashBox.ultimaAtualizacao = Date.now()
    this.onCashBoxChangeCallback?.(this.cashBox)
  }

  getCashBox(): CashBoxState {
    return { ...this.cashBox }
  }

  receberOK(signal: OkSignal) {
    const chave = `${signal.rede}:${signal.par}`
    if (!this.oks.has(chave)) {
      this.oks.set(chave, new Map())
    }
    const porPar = this.oks.get(chave)!
    if (!porPar.has(signal.pregueiro)) {
      porPar.set(signal.pregueiro, [])
    }
    porPar.get(signal.pregueiro)!.push(signal)

    this.log(`📢 OK recebido: ${signal.pregueiro} → ${signal.par} na ${signal.rede} (${signal.confianca}%)`)

    this.verificarOrdem(chave, signal)
    this.limparExpirados()
  }

  private verificarOrdem(chave: string, signal: OkSignal) {
    const [rede, par] = chave.split(":")
    const porPar = this.oks.get(chave)
    if (!porPar) return

    const okValidos = Array.from(porPar.entries())
      .flatMap(([nome, sinais]) => {
        const recentes = sinais.filter(s => Date.now() - s.timestamp < this.JANELA_MS)
        return recentes.length > 0 ? [{ nome, sinal: recentes[recentes.length - 1] }] : []
      })

    if (okValidos.length >= this.LIMIAR_OK) {
      const participantes = okValidos.slice(0, this.LIMIAR_OK)
      const confiancaMedia = Math.round(participantes.reduce((s, p) => s + p.sinal.confianca, 0) / participantes.length)

      // Confiança mínima em mainnet: 50%
      if (rede === "polygon" && confiancaMedia < 50) {
        this.log(`🚫 Confiança ${confiancaMedia}% < 50% mínimo em mainnet — ordem rejeitada`)
        return
      }

      // Sequencial: uma ordem por vez, aguarda confirmação na rede
      if (this.getOrdensAtivas().length > 0) {
        this.log(`⏳ Ordem anterior ainda não confirmada — aguardando`)
        return
      }

      const ordem: OrdemExecucao = {
        id: `ordem_${Date.now()}_${rede}_${par.replace(/[^a-zA-Z0-9]/g, "_")}`,
        rede,
        par,
        fromToken: participantes[0].sinal.fromToken,
        toToken: participantes[0].sinal.toToken,
        pregueiros: participantes.map(p => p.nome),
        confiancaMedia,
        timestamp: Date.now(),
        status: "preparando"
      }

      this.ordens.push(ordem)
      this.log(`🏛️ ORDEM GERADA: ${par} na ${rede} (${ordem.pregueiros.join(", ")})`)
      this.onOrdemCallback?.(ordem)

      // Limpar OKs usados
      for (const p of participantes) {
        porPar.delete(p.nome)
      }
    }
  }

  atualizarOrdem(id: string, update: Partial<OrdemExecucao>) {
    const ordem = this.ordens.find(o => o.id === id)
    if (ordem) {
      Object.assign(ordem, update)
      this.onOrdemCallback?.(ordem)
    }
  }

  getOrdensAtivas(): OrdemExecucao[] {
    const agora = Date.now()
    for (const o of this.ordens) {
      const stuck = agora - o.timestamp > this.ORDEM_TIMEOUT_MS
      if (stuck && (o.status === "preparando" || o.status === "pronto" || o.status === "executando")) {
        this.log(`⏰ Ordem ${o.id} expirou (${Math.round((agora - o.timestamp) / 1000)}s em "${o.status}") — marcando como falha`)
        o.status = "falhou"
        this.onOrdemCallback?.(o)
      }
    }
    return this.ordens.filter(o => o.status !== "concluido" && o.status !== "falhou")
  }

  getOrdensConcluidas(): OrdemExecucao[] {
    return this.ordens.filter(o => o.status === "concluido" || o.status === "falhou")
  }

  getTodasOrdens(): OrdemExecucao[] {
    return [...this.ordens]
  }

  getOksAtivos(): { par: string; rede: string; pregueiros: string[]; total: number }[] {
    const resultado: { par: string; rede: string; pregueiros: string[]; total: number }[] = []
    for (const [chave, porPar] of this.oks.entries()) {
      const [rede, par] = chave.split(":")
      const ativos = Array.from(porPar.entries())
        .filter(([, sinais]) => sinais.some(s => Date.now() - s.timestamp < this.JANELA_MS))
        .map(([nome]) => nome)
      if (ativos.length > 0) {
        resultado.push({ par, rede, pregueiros: ativos, total: ativos.length })
      }
    }
    return resultado
  }

  private limparExpirados() {
    const agora = Date.now()
    for (const [, porPar] of this.oks.entries()) {
      for (const [nome, sinais] of porPar.entries()) {
        const validos = sinais.filter(s => agora - s.timestamp < this.JANELA_MS)
        if (validos.length === 0) {
          porPar.delete(nome)
        } else {
          porPar.set(nome, validos)
        }
      }
    }
  }

  limparOrdensTravadas() {
    const agora = Date.now()
    for (const o of this.ordens) {
      if ((o.status === "preparando" || o.status === "pronto") && agora - o.timestamp > 5000) {
        o.status = "falhou"
      }
      if (o.status === "executando" && agora - o.timestamp > 30000) {
        o.status = "falhou"
      }
    }
  }

  getStatus(): { ordensAtivas: number; ordensConcluidas: number; oksPendentes: number } {
    return {
      ordensAtivas: this.getOrdensAtivas().length,
      ordensConcluidas: this.getOrdensConcluidas().length,
      oksPendentes: this.getOksAtivos().reduce((s, o) => s + o.total, 0)
    }
  }
}

export const pregão = new Pregão()
