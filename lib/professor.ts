import { escolaRobos } from "./escola-robos"
import { positionManager } from "./position-manager"
import { parametrosRobos } from "./parametros-robos"
import { narrador } from "./narrator"
import { pairSector, type ParPerformance } from "./pair-sector"
import { accountant } from "./accountant"
import { setorPacotes, type TradeIntent } from "./setor-pacotes"
import { TRADING_PAIRS, NETWORKS, realSwap, type TokenSymbol, type NetworkKey } from "./real-swap-executor"

export interface PalpiteRobo {
  roboNome: string
  rede: string
  par: string
  fromToken: string
  toToken: string
  direcao: "buy" | "sell"
  confianca: number
  precoNoPalpite: number
  timestamp: number
}

interface PalpitePendente extends PalpiteRobo {
  avaliado: boolean
}

const PALPITES_KEY = "arcflow_professor_palpites"
const INTERVALO_AVALIACAO_MS = 5 * 60 * 1000

function gerarFeedbackAcerto(confianca: number): string {
  if (confianca > 70) return "Continue nesta direção — seu modelo de momentum está calibrado"
  if (confianca < 40) return "Acertou mas estava inseguro — confie mais nos sinais fortes"
  return "Bom resultado — consistência leva à promoção"
}

function gerarFeedbackErro(confianca: number): string {
  if (confianca > 70) return "Estava muito confiante e errou — revise o threshold de entrada"
  if (confianca < 40) return "Erro esperado — continue explorando este par"
  return "Ajuste seus parâmetros — o mercado não confirmou sua análise"
}

function gerarFeedbackAjuste(nome: string, motivo: string, params: { confiancaMinima: number; thresholdEntrada: number }): string {
  return `⚙️ Professor ajustou ${nome}: ${motivo} (conf.min=${params.confiancaMinima}%, entrada=${(params.thresholdEntrada*100).toFixed(2)}%)`
}

class Professor {
  private palpites: PalpitePendente[] = []
  private ultimaAvaliacao: number = 0
  private streakErro: Map<string, number> = new Map()
  private streakAcerto: Map<string, number> = new Map()

  constructor() {
    this._carregar()
  }

  private _carregar() {
    try {
      const raw = localStorage.getItem(PALPITES_KEY)
      if (raw) {
        this.palpites = JSON.parse(raw)
      }
    } catch {
      // silencioso
    }
  }

  private _salvar() {
    try {
      localStorage.setItem(PALPITES_KEY, JSON.stringify(this.palpites))
    } catch {
      // silencioso
    }
  }

  registrarPalpite(palpite: PalpiteRobo) {
    this.palpites.push({ ...palpite, avaliado: false })
    this._salvar()
  }

  async avaliarPalpites(): Promise<void> {
    const agora = Date.now()
    if (agora - this.ultimaAvaliacao < INTERVALO_AVALIACAO_MS) return
    this.ultimaAvaliacao = agora

    const pendentes = this.palpites.filter(p => !p.avaliado && (agora - p.timestamp) >= INTERVALO_AVALIACAO_MS)
    if (pendentes.length === 0) return

    for (const palpite of pendentes) {
      try {
        await this._avaliar(palpite)
      } catch (e) {
        console.warn(`[PROFESSOR] Erro ao avaliar palpite de ${palpite.roboNome}: ${e}`)
      }
      palpite.avaliado = true
    }

    this.palpites = this.palpites.filter(p => (agora - p.timestamp) < 3600000)
    this._salvar()

    // Verifica promoção/rebaixamento para robôs com palpites avaliados
    const nomesAvaliados = [...new Set(pendentes.map(p => p.roboNome))]
    for (const nome of nomesAvaliados) {
      const resultado = escolaRobos.verificarPromocao(nome)
      if (resultado === "promovido") {
        console.log(`📚 [PROFESSOR] ${nome} PROMOVIDO a agente decisório!`)
      } else if (resultado === "rebaixado") {
        console.log(`📚 [PROFESSOR] ${nome} rebaixado a aprendiz`)
      }
    }
  }

