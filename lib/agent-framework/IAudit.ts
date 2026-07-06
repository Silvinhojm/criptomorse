import type { AgentProposal } from "./IAgent"
import type { ExecutionResult } from "./IExecutor"

export interface AuditEntry {
  id: string
  timestamp: number
  agentId: string
  action: string
  proposal: AgentProposal
  result: ExecutionResult | null
  consensus: { approved: boolean; confidence: number; voters: number }
  knowledgeModifier?: number
  knowledgeReport?: {
    liquidity: number
    gasScore: number
    routeScore: number
    marketScore: number
    riskScore: number
    expectedValue: number
  }
  knowledgeWarnings?: string[]
  tags: string[]
}

export interface AuditReport {
  totalActions: number
  successful: number
  failed: number
  totalProfit: number
  totalGasCost: number
  topAgents: { agentId: string; actions: number; profit: number }[]
  periodStart: number
  periodEnd: number
}

export interface IAudit {
  readonly name: string
  record(entry: AuditEntry): void
  getRecent(count: number): AuditEntry[]
  getByAgent(agentId: string, limit?: number): AuditEntry[]
  getReport(since: number): AuditReport
  clear(): void
}
