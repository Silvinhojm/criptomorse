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
  return `${request.pair.split('→')[1]}:${request.network}`
}

class CapitalController {
  private state: CapitalState = { locks: {}, requests: [] }
  private listeners: Array<() => void> = []

  getState() {
    const networks = Object.keys(this.state.locks)
    return {
      locked: networks.length > 0,
      lockedBy: networks.length > 0 ? networks[0] : null,
      lockedAt: networks.length > 0 ? this.state.locks[networks[0]].lockedAt : 0,
      requests: this.state.requests,
    }
  }
  onChange(cb: () => void) { this.listeners.push(cb); return () => { this.listeners = this.listeners.filter(c => c !== cb) } }
  private notify() { for (const cb of this.listeners) cb() }

  request(request: CapitalRequest): { authorized: boolean; waitPosition: number; reason: string } {
    this.state.requests = this.state.requests.filter(r => Date.now() - r.requestedAt < 300_000)

    const netLock = this.state.locks[request.network]
    if (netLock) {
      const openPositions = positionManager.getOpenPositions()
      const stillOpen = openPositions.some(p =>
        `${p.boughtToken}:${p.networkKey}` === netLock.lockedBy
      )
      if (!stillOpen) {
        this.unlock(request.network)
      } else {
        this.state.requests.push(request)
        this.state.requests.sort((a, b) => b.score - a.score)
        const pos = this.state.requests.findIndex(r => r.id === request.id)
        return { authorized: false, waitPosition: pos + 1, reason: `Capital ocupado em ${request.network}: ${netLock.lockedBy}` }
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

    this.state.locks[request.network] = { lockedBy: lockKey(request), lockedAt: Date.now() }
    this.state.requests = this.state.requests.filter(r => r.id !== request.id)
    this.notify()
    return { authorized: true, waitPosition: 0, reason: 'Executar agora' }
  }

  unlock(networkKey: string) {
    delete this.state.locks[networkKey]

    const next = this.state.requests.find(r => r.network === networkKey)
    if (next) {
      const availableUSDC = realSwap.getBalance("USDC")
      if (availableUSDC >= next.amountUSD) {
        this.state.locks[networkKey] = { lockedBy: lockKey(next), lockedAt: Date.now() }
        this.state.requests = this.state.requests.filter(r => r.id !== next.id)
        console.log(`[Capital] 🔓 Liberado ${networkKey} → ${next.strategy} autorizado (${next.pair} $${next.amountUSD})`)
      }
    }

    this.notify()
  }

  canExecute(amountUSD: number, pair: string, network: string): boolean {
    const availableUSDC = realSwap.getBalance("USDC")
    if (availableUSDC < amountUSD) return false
    const boughtToken = pair.split('→')[1]
    const netLock = this.state.locks[network]
    if (netLock && netLock.lockedBy !== `${boughtToken}:${network}`) return false
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

    if (this.state.locks[network]) {
      this.state.requests.push({
        id: `autonomo:${agentName}:${pair}:${Date.now()}`,
        strategy: `autonomo-${agentName}`,
        pair,
        network,
        amountUSD,
        score: info.pontos / 100,
        estimatedProfit: 0,
        requestedAt: Date.now(),
      })
      return { authorized: false, reason: `Capital ocupado em ${network} — ${agentName} na fila` }
    }

    this.state.locks[network] = { lockedBy: `${pair.split('→')[1]}:${network}`, lockedAt: Date.now() }
    this.notify()
    console.log(`[Capital] 🤖 ${agentName} (nível ${info.nivel}) autorizado autonomamente — ${pair} $${amountUSD}`)
    return { authorized: true, reason: `Executando trade autônomo de ${agentName}` }
  }

  forceUnlock(networkKey?: string) {
    if (networkKey) {
      delete this.state.locks[networkKey]
      this.state.requests = this.state.requests.filter(r => r.network !== networkKey)
    } else {
      this.state.locks = {}
      this.state.requests = []
    }
    this.notify()
  }
}

export const capitalController = new CapitalController()
