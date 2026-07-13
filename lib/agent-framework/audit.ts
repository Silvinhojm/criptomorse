import type { IAudit, AuditEntry, AuditReport, AuditWriteResult } from "./IAudit"
import type { AgentProposal } from "./IAgent"
import type { ExecutionResult } from "./IExecutor"

export { type AuditEntry, type AuditReport, type AuditWriteResult, type IAudit }

let nextId = 0

export class Audit implements IAudit {
  readonly name: string
  private entries: AuditEntry[] = []
  private maxEntries: number

  constructor(name: string, maxEntries = 1000) {
    this.name = name
    this.maxEntries = maxEntries
  }

  record(entry: AuditEntry): AuditWriteResult {
    this.entries.push(entry)
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries)
    }
    return { recorded: true }
  }

  getById(id: string): AuditEntry | null {
    return this.entries.find(entry => entry.id === id) ?? null
  }

  updateEntry(id: string, updates: Partial<Pick<AuditEntry, "onChainHash" | "onChainTx" | "onChainStatus">>): boolean {
    const entry = this.entries.find(e => e.id === id)
    if (!entry) return false
    if (updates.onChainHash !== undefined) entry.onChainHash = updates.onChainHash
    if (updates.onChainTx !== undefined) entry.onChainTx = updates.onChainTx
    if (updates.onChainStatus !== undefined) entry.onChainStatus = updates.onChainStatus
    return true
  }

  getRecent(count: number): AuditEntry[] {
    return this.entries.slice(-count).reverse()
  }

  getByAgent(agentId: string, limit = 50): AuditEntry[] {
    return this.entries
      .filter(e => e.agentId === agentId)
      .slice(-limit)
      .reverse()
  }

  getReport(since: number): AuditReport {
    const filtered = this.entries.filter(e => e.timestamp >= since)
    const successful = filtered.filter(e => e.result?.success)
    const failed = filtered.filter(e => !e.result?.success)

    const agentProfit = new Map<string, { actions: number; profit: number }>()
    for (const e of filtered) {
      const p = agentProfit.get(e.agentId) ?? { actions: 0, profit: 0 }
      p.actions++
      p.profit += e.result?.profit ?? 0
      agentProfit.set(e.agentId, p)
    }

    const topAgents = Array.from(agentProfit.entries())
      .map(([agentId, v]) => ({ agentId, actions: v.actions, profit: v.profit }))
      .sort((a, b) => b.actions - a.actions)
      .slice(0, 10)

    return {
      totalActions: filtered.length,
      successful: successful.length,
      failed: failed.length,
      totalProfit: filtered.reduce((s, e) => s + (e.result?.profit ?? 0), 0),
      totalGasCost: filtered.reduce((s, e) => s + (e.result?.gasCost ?? 0), 0),
      topAgents,
      periodStart: since,
      periodEnd: Date.now(),
    }
  }

  clear(): void {
    this.entries = []
  }

  static createEntry(params: {
    agentId: string
    action: string
    proposal: AgentProposal
    result: ExecutionResult | null
    approved: boolean
    confidence: number
    voters: number
    knowledgeModifier?: number
    onChainHash?: string
    onChainTx?: string
    onChainStatus?: "pending" | "confirmed" | "failed" | "skipped"
    tags?: string[]
  }): AuditEntry {
    const knowMod = params.knowledgeModifier
    return {
      id: `audit_${++nextId}_${Date.now()}`,
      timestamp: Date.now(),
      agentId: params.agentId,
      action: params.action,
      proposal: params.proposal,
      result: params.result,
      consensus: {
        approved: params.approved,
        confidence: params.confidence,
        voters: params.voters,
      },
      knowledgeModifier: knowMod,
      knowledgeWarnings: (params.proposal.params?.knowledgeWarnings as string[] | undefined) ?? undefined,
      onChainHash: params.onChainHash,
      onChainTx: params.onChainTx,
      onChainStatus: params.onChainStatus,
      tags: params.tags ?? [],
    }
  }
}
