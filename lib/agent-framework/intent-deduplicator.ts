export interface DedupEntry {
  hash: string
  firstSeen: number
  count: number
}

export class IntentDeduplicator {
  private entries: Map<string, DedupEntry> = new Map()
  readonly WINDOW_MS: number
  readonly MAX_WARNINGS = 3

  constructor(windowMs = 30_000) {
    this.WINDOW_MS = windowMs
  }

  hashProposal(agentId: string, action: string, params?: Record<string, unknown>): string {
    const pair = params?.par as string ?? params?.pair as string ?? ""
    const network = params?.rede as string ?? params?.networkKey as string ?? ""
    const fromToken = params?.fromToken as string ?? ""
    const toToken = params?.toToken as string ?? ""
    const amountBucket = this._amountBucket(params?.amountUsd as number | undefined)
    return `${agentId}|${action}|${pair}|${network}|${fromToken}|${toToken}|${amountBucket}`
  }

  private _amountBucket(amount?: number): string {
    if (!amount || amount <= 0) return "0"
    if (amount <= 10) return "1-10"
    if (amount <= 50) return "11-50"
    if (amount <= 100) return "51-100"
    return "101+"
  }

  private _prune(): void {
    const cutoff = Date.now() - this.WINDOW_MS
    for (const [hash, entry] of this.entries) {
      if (entry.firstSeen < cutoff) {
        this.entries.delete(hash)
      }
    }
  }

  isDuplicate(agentId: string, action: string, params?: Record<string, unknown>): { duplicate: boolean; count: number; entry?: DedupEntry } {
    this._prune()
    const hash = this.hashProposal(agentId, action, params)
    const existing = this.entries.get(hash)
    if (existing) {
      existing.count++
      return { duplicate: true, count: existing.count, entry: existing }
    }
    const entry: DedupEntry = { hash, firstSeen: Date.now(), count: 1 }
    this.entries.set(hash, entry)
    return { duplicate: false, count: 1, entry }
  }

  reset(): void {
    this.entries.clear()
  }

  getStats(): { activeEntries: number; oldestMs: number } {
    const now = Date.now()
    let oldest = now
    for (const e of this.entries.values()) {
      if (e.firstSeen < oldest) oldest = e.firstSeen
    }
    return {
      activeEntries: this.entries.size,
      oldestMs: this.entries.size > 0 ? now - oldest : 0,
    }
  }
}