  private async _avaliar(palpite: PalpiteRobo) {
    const tokenVolatil = palpite.direcao === "buy" ? palpite.toToken : palpite.fromToken
    // Pula tokens sem price feed real (CoinGecko) — evita streak negativo falso
    const COIN_IDS: Record<string, string> = {
      WETH: "ethereum", WMATIC: "matic-network", ARB: "arbitrum",
      WBTC: "bitcoin", SOL: "solana", cirBTC: "bitcoin",
    }
    if (!COIN_IDS[tokenVolatil]) return

    const precoAtual = await positionManager.fetchTokenPrice(tokenVolatil as TokenSymbol)
    if (!precoAtual || precoAtual <= 0) return

    const variacao = ((precoAtual - palpite.precoNoPalpite) / palpite.precoNoPalpite) * 100

    let acertou = false
    if (palpite.direcao === "buy" && variacao > 0.1) {
      acertou = true
    } else if (palpite.direcao === "sell" && variacao < -0.1) {
      acertou = true
    }

    const pontos = Math.round(palpite.confianca * (acertou ? 0.3 : -0.3))
    const feedback = acertou
      ? gerarFeedbackAcerto(palpite.confianca)
      : gerarFeedbackErro(palpite.confianca)

    pairSector.registrarAvaliacao({
      par: palpite.par,
      rede: palpite.rede as NetworkKey,
      fromToken: palpite.fromToken as TokenSymbol,
      toToken: palpite.toToken as TokenSymbol,
      roboNome: palpite.roboNome,
      direcao: palpite.direcao,
      confianca: palpite.confianca,
      precoNoPalpite: palpite.precoNoPalpite,
      timestamp: palpite.timestamp,
      acertou,
      pontos,
    })

    escolaRobos.registrarResultado(
      palpite.roboNome,
      acertou,
      palpite.confianca,
      `${palpite.par} em ${palpite.rede}: ${feedback}`
    )

    // Aplica ajustes automáticos do Professor
    const feedbackAjuste = this._aplicarAjustes(palpite, acertou)

    const robo = escolaRobos.getRobo(palpite.roboNome)
    const sinal = acertou ? "+" : ""
    narrador.professorAvaliacao(palpite.roboNome, acertou, pontos)
    console.log(
      `📚 [PROFESSOR] ${palpite.roboNome} ${acertou ? "acertou" : "errou"} ${palpite.par} em ${palpite.rede} (${sinal}${pontos}pts) | Total: ${robo.pontos}pts`
    )
    if (!acertou && !feedbackAjuste) {
      console.log(`📚 [PROFESSOR] ${palpite.roboNome} — sugestão: ${feedback}`)
    }
  }

  private _aplicarAjustes(palpite: PalpiteRobo, acertou: boolean): boolean {
    const nome = palpite.roboNome
    const params = parametrosRobos.get(nome)
    let ajustou = false
    let motivo = ""

    if (acertou) {
      this.streakAcerto.set(nome, (this.streakAcerto.get(nome) || 0) + 1)
      this.streakErro.set(nome, 0)

      // Acertos consecutivos: libera um pouco os thresholds
      const streak = this.streakAcerto.get(nome) || 0
      if (streak >= 5 && params.confiancaMinima > 20) {
        const novos = parametrosRobos.ajustar(nome, {
          confiancaMinima: Math.max(20, params.confiancaMinima - 3),
          thresholdEntrada: Math.max(0.003, params.thresholdEntrada - 0.0005),
        }, `${streak} acertos consecutivos — afrouxando parâmetros`)
        ajustou = true
        motivo = gerarFeedbackAjuste(nome, `${streak} acertos consecutivos, reduzindo seletividade`, novos)
      }
    } else {
      this.streakErro.set(nome, (this.streakErro.get(nome) || 0) + 1)
      this.streakAcerto.set(nome, 0)

      const streak = this.streakErro.get(nome) || 0
      const foiConfiante = palpite.confianca > 70

      if (foiConfiante && streak >= 2) {
        // Erro confiante + streak: aumenta thresholdEntrada drasticamente
        const novos = parametrosRobos.ajustar(nome, {
          thresholdEntrada: Math.min(0.02, params.thresholdEntrada * 2),
          confiancaMinima: Math.min(60, params.confiancaMinima + 8),
        }, `erro confiante em sequência — endurecendo entrada`)
        ajustou = true
        motivo = gerarFeedbackAjuste(nome, `erro confiante #${streak}, endurecendo entrada`, novos)
      } else if (streak >= 3) {
        // Streak de erros: aumenta confiancaMinima gradualmente
        const novos = parametrosRobos.ajustar(nome, {
          confiancaMinima: Math.min(55, params.confiancaMinima + 5),
          thresholdEntrada: Math.min(0.015, params.thresholdEntrada + 0.002),
        }, `${streak} erros consecutivos — aumentando seletividade`)
        ajustou = true
        motivo = gerarFeedbackAjuste(nome, `${streak} erros consecutivos, aumentando seletividade`, novos)
      } else if (foiConfiante) {
        // Erro isolado confiante: sobe confiancaMinima
        const novos = parametrosRobos.ajustar(nome, {
          confiancaMinima: Math.min(50, params.confiancaMinima + 5),
        }, `erro confiante — precisa de mais convicção para entrar`)
        ajustou = true
        motivo = gerarFeedbackAjuste(nome, `erro confiante, elevando exigência`, novos)
      }
    }

    if (ajustou && motivo) {
      escolaRobos.getRobo(nome).historicoFeedback.push(motivo)
      console.log(`⚙️ [PROFESSOR] ${motivo}`)
    }

    return ajustou
  }

