import type { AgentIntent, IntentRecord, IntentFilter, IIntentPublisher, IntentStatus } from "./intent-types"
import type { DecisionReport } from "./decision-report"
import { ethers } from "ethers"

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

  private _transition(record: IntentRecord, newStatus: IntentStatus): void {
    record.status = newStatus
    if (!record.statusHistory) record.statusHistory = []
    record.statusHistory.push({ status: newStatus, timestamp: Date.now() })
    if (newStatus === "APPROVED" || newStatus === "REJECTED" || newStatus === "FAILED" || newStatus === "COMPLETED") {
      record.resolvedAt = Date.now()
    }
  }

  async publish(intent: AgentIntent): Promise<string> {
    const record: IntentRecord = {
      intent: { ...intent, id: intent.id || `intent_${++nextIntentId}_${Date.now()}` },
      status: "CREATED",
      votes: [],
      createdAt: Date.now(),
      statusHistory: [{ status: "CREATED", timestamp: Date.now() }],
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
    this._transition(record, status)
    this._notify(record)
    return true
  }

  recordVote(id: string, vote: { agentId: string; approved: boolean; confidence: number; reputationWeight?: number; knowledgeWeight?: number; reason: string }): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.votes.push({
      ...vote,
      reputationWeight: vote.reputationWeight ?? 1.0,
      knowledgeWeight: vote.knowledgeWeight ?? 1.0,
    })
    this._notify(record)
    return true
  }

  recordResult(id: string, result: { success: boolean; profit: number; txHash?: string; errorMsg?: string }): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.result = result
    this._transition(record, result.success ? "COMPLETED" : "FAILED")
    this._notify(record)
    return true
  }

  setDecisionReport(id: string, report: DecisionReport): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.decisionReport = report
    this._notify(record)
    return true
  }

  async anchorDecision(id: string, report: DecisionReport): Promise<{ txHash: string; blockNumber: number; hash: string } | null> {
    const lightweightMeta = JSON.stringify({
      intentId: report.intentId,
      agentId: report.agentId,
      action: report.action,
      status: report.execution?.success ? "COMPLETED" : "FAILED",
      timestamp: report.createdAt,
    })
    const hash = ethers.solidityPackedKeccak256(["string"], [lightweightMeta])
    console.log(`[IntentPublisher] 📝 Off-chain anchor: ${id} → hash=${hash.slice(0, 18)}...`)
    return null
  }

  subscribe(cb: (record: IntentRecord) => void): () => void {
    this.subscribers.add(cb)
    return () => this.subscribers.delete(cb)
  }

  getStats() {
    const all = Array.from(this.records.values())
    return {
      total: all.length,
      pending: all.filter(r => r.status === "CREATED" || r.status === "KNOWLEDGE_VALIDATED").length,
      voting: all.filter(r => r.status === "VOTING").length,
      approved: all.filter(r => r.status === "APPROVED" || r.status === "EXECUTING").length,
      completed: all.filter(r => r.status === "COMPLETED").length,
      failed: all.filter(r => r.status === "FAILED").length,
      rejected: all.filter(r => r.status === "REJECTED").length,
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
