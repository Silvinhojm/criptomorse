import { accountant } from "./accountant"
import { escolaRobos } from "./escola-robos"
import { isStable } from "./real-swap-executor"
import { setorPacotes, type TradeIntent } from "./setor-pacotes"
import { batchApprove, executeBatch, type UltraFlashSwap } from "./ultraflash"
import { realSwap, NETWORKS, type NetworkKey, type TokenSymbol, TOKEN_DECIMALS, isArcStressMode } from "./real-swap-executor"
import { hasDirectDex, getDirectDexQuote, calculateAmountOutMin } from "./direct-dex"
import { getQuote } from "./lifi-executor"
import { ethers } from "ethers"
import { gasPriceOracle } from "./gas-price-oracle"
import { positionManager } from "./position-manager"

export interface PackageResult {
  id: string
  rede: NetworkKey
  totalTrades: number
  tradesSucesso: number
  totalInvested: number
  totalReturned: number
  gasCost: number
  profit: number
  status: 'executando' | 'parcial' | 'concluido' | 'falhou'
  timestamp: number
  txHash?: string
}

export interface OkSignal {
  pregueiro: string
  rede: string
  par: string
  confianca: number
  timestamp: number
  fromToken: string
  toToken: string
  amountUsd?: number
  direcao?: "buy" | "sell"
  precoNoPalpite?: number
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

import { batchExecutor } from "./batch-executor";
class Pregão {
  private oks: OkIndex = new Map()
  private ordens: OrdemExecucao[] = []
  private cashBox: CashBoxState = {
    saldoUSDC: 0,
    saldosPorRede: {},
    ultimaAtualizacao: Date.now()
  }
  private get LIMIAR_OK(): number { return isArcStressMode() ? 1 : 2 }
  private get JANELA_MS(): number { return isArcStressMode() ? 15_000 : 30_000 }
  private get ORDEM_TIMEOUT_MS(): number { return isArcStressMode() ? 60_000 : 120_000 }
  private onOrdemCallbacks: Array<(ordem: OrdemExecucao) => void> = []
  private onLogCallbacks: Array<(msg: string) => void> = []
  private onCashBoxChangeCallbacks: Array<(state: CashBoxState) => void> = []
  private sessionStats = { trades: 0, wins: 0, losses: 0, profit: 0 }
  private static ORDENS_KEY = "arcflow_ordens"
  private static STATS_KEY = "arcflow_session_stats"
  private static PACOTES_KEY = "arcflow_pacotes_results"
  private packageResults: PackageResult[] = []
  private _redeAtiva: string = ""

  setRedeAtiva(rede: string) {
    if (rede !== this._redeAtiva) {
      const anterior = this._redeAtiva
      this._redeAtiva = rede
      this.log(`🔀 Rede ativa alterada: ${anterior || '(nenhuma)'} → ${rede}`)
      // Remove todos os OKs de redes diferentes
      for (const [chave] of this.oks) {
        const [redeNaChave] = chave.split(":")
        if (redeNaChave !== this._redeAtiva) {
          this.oks.delete(chave)
        }
      }
      // Remove ordens pendentes de redes diferentes
      let removidas = 0
      for (const o of this.ordens) {
        if (o.rede !== this._redeAtiva && o.status === "preparando") {
          o.status = "falhou"
          o.errorMsg = `Rede diferente da ativa (${o.rede} ≠ ${this._redeAtiva})`
          removidas++
        }
      }
      if (removidas > 0) {
        this._saveOrdens()
        this.log(`🧹 ${removidas} ordens de redes diferentes canceladas`)
      }
    }
  }

  getRedeAtiva(): string { return this._redeAtiva }

  constructor() {
    this._loadOrdens()
    this._loadStats()
    this._loadPackageResults()
  }

  private _loadPackageResults(): void {
    try {
      const raw = localStorage.getItem(Pregão.PACOTES_KEY)
      if (raw) this.packageResults = JSON.parse(raw)
    } catch {}
  }

  private _savePackageResults(): void {
    try {
      localStorage.setItem(Pregão.PACOTES_KEY, JSON.stringify(this.packageResults.slice(-50)))
    } catch {}
  }

  getPackageResults(): PackageResult[] {
    return [...this.packageResults].reverse()
  }

