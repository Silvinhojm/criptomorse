import type { ILearningEngine, LearningFeedback, AgentParams } from "./ILearningEngine"

export { type LearningFeedback, type AgentParams, type ILearningEngine }

interface AdjustmentRecord {
  from: AgentParams
  to: AgentParams
  reason: string
  timestamp: number
}

export class LearningEngine implements ILearningEngine {
  readonly name: string
  protected feedbacks: LearningFeedback[] = []
  protected agentParams: Map<string, AgentParams> = new Map()
  protected adjustments: Map<string, AdjustmentRecord[]> = new Map()
  protected maxFeedbacks: number

  constructor(name: string, maxFeedbacks = 1000) {
    this.name = name
    this.maxFeedbacks = maxFeedbacks
  }

  ingest(feedback: LearningFeedback): void {
    this.feedbacks.push(feedback)
    if (this.feedbacks.length > this.maxFeedbacks) {
      this.feedbacks = this.feedbacks.slice(-this.maxFeedbacks)
    }
  }

  getParams(agentId: string): AgentParams | null {
    return this.agentParams.get(agentId) ?? null
  }

  setDefaultParams(agentId: string, params: AgentParams): void {
    if (!this.agentParams.has(agentId)) {
      this.agentParams.set(agentId, { ...params })
    }
  }

  adjust(agentId: string): { adjusted: boolean; reason: string; newParams: AgentParams } {
    const current = this.agentParams.get(agentId)
    if (!current) {
      return { adjusted: false, reason: `No params for ${agentId}`, newParams: this._defaultParams() }
    }

    const recent = this.feedbacks
      .filter(f => f.agentId === agentId)
      .slice(-20)

    if (recent.length < 3) {
      return { adjusted: false, reason: "Not enough feedback data", newParams: current }
    }

    const recentWins = recent.filter(f => f.success).length
    const winRate = recentWins / recent.length

    let adjusted = false
    let reason = ""
    const newParams = { ...current }

    if (winRate < 0.3) {
      newParams.minConfidence = Math.min(80, current.minConfidence + 5)
      newParams.threshold = Math.min(0.05, current.threshold * 1.5)
      adjusted = true
      reason = `Low win rate (${(winRate * 100).toFixed(0)}%) — increasing strictness`
    } else if (winRate > 0.7) {
      newParams.minConfidence = Math.max(10, current.minConfidence - 3)
      newParams.threshold = Math.max(0.001, current.threshold * 0.8)
      adjusted = true
      reason = `High win rate (${(winRate * 100).toFixed(0)}%) — loosening params`
    }

    if (adjusted) {
      const records = this.adjustments.get(agentId) ?? []
      records.push({ from: current, to: newParams, reason, timestamp: Date.now() })
      this.adjustments.set(agentId, records)
      this.agentParams.set(agentId, newParams)
    }

    return { adjusted, reason, newParams }
  }

  getAdjustmentHistory(agentId: string): { from: AgentParams; to: AgentParams; reason: string; timestamp: number }[] {
    return this.adjustments.get(agentId) ?? []
  }

  private _defaultParams(): AgentParams {
    return { minConfidence: 30, threshold: 0.005, maxExposure: 100, cooldownMs: 60000 }
  }
}
