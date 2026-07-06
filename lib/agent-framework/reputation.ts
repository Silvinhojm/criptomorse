import type { IReputation, AgentStats } from "./IReputation"

export { type AgentStats, type IReputation }

export class Reputation implements IReputation {
  private agents = new Map<string, AgentStats>()
  readonly name: string

  constructor(name: string) {
    this.name = name
  }

  getName(): string {
    return this.name
  }

  recordResult(agentId: string, success: boolean, profit: number): void {
    let s = this.agents.get(agentId)
    if (!s) {
      s = {
        agentId,
        totalActions: 0,
        successes: 0,
        failures: 0,
        winRate: 0,
        totalProfit: 0,
        avgProfit: 0,
        streak: 0,
        score: 0,
        level: 0,
      }
      this.agents.set(agentId, s)
    }

    s.totalActions++
    if (success) {
      s.successes++
      s.streak = Math.max(0, s.streak) + 1
    } else {
      s.failures++
      s.streak = Math.min(0, s.streak) - 1
    }
    s.totalProfit += profit
    s.winRate = s.totalActions > 0 ? (s.successes / s.totalActions) * 100 : 0
    s.avgProfit = s.totalActions > 0 ? s.totalProfit / s.totalActions : 0
    s.score = this._computeScore(s)
  }

  private _computeScore(s: AgentStats): number {
    const winPart = s.winRate * 0.5
    const profitPart = Math.min(Math.max(0, s.avgProfit), 1) * 20
    const streakPart = Math.max(0, s.streak) * 2
    return Math.max(0, winPart + profitPart + streakPart)
  }

  getStats(agentId: string): AgentStats | null {
    return this.agents.get(agentId) ?? null
  }

  getAllStats(): AgentStats[] {
    return Array.from(this.agents.values()).sort((a, b) => b.score - a.score)
  }

  getTopK(k: number): AgentStats[] {
    return this.getAllStats().slice(0, k)
  }

  getScore(agentId: string): number {
    return this.agents.get(agentId)?.score ?? 0
  }

  registerAgent(agentId: string): void {
    if (!this.agents.has(agentId)) {
      this.agents.set(agentId, {
        agentId,
        totalActions: 0,
        successes: 0,
        failures: 0,
        winRate: 0,
        totalProfit: 0,
        avgProfit: 0,
        streak: 0,
        score: 0,
        level: 0,
      })
    }
  }
}
