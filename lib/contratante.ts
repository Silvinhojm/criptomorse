// lib/contratante.ts
// Pregueiro especializado em swaps na Arc testnet via Circle App Kit
// Gera transações on-chain para testar a rede

import { jobRobot } from './job-robot'
import { narrador } from './narrator'

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
  private _reports: SwapReport[] = []

  private listeners: Array<() => void> = []

  setPrivateKey(pk: string) {
    this._privateKey = pk
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
  }

  private notify() {
    for (const cb of this.listeners) cb()
  }

  /** Tenta executar um ciclo de swap na Arc testnet */
  async tryExecuteCycle(): Promise<{ ok: boolean; msg: string }> {
    if (!this._privateKey) {
      return { ok: false, msg: '❌ Contratante: private key não configurada' }
    }

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

    const result = await jobRobot.executeSwap(amount)

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
      const msg = `✅ Swap #${this._cicloAtual} concluído: ${result.pair} ($${amount} → ${result.amountOut ?? '?'})`
      this._ultimoResultado = `${msg} | tx: ${result.txHash?.slice(0, 10)}...`
      this._ultimoError = null
      this.notify()
      narrador.adicionarEvento({
        tipo: 'info',
        mensagem: `Contratante: ${result.pair} $${
          result.amountIn ?? amount
        } concluído na Arc testnet`,
        timestamp: Date.now(),
      })
      return { ok: true, msg }
    } else {
      this._swapsFalha++
      this._ultimoError = result.error ?? 'Erro desconhecido'
      this._ultimoResultado = `❌ Swap #${this._cicloAtual} falhou: ${result.error?.slice(0, 100)}`
      this.notify()
      return { ok: false, msg: `❌ Swap falhou: ${result.error?.slice(0, 100)}` }
    }
  }
}

export const contratante = new Contratante()