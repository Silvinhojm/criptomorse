import type { AgentIntent, IntentRecord, IntentFilter, IIntentPublisher, IntentStatus } from "../../agent-framework/intent-types"
import type { DecisionReport } from "../../agent-framework/decision-report"

let nextId = 0

/**
 * Minimal IIntentPublisher for the education domain.
 *
 * Deliberately OMITS `anchorDecision` (optional in IIntentPublisher) so that
 * Coordinator.submitProposal() never attempts on-chain anchoring for
 * education decisions -- see coordinator.ts: the anchor call is guarded by
 * `this.intentPublisher_?.anchorDecision`, a no-op when the method is absent.
 *
 * Consequence: DecisionReport.onChainStatus stays `undefined` for every
 * education decision. This is the closest achievable representation of
 * "anchoring not required" given the real onChainStatus enum
 * (`"pending" | "confirmed" | "failed" | "skipped"`) has no literal
 * `"not_required"` value, and decision-report.ts is out of scope to modify
 * for this mandate. See Stage 3 report for the full discussion.
 */
export class EducationIntentPublisher implements IIntentPublisher {
  private records = new Map<string, IntentRecord>()

  async publish(intent: AgentIntent): Promise<string> {
    const id = intent.id || `edu_intent_${++nextId}_${Date.now()}`
    this.records.set(id, {
      intent: { ...intent, id },
      status: "CREATED",
      votes: [],
      createdAt: Date.now(),
      statusHistory: [{ status: "CREATED", timestamp: Date.now() }],
    })
    return id
  }

  getRecord(id: string): IntentRecord | null {
    return this.records.get(id) ?? null
  }

  list(filter?: IntentFilter): IntentRecord[] {
    let all = Array.from(this.records.values()).sort((a, b) => b.createdAt - a.createdAt)
    if (filter?.agentId) all = all.filter((r) => r.intent.agentId === filter.agentId)
    if (filter?.action) all = all.filter((r) => r.intent.action === filter.action)
    if (filter?.status) all = all.filter((r) => r.status === filter.status)
    if (filter?.since) all = all.filter((r) => r.createdAt >= filter.since!)
    if (filter?.limit) all = all.slice(0, filter.limit)
    return all
  }

  updateStatus(id: string, status: IntentStatus): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.status = status
    if (!record.statusHistory) record.statusHistory = []
    record.statusHistory.push({ status, timestamp: Date.now() })
    return true
  }

  recordVote(id: string, vote: { agentId: string; approved: boolean; confidence: number; reputationWeight?: number; knowledgeWeight?: number; reason: string }): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.votes.push({ ...vote, reputationWeight: vote.reputationWeight ?? 1, knowledgeWeight: vote.knowledgeWeight ?? 1 })
    return true
  }

  recordResult(id: string, result: { success: boolean; profit: number; txHash?: string; errorMsg?: string }): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.result = result
    return true
  }

  setDecisionReport(id: string, report: DecisionReport): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.decisionReport = report
    return true
  }

  subscribe(_cb: (record: IntentRecord) => void): () => void {
    return () => {}
  }
}
