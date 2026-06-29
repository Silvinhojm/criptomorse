import { escolaRobos, type RoboEscolar } from "./escola-robos"
import { professor } from "./professor"
import { parametrosRobos, type ParametrosRobo } from "./parametros-robos"
import { realSwap } from "./real-swap-executor"
import { pregão } from "./pregão"

const TRAINING_KEY = "arcflow_arc_training"
const TRAINING_CYCLES_TARGET = 100

export interface ArcTrainingState {
  active: boolean
  cyclesCompleted: number
  cyclesTarget: number
  startedAt: number
  lastCycleAt: number
  agentSnapshots: TrainingAgentSnapshot[]
  parameterSnapshots: TrainingParamSnapshot[]
  logs: string[]
}

export interface TrainingAgentSnapshot {
  timestamp: number
  agents: {
    nome: string
    pontos: number
    palpitesTotal: number
    acertos: number
    erros: number
    taxaAcerto: number
    status: string
  }[]
}

export interface TrainingParamSnapshot {
  timestamp: number
  params: {
    nome: string
    confiancaMinima: number
    thresholdEntrada: number
    thresholdSpread: number
  }[]
}

class ArcTraining {
  private state: ArcTrainingState = {
    active: false,
    cyclesCompleted: 0,
    cyclesTarget: TRAINING_CYCLES_TARGET,
    startedAt: 0,
    lastCycleAt: 0,
    agentSnapshots: [],
    parameterSnapshots: [],
    logs: [],
  }

  private intervalId: ReturnType<typeof setInterval> | null = null
  private onStateChange: ((state: ArcTrainingState) => void) | null = null

  constructor() {
    this._load()
  }

  private _load() {
    try {
      const raw = localStorage.getItem(TRAINING_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as ArcTrainingState
        this.state.cyclesCompleted = saved.cyclesCompleted
        this.state.agentSnapshots = saved.agentSnapshots || []
        this.state.parameterSnapshots = saved.parameterSnapshots || []
        this.state.logs = saved.logs || []
      }
    } catch {
      // silencioso
    }
  }

  private _save() {
    try {
      localStorage.setItem(TRAINING_KEY, JSON.stringify(this.state))
    } catch {
      // silencioso
    }
  }

  private _notify() {
    if (this.onStateChange) {
      this.onStateChange({ ...this.state })
    }
  }

  private _log(msg: string) {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`
    this.state.logs.push(entry)
    if (this.state.logs.length > 100) {
      this.state.logs = this.state.logs.slice(-100)
    }
    pregão.adicionarLog(`🎓 ${msg}`)
    this._save()
    this._notify()
  }

  subscribe(cb: (state: ArcTrainingState) => void) {
    this.onStateChange = cb
    cb({ ...this.state })
    return () => { this.onStateChange = null }
  }

  getState(): ArcTrainingState {
    return { ...this.state }
  }

  getCalibratedParams(): Record<string, ParametrosRobo> {
    return parametrosRobos.getTodos()
  }

  async start() {
    if (this.state.active) return
    const currentNet = realSwap.getNetworkKey()
    if (currentNet !== "arc") {
      this._log("❌ Troque para rede Arc antes de iniciar treino")
      return
    }
    this.state.active = true
    this.state.startedAt = Date.now()
    this.state.cyclesCompleted = 0
    this.state.agentSnapshots = []
    this.state.parameterSnapshots = []
    this.state.logs = []
    this._takeSnapshot()
    this._log(`🎓 Treino iniciado — ${this.state.cyclesTarget} ciclos alvo`)
    this._save()
    this._notify()

    this.intervalId = setInterval(() => this._runCycle(), 15_000)
  }

  stop() {
    if (!this.state.active) return
    this.state.active = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this._takeSnapshot()
    this._log(`⏹️ Treino parado — ${this.state.cyclesCompleted} ciclos completos`)
    this._save()
    this._notify()
  }

  private async _runCycle() {
    if (!this.state.active) return
    if (this.state.cyclesCompleted >= this.state.cyclesTarget) {
      this._log(`✅ Treino concluído — ${this.state.cyclesTarget} ciclos atingidos`)
      this.stop()
      return
    }

    try {
      const { executarCicloPregueiros } = await import("./pregueiro")
      const { executarCicloAgentes } = await import("./agentes-do-pregão")
      const { executarCiclo: executarArc } = await import("./pregao-arc")

      await executarCicloPregueiros("arc").catch(() => {})
      await executarCicloAgentes("arc").catch(() => {})
      await executarArc().catch(() => {})

      await professor.avaliarPalpites().catch(() => {})

      this.state.cyclesCompleted++
      this.state.lastCycleAt = Date.now()

      if (this.state.cyclesCompleted % 5 === 0) {
        this._takeSnapshot()
        const agents = escolaRobos.getAll()
        const top3 = agents.slice(0, 3).map(a => `${a.nome}=${a.pontos}pts(${a.taxaAcerto.toFixed(0)}%)`).join(", ")
        this._log(`Ciclo #${this.state.cyclesCompleted}/${this.state.cyclesTarget} | ${top3}`)
      }
    } catch (e) {
      this._log(`⚠️ Erro no ciclo #${this.state.cyclesCompleted + 1}: ${e instanceof Error ? e.message : e}`)
    }
  }

  private _takeSnapshot() {
    const agents = escolaRobos.getAll()
    this.state.agentSnapshots.push({
      timestamp: Date.now(),
      agents: agents.map(a => ({
        nome: a.nome,
        pontos: a.pontos,
        palpitesTotal: a.palpitesTotal,
        acertos: a.acertos,
        erros: a.erros,
        taxaAcerto: a.taxaAcerto,
        status: a.status,
      })),
    })
    const allParams = parametrosRobos.getTodos()
    this.state.parameterSnapshots.push({
      timestamp: Date.now(),
      params: Object.entries(allParams).map(([nome, p]) => ({
        nome,
        confiancaMinima: p.confiancaMinima,
        thresholdEntrada: p.thresholdEntrada,
        thresholdSpread: p.thresholdSpread,
      })),
    })
    if (this.state.agentSnapshots.length > 20) {
      this.state.agentSnapshots = this.state.agentSnapshots.slice(-20)
    }
    if (this.state.parameterSnapshots.length > 20) {
      this.state.parameterSnapshots = this.state.parameterSnapshots.slice(-20)
    }
  }
}

export const arcTraining = new ArcTraining()
