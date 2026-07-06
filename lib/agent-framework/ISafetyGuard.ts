export interface SafetyStatus {
  isOpen: boolean
  reason: string | null
  triggeredAt: string | null
  consecutiveFailures: number
  maxFailures: number
  cooldownUntil: number | null
}

export interface ISafetyGuard {
  readonly name: string
  recordSuccess(): void
  recordFailure(reason?: string): void
  isOpen(): boolean
  getStatus(): SafetyStatus
  reset(): void
}