  private _saveOrdens(): void {
    try {
      const ativas = this.ordens.filter(o => o.status !== "concluido" && o.status !== "falhou")
      localStorage.setItem(Pregão.ORDENS_KEY, JSON.stringify(ativas))
    } catch {}
  }

  private _loadOrdens(): void {
    try {
      const raw = localStorage.getItem(Pregão.ORDENS_KEY)
      if (!raw) return
      const saved: OrdemExecucao[] = JSON.parse(raw)
      for (const o of saved) {
        const exists = this.ordens.some(ex => ex.id === o.id)
        if (!exists) {
          this.ordens.push(o)
        }
      }
    } catch {}
  }

  private _saveStats(): void {
    try {
      localStorage.setItem(Pregão.STATS_KEY, JSON.stringify(this.sessionStats))
    } catch {}
  }

  private _loadStats(): void {
    try {
      const raw = localStorage.getItem(Pregão.STATS_KEY)
      if (!raw) return
      const saved = JSON.parse(raw)
      this.sessionStats = { ...this.sessionStats, ...saved }
    } catch {}
  }

  onOrdem(cb: (ordem: OrdemExecucao) => void) {
    this.onOrdemCallbacks.push(cb)
    return () => { this.onOrdemCallbacks = this.onOrdemCallbacks.filter(c => c !== cb) }
  }

  onLog(cb: (msg: string) => void) {
    this.onLogCallbacks.push(cb)
    return () => { this.onLogCallbacks = this.onLogCallbacks.filter(c => c !== cb) }
  }

  onCashBoxChange(cb: (state: CashBoxState) => void) {
    this.onCashBoxChangeCallbacks.push(cb)
    return () => { this.onCashBoxChangeCallbacks = this.onCashBoxChangeCallbacks.filter(c => c !== cb) }
  }

  adicionarLog(msg: string) {
    for (const cb of this.onLogCallbacks) cb(msg)
  }

  private log(msg: string) {
    console.log(`[PREGÃO] ${msg}`)
    for (const cb of this.onLogCallbacks) cb(msg)
  }

  registrarCashBox(
    saldoUSDC: number,
    saldosPorRede: Record<string, Record<string, number>>,
    unifiedBalance?: { totalUSD: number; porRede: Record<string, number> }
  ) {
    this.cashBox = { saldoUSDC, saldosPorRede, ultimaAtualizacao: Date.now(), unifiedBalance }
    for (const cb of this.onCashBoxChangeCallbacks) cb(this.cashBox)
  }

  atualizarUnifiedBalance(totalUSD: number, porRede: Record<string, number>) {
    this.cashBox.unifiedBalance = { totalUSD, porRede }
    this.cashBox.ultimaAtualizacao = Date.now()
    for (const cb of this.onCashBoxChangeCallbacks) cb(this.cashBox)
  }

  getCashBox(): CashBoxState {
    return { ...this.cashBox }
  }

