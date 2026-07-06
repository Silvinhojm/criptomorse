export interface AgentProposal {
  id: string
  agentId: string
  action: string
  params: Record<string, unknown>
  confidence: number
  timestamp: number
}

export interface AgentVote {
  agentId: string
  proposalId: string
  approved: boolean
  confidence: number
  reason: string
  timestamp: number
}

export interface AgentIdentity {
  agentId: string
  name: string
  version: string
  level: number
  canExecuteSolo: boolean
  maxAmountUSD: number
}

export interface IAgent {
  readonly agentId: string
  getIdentity(): AgentIdentity
  propose(ctx: Record<string, unknown>): AgentProposal | null
  vote(proposal: AgentProposal): AgentVote
  onFeedback(feedback: { success: boolean; profit: number; reason?: string }): void
}
