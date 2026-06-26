import { narrador } from "./narrator"

const STORAGE_KEY = "arcflow_escola"
const SHIFT_KEY = "arcflow_escola_shift"
const ULTIMAS_AVALIACOES_KEY = "arcflow_escola_ultimas"

export const SHIFT_DURATION_MS = 10 * 60 * 1000
const SHIFT_SIZE = 3

export const MIN_JOBS_PROVA = 3

// Regras de promoção via Professor
export const PROMOCAO_MIN_PALPITES = 50
export const PROMOCAO_MIN_TAXA = 60  // %
export const PROMOCAO_MIN_PONTOS = 500

export interface RoboEscolar {
  nome: string
  pontos: number
  palpitesTotal: number
  acertos: number
  erros: number
  taxaAcerto: number
  historicoFeedback: string[]
  jobsCompletos: number
  jobsFalha: number
  jobsTx: string[] // tx hashes or contract addresses of on-chain proofs
  status: "aprendiz" | "promovido"
  promovidoEm?: number
  rebaixadoEm?: number
}

interface ShiftState {
  robosAtivos: string[]
  inicio: number
  expira: number
  turno: number
}

class EscolaRobos {
  private robos: Map<string, RoboEscolar> = new Map()
  private ultimasAvaliacoes: Map<string, boolean[]> = new Map()
  private shift: ShiftState = { robosAtivos: [], inicio: 0, expira: 0, turno: 0 }

  constructor() {
    this._carregar()
  }