  receberOK(signal: OkSignal) {
    // Sanitizar confianca antes de processar
    signal.confianca = Math.min(100, Math.max(0, signal.confianca ?? 0))
    if (isNaN(signal.confianca)) signal.confianca = 0

    // Ignorar sinais de redes diferentes da ativa (exceto se nenhuma rede ativa foi definida)
    if (this._redeAtiva && signal.rede !== this._redeAtiva) {
      this.log(`🚫 Sinal ignorado: ${signal.pregueiro} → ${signal.par} na ${signal.rede} (rede ativa: ${this._redeAtiva})`)
      return
    }

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

    // 🎓 Verifica se o sinal vem de um robô em turno ativo E verificado (jobs como prova)
    // 🏆 Ou robô promovido pelo Professor (avaliação de pares consistente)
    const nomeAgente = signal.pregueiro.startsWith("Agente:") ? signal.pregueiro.replace("Agente:", "") : ""
    const isVerified = nomeAgente !== "" && escolaRobos.isOnShift(nomeAgente) && escolaRobos.isVerified(nomeAgente)
    const isPromovido = nomeAgente !== "" && escolaRobos.isOnShift(nomeAgente) && escolaRobos.isPromovido(nomeAgente)
    const isOnShiftUnverified = nomeAgente !== "" && escolaRobos.isOnShift(nomeAgente) && !escolaRobos.isVerified(nomeAgente) && !escolaRobos.isPromovido(nomeAgente)

    // 🔥 Consenso Híbrido: 1 agente + 1 pregueiro = ORDEM
    const TEM_LIMIAR_HIBRIDO = okAgentes.length >= 1 && okPregueiros.length >= 1
    
    // Grid orders: limiar = 1 (OK único do grid)
    const gridOk = okValidos.filter(p => p.nome.startsWith("Grid:"))
    const TEM_GRID = gridOk.length >= 1

    // Verifica se tem consenso (robô verificado ou promovido em turno não precisa de consenso)
    const temConsenso = isVerified || isPromovido || TEM_GRID || TEM_LIMIAR_HIBRIDO || okAgentes.length >= limiarAgentes || okPregueiros.length >= 3

    if (!temConsenso) {
      return
    }

    // Seleciona os participantes da ordem
    let participantes: { nome: string; sinal: OkSignal }[] = []
    let origem = "🏛️"

    if (isPromovido) {
      participantes = [{ nome: signal.pregueiro, sinal: signal }]
      origem = "🏆 Promovido"
      this.log(`🏆 Ordem de robô promovido: ${nomeAgente} → ${signal.par} em ${rede}`)
    } else if (isVerified) {
      participantes = [{ nome: signal.pregueiro, sinal: signal }]
      origem = "🎓 Verificado"
      this.log(`🎓 Ordem de robô verificado: ${nomeAgente} → ${signal.par} em ${rede}`)
    } else if (isOnShiftUnverified) {
      this.log(`📚 ${nomeAgente} em turno mas ainda precisa de ${Math.max(0, 3 - escolaRobos.getRobo(nomeAgente).jobsCompletos)} jobs para ser verificado`)
    } else if (TEM_GRID) {
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
    let confiancaMedia = 0
    if (pesoTotal > 0) {
      confiancaMedia = Math.round(
        participantes.reduce((s, p) => s + p.sinal.confianca * (agentPoder.get(p.nome) ?? 0.5), 0) / pesoTotal
      )
    }
    if (isNaN(confiancaMedia) || !isFinite(confiancaMedia) || confiancaMedia < 30) {
      this.log(`⛔ Confiança inválida (${confiancaMedia}%) — ordem descartada`)
      return
    }

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

    // Previne ordem duplicada do mesmo par+direção+rede
    const ordemFrom = participantes[0].sinal.fromToken
    const ordemTo = participantes[0].sinal.toToken
    const existeAtiva = this.ordens.some(o =>
      (o.status === "preparando" || o.status === "pronto" || o.status === "executando") &&
      o.fromToken === ordemFrom && o.toToken === ordemTo && o.rede === rede
    )
    if (existeAtiva) {
      this.log(`⛔ Já existe ordem ativa para ${ordemFrom}→${ordemTo}@${rede} — descartando duplicata`)
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
    this._saveOrdens()
    
    // Log detalhado da origem da ordem
    const detalhe = TEM_GRID ? `Grid:${gridOk[0].nome}` :
                    TEM_LIMIAR_HIBRIDO ? `Agente:${okAgentes[0].nome} + Pregueiro:${okPregueiros[0].nome}` :
                    `${participantes.length} agentes`
    this.log(`${origem} ORDEM GERADA: ${par} na ${rede} (${detalhe}) conf=${confiancaMedia}%`)

    for (const cb of this.onOrdemCallbacks) cb(ordem)

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
      const wasCompleted = ordem.status === "concluido"
      Object.assign(ordem, update)
      if (ordem.status === "concluido" && ordem.resultado && !wasCompleted) {
        const isBuyOpening = isStable(ordem.fromToken as any) && !isStable(ordem.toToken as any)
        if (!isBuyOpening) {
          this.sessionStats.trades++
          if (ordem.resultado.profit > 0) {
            this.sessionStats.wins++
          } else {
            this.sessionStats.losses++
          }
          this.sessionStats.profit += ordem.resultado.profit
        }
        this._saveStats()
      }
      this._saveOrdens()
      for (const cb of this.onOrdemCallbacks) cb(ordem)
    }
  }

  getOrdensAtivas(): OrdemExecucao[] {
    const agora = Date.now()
    for (const o of this.ordens) {
      const stuck = agora - o.timestamp > this.ORDEM_TIMEOUT_MS
      if (stuck && (o.status === "preparando" || o.status === "pronto" || o.status === "executando")) {
        this.log(`⏰ Ordem ${o.id} expirou (${Math.round((agora - o.timestamp) / 1000)}s em "${o.status}") — marcando como falha`)
        o.status = "falhou"
        this._saveOrdens()
        for (const cb of this.onOrdemCallbacks) cb(o)
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
    let mudou = false
    for (const o of this.ordens) {
      if ((o.status === "preparando" || o.status === "pronto") && agora - o.timestamp > 5000) {
        o.status = "falhou"
        mudou = true
        this.log(`🧹 Ordem ${o.id} travada em "${o.status}" — marcada como falha`)
      }
      if (o.status === "executando" && agora - o.timestamp > 30000) {
        o.status = "falhou"
        mudou = true
        this.log(`🧹 Ordem ${o.id} travada em "executando" — marcada como falha`)
      }
    }
    if (mudou) this._saveOrdens()
  }

  private _quoteWithTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> {
    return Promise.race([
      promise,
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms)
      ),
    ]).catch(err => {
      this.log(`[PREGÃO] ⏰ ${err.message}`)
      return null
    })
  }

  private async _quoteTrade(
    trade: TradeIntent,
    net: any,
    redeKey: NetworkKey,
  ): Promise<import("./ultraflash").UltraFlashSwap | null> {
    const fromDecimals = TOKEN_DECIMALS[trade.fromToken] ?? 6
    const toDecimals = TOKEN_DECIMALS[trade.toToken] ?? 6
    const fromTokenAddr = (net.tokens as any)[trade.fromToken]
    const toTokenAddr = (net.tokens as any)[trade.toToken]
    if (!fromTokenAddr || !toTokenAddr) return null

    const fromPrice = await realSwap.fetchTokenPrice(trade.fromToken).catch(() => 1)
    const fromAmountRaw = ethers.parseUnits((trade.amount / fromPrice).toFixed(fromDecimals), fromDecimals)

    const [dexQuote, lifiQuote] = await Promise.all([
      hasDirectDex(redeKey)
        ? this._quoteWithTimeout(
            getDirectDexQuote(redeKey, realSwap.getProvider()!, fromTokenAddr, toTokenAddr, fromAmountRaw),
            5000, `DEX ${trade.fromToken}→${trade.toToken}`
          )
        : Promise.resolve(null),
      // LI.FI é fallback — timeout maior pois passa pelo proxy
      this._quoteWithTimeout(
        getQuote({
          fromChain: net.chainId, toChain: net.chainId,
          fromToken: fromTokenAddr, toToken: toTokenAddr,
          fromAmount: fromAmountRaw.toString(),
          fromAddress: realSwap.getAddress(),
          toAddress: realSwap.getAddress(), slippage: 0.005,
        }),
        10000, `LI.FI ${trade.fromToken}→${trade.toToken}`
      ),
    ])

    const dexOut = dexQuote && dexQuote.amountOut > 0n
      ? Number(ethers.formatUnits(dexQuote.amountOut, toDecimals))
      : 0
    const lifiOut = lifiQuote?.transactionRequest?.data && lifiQuote?.transactionRequest?.to
      ? parseFloat(lifiQuote.toAmount ?? "0") / Math.pow(10, toDecimals)
      : 0

    if (dexOut >= lifiOut && dexOut > 0 && dexQuote) {
      const amountOutMin = calculateAmountOutMin(dexQuote.amountOut, 100)
      const deadline = Math.floor(Date.now() / 1000) + 600
      const iface = new ethers.Interface([
        "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)",
      ])
      return {
        fromToken: trade.fromToken, toToken: trade.toToken,
        amountRaw: fromAmountRaw, amountUsd: trade.amount,
        target: dexQuote.router,
        calldata: iface.encodeFunctionData("swapExactTokensForTokens", [
          fromAmountRaw, amountOutMin, dexQuote.path, realSwap.getAddress(), deadline,
        ]),
        value: 0n, spender: dexQuote.router,
        expectedToAmount: dexOut, network: redeKey,
      }
    }

    if (lifiOut > 0 && lifiQuote?.transactionRequest) {
      return {
        fromToken: trade.fromToken, toToken: trade.toToken,
        amountRaw: fromAmountRaw, amountUsd: trade.amount,
        target: lifiQuote.transactionRequest.to,
        calldata: lifiQuote.transactionRequest.data,
        value: BigInt(lifiQuote.transactionRequest.value ?? "0"),
        spender: lifiQuote.transactionRequest.to,
        expectedToAmount: lifiOut, network: redeKey,
      }
    }

    return null
  }

  async executarPacotes(): Promise<void> {
    const redeAtual = realSwap.getNetworkKey()
    if (!redeAtual) return

    const pacote = setorPacotes.getPacotePorRede(redeAtual)
    if (!pacote) return

    pacote.attempts = (pacote.attempts || 0) + 1
    const isUltimaTentativa = pacote.attempts >= 3

    // ─── 1. Threshold adaptativo por rede ──
    const gasCost = await gasPriceOracle.getGasCost(pacote.rede).catch(() => 0.02)
    const basePct = pacote.rede === "ethereum" ? 0.005 : pacote.rede === "base" || pacote.rede === "arbitrum" ? 0.003 : 0.001
    const pctThreshold = isUltimaTentativa ? basePct * 0.3 : Math.max(basePct - (pacote.attempts - 1) * (basePct * 0.35), basePct * 0.2)
    const thresholdPorTrade = pacote.trades.map(t => Math.max(t.amount * pctThreshold, 0.005))
    const lucroMinimoTotal = thresholdPorTrade.reduce((s, v) => s + v, 0)

    if (pacote.expectedProfitTotal < lucroMinimoTotal && !isUltimaTentativa) {
      this.log(`⏳ Pacote ${pacote.id} tentativa #${pacote.attempts}: lucro esp. $${pacote.expectedProfitTotal.toFixed(4)} < $${lucroMinimoTotal.toFixed(4)} (${(pctThreshold*100).toFixed(1)}%/trade)`)
      setorPacotes.registrarPacote(pacote)
      return
    }

    const net = NETWORKS[pacote.rede]
    if (!net) return

    const currentNet = realSwap.getNetworkKey()
    if (currentNet !== pacote.rede) {
      this.log(`[PREGÃO] 🔀 Alternando rede: ${currentNet} → ${pacote.rede}`)
      await realSwap.switchNetwork(pacote.rede)
    }

    // ─── 2. Quoting paralelo para TODOS os trades de uma vez ──
    const results = await Promise.all(
      pacote.trades.map(trade => this._quoteTrade(trade, net, pacote.rede))
    )

    const swaps = results.filter(Boolean) as import("./ultraflash").UltraFlashSwap[]
    const erros = results.filter(r => r === null).length

    if (swaps.length === 0) {
      this.log(`[PREGÃO] ❌ Nenhum swap válido no pacote ${pacote.id} (${erros} erros)`)
      return
    }

    if (erros > 0) {
      this.log(`[PREGÃO] ⚠️ ${erros}/${pacote.trades.length} trades sem rota — prosseguindo com ${swaps.length}`)
    }

    // ─── 3. Gas-aware threshold (relaxa na última tentativa) ──
    const swapsToUSD = async (swaps: UltraFlashSwap[]): Promise<number> => {
      let total = 0
      for (const sw of swaps) {
        const isStableTo = ["USDC", "USDT", "DAI", "EURC"].includes(sw.toToken)
        const price = isStableTo ? 1 : await realSwap.fetchTokenPrice(sw.toToken as TokenSymbol).catch(() => 1)
        total += sw.expectedToAmount * price
      }
      return total
    }
    const expectedReturnUSD = await swapsToUSD(swaps)
    const lucroRealEsperado = expectedReturnUSD - swaps.reduce((s, sw) => s + sw.amountUsd, 0)
    const estimatedGasTotal = gasCost * (1 + swaps.length * 0.3)
    const gasMultiplier = isUltimaTentativa ? 1.0 : 2.0

    if (lucroRealEsperado < lucroMinimoTotal && !isUltimaTentativa) {
      this.log(`[PREGÃO] ⏳ Lucro real $${lucroRealEsperado.toFixed(4)} < mínimo $${lucroMinimoTotal.toFixed(4)} — requote rejeitado (attempt #${pacote.attempts})`)
      return
    }

    if (lucroRealEsperado < estimatedGasTotal * gasMultiplier && !isUltimaTentativa) {
      this.log(`[PREGÃO] ⏳ Lucro $${lucroRealEsperado.toFixed(4)} < ${gasMultiplier}x gas $${(estimatedGasTotal * gasMultiplier).toFixed(4)} — aguardando (attempt #${pacote.attempts})`)
      return
    }

    const pkgResult: PackageResult = {
      id: pacote.id,
      rede: pacote.rede,
      totalTrades: swaps.length,
      tradesSucesso: 0,
      totalInvested: swaps.reduce((s, sw) => s + sw.amountUsd, 0),
      totalReturned: 0,
      gasCost: estimatedGasTotal,
      profit: 0,
      status: 'executando',
      timestamp: Date.now(),
    }
    this.packageResults.push(pkgResult)

    this.log(`[PREGÃO] 🚀 Pacote ${pacote.id}: ${swaps.length} swaps em ${pacote.rede} | lucro esp.: $${lucroRealEsperado.toFixed(4)} | gas: $${estimatedGasTotal.toFixed(4)}`)

    // ─── 4. Modo Papel: simula trades sem gastar gas ──
    const isPaper = typeof window !== "undefined" && localStorage.getItem("arcflow_paper_mode") === "true"
    if (isPaper) {
      this.log(`[PREGÃO] 📝 Modo Papel: simulando ${swaps.length} trades em ${pacote.rede}`)
      let totalReturnedUSD = 0
      let tradesOk = 0
      for (let i = 0; i < swaps.length; i++) {
        const sw = swaps[i]
        const trade = pacote.trades[i]
        if (!trade) continue
        const isStableTo = ["USDC", "USDT", "DAI", "EURC"].includes(trade.toToken)
        const toPrice = isStableTo ? 1 : await realSwap.fetchTokenPrice(trade.toToken as TokenSymbol).catch(() => 1)
        const toAmountUSD = sw.expectedToAmount * toPrice
        totalReturnedUSD += toAmountUSD
        tradesOk++
        if (trade.ordemId) {
          this.atualizarOrdem(trade.ordemId, {
            status: "concluido",
            resultado: {
              txHash: "paper_" + Date.now(),
              explorerUrl: "",
              fromAmount: trade.amount,
              toAmount: toAmountUSD,
              profit: toAmountUSD - trade.amount,
            },
          })
        }
        const isStableFrom = ["USDC", "USDT", "DAI", "EURC"].includes(trade.fromToken)
        if (!isStableTo && isStableFrom) {
          positionManager.openPosition(
            pacote.rede, trade.toToken as TokenSymbol, trade.fromToken as TokenSymbol,
            sw.expectedToAmount, trade.amount, trade.amount / (sw.expectedToAmount || 0.000000001),
          )
        }
        if (!isStableFrom && isStableTo) {
          const pos = positionManager.getOpenPositions()
            .find(p => p.boughtToken === trade.fromToken && p.networkKey === pacote.rede && p.status === "open")
          if (pos) positionManager.closePosition(pos.id, sw.expectedToAmount / trade.amount)
        }
        this.log(`[PREGÃO] 📝 ${trade.fromToken}→${trade.toToken}: $${trade.amount} → $${toAmountUSD.toFixed(4)} (simulado)`)
      }
      const profitReal = totalReturnedUSD - pkgResult.totalInvested
      pkgResult.tradesSucesso = tradesOk
      pkgResult.totalReturned = totalReturnedUSD
      pkgResult.profit = profitReal
      pkgResult.status = 'concluido'
      this._savePackageResults()
      this.log(`[PREGÃO] 📝 Pacote ${pacote.id}: ${tradesOk}/${swaps.length} simulado | lucro: $${profitReal.toFixed(4)}`)
      return
    }

    try {
      await batchApprove(realSwap.getSigner()!, realSwap.getAddress(), pacote.rede as NetworkKey, swaps, (m) => this.log(`[PREGÃO] ${m}`))
      const batchResult = await executeBatch(realSwap.getSigner()!, pacote.rede as NetworkKey, swaps, (m) => this.log(`[PREGÃO] ${m}`))

      if (!batchResult.success) {
        this.log(`[PREGÃO] ❌ Batch UltraFlash falhou em ${pacote.rede}`)
        pkgResult.status = 'falhou'
        this._savePackageResults()
        for (const trade of pacote.trades) {
          if (trade.ordemId) this.atualizarOrdem(trade.ordemId, { status: "falhou" })
        }
        return
      }

      let totalReturnedUSD = 0
      let tradesOk = 0

      for (let i = 0; i < batchResult.results.length; i++) {
        const r = batchResult.results[i]
        const trade = pacote.trades[i]
        if (!trade) continue

        if (!r.success) {
          this.log(`[PREGÃO] ❌ Swap ${trade.fromToken}→${trade.toToken} falhou no batch`)
          if (trade.ordemId) this.atualizarOrdem(trade.ordemId, { status: "falhou" })
          continue
        }

        // Fix 0: expectedToAmount é em unidades de token, não USD
        const isStableTo = ["USDC", "USDT", "DAI", "EURC"].includes(trade.toToken)
        const toPrice = isStableTo ? 1 : await realSwap.fetchTokenPrice(trade.toToken as TokenSymbol).catch(() => 1)
        const toAmountUSD = r.swap.expectedToAmount * toPrice
        totalReturnedUSD += toAmountUSD
        tradesOk++

        if (trade.ordemId) {
          this.atualizarOrdem(trade.ordemId, {
            status: "concluido",
            resultado: {
              txHash: batchResult.txHash ?? "",
              explorerUrl: `${(net as any).explorerUrl || (net as any).explorer || ""}/tx/${batchResult.txHash}`,
              fromAmount: trade.amount,
              toAmount: toAmountUSD,
              profit: toAmountUSD - trade.amount,
            },
          })
        }

        // Se comprou volátil → abre posição
        // Se vendeu volátil → fecha posição correspondente (delta neutro)
        const isStableFrom = ["USDC", "USDT", "DAI", "EURC"].includes(trade.fromToken)
        if (!isStableTo && isStableFrom) {
          positionManager.openPosition(
            pacote.rede,
            trade.toToken as TokenSymbol,
            trade.fromToken as TokenSymbol,
            r.swap.expectedToAmount,
            trade.amount,
            trade.amount / (r.swap.expectedToAmount || 0.000000001),
          )
        }
        if (!isStableFrom && isStableTo) {
          const pos = positionManager.getOpenPositions()
            .find(p => p.boughtToken === trade.fromToken && p.networkKey === pacote.rede && p.status === "open")
          if (pos) {
            positionManager.closePosition(pos.id, r.swap.expectedToAmount / trade.amount)
          }
        }

        const pctChange = ((toAmountUSD / trade.amount - 1) * 100)
        this.log(`[PREGÃO] ✅ ${trade.fromToken}→${trade.toToken} via ${r.swap.network}: $${trade.amount} → $${toAmountUSD.toFixed(4)} (${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%)`)
      }

      const profitReal = totalReturnedUSD - pkgResult.totalInvested
      pkgResult.tradesSucesso = tradesOk
      pkgResult.totalReturned = totalReturnedUSD
      pkgResult.profit = profitReal - (batchResult.totalGasUsed ? estimatedGasTotal : 0)
      pkgResult.txHash = batchResult.txHash
      pkgResult.status = tradesOk === pkgResult.totalTrades ? 'concluido' : 'parcial'
      this._savePackageResults()

      this.log(`[PREGÃO] ✅ Pacote ${pacote.id}: ${tradesOk}/${batchResult.results.length} sucesso | investido: $${pkgResult.totalInvested.toFixed(2)} | retorno: $${totalReturnedUSD.toFixed(4)} | lucro: $${profitReal.toFixed(4)} | TX: ${batchResult.txHash?.slice(0, 10)}...`)
    } catch (err: any) {
      this.log(`[PREGÃO] ❌ Erro executando pacote ${pacote.id}: ${err.message.slice(0, 150)}`)
      pkgResult.status = 'falhou'
      this._savePackageResults()
      for (const trade of pacote.trades) {
        if (trade.ordemId) this.atualizarOrdem(trade.ordemId, { status: "falhou" })
      }
    }
  }

  getStatus(): { ordensAtivas: number; ordensConcluidas: number; oksPendentes: number; sessionTrades: number; sessionWins: number; sessionLosses: number; sessionProfit: number } {
    return {
      ordensAtivas: this.getOrdensAtivas().length,
      ordensConcluidas: this.getOrdensConcluidas().length,
      oksPendentes: this.getOksAtivos().reduce((s, o) => s + o.total, 0),
      sessionTrades: this.sessionStats.trades,
      sessionWins: this.sessionStats.wins,
      sessionLosses: this.sessionStats.losses,
      sessionProfit: this.sessionStats.profit
    }
  }

  verificarShiftRotacao(): boolean {
    return escolaRobos.verificarRotacao()
  }
}

export const pregão = new Pregão()