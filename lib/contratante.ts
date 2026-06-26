// lib/contratante.ts
// Pregueiro especializado em swaps na Arc testnet via Circle App Kit
// Gera transações on-chain para testar a rede

import { jobRobot } from './job-robot'
import { narrador } from './narrator'
import { escolaRobos } from './escola-robos'

export interface SwapReport {
  pair: string
  amountIn: string
  txHash: string
  timestamp: number
  success: boolean
  error?: string
}

export interface ContratanteState {
  ativo: boolean
  swapsExecutados: number
  swapsSucesso: number
  swapsFalha: number
  ultimoResultado: string
  ultimoError: string | null
  totalTxs: number
  cicloAtual: number
  reports: SwapReport[]
}

class Contratante {
  private _ativo = false
  private _swapsExecutados = 0
  private _swapsSucesso = 0
  private _swapsFalha = 0
  private _ultimoResultado = ''
  private _ultimoError: string | null = null
  private _totalTxs = 0
  private _cicloAtual = 0
  private _privateKey = ''
  private _executando = false // guard contra overlap
  private _reports: SwapReport[] = []

  private listeners: Array<() => void> = []

  setPrivateKey(pk: string) {
    this._privateKey = pk
    jobRobot.reset()
  }

  getState(): ContratanteState {
    return {
      ativo: this._ativo,
      swapsExecutados: this._swapsExecutados,
      swapsSucesso: this._swapsSucesso,
      swapsFalha: this._swapsFalha,
      ultimoResultado: this._ultimoResultado,
      ultimoError: this._ultimoError,
      totalTxs: this._totalTxs,
      cicloAtual: this._cicloAtual,
      reports: [...this._reports].reverse().slice(0, 10),
    }
  }

  onChange(cb: () => void) {
    this.listeners.push(cb)
    return () => { this.listeners = this.listeners.filter(c => c !== cb) }
  }

  private notify() {
    for (const cb of this.listeners) cb()
  }

  /** Tenta executar um ciclo de swap na Arc testnet */
  async tryExecuteCycle(): Promise<{ ok: boolean; msg: string }> {
    if (this._executando) {
      return { ok: false, msg: '⏳ Contratante: ciclo anterior ainda executando' }
    }
    this._executando = true
    if (!this._privateKey) {
      this._executando = false
      return { ok: false, msg: '❌ Contratante: private key não configurada' }
    }

    try {
      if (!jobRobot.isReady()) {
        try {
          jobRobot.initialize(this._privateKey)
        } catch (e: any) {
          this._ultimoError = e.message
          this.notify()
          return { ok: false, msg: `❌ Contratante: falha ao inicializar: ${e.message}` }
        }
      }

      if (!jobRobot.isReady()) {
        return { ok: false, msg: '❌ Contratante: wallet não inicializada' }
      }

      // Verificar saldo antes
      const bal = await jobRobot.checkBalance()
      if (bal < 0.5) {
        const msg = `⚠️ Contratante: saldo baixo ($${bal.toFixed(2)} USDC) — aguardando...`
        this._ultimoResultado = msg
        this.notify()
        return { ok: false, msg }
      }

      this._cicloAtual++
      const amount = Math.min(1.0, Math.max(0.50, bal * 0.1)).toFixed(2)
      this._ultimoResultado = `🤖 Swap #${this._cicloAtual} ($${amount} USDC)...`
      this.notify()

      const shiftState = escolaRobos.getShiftState()
      const roboNome = shiftState.robosAtivos[0] ?? "Contratante"
      const result = await jobRobot.executeSwap(amount, roboNome)

      this._swapsExecutados++
      this._totalTxs++
      const report: SwapReport = {
        pair: result.pair ?? 'desconhecido',
        amountIn: result.amountIn ?? amount,
        txHash: result.txHash ?? '',
        timestamp: Date.now(),
        success: result.success,
        error: result.error,
      }
      this._reports.push(report)

    if (result.success) {
      this._swapsSucesso++
      // Registra job como prova para os robôs em turno ativo
      for (const nomeRobo of shiftState.robosAtivos) {
        const contratoId = result.contractAddress ?? result.txHash ?? ''
        escolaRobos.registrarJob(nomeRobo, true, contratoId)
        narrador.jobConcluido(nomeRobo, result.pair ?? "USDC→EURC", amount)
      }
      const contratoMsg = result.contractAddress ? ` | 📜 ${result.contractAddress.slice(0, 10)}...` : ''
      const isDeploy = result.stage === 'deployed' || result.stage === 'stress-deploy'
      const amountOut = result.amountOut && result.amountOut !== "0" ? `$${result.amountOut}` : (isDeploy ? 'deploy' : '$0')
      const prefix = isDeploy ? '📦' : '✅'
      const msg = `${prefix} Stress #${this._cicloAtual}: ${result.pair} ($${amount} → ${amountOut})${contratoMsg}`
      this._ultimoResultado = `${msg} | tx: ${result.txHash?.slice(0, 10)}...`
      this._ultimoError = null
      this.notify()
      narrador.manual(`Contratante: ${result.pair} $${result.amountIn ?? amount} concluído na Arc testnet${contratoMsg}`, "info")
      return { ok: true, msg }
    } else {
      this._swapsFalha++
      this._ultimoError = result.error ?? 'Erro desconhecido'
      this._ultimoResultado = `❌ Swap #${this._cicloAtual} falhou: ${result.error?.slice(0, 100)}`
      this.notify()
      const _kitKey = jobRobot.getKitKey();
      console.error(`❌ Swap falhou: ${result?.error || "Erro desconhecido"}`);
      if (_kitKey === "KIT_KEY:keyId:keySecret" || !_kitKey) {
        console.error(`⚠️ KIT_KEY inválida — configure no .env ou no dashboard`);
      }
      return { ok: false, msg: `❌ Swap falhou: ${result.error?.slice(0, 100)}` }
    }
    } finally {
      this._executando = false
    }
  }
}

export const contratante = new Contratante()