import { accountant } from "./accountant"

export interface OkSignal {
  pregueiro: string
  rede: string
  par: string
  confianca: number
  timestamp: number
  fromToken: string
  toToken: string
  amountUsd?: number
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
  amountUsd?: number
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
  private LIMIAR_OK = 2
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

    const isGridOrder = signal.pregueiro.startsWith("Grid:")
    const limiarAgentes = this.LIMIAR_OK

    // Coleta OKs válidos (dentro da janela)
    const okValidos = Array.from(porPar.entries())
      .flatMap(([nome, sinais]) => {
        const recentes = sinais.filter(s => Date.now() - s.timestamp < this.JANELA_MS)
        return recentes.length > 0 ? [{ nome, sinal: recentes[recentes.length - 1] }] : []
      })

    // Separa por tipo: agentes vs pregueiros
    const okAgentes = okValidos.filter(p => p.nome.startsWith("Agente:"))
    const okPregueiros = okValidos.filter(p => !p.nome.startsWith("Agente:") && !p.nome.startsWith("Grid:"))

    // 🔥 Consenso Híbrido: 1 agente + 1 pregueiro = ORDEM
    const TEM_LIMIAR_HIBRIDO = okAgentes.length >= 1 && okPregueiros.length >= 1
    
    // Grid orders: limiar = 1 (OK único do grid)
    const gridOk = okValidos.filter(p => p.nome.startsWith("Grid:"))
    const TEM_GRID = gridOk.length >= 1

    // Verifica se tem consenso
    const temConsenso = TEM_GRID || TEM_LIMIAR_HIBRIDO || okAgentes.length >= limiarAgentes || okPregueiros.length >= 3

    if (!temConsenso) {
      return
    }

    // Seleciona os participantes da ordem
    let participantes: { nome: string; sinal: OkSignal }[] = []
    let origem = "🏛️"

    if (TEM_GRID) {
      participantes = gridOk.slice(0, 1)
      origem = "📐 Grid"
    } else if (TEM_LIMIAR_HIBRIDO) {
      // Híbrido: 1 agente + 1 pregueiro
      participantes = [okAgentes[0], okPregueiros[0]]
      origem = "🤝 Híbrido"
    } else if (okAgentes.length >= limiarAgentes) {
      function poderVoto(a: { nome: string; sinal: { confianca: number } }): number {
        const agentName = a.nome.replace("Agente:", "")
        const score = accountant.getAgentScore(agentName)
        const winRate = score ? score.winRate / 100 : 0.5
        return a.sinal.confianca * winRate
      }
      const sorted = okAgentes
        .filter(a => a.sinal.confianca >= 30)
        .sort((a, b) => poderVoto(b) - poderVoto(a))
      if (sorted.length >= limiarAgentes) {
        participantes = sorted.slice(0, limiarAgentes)
      }
      origem = "🏛️ Agentes"
    } else if (okPregueiros.length >= 3) {
      participantes = okPregueiros.slice(0, 3)
      origem = "📊 Pregueiros"
    }

    if (participantes.length === 0) return

    // Calcula confiança média ponderada por winRate
    const agentPoder = new Map<string, number>()
    for (const p of participantes) {
      const agentName = p.nome.replace("Agente:", "")
      const score = accountant.getAgentScore(agentName)
      const winRate = score ? score.winRate / 100 : 0.5
      agentPoder.set(p.nome, winRate)
    }
    const pesoTotal = participantes.reduce((s, p) => s + (agentPoder.get(p.nome) ?? 0.5), 0)
    const confiancaMedia = Math.round(
      participantes.reduce((s, p) => s + p.sinal.confianca * (agentPoder.get(p.nome) ?? 0.5), 0) / pesoTotal
    )

    // Grid orders bypass confidence minimum
    const MAINNETS = new Set(["polygon", "base", "ethereum", "arbitrum"])
    if (!TEM_GRID && MAINNETS.has(rede) && confiancaMedia < 40) {
      this.log(`🚫 Confiança ${confiancaMedia}% < 40% mínimo em mainnet — ordem rejeitada`)
      return
    }

    // Limite de ordens ativas (máximo 10 — mais micro-trades simultâneos)
    if (this.getOrdensAtivas().length >= 10) {
      this.log(`⏳ ${this.getOrdensAtivas().length} ordens ativas — aguardando`)
      return
    }

    // Cria a ordem
    const ordem: OrdemExecucao = {
      id: `${TEM_GRID ? "grid" : "ordem"}_${Date.now()}_${rede}_${par.replace(/[^a-zA-Z0-9]/g, "_")}`,
      rede,
      par,
      fromToken: participantes[0].sinal.fromToken,
      toToken: participantes[0].sinal.toToken,
      pregueiros: participantes.map(p => p.nome),
      confiancaMedia,
      timestamp: Date.now(),
      amountUsd: participantes[0].sinal.amountUsd,
      status: "preparando"
    }

    this.ordens.push(ordem)
    
    // Log detalhado da origem da ordem
    const detalhe = TEM_GRID ? `Grid:${gridOk[0].nome}` :
                    TEM_LIMIAR_HIBRIDO ? `Agente:${okAgentes[0].nome} + Pregueiro:${okPregueiros[0].nome}` :
                    `${participantes.length} agentes`
    this.log(`${origem} ORDEM GERADA: ${par} na ${rede} (${detalhe}) conf=${confiancaMedia}%`)

    this.onOrdemCallback?.(ordem)

    // Remove os OKs usados
    for (const p of participantes) {
      const key = p.nome
      const sinais = porPar.get(key)
      if (sinais) {
        const validos = sinais.filter(s => Date.now() - s.timestamp < this.JANELA_MS)
        if (validos.length > 1) {
          // Remove apenas o OK mais recente
          const sorted = validos.sort((a, b) => b.timestamp - a.timestamp)
          const toRemove = sorted[0]
          const updated = validos.filter(s => s !== toRemove)
          if (updated.length > 0) {
            porPar.set(key, updated)
          } else {
            porPar.delete(key)
          }
        } else {
          porPar.delete(key)
        }
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
        this.log(`🧹 Ordem ${o.id} travada em "${o.status}" — marcada como falha`)
      }
      if (o.status === "executando" && agora - o.timestamp > 30000) {
        o.status = "falhou"
        this.log(`🧹 Ordem ${o.id} travada em "executando" — marcada como falha`)
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