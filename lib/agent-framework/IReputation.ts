export interface AgentStats {
  agentId: string
  totalActions: number
  successes: number
  failures: number
  winRate: number
  totalProfit: number
  avgProfit: number
  streak: number
  score: number
  level: number
}

export interface IReputation {
  getName(): string
  recordResult(agentId: string, success: boolean, profit: number): void
  getStats(agentId: string): AgentStats | null
  getAllStats(): AgentStats[]
  getTopK(k: number): AgentStats[]
  getScore(agentId: string): number
}