  private _carregar() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw) as RoboEscolar[]
        this.robos = new Map(data.map(r => [r.nome, r]))
      }
      const rawShift = localStorage.getItem(SHIFT_KEY)
      if (rawShift) {
        this.shift = JSON.parse(rawShift)
      }
      const rawUltimas = localStorage.getItem(ULTIMAS_AVALIACOES_KEY)
      if (rawUltimas) {
        this.ultimasAvaliacoes = new Map(Object.entries(JSON.parse(rawUltimas)))
      }
    } catch {
      // localStorage pode falhar em SSR
    }
  }

  private _salvar() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(this.robos.values())))
      localStorage.setItem(SHIFT_KEY, JSON.stringify(this.shift))
      const obj: Record<string, boolean[]> = {}
      this.ultimasAvaliacoes.forEach((v, k) => { obj[k] = v })
      localStorage.setItem(ULTIMAS_AVALIACOES_KEY, JSON.stringify(obj))
    } catch {
      // silencioso
    }
  }

  getRobo(nome: string): RoboEscolar {
    let robo = this.robos.get(nome)
    if (!robo) {
      robo = {
        nome,
        pontos: 0,
        palpitesTotal: 0,
        acertos: 0,
        erros: 0,
        taxaAcerto: 0,
        historicoFeedback: [],
        jobsCompletos: 0,
        jobsFalha: 0,
        jobsTx: [],
        status: "aprendiz",
      }
      this.robos.set(nome, robo)
    }
    return robo
  }

  getAll(): RoboEscolar[] {
    return Array.from(this.robos.values())
      .sort((a, b) => b.pontos - a.pontos)
  }

  getTopRobos(count: number = SHIFT_SIZE): RoboEscolar[] {
    return this.getAll()
      .filter(r => r.pontos > 0)
      .slice(0, count)
  }

  getCandidatosProva(): RoboEscolar[] {
    return this.getAll().filter(r => r.pontos > 0 && r.jobsCompletos < MIN_JOBS_PROVA)
  }

  registrarResultado(nome: string, acertou: boolean, confianca: number, feedback: string) {
    const robo = this.getRobo(nome)
    robo.palpitesTotal++
    if (acertou) {
      const bonus = Math.round(confianca * 0.5)
      robo.pontos += Math.max(1, bonus)
      robo.acertos++
    } else {
      const penalidade = Math.round(confianca * 0.8)
      robo.pontos -= Math.max(1, penalidade)
      robo.erros++
    }
    robo.taxaAcerto = robo.palpitesTotal > 0
      ? (robo.acertos / robo.palpitesTotal) * 100
      : 0
    robo.historicoFeedback.push(feedback)
    if (robo.historicoFeedback.length > 20) {
      robo.historicoFeedback = robo.historicoFeedback.slice(-20)
    }

    let avaliacoes = this.ultimasAvaliacoes.get(nome) || []
    avaliacoes.push(acertou)
    if (avaliacoes.length > 20) {
      avaliacoes = avaliacoes.slice(-20)
    }
    this.ultimasAvaliacoes.set(nome, avaliacoes)

    this._salvar()
  }

  isPromovido(nome: string): boolean {
    const robo = this.robos.get(nome)
    if (!robo) return false
    return robo.status === "promovido"
  }

  verificarPromocao(nome: string): "promovido" | "rebaixado" | null {
    const robo = this.getRobo(nome)
    const ultimas20 = this.ultimasAvaliacoes.get(nome) || []
    const taxaUltimas20 = ultimas20.length >= 10
      ? (ultimas20.filter(Boolean).length / ultimas20.length) * 100
      : robo.taxaAcerto

    if (robo.status === "aprendiz") {
      if (
        robo.palpitesTotal >= PROMOCAO_MIN_PALPITES &&
        robo.taxaAcerto >= PROMOCAO_MIN_TAXA &&
        robo.pontos >= PROMOCAO_MIN_PONTOS
      ) {
        this.promover(nome)
        return "promovido"
      }
    } else if (robo.status === "promovido") {
      if (taxaUltimas20 < 50 && ultimas20.length >= 20) {
        this.rebaixar(nome)
        return "rebaixado"
      }
    }
    return null
  }

  private promover(nome: string) {
    const robo = this.getRobo(nome)
    robo.status = "promovido"
    robo.promovidoEm = Date.now()
    const msg = `🎓 ${nome} PROMOVIDO — ${robo.pontos}pts, ${robo.taxaAcerto.toFixed(0)}% acerto após ${robo.palpitesTotal} palpites`
    robo.historicoFeedback.push(msg)
    this._salvar()
    console.log(`📚 [ESCOLA] ${msg}`)
    narrador.roboVerificado(nome, robo.pontos, robo.palpitesTotal)
  }

  private rebaixar(nome: string) {
    const robo = this.getRobo(nome)
    robo.status = "aprendiz"
    robo.rebaixadoEm = Date.now()
    const ultimas20 = this.ultimasAvaliacoes.get(nome) || []
    const taxa = ultimas20.length >= 20
      ? (ultimas20.filter(Boolean).length / 20) * 100
      : 0
    const msg = `⬇️ ${nome} rebaixado — acerto caiu para ${taxa.toFixed(0)}% nas últimas ${Math.min(20, ultimas20.length)} avaliações`
    robo.historicoFeedback.push(msg)
    this._salvar()
    console.log(`📚 [ESCOLA] ${msg}`)
  }

  // ─── Sistema de Jobs (Prova para Mainnet) ───

  registrarJob(nome: string, sucesso: boolean, onChainRef = '') {
    const robo = this.getRobo(nome)
    if (sucesso) {
      robo.jobsCompletos++
      if (onChainRef) {
        robo.jobsTx.push(onChainRef)
      }
    } else {
      robo.jobsFalha++
    }
    const ref = onChainRef ? ` (📜 ${onChainRef.slice(0, 10)}...)` : ''
    if (sucesso && robo.jobsCompletos === MIN_JOBS_PROVA) {
      const msg = `🎓 ${nome} completou ${MIN_JOBS_PROVA} jobs — PROVA FINAL PASSADA, apto para mainnet!${ref}`
      robo.historicoFeedback.push(msg)
      console.log(`🎓 [ESCOLA] ${msg}`)
      narrador.roboVerificado(nome, robo.pontos, robo.jobsCompletos)
    }
    if (sucesso) {
      console.log(`📋 [JOBS] ${nome} job #${robo.jobsCompletos}${ref}`)
    }
    this._salvar()
  }

  isVerified(nome: string): boolean {
    const robo = this.robos.get(nome)
    if (!robo) return false
    return robo.jobsCompletos >= MIN_JOBS_PROVA
  }

  // ─── Sistema de Turnos (Shift) ───

  getShiftState(): ShiftState {
    return { ...this.shift }
  }

  isOnShift(nome: string): boolean {
    return this.shift.robosAtivos.includes(nome) && Date.now() < this.shift.expira
  }

  rotacionarShift(): string[] {
    const agora = Date.now()
    const top3 = this.getTopRobos(SHIFT_SIZE)
    const novosNomes = top3.map(r => r.nome)

    this.shift = {
      robosAtivos: novosNomes,
      inicio: agora,
      expira: agora + SHIFT_DURATION_MS,
      turno: this.shift.turno + 1,
    }

    if (novosNomes.length > 0) {
      console.log(`🔄 [ESCOLA] Turno ${this.shift.turno} — ${novosNomes.join(", ")} — expira em ${new Date(this.shift.expira).toLocaleTimeString()}`)
      narrador.shiftRotacionado(novosNomes)
      for (const nome of novosNomes) {
        narrador.roboEmTurno(nome)
      }
    } else {
      console.log(`🔄 [ESCOLA] Turno ${this.shift.turno} — nenhum robô com pontuação positiva disponível`)
    }

    this._salvar()
    return novosNomes
  }

  verificarRotacao(): boolean {
    if (Date.now() >= this.shift.expira && this.shift.robosAtivos.length > 0) {
      const antigos = this.shift.robosAtivos.join(", ")
      this.rotacionarShift()
      const novos = this.shift.robosAtivos.join(", ")
      console.log(`⏰ [ESCOLA] Turno expirou — rodízio: ${antigos} → ${novos}`)
      return true
    }
    return false
  }

  getHistoricoFeedback(nome: string): string[] {
    return this.getRobo(nome).historicoFeedback
  }

  getStats() {
    const all = this.getAll()
    return {
      total: all.length,
      robos: all,
      shift: this.getShiftState(),
      emTurno: this.shift.robosAtivos.filter(n => this.isOnShift(n)),
    }
  }
}

export const escolaRobos = new EscolaRobos()
