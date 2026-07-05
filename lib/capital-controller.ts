import { realSwap } from './real-swap-executor'
import { positionManager } from './position-manager'
import { escolaRobos } from './escola-robos'

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

interface NetworkLock {
  lockedBy: string
  lockedAt: number
}

interface CapitalState {
  locks: Record<string, NetworkLock>
  requests: CapitalRequest[]
}

function lockKey(request: CapitalRequest): string {
  // pair pode ser "USDC→WMATIC" ou "USDC→WMATIC+USDC→WETH" (batch)
  // extrai o primeiro boughtToken após a primeira seta
  const token = request.pair.split('→')[1]?.split(/[+]/)[0] || request.pair
  return `${token}:${request.network}`
}

class CapitalController {
  private state: CapitalState = { locks: {}, requests: [] }
  private listeners: Array<() => void> = []

  getState() {
    const keys = Object.keys(this.state.locks)
    return {
      locked: keys.length > 0,
      lockedBy: keys.length > 0 ? keys.join(', ') : null,
      lockedAt: keys.length > 0 ? Math.min(...keys.map(k => this.state.locks[k].lockedAt)) : 0,
      requests: this.state.requests,
      locks: { ...this.state.locks },
    }
  }
  onChange(cb: () => void) { this.listeners.push(cb); return () => { this.listeners = this.listeners.filter(c => c !== cb) } }
  private notify() { for (const cb of this.listeners) cb() }

  request(request: CapitalRequest): { authorized: boolean; waitPosition: number; reason: string } {
    this.state.requests = this.state.requests.filter(r => Date.now() - r.requestedAt < 300_000)
    const k = lockKey(request)

    const existingLock = this.state.locks[k]
    if (existingLock) {
      const openPositions = positionManager.getOpenPositions()
      const stillOpen = openPositions.some(p =>
        `${p.boughtToken}:${p.networkKey}` === existingLock.lockedBy
      )
      if (!stillOpen) {
        delete this.state.locks[k]
      } else {
        this.state.requests.push(request)
        this.state.requests.sort((a, b) => b.score - a.score)
        const pos = this.state.requests.findIndex(r => r.id === request.id)
        return { authorized: false, waitPosition: pos + 1, reason: `Capital ocupado: ${existingLock.lockedBy}` }
      }
    }

    const availableUSDC = realSwap.getBalance("USDC")
    if (availableUSDC < request.amountUSD) {
      return { authorized: false, waitPosition: 0, reason: `Saldo insuficiente: $${availableUSDC.toFixed(2)} < $${request.amountUSD}` }
    }

    const better = this.state.requests.find(r => r.score > request.score && r.strategy !== request.strategy)
    if (better) {
      this.state.requests.push(request)
      this.state.requests.sort((a, b) => b.score - a.score)
      return { authorized: false, waitPosition: 2, reason: `${better.strategy} tem oportunidade melhor (score ${better.score} vs ${request.score})` }
    }

    this.state.locks[k] = { lockedBy: k, lockedAt: Date.now() }
    this.state.requests = this.state.requests.filter(r => r.id !== request.id)
    this.notify()
    return { authorized: true, waitPosition: 0, reason: 'Executar agora' }
  }

  unlock(key: string) {
    delete this.state.locks[key]

    const network = key.split(':').slice(1).join(':')
    const next = this.state.requests.find(r => r.network === network)
    if (next) {
      const k = lockKey(next)
      if (!this.state.locks[k]) {
        const availableUSDC = realSwap.getBalance("USDC")
        if (availableUSDC >= next.amountUSD) {
          this.state.locks[k] = { lockedBy: k, lockedAt: Date.now() }
          this.state.requests = this.state.requests.filter(r => r.id !== next.id)
          console.log(`[Capital] 🔓 Liberado ${key} → ${next.strategy} autorizado (${next.pair} $${next.amountUSD})`)
        }
      }
    }

    this.notify()
  }

  unlockNetwork(network: string) {
    for (const key of Object.keys(this.state.locks)) {
      if (key.endsWith(':' + network)) {
        delete this.state.locks[key]
      }
    }
    this.state.requests = this.state.requests.filter(r => r.network !== network)
    this.notify()
  }

  canExecute(amountUSD: number, pair: string, network: string): boolean {
    const availableUSDC = realSwap.getBalance("USDC")
    if (availableUSDC < amountUSD) return false
    const token = pair.split('→')[1]?.split(/[+]/)[0] || pair
    const k = `${token}:${network}`
    if (this.state.locks[k] && this.state.locks[k].lockedBy !== k) return false
    return true
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

    const availableUSDC = realSwap.getBalance("USDC")
    if (availableUSDC < amountUSD) {
      return { authorized: false, reason: `Saldo insuficiente: $${availableUSDC.toFixed(2)} < $${amountUSD}` }
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

    if (this.state.locks[k]) {
      this.state.requests.push(req)
      return { authorized: false, reason: `Capital ocupado (${k}) — ${agentName} na fila` }
    }

    this.state.locks[k] = { lockedBy: k, lockedAt: Date.now() }
    this.notify()
    console.log(`[Capital] 🤖 ${agentName} (nível ${info.nivel}) autorizado autonomamente — ${pair} $${amountUSD}`)
    return { authorized: true, reason: `Executando trade autônomo de ${agentName}` }
  }

  forceUnlock(networkKey?: string) {
    if (networkKey) {
      // Remove all locks for this network
      for (const key of Object.keys(this.state.locks)) {
        if (key.endsWith(':' + networkKey)) {
          delete this.state.locks[key]
        }
      }
      this.state.requests = this.state.requests.filter(r => r.network !== networkKey)
    } else {
      this.state.locks = {}
      this.state.requests = []
    }
    this.notify()
  }
}

export const capitalController = new CapitalController()
