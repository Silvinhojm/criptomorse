// lib/contratante.ts
// Pregueiro especializado em criar jobs ERC-8183 na Arc testnet
// Gera transações on-chain para testar a rede e registrar comportamento dos robôs

import { jobRobot } from './job-robot'
import { NETWORKS } from './real-swap-executor'
import { narrador } from './narrator'

export interface ContratanteState {
  ativo: boolean
  ultimoJobId: number | null
  jobsCriados: number
  ultimoResultado: string
  ultimoError: string | null
  txCount: number
  cicloAtual: number
}

class Contratante {
  private _ativo = false
  private _ultimoJobId: number | null = null
  private _jobsCriados = 0
  private _ultimoResultado = ''
  private _ultimoError: string | null = null
  private _txCount = 0
  private _cicloAtual = 0
  private _budgetUsd = 0.50
  private _privateKey = ''

  private listeners: Array<() => void> = []

  setPrivateKey(pk: string) {
    this._privateKey = pk
  }

  setBudget(usd: number) {
    this._budgetUsd = Math.max(0.10, usd)
  }

  getState(): ContratanteState {
    return {
      ativo: this._ativo,
      ultimoJobId: this._ultimoJobId,
      jobsCriados: this._jobsCriados,
      ultimoResultado: this._ultimoResultado,
      ultimoError: this._ultimoError,
      txCount: this._txCount,
      cicloAtual: this._cicloAtual,
    }
  }

  onChange(cb: () => void) {
    this.listeners.push(cb)
  }

  private notify() {
    for (const cb of this.listeners) cb()
  }

  // Tenta executar um ciclo de job na Arc testnet
  async tryExecuteCycle(): Promise<{ ok: boolean; msg: string }> {
    if (!this._privateKey) {
      return { ok: false, msg: '❌ Contratante: private key não configurada' }
    }

    try {
      jobRobot.initialize(this._privateKey)
    } catch (e: any) {
      this._ultimoError = e.message
      this.notify()
      return { ok: false, msg: `❌ Contratante: falha ao inicializar: ${e.message}` }
    }

    if (!jobRobot.isReady()) {
      return { ok: false, msg: '❌ Contratante: wallet não inicializada' }
    }

    this._cicloAtual++
    const msg = `🤖 Contratante criando job #${this._cicloAtual} ($${this._budgetUsd.toFixed(2)} USDC)...`
    this._ultimoResultado = msg

    const result = await jobRobot.executeCycle(this._budgetUsd)

    if (result.success) {
      this._ultimoJobId = result.jobId ?? null
      this._jobsCriados++
      this._txCount += result.txHashes.length
      this._ultimoResultado = `✅ Job #${result.jobId} concluído (${result.txHashes.length} txs)`
      this._ultimoError = null
      this.notify()
      narrador.adicionarEvento({
        tipo: 'info',
        mensagem: `JobRobot: job #${result.jobId} criado e executado na Arc testnet (${result.txHashes.length} transações)`,
        timestamp: Date.now(),
      })
      return { ok: true, msg: `✅ Job #${result.jobId} concluído em ${result.txHashes.length} transações` }
    } else {
      this._ultimoError = result.error ?? 'Erro desconhecido'
      this._ultimoResultado = `❌ Job falhou: ${result.error}`
      this.notify()
      return { ok: false, msg: `❌ Job falhou: ${result.error}` }
    }
  }
}

export const contratante = new Contratante()
