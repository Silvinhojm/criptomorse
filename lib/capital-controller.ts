import { realSwap } from './real-swap-executor'
import { positionManager } from './position-manager'
import { escolaRobos } from './escola-robos'
import { ResourceManager } from './agent-framework/resource-manager'

export interface CapitalRequest {
  id: string
  strategy: string
  pair: string
  network: string
  amountUSD: number
  score: number
  estimatedProfit: number
  requestedAt: number
}

function lockKey(request: CapitalRequest): string {
  const token = request.pair.split('→')[1]?.split(/[+]/)[0] || request.pair
  return `${token}:${request.network}`
}

class CapitalController {
  private listeners: Array<() => void> = []
  private rm: ResourceManager

  constructor() {
    this.rm = new ResourceManager('CapitalController', (type) => {
      if (type === 'USDC') return realSwap.getBalance("USDC")
      return Infinity
    }, 300_000)
  }

  getState() {
    const s = this.rm.getState()
    return {
      locked: s.locked > 0,
      lockedBy: s.locked > 0 ? Object.keys(s.locks).join(', ') : null,
      lockedAt: s.locked > 0 ? Math.min(...Object.values(s.locks).map((l: { lockedAt: number }) => l.lockedAt)) : 0,
      requests: s.queue.map(r => ({
        id: r.id,
        strategy: r.agentId,
        pair: r.resourceId,
        network: r.resourceType,
        amountUSD: r.amount,
        score: r.priority,
        estimatedProfit: 0,
        requestedAt: r.requestedAt,
      })),
      locks: { ...s.locks },
    }
  }
  onChange(cb: () => void) { this.listeners.push(cb); return () => { this.listeners = this.listeners.filter(c => c !== cb) } }
  private notify() { for (const cb of this.listeners) cb() }

  request(request: CapitalRequest): { authorized: boolean; waitPosition: number; reason: string } {
    const k = lockKey(request)

    // Legacy check: posição fantasma?
    const existingLock = this.getState().locks[k]
    if (existingLock) {
      const openPositions = positionManager.getOpenPositions()
      const stillOpen = openPositions.some(p =>
        `${p.boughtToken}:${p.networkKey}` === existingLock.lockedBy
      )
      if (!stillOpen) {
        this.rm.release(k)
      }
    }

    const grant = this.rm.request({
      id: request.id,
      agentId: request.strategy,
      resourceType: request.network,
      resourceId: `${request.pair.split('→')[1]?.split(/[+]/)[0] || request.pair}`,
      amount: request.amountUSD,
      priority: request.score,
      requestedAt: request.requestedAt,
    })

    this.notify()
    return {
      authorized: grant.authorized,
      waitPosition: grant.queuePosition,
      reason: grant.reason,
    }
  }

  unlock(key: string) {
    this.rm.release(key)
    this.notify()
  }

  unlockNetwork(network: string) {
    const s = this.rm.getState()
    for (const key of Object.keys(s.locks)) {
      if (key.endsWith(':' + network)) {
        this.rm.release(key)
      }
    }
    this.notify()
  }

  canExecute(amountUSD: number, pair: string, network: string): boolean {
    const token = pair.split('→')[1]?.split(/[+]/)[0] || pair
    const k = `${token}:${network}`
    const s = this.rm.getState()
    if (s.locks[k] && s.locks[k].lockedBy !== k) return false
    return realSwap.getBalance("USDC") >= amountUSD
  }

  requestAutonomo(
    agentName: string,
    pair: string,
    network: string,
    amountUSD: number,
  ): { authorized: boolean; reason: string } {
    const info = escolaRobos.getNivelInfo(agentName)
    if (!info) {
      return { authorized: false, reason: `Agente ${agentName} não encontrado` }
    }
    if (!info.podeExecutarSolo) {
      return { authorized: false, reason: `${agentName} nível ${info.nivel} — não pode executar solo (mín: nível 3)` }
    }
    if (amountUSD > info.maxAmountUSD) {
      return { authorized: false, reason: `${agentName} amount $${amountUSD} excede limite de $${info.maxAmountUSD}` }
    }

    const req: CapitalRequest = {
      id: `autonomo:${agentName}:${pair}:${Date.now()}`,
      strategy: `autonomo-${agentName}`,
      pair,
      network,
      amountUSD,
      score: info.pontos / 100,
      estimatedProfit: 0,
      requestedAt: Date.now(),
    }
    const k = lockKey(req)
    const s = this.rm.getState()
    if (s.locks[k]) {
      return { authorized: false, reason: `Capital ocupado (${k}) — ${agentName} na fila` }
    }

    const grant = this.rm.request({
      id: req.id,
      agentId: req.strategy,
      resourceType: req.network,
      resourceId: `${req.pair.split('→')[1]?.split(/[+]/)[0] || req.pair}`,
      amount: req.amountUSD,
      priority: info.pontos / 100,
      requestedAt: Date.now(),
    })
    this.notify()
    if (grant.authorized) {
      console.log(`[Capital] 🤖 ${agentName} (nível ${info.nivel}) autorizado autonomamente — ${pair} $${amountUSD}`)
    }
    return { authorized: grant.authorized, reason: grant.reason }
  }

  forceUnlock(networkKey?: string) {
    if (networkKey) {
      const s = this.rm.getState()
      for (const key of Object.keys(s.locks)) {
        if (key.endsWith(':' + networkKey)) {
          this.rm.release(key)
        }
      }
    } else {
      this.rm.releaseAll()
    }
    this.notify()
  }
}

export const capitalController = new CapitalController()
