export interface LearningFeedback {
  agentId: string
  action: string
  success: boolean
  profit: number
  confidence: number
  params: Record<string, number>
  context: Record<string, unknown>
}

export interface AgentParams {
  minConfidence: number
  threshold: number
  maxExposure: number
  cooldownMs: number
  [key: string]: number
}

export interface ILearningEngine {
  readonly name: string
  ingest(feedback: LearningFeedback): void
  getParams(agentId: string): AgentParams | null
  adjust(agentId: string): { adjusted: boolean; reason: string; newParams: AgentParams }
  getAdjustmentHistory(agentId: string): { from: AgentParams; to: AgentParams; reason: string; timestamp: number }[]
}
