export interface AgentIntent {
  id: string
  agentId: string
  action: string
  params: Record<string, unknown>
  confidence: number
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
  signature?: string
  timestamp: number
}

export type IntentStatus = "CREATED" | "KNOWLEDGE_VALIDATED" | "VOTING" | "APPROVED" | "REJECTED" | "EXECUTING" | "COMPLETED" | "FAILED"

export interface IntentRecord {
  intent: AgentIntent
  status: IntentStatus
  votes: { agentId: string; approved: boolean; confidence: number; reputationWeight: number; knowledgeWeight: number; reason: string }[]
  result?: { success: boolean; profit: number; txHash?: string; errorMsg?: string }
  createdAt: number
  resolvedAt?: number
  statusHistory?: { status: IntentStatus; timestamp: number }[]
}

export interface IntentFilter {
  agentId?: string
  action?: string
  status?: IntentStatus
  since?: number
  limit?: number
}

export interface IIntentPublisher {
  publish(intent: AgentIntent): Promise<string>
  getRecord(id: string): IntentRecord | null
  list(filter?: IntentFilter): IntentRecord[]
  updateStatus(id: string, status: IntentStatus): void
  subscribe(cb: (record: IntentRecord) => void): () => void
}
