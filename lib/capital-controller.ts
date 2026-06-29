// lib/capital-controller.ts
// Controlador de Capital — evita que múltiplos métodos compitam pelo mesmo USDC
//
// Princípio: "Um trade de cada vez, sempre o melhor"
// - Cada método registra sua oportunidade com score e valor
// - Controller escolhe a MELHOR e autoriza só ela
// - Capital fica bloqueado até posição fechar
// - Evita 4 métodos disputando $30 simultaneamente

import { realSwap } from './real-swap-executor'
import { positionManager } from './position-manager'

export interface CapitalRequest {
  id: string               // identificador único (ex: "oscillation:USDC/USDT:0.0025")
  strategy: string          // nome do método ("grao", "oscillation", "stable-scan", "internacional")
  pair: string              // par (ex: "USDC→USDT")
  network: string
  amountUSD: number
  score: number             // 0-100 — quanto maior, melhor a oportunidade
  estimatedProfit: number   // lucro estimado ($)
  requestedAt: number       // timestamp
}

interface CapitalState {
  locked: boolean
  lockedBy: string | null    // id da request que pegou o capital
  lockedAt: number
  requests: CapitalRequest[] // fila de espera
}

class CapitalController {
  private state: CapitalState = { locked: false, lockedBy: null, lockedAt: 0, requests: [] }
  private listeners: Array<() => void> = []

  getState() { return { ...this.state } }
  onChange(cb: () => void) { this.listeners.push(cb); return () => { this.listeners = this.listeners.filter(c => c !== cb) } }
  private notify() { for (const cb of this.listeners) cb() }

  /** Registrar uma oportunidade — retorna true se autorizado a executar AGORA */
  request(request: CapitalRequest): { authorized: boolean; waitPosition: number; reason: string } {
    // Limpar requests antigas (>5 min)
    this.state.requests = this.state.requests.filter(r => Date.now() - r.requestedAt < 300_000)

    const availableUSDC = realSwap.getBalance("USDC")

    // Se já tem capital bloqueado
    if (this.state.locked) {
      // Verificar se a posição ainda está aberta (match por boughtToken:networkKey)
      const openPositions = positionManager.getOpenPositions()
      const stillOpen = openPositions.some(p =>
        `${p.boughtToken}:${p.networkKey}` === this.state.lockedBy
      )
      if (!stillOpen) {
        this.unlock()
      } else {
        this.state.requests.push(request)
        this.state.requests.sort((a, b) => b.score - a.score)
        const pos = this.state.requests.findIndex(r => r.id === request.id)
        return { authorized: false, waitPosition: pos + 1, reason: `Capital ocupado por ${this.state.lockedBy}` }
      }
    }

    // Verificar saldo disponível
    if (availableUSDC < request.amountUSD) {
      return { authorized: false, waitPosition: 0, reason: `Saldo insuficiente: $${availableUSDC.toFixed(2)} < $${request.amountUSD}` }
    }

    // Verificar se não tem request MELHOR na fila
    const better = this.state.requests.find(r => r.score > request.score && r.strategy !== request.strategy)
    if (better) {
      this.state.requests.push(request)
      this.state.requests.sort((a, b) => b.score - a.score)
      return { authorized: false, waitPosition: 2, reason: `${better.strategy} tem oportunidade melhor (score ${better.score} vs ${request.score})` }
    }

    // Autorizado!
    this.state.locked = true
    this.state.lockedBy = `${request.pair.split('→')[1]}:${request.network}`
    this.state.lockedAt = Date.now()
    this.state.requests = this.state.requests.filter(r => r.id !== request.id)

    this.notify()
    return { authorized: true, waitPosition: 0, reason: 'Executar agora' }
  }

  /** Liberar capital após posição fechar */
  unlock() {
    this.state.locked = false
    this.state.lockedBy = null

    // Verificar se tem request pendente na fila
    const next = this.state.requests[0]
    if (next) {
      const availableUSDC = realSwap.getBalance("USDC")
      if (availableUSDC >= next.amountUSD) {
        this.state.locked = true
        this.state.lockedBy = `${next.pair.split('→')[1]}:${next.network}`
        this.state.lockedAt = Date.now()
        this.state.requests.shift()
        console.log(`[Capital] 🔓 Liberado → ${next.strategy} autorizado (${next.pair} $${next.amountUSD})`)
      }
    }

    this.notify()
  }

  /** Todos os métodos chamam isso antes de executar swap */
  canExecute(strategy: string, amountUSD: number, pair: string): boolean {
    const availableUSDC = realSwap.getBalance("USDC")
    if (availableUSDC < amountUSD) return false
    if (this.state.locked && this.state.lockedBy !== `${strategy}:${pair}`) return false
    return true
  }

  /** Força liberação de emergência (se posição sumiu sem fechar) */
  forceUnlock() {
    this.state.locked = false
    this.state.lockedBy = null
    this.state.requests = []
    this.notify()
  }
}

export const capitalController = new CapitalController()
