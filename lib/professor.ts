import { escolaRobos, type RoboEscolar } from "./escola-robos"
import { positionManager } from "./position-manager"
import { parametrosRobos } from "./parametros-robos"
import { narrador } from "./narrator"
import { pairSector, type ParPerformance } from "./pair-sector"
import { accountant } from "./accountant"
import { setorPacotes, type TradeIntent } from "./setor-pacotes"
import { pregão } from "./pregão"
import { TRADING_PAIRS, NETWORKS, realSwap, type TokenSymbol, type NetworkKey } from "./real-swap-executor"
import { COIN_IDS } from "./coin-ids"
import { timingOptimizer } from "./timing-optimizer"

const STABLES = new Set(["USDC", "USDT", "DAI", "EURC", "USDC.e"])

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

interface ProfessorState {
  agentes: RoboEscolar[];
  streaks: Record<string, { streakErro: number; streakAcerto: number }>;
}

const PROFESSOR_ESTADO_KEY = "arcflow_professor_estado";

class Professor {
  private palpites: PalpitePendente[] = []
  private ultimaAvaliacao: number = 0
  private streakErro: Map<string, number> = new Map()
  private streakAcerto: Map<string, number> = new Map()

  async init(): Promise<void> {
    try {
      const estadoSalvo = localStorage.getItem(PROFESSOR_ESTADO_KEY);
      if (estadoSalvo) {
        const parsed: ProfessorState = JSON.parse(estadoSalvo);
        for (const agente of parsed.agentes) {
          escolaRobos.getRobo(agente.nome);
          const robo = escolaRobos.getRobo(agente.nome);
          robo.pontos = agente.pontos;
          robo.palpitesTotal = agente.palpitesTotal;
          robo.acertos = agente.acertos;
          robo.erros = agente.erros;
          robo.taxaAcerto = agente.taxaAcerto;
          robo.historicoFeedback = agente.historicoFeedback;
          robo.status = agente.status;
          robo.promovidoEm = agente.promovidoEm;
          robo.rebaixadoEm = agente.rebaixadoEm;
        }
        Object.entries(parsed.streaks).forEach(([nome, s]) => {
          this.streakErro.set(nome, s.streakErro);
          this.streakAcerto.set(nome, s.streakAcerto);
        });
        console.log('[PROFESSOR] ✅ Estado restaurado do localStorage');
        return;
      }
    } catch {
      // silencioso
    }
    console.log('[PROFESSOR] ⏳ Nenhum estado salvo — processando histórico normalmente');
  }

  private _salvarEstado(): void {
    try {
      const agentes = escolaRobos.getAll();
      const streaks: Record<string, { streakErro: number; streakAcerto: number }> = {};
      this.streakErro.forEach((v, k) => {
        if (!streaks[k]) streaks[k] = { streakErro: 0, streakAcerto: 0 };
        streaks[k].streakErro = v;
      });
      this.streakAcerto.forEach((v, k) => {
        if (!streaks[k]) streaks[k] = { streakErro: 0, streakAcerto: 0 };
        streaks[k].streakAcerto = v;
      });
      localStorage.setItem(PROFESSOR_ESTADO_KEY, JSON.stringify({ agentes, streaks } as ProfessorState));
    } catch {
      // silencioso
    }
  }

