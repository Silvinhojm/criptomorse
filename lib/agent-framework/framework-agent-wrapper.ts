import type { IAgent, AgentIdentity, AgentProposal, AgentVote } from "./IAgent"
import { frameworkReputation } from "./singletons"

export interface AgentEvalResult {
  confidence: number
  action: "buy" | "sell"
  reason: string
}

export class FrameworkAgent implements IAgent {
  readonly agentId: string
  private identity: AgentIdentity
  private evaluatePair: (pair: string, network: string, action?: string) => AgentEvalResult | null
  private cooldownMs: number
  private cooldownMap = new Map<string, number>()
  private lastVoteMap = new Map<string, number>()

  constructor(config: {
    agentId: string
    name: string
    version: string
    level: number
    canExecuteSolo: boolean
    maxAmountUSD: number
    evaluatePair: (pair: string, network: string, action?: string) => AgentEvalResult | null
    cooldownMs?: number
  }) {
    this.agentId = config.agentId
    this.identity = {
      agentId: config.agentId,
      name: config.name,
      version: config.version,
      level: config.level,
      canExecuteSolo: config.canExecuteSolo,
      maxAmountUSD: config.maxAmountUSD,
    }
    this.evaluatePair = config.evaluatePair
    this.cooldownMs = config.cooldownMs ?? 60_000
  }

  getIdentity(): AgentIdentity {
    return this.identity
  }

  propose(_ctx: Record<string, unknown>): AgentProposal | null {
    return null
  }

  vote(proposal: AgentProposal): AgentVote {
    const pair = (proposal.params?.par as string) ?? (proposal.params?.pair as string) ?? ""
    const network = (proposal.params?.rede as string) ?? (proposal.params?.networkKey as string) ?? ""
    const action = proposal.action?.toLowerCase() === "sell" ? "sell" : "buy"

    const cooldownKey = `${pair}:${network}:${action}`
    const lastVote = this.lastVoteMap.get(cooldownKey)
    const now = Date.now()

    if (lastVote && now - lastVote < this.cooldownMs) {
      return {
        agentId: this.agentId,
        proposalId: proposal.id,
        approved: true,
        confidence: 50,
        reason: `Cooldown — skipping vote on ${pair}`,
        timestamp: now,
      }
    }

    const result = this.evaluatePair(pair, network, action)
    this.lastVoteMap.set(cooldownKey, now)

    if (!result) {
      return {
        agentId: this.agentId,
        proposalId: proposal.id,
        approved: false,
        confidence: 0,
        reason: `${pair} not in my domain`,
        timestamp: now,
      }
    }

    const directionMatch = result.action === action
    return {
      agentId: this.agentId,
      proposalId: proposal.id,
      approved: directionMatch,
      confidence: result.confidence,
      reason: directionMatch ? result.reason : `${result.reason} (wanted ${result.action}, proposed ${action})`,
      timestamp: now,
    }
  }

  onFeedback(feedback: { success: boolean; profit: number; reason?: string }): void {
    frameworkReputation.recordResult(this.agentId, feedback.success, feedback.profit)
  }
}
