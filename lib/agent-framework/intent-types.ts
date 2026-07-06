export interface AgentIntent {
  id: string
  agentId: string
  action: string
  params: Record<string, unknown>
  confidence: number
  signature?: string
  timestamp: number
}

export type IntentStatus = "pending" | "voting" | "approved" | "rejected" | "executing" | "executed" | "failed"

export interface IntentRecord {
  intent: AgentIntent
  status: IntentStatus
  votes: { agentId: string; approved: boolean; confidence: number; reason: string }[]
  result?: { success: boolean; profit: number; txHash?: string; errorMsg?: string }
  createdAt: number
  resolvedAt?: number
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
  subscribe(cb: (record: IntentRecord) => void): () => void
}