  constructor() {
    this._carregar()
    this.init().catch(() => {})
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
    this._salvarEstado()
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
    // Pula tokens sem price feed real (SoSoValue) — evita streak negativo falso

    if (!COIN_IDS[tokenVolatil]) return

    const precoAtual = await positionManager.fetchTokenPrice(tokenVolatil as TokenSymbol)
    if (!precoAtual || precoAtual <= 0) return

    const variacao = ((precoAtual - palpite.precoNoPalpite) / palpite.precoNoPalpite) * 100

    // Em pares stable-stable (EURC/USDC, etc.), volatilidade é <0.1% — usar threshold reduzido
    const fromSymbol = palpite.fromToken as TokenSymbol
    const toSymbol = palpite.toToken as TokenSymbol
    const isStablePair = STABLES.has(fromSymbol) && STABLES.has(toSymbol)
    const threshold = isStablePair ? 0.02 : 0.1

    let acertou = false
    if (palpite.direcao === "buy" && variacao > threshold) {
      acertou = true
    } else if (palpite.direcao === "sell" && variacao < -threshold) {
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

    // Registra no TimingOptimizer para aprendizado de horários
    timingOptimizer.registrarResultado(palpite.roboNome, palpite.par, acertou, palpite.confianca)

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
    this._salvarEstado()
  }

  private _ultimoParAjuste = new Map<string, string>()
  private _ajusteCount = new Map<string, number>()

  private _extrairBasePar(par: string): string {
    const tokens = par.split('→')
    if (tokens.length !== 2) return par
    tokens.sort()
    return tokens.join('→')
  }

  private _aplicarAjustes(palpite: PalpiteRobo, acertou: boolean): boolean {
    const nome = palpite.roboNome
    const params = parametrosRobos.get(nome)
    let ajustou = false
    let motivo = ""

    // Usa base pair (tokens sorted) pra streak — USDC→cirBTC e cirBTC→USDC
    // compartilham o mesmo streak, evitando gangorra de parâmetros
    const basePar = this._extrairBasePar(palpite.par)
    const ultimoPar = this._ultimoParAjuste.get(nome)
    if (ultimoPar && ultimoPar !== basePar) {
      this.streakErro.set(nome, 0)
      this.streakAcerto.set(nome, 0)
      this._ajusteCount.set(nome, 0)
    }
    this._ultimoParAjuste.set(nome, basePar)

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
      const ajusteCount = this._ajusteCount.get(nome) || 0

      // Timing-aware: se robô tem histórico ruim neste horário, acelera o ajuste
      const timing = timingOptimizer.getRecomendacao(nome)
      const timingAgression = timing.samples >= 5 && timing.timingScore < -30 ? 1.5 : 1.0

      // Recovery: robô preso no teto com streak longo e pontos no floor — reseta pra dar chance
      const COOLDOWN_RECOVERY_KEY = `arcflow_recovery_${nome}`
      const lastRecovery = typeof window !== 'undefined'
        ? parseInt(localStorage.getItem(COOLDOWN_RECOVERY_KEY) || "0", 10)
        : 0
      if (
        streak > 20 &&
        params.confiancaMinima >= 55 &&
        params.thresholdEntrada >= 0.015 &&
        Date.now() - lastRecovery > 86_400_000 // 24h de cooldown
      ) {
        const robo = escolaRobos.getRobo(nome)
        if (robo.pontos <= -400) {
          console.log(`🔄 [PROFESSOR] ${nome} preso no teto com ${streak} erros e ${robo.pontos}pts — resetando parâmetros`)
          parametrosRobos.reset(nome)
          this.streakErro.set(nome, 0)
          this._ajusteCount.set(nome, 0)
          this.streakAcerto.set(nome, 0)
          if (typeof window !== 'undefined') localStorage.setItem(COOLDOWN_RECOVERY_KEY, String(Date.now()))
          return true
        }
      }

      // Se params já estão no teto, não ajusta nem loga
      if (params.confiancaMinima >= 55 && params.thresholdEntrada >= 0.015) {
        return false
      }

      // Limite de 10 ajustes consecutivos — após isso, aceita que o robô não acerta esse par
      if (ajusteCount >= 10) {
        return false
      }

      if (foiConfiante && streak >= 2) {
        // Erro confiante + streak: aumenta thresholdEntrada drasticamente
        const confBoost = Math.round(8 * timingAgression)
        const entradaMult = timingAgression > 1.0 ? 2.5 : 2.0
        const novos = parametrosRobos.ajustar(nome, {
          thresholdEntrada: Math.min(0.02, params.thresholdEntrada * entradaMult),
          confiancaMinima: Math.min(60, params.confiancaMinima + confBoost),
        }, `erro confiante em sequência — endurecendo entrada`)
        ajustou = true
        this._ajusteCount.set(nome, ajusteCount + 1)
        const timingSuffix = timingAgression > 1.0 ? ` (timing: horário ruim #${timing.timingScore})` : ""
        motivo = gerarFeedbackAjuste(nome, `erro confiante #${streak}, endurecendo entrada${timingSuffix}`, novos)
      } else if (streak >= 3) {
        // Streak de erros: aumenta confiancaMinima gradualmente
        const confBoost = Math.round(5 * timingAgression)
        const entradaBoost = Math.round(0.002 * timingAgression * 1000) / 1000
        const novos = parametrosRobos.ajustar(nome, {
          confiancaMinima: Math.min(55, params.confiancaMinima + confBoost),
          thresholdEntrada: Math.min(0.015, params.thresholdEntrada + entradaBoost),
        }, `${streak} erros consecutivos — aumentando seletividade`)
        ajustou = true
        this._ajusteCount.set(nome, ajusteCount + 1)
        const timingSuffix = timingAgression > 1.0 ? ` (timing: horário ruim)` : ""
        motivo = gerarFeedbackAjuste(nome, `${streak} erros consecutivos, aumentando seletividade${timingSuffix}`, novos)
      } else if (foiConfiante) {
        // Erro isolado confiante: sobe confiancaMinima
        const confBoost = Math.round(5 * timingAgression)
        const novos = parametrosRobos.ajustar(nome, {
          confiancaMinima: Math.min(50, params.confiancaMinima + confBoost),
        }, `erro confiante — precisa de mais convicção para entrar`)
        ajustou = true
        this._ajusteCount.set(nome, ajusteCount + 1)
        const timingSuffix = timingAgression > 1.0 ? ` (timing: horário ruim)` : ""
        motivo = gerarFeedbackAjuste(nome, `erro confiante, elevando exigência${timingSuffix}`, novos)
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
    // ─── 1. Consumir ordens pendentes do Pregão ───
    const pendentes = pregão.getTodasOrdens()
      .filter(o => o.status === "pronto" || o.status === "preparando")
    if (pendentes.length > 0) {
      const porRede = new Map<string, typeof pendentes>()
      for (const ordem of pendentes) {
        const rede = ordem.rede
        if (!porRede.has(rede)) porRede.set(rede, [])
        porRede.get(rede)!.push(ordem)
      }
      const redeAtiva = realSwap.getNetworkKey()
      for (const [rede, ordens] of porRede) {
        const net = NETWORKS[rede as NetworkKey]
        if (!net || net.isTestnet) continue
        if (rede !== redeAtiva) continue

        // ─── Agrupa ordens por par de tokens (batches atômicos) ───
        const porPar = new Map<string, typeof ordens>()
        for (const ordem of ordens) {
          const par = ordem.par
          if (!porPar.has(par)) porPar.set(par, [])
          porPar.get(par)!.push(ordem)
        }

        for (const [parLabel, ordensPar] of porPar) {
          const trades: TradeIntent[] = []
          let totalAmount = 0
          for (const ordem of ordensPar) {
            const amount = ordem.amountUsd || 5.0
            if (amount < 2.0) continue
            totalAmount += amount
            trades.push({
              fromToken: ordem.fromToken as TokenSymbol,
              toToken: ordem.toToken as TokenSymbol,
              amount,
              agentes: ordem.pregueiros.map(p => p.replace("Agente:", "")),
              confianca: ordem.confiancaMedia,
              expectedProfit: amount * (ordem.confiancaMedia / 100) * 0.003,
              ordemId: ordem.id,
            })
          }
          if (trades.length === 0) continue
          const profitTotal = trades.reduce((s, t) => s + t.expectedProfit, 0)
          const confMedia = Math.round(trades.reduce((s, t) => s + t.confianca, 0) / trades.length)
          setorPacotes.registrarPacote({
            id: `pacote_preg_${rede}_${parLabel.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`,
            rede: rede as NetworkKey,
            trades,
            expectedProfitTotal: profitTotal,
            confiancaMedia: confMedia,
            timestamp: Date.now(),
            expiraEm: Date.now() + 120_000,
          })
          // Marca ordens como executando para não serem re-processadas
          for (const o of ordensPar) {
            pregão.atualizarOrdem(o.id, { status: "executando" })
          }
          console.log(`[PROFESSOR] 📦 Pacote via Pregão: ${trades.length} trades em ${rede}/${parLabel} | total: $${totalAmount.toFixed(2)} | lucro esp.: $${profitTotal.toFixed(4)} | conf: ${confMedia}%`)
        }
      }
      return
    }

    // ─── 2. Fallback: criar pacotes do ranking (agentes + pares) ───
    const ranking = accountant.getRanking()
    if (ranking.length === 0) return

    const provenAgents = ranking.filter(a => a.totalTrades >= 3 && a.winRate >= 50 && a.score > 0)
    const topAgents = provenAgents.length > 0
      ? provenAgents.slice(0, 5)
      : ranking
          .filter(a => a.totalTrades >= 1)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)

    if (topAgents.length === 0) return

    const redeAtiva = realSwap.getNetworkKey()
    const networksToScan = Object.keys(TRADING_PAIRS).filter(k => {
      const net = NETWORKS[k as NetworkKey]
      return net && !net.isTestnet && k === redeAtiva
    }) as NetworkKey[]

    if (networksToScan.length === 0) return

    for (const rede of networksToScan) {
      const paresRede = TRADING_PAIRS[rede]
      if (!paresRede || paresRede.length === 0) continue

      const performance = pairSector.getPerformancePorPar(rede)
      const topPares = performance
        .filter(p => p.totalAvaliacoes >= 1)
        .sort((a, b) => b.taxaAcerto - a.taxaAcerto)
        .slice(0, 5)

      const paresUsar = topPares.length > 0 ? topPares : paresRede.map(p => ({
        par: p.label,
        rede,
        totalAvaliacoes: 0,
        acertos: 0,
        taxaAcerto: 0,
        ultimaAvaliacao: 0,
        melhoresRobos: [],
      }))

      const trades: TradeIntent[] = []
      let totalAmount = 0

      for (const par of paresUsar) {
        const pairDef = paresRede.find(p => p.label === par.par)
        if (!pairDef) continue
        if (totalAmount >= 15) break

        const saldoUSDC = realSwap.getBalance("USDC")
        const amount = Math.min(saldoUSDC * 0.25, 5.0)
        if (amount < 2.0) continue

        const melhorRobo = par.melhoresRobos[0]
        const agenteNome = melhorRobo?.nome || topAgents[0]?.agentName
        if (!agenteNome) continue
        const agente = ranking.find(a => a.agentName === agenteNome) || topAgents[0]
        if (!agente) continue

        const precoAtual = await positionManager.fetchTokenPrice(pairDef.to)
        if (!precoAtual || precoAtual <= 0) continue

        const winRateBase = Math.max(agente.winRate, 30)
        const taxaAcertoBase = Math.max(par.taxaAcerto, 30)
        let confiancaAjustada = Math.round(Math.min(95, winRateBase * 0.4 + taxaAcertoBase * 0.6))

        // Timing-aware: ajusta confiança pelo horário
        const timing = timingOptimizer.getRecomendacao(agenteNome)
        if (timing.samples >= 3 && timing.confidenceMultiplier !== 1.0) {
          const antes = confiancaAjustada
          confiancaAjustada = Math.round(Math.min(95, confiancaAjustada * timing.confidenceMultiplier))
          if (confiancaAjustada !== antes) {
            console.log(`⏰ [TIMING] ${agenteNome}: confiança ajustada ${antes}% → ${confiancaAjustada}% (mult ${timing.confidenceMultiplier}x, hora ${timing.currentHour}h, winRate ${timing.currentHourWinRate.toFixed(0)}%)`)
          }
        }

        totalAmount += amount

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

      const profitTotal = trades.reduce((s, t) => s + t.expectedProfit, 0)
      const confMedia = Math.round(trades.reduce((s, t) => s + t.confianca, 0) / trades.length)

      setorPacotes.registrarPacote({
        id: `pacote_prof_${rede}_${Date.now()}`,
        rede,
        trades,
        expectedProfitTotal: profitTotal,
        confiancaMedia: confMedia,
        timestamp: Date.now(),
        expiraEm: Date.now() + 120_000,
      })

      console.log(`[PROFESSOR] 📦 Pacote via ranking: ${trades.length} trades em ${rede} | total: $${totalAmount.toFixed(2)} | lucro esp.: $${profitTotal.toFixed(4)} | conf: ${confMedia}%`)
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
