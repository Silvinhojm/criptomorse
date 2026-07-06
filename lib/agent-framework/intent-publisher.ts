import type { AgentIntent, IntentRecord, IntentFilter, IIntentPublisher, IntentStatus } from "./intent-types"

let nextIntentId = 0

export type { AgentIntent, IntentRecord, IntentFilter, IIntentPublisher }

export class IntentPublisher implements IIntentPublisher {
  private records = new Map<string, IntentRecord>()
  private subscribers = new Set<(record: IntentRecord) => void>()
  private maxRecords: number
  readonly name: string

  constructor(name: string, maxRecords = 500) {
    this.name = name
    this.maxRecords = maxRecords
  }

  async publish(intent: AgentIntent): Promise<string> {
    const record: IntentRecord = {
      intent: { ...intent, id: intent.id || `intent_${++nextIntentId}_${Date.now()}` },
      status: "pending",
      votes: [],
      createdAt: Date.now(),
    }

    this.records.set(record.intent.id, record)
    this._trim()
    this._notify(record)
    return record.intent.id
  }

  getRecord(id: string): IntentRecord | null {
    return this.records.get(id) ?? null
  }

  list(filter?: IntentFilter): IntentRecord[] {
    let all = Array.from(this.records.values()).sort((a, b) => b.createdAt - a.createdAt)

    if (filter) {
      if (filter.agentId) all = all.filter(r => r.intent.agentId === filter.agentId)
      if (filter.action) all = all.filter(r => r.intent.action === filter.action)
      if (filter.status) all = all.filter(r => r.status === filter.status)
      if (filter.since) all = all.filter(r => r.createdAt >= filter.since!)
      if (filter.limit) all = all.slice(0, filter.limit)
    }

    return all
  }

  updateStatus(id: string, status: IntentStatus): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.status = status
    if (status === "approved" || status === "rejected" || status === "failed") {
      record.resolvedAt = Date.now()
    }
    this._notify(record)
    return true
  }

  recordVote(id: string, vote: { agentId: string; approved: boolean; confidence: number; reason: string }): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.votes.push(vote)
    this._notify(record)
    return true
  }

  recordResult(id: string, result: { success: boolean; profit: number; txHash?: string; errorMsg?: string }): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.result = result
    record.status = result.success ? "executed" : "failed"
    record.resolvedAt = Date.now()
    this._notify(record)
    return true
  }

  subscribe(cb: (record: IntentRecord) => void): () => void {
    this.subscribers.add(cb)
    return () => this.subscribers.delete(cb)
  }

  getStats() {
    const all = Array.from(this.records.values())
    return {
      total: all.length,
      pending: all.filter(r => r.status === "pending" || r.status === "voting").length,
      approved: all.filter(r => r.status === "approved").length,
      executed: all.filter(r => r.status === "executed").length,
      failed: all.filter(r => r.status === "failed").length,
      rejected: all.filter(r => r.status === "rejected").length,
    }
  }

  private _trim(): void {
    if (this.records.size > this.maxRecords) {
      const sorted = Array.from(this.records.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt)
      const toRemove = sorted.slice(0, sorted.length - this.maxRecords)
      for (const [id] of toRemove) this.records.delete(id)
    }
  }

  private _notify(record: IntentRecord): void {
    for (const cb of this.subscribers) {
      try { cb(record) } catch { /* subscriber error */ }
    }
  }
}
