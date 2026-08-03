export type OnChainProofOutboxStatus = "pending" | "processing" | "retry_wait" | "reconciliation_pending" | "confirmed" | "dead_letter" | "legacy_evidence_missing"

export interface OnChainProofOutboxItem {
  intentId: string
  decisionReportId: string
  auditId: string
  decisionHash: string
  compactPayload: string
  attempts: number
  nextAttemptAt: number
  lastError?: string
  status: OnChainProofOutboxStatus
  txHash?: string
  blockNumber?: number
  leaseOwner?: string
}

export interface OnChainProofOutbox {
  enqueue(item: Omit<OnChainProofOutboxItem, "attempts" | "status">): Promise<void>
  claimDue(owner: string, now?: number): Promise<OnChainProofOutboxItem | null>
  recordKnownProof(intentId: string, owner: string, proof: { txHash: string; blockNumber: number }): Promise<boolean>
  complete(intentId: string, owner: string): Promise<boolean>
  retry(intentId: string, owner: string, error: string, nextAttemptAt: number, exhausted: boolean): Promise<boolean>
  markLegacyEvidenceMissing(intentId: string, owner: string): Promise<boolean>
  get(intentId: string): Promise<OnChainProofOutboxItem | null>
}

/** Deterministic serialized adapter used only by tests; no external Redis. */
export class MemoryOnChainProofOutbox implements OnChainProofOutbox {
  private readonly items = new Map<string, OnChainProofOutboxItem>()
  private globalLeaseOwner: string | null = null
  private serial: Promise<void> = Promise.resolve()

  private async locked<T>(fn: () => T): Promise<T> {
    let release!: () => void
    const previous = this.serial
    this.serial = new Promise<void>(resolve => { release = resolve })
    await previous
    try { return fn() } finally { release() }
  }

  async enqueue(item: Omit<OnChainProofOutboxItem, "attempts" | "status">): Promise<void> {
    await this.locked(() => {
      if (!this.items.has(item.intentId)) this.items.set(item.intentId, { ...item, attempts: 0, status: "pending" })
    })
  }

  claimDue(owner: string, now = Date.now()): Promise<OnChainProofOutboxItem | null> {
    return this.locked(() => {
      if (this.globalLeaseOwner) return null
      const item = [...this.items.values()].find(candidate =>
        ["pending", "retry_wait", "reconciliation_pending"].includes(candidate.status) && candidate.nextAttemptAt <= now)
      if (!item) return null
      this.globalLeaseOwner = owner
      item.status = "processing"
      item.attempts += 1
      item.leaseOwner = owner
      return { ...item }
    })
  }

  recordKnownProof(intentId: string, owner: string, proof: { txHash: string; blockNumber: number }): Promise<boolean> {
    return this.locked(() => {
      const item = this.items.get(intentId)
      if (!item || item.leaseOwner !== owner || item.status !== "processing") return false
      item.txHash = proof.txHash
      item.blockNumber = proof.blockNumber
      item.status = "reconciliation_pending"
      return true
    })
  }

  complete(intentId: string, owner: string): Promise<boolean> {
    return this.locked(() => {
      const item = this.items.get(intentId)
      if (!item || item.leaseOwner !== owner) return false
      item.status = "confirmed"
      delete item.leaseOwner
      if (this.globalLeaseOwner === owner) this.globalLeaseOwner = null
      return true
    })
  }

  retry(intentId: string, owner: string, error: string, nextAttemptAt: number, exhausted: boolean): Promise<boolean> {
    return this.locked(() => {
      const item = this.items.get(intentId)
      if (!item || item.leaseOwner !== owner) return false
      item.lastError = error.slice(0, 500)
      item.nextAttemptAt = nextAttemptAt
      item.status = exhausted ? "dead_letter" : (item.txHash ? "reconciliation_pending" : "retry_wait")
      delete item.leaseOwner
      if (this.globalLeaseOwner === owner) this.globalLeaseOwner = null
      return true
    })
  }

  markLegacyEvidenceMissing(intentId: string, owner: string): Promise<boolean> {
    return this.locked(() => {
      const item = this.items.get(intentId)
      if (!item || item.leaseOwner !== owner) return false
      item.status = "legacy_evidence_missing"
      item.lastError = "legacy_evidence_missing"
      delete item.leaseOwner
      if (this.globalLeaseOwner === owner) this.globalLeaseOwner = null
      return true
    })
  }

  async get(intentId: string): Promise<OnChainProofOutboxItem | null> {
    const item = this.items.get(intentId)
    return item ? { ...item } : null
  }
}