  getPalpitesPendentes(): number {
    return this.palpites.filter(p => !p.avaliado).length
  }

  getStats() {
    return {
      totalPalpites: this.palpites.length,
      pendentes: this.getPalpitesPendentes(),
      ultimaAvaliacao: this.ultimaAvaliacao,
    }
  }

  async gerarPacotes(): Promise<void> {
    const ranking = accountant.getRanking()
    if (ranking.length === 0) return

    const topAgents = ranking
      .filter(a => a.totalTrades >= 3 && a.winRate >= 50 && a.score > 0)
      .slice(0, 5)

    if (topAgents.length === 0) return

    const networksToScan = Object.keys(TRADING_PAIRS).filter(k => {
      const net = NETWORKS[k as NetworkKey]
      return net && !net.isTestnet
    }) as NetworkKey[]

    if (networksToScan.length === 0) return

    for (const rede of networksToScan) {
      const paresRede = TRADING_PAIRS[rede]
      if (!paresRede || paresRede.length === 0) continue

      const performance = pairSector.getPerformancePorPar(rede)
      const topPares = performance
        .filter(p => p.totalAvaliacoes >= 2 && p.taxaAcerto >= 50)
        .sort((a, b) => b.taxaAcerto - a.taxaAcerto)
        .slice(0, 5)

      if (topPares.length === 0) continue

      const trades: TradeIntent[] = []
      const agentesUsados = new Set<string>()
      let totalAmount = 0

      for (const par of topPares) {
        const pairDef = paresRede.find(p => p.label === par.par)
        if (!pairDef) continue
        if (totalAmount >= 15) break

        const agenteNome = par.melhoresRobos[0]?.nome
        if (!agenteNome) continue
        const agente = topAgents.find(a => a.agentName === agenteNome)
        if (!agente) continue
        agentesUsados.add(agenteNome)

        const precoAtual = await positionManager.fetchTokenPrice(pairDef.to)
        if (!precoAtual || precoAtual <= 0) continue

        const confiancaAjustada = Math.round(Math.min(95, agente.winRate * 0.4 + par.taxaAcerto * 0.6))

        const netConf = NETWORKS[rede]
        const saldoUSDC = realSwap.getBalance("USDC")
        const amount = Math.min(saldoUSDC * 0.25, 5.0)
        if (amount < 2.0) continue

        totalAmount += amount

        // Lucro esperado realista: 0.3% de retorno × confiança
        const expectedProfit = amount * (confiancaAjustada / 100) * 0.003

        trades.push({
          fromToken: pairDef.from,
          toToken: pairDef.to,
          amount,
          agentes: [agenteNome],
          confianca: confiancaAjustada,
          expectedProfit,
        })
      }

      if (trades.length === 0) continue
      if (trades.length < 2) continue // mínimo 2 trades por pacote

      const profitTotal = trades.reduce((s, t) => s + t.expectedProfit, 0)
      const confMedia = Math.round(trades.reduce((s, t) => s + t.confianca, 0) / trades.length)

      setorPacotes.registrarPacote({
        id: `pacote_prof_${rede}_${Date.now()}`,
        rede,
        trades,
        expectedProfitTotal: profitTotal,
        confiancaMedia: confMedia,
        timestamp: Date.now(),
        expiraEm: Date.now() + 30_000,
      })

      console.log(`[PROFESSOR] 📦 Pacote gerado: ${trades.length} trades em ${rede} | total: $${totalAmount.toFixed(2)} | lucro esp.: $${profitTotal.toFixed(4)} | conf: ${confMedia}%`)
    }
  }

  getPairSectorReport(rede: NetworkKey): ParPerformance[]
  getPairSectorReport(rede?: NetworkKey): ParPerformance[] | Record<string, ParPerformance[]>
  getPairSectorReport(rede?: NetworkKey) {
    if (rede) return pairSector.getPerformancePorPar(rede)
    const todasRedes = [...new Set(Object.keys(pairSector.getStats().porRede))]
    const relatorio: Record<string, ReturnType<typeof pairSector.getPerformancePorPar>> = {}
    for (const r of todasRedes) {
      relatorio[r] = pairSector.getPerformancePorPar(r as NetworkKey)
    }
    return relatorio
  }
}

export const professor = new Professor()
