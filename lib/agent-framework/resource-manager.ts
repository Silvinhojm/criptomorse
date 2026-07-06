import type { IResourceManager, ResourceRequest, ResourceGrant, ResourceState } from "./IResourceManager"

interface ResourceLock {
  lockedBy: string
  lockedAt: number
}

/**
 * Generic resource manager — controls access to any resource type (capital, CPU, rate limits, etc).
 * Agents request resources, get authorized or queued by priority.
 */
export class ResourceManager implements IResourceManager {
  readonly name: string
  private locks: Record<string, ResourceLock> = {}
  private queue: ResourceRequest[] = []
  private getAvailableFn: (type: string, id: string) => number
  private queueExpiryMs: number

  constructor(
    name: string,
    getAvailable: (type: string, id: string) => number = () => Infinity,
    queueExpiryMs = 300_000,
  ) {
    this.name = name
    this.getAvailableFn = getAvailable
    this.queueExpiryMs = queueExpiryMs
  }

  private resourceKey(req: ResourceRequest): string {
    return `${req.resourceId}:${req.resourceType}`
  }

  request(req: ResourceRequest): ResourceGrant {
    // Expurga requests expirados
    this.queue = this.queue.filter(r => Date.now() - r.requestedAt < this.queueExpiryMs)

    const k = this.resourceKey(req)
    const existing = this.locks[k]
    if (existing) {
      this.queue.push(req)
      this.queue.sort((a, b) => b.priority - a.priority)
      const pos = this.queue.findIndex(r => r.id === req.id)
      return { authorized: false, reason: `Resource locked: ${existing.lockedBy}`, queuePosition: pos + 1 }
    }

    const available = this.getAvailableFn(req.resourceType, req.resourceId)
    if (available < req.amount) {
      return { authorized: false, reason: `Insufficient ${req.resourceType}: ${available} < ${req.amount}`, queuePosition: 0 }
    }

    // Block se alguém com prioridade maior está na fila
    const better = this.queue.find(r => r.priority > req.priority && r.resourceId === req.resourceId)
    if (better) {
      this.queue.push(req)
      this.queue.sort((a, b) => b.priority - a.priority)
      return { authorized: false, reason: `${better.agentId} has higher priority`, queuePosition: 2 }
    }

    this.locks[k] = { lockedBy: k, lockedAt: Date.now() }
    this.queue = this.queue.filter(r => r.id !== req.id)
    return { authorized: true, reason: "Granted", queuePosition: 0, grantedAt: Date.now(), expiresAt: Date.now() + 120_000 }
  }

  release(resourceKey: string): void {
    const existing = this.locks[resourceKey]
    if (!existing) return
    delete this.locks[resourceKey]

    // Libera próximo da fila para este recurso
    const next = this.queue.find(r => {
      const rk = this.resourceKey(r)
      return rk === resourceKey && !this.locks[rk]
    })
    if (next) {
      const available = this.getAvailableFn(next.resourceType, next.resourceId)
      if (available >= next.amount) {
        this.locks[resourceKey] = { lockedBy: this.resourceKey(next), lockedAt: Date.now() }
        this.queue = this.queue.filter(r => r.id !== next.id)
      }
    }
  }

  releaseAll(agentId?: string): void {
    if (agentId) {
      for (const key of Object.keys(this.locks)) {
        if (this.locks[key].lockedBy.startsWith(agentId)) {
          delete this.locks[key]
        }
      }
      this.queue = this.queue.filter(r => r.agentId !== agentId)
    } else {
      this.locks = {}
      this.queue = []
    }
  }

  getState(resourceType?: string): ResourceState {
    const locks = resourceType
      ? Object.fromEntries(Object.entries(this.locks).filter(([k]) => k.endsWith(`:${resourceType}`)))
      : { ...this.locks }

    const available = resourceType
      ? this.getAvailableFn(resourceType, "")
      : Infinity

    return { available, locked: Object.keys(locks).length, locks, queue: [...this.queue] }
  }

  getAvailable(resourceType: string, resourceId: string): number {
    return this.getAvailableFn(resourceType, resourceId)
  }
}
