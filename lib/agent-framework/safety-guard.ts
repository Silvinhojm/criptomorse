import type { ISafetyGuard, SafetyStatus } from "./ISafetyGuard"

export interface SafetyGuardConfig {
  name: string
  maxFailures: number
  cooldownMs: number
  onTrigger?: (reason: string) => void
  onRecover?: () => void
}

/**
 * Generic safety guard — counts consecutive failures, opens after threshold,
 * auto-recovers after cooldown. Usable for routes, financial health, rate limits, etc.
 */
export class SafetyGuard implements ISafetyGuard {
  readonly name: string
  private consecutiveFailures = 0
  private cooldownUntil: number | null = null
  private readonly maxFailures: number
  private readonly cooldownMs: number
  private readonly onTrigger?: (reason: string) => void
  private readonly onRecover?: () => void

  constructor(config: SafetyGuardConfig) {
    this.name = config.name
    this.maxFailures = config.maxFailures
    this.cooldownMs = config.cooldownMs
    this.onTrigger = config.onTrigger
    this.onRecover = config.onRecover
  }

  recordSuccess(): void {
    if (this.consecutiveFailures > 0 || this.cooldownUntil) {
      this.consecutiveFailures = 0
      this.cooldownUntil = null
      this.onRecover?.()
    }
  }

  recordFailure(reason?: string): void {
    this.consecutiveFailures++
    if (this.consecutiveFailures >= this.maxFailures && !this.cooldownUntil) {
      this.cooldownUntil = Date.now() + this.cooldownMs
      const msg = `${this.name}: triggered after ${this.consecutiveFailures} failures${reason ? ` — ${reason}` : ''}`
      this.onTrigger?.(msg)
    }
  }

  isOpen(): boolean {
    if (!this.cooldownUntil) return false
    if (Date.now() >= this.cooldownUntil) {
      this.consecutiveFailures = 0
      this.cooldownUntil = null
      this.onRecover?.()
      return false
    }
    return true
  }

  getStatus(): SafetyStatus {
    return {
      isOpen: this.isOpen(),
      reason: this.isOpen() ? `${this.name} em cooldown` : null,
      triggeredAt: this.cooldownUntil ? new Date(this.cooldownUntil - this.cooldownMs).toISOString() : null,
      consecutiveFailures: this.consecutiveFailures,
      maxFailures: this.maxFailures,
      cooldownUntil: this.cooldownUntil,
    }
  }

  reset(): void {
    this.consecutiveFailures = 0
    this.cooldownUntil = null
  }
}

/**
 * Composite safety guard — aggregates multiple guards.
 * Open if ANY guard is open.
 */
export class CompositeSafetyGuard implements ISafetyGuard {
  readonly name: string
  private guards: SafetyGuard[] = []

  constructor(name: string) {
    this.name = name
  }

  add(guard: SafetyGuard): void {
    this.guards.push(guard)
  }

  remove(name: string): void {
    this.guards = this.guards.filter(g => g.name !== name)
  }

  recordSuccess(): void {
    for (const g of this.guards) g.recordSuccess()
  }

  recordFailure(reason?: string): void {
    for (const g of this.guards) g.recordFailure(reason)
  }

  isOpen(): boolean {
    return this.guards.some(g => g.isOpen())
  }

  getStatus(): SafetyStatus {
    const openGuards = this.guards
      .map(g => ({ name: g.name, status: g.getStatus() }))
      .filter(s => s.status.isOpen)
    if (openGuards.length === 0) {
      return { isOpen: false, reason: null, triggeredAt: null, consecutiveFailures: 0, maxFailures: 0, cooldownUntil: null }
    }
    return {
      isOpen: true,
      reason: `Open guards: ${openGuards.map(s => s.name).join(', ')}`,
      triggeredAt: openGuards[0].status.triggeredAt,
      consecutiveFailures: Math.max(...openGuards.map(s => s.status.consecutiveFailures)),
      maxFailures: Math.max(...openGuards.map(s => s.status.maxFailures)),
      cooldownUntil: Math.max(...openGuards.map(s => s.status.cooldownUntil ?? 0)),
    }
  }

  reset(): void {
    for (const g of this.guards) g.reset()
  }
}
