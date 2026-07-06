import type { ICoordinator, ConsensusResult, CycleReport, SubmissionResult } from "./ICoordinator"
import type { IAgent, AgentProposal, AgentVote } from "./IAgent"
import type { IExecutor } from "./IExecutor"
import type { ISafetyGuard } from "./ISafetyGuard"
import type { IAudit } from "./IAudit"
import { Voting, type VoteResult } from "./voting"
import { Audit } from "./audit"
import { frameworkReputation } from "./singletons"

export { type ConsensusResult, type CycleReport, type SubmissionResult }

export interface CoordinatorConfig {
  name: string
  minAgents?: number
  minConfidence?: number
  executor?: IExecutor
  safetyGuard?: ISafetyGuard
  audit?: IAudit
}

export class Coordinator implements ICoordinator {
  readonly name: string
  private agents: Map<string, IAgent> = new Map()
  private proposals: AgentProposal[] = []
  private voting: Voting
  private executor_: IExecutor | null
  private safetyGuard_: ISafetyGuard | null
  private audit_: IAudit | null
  private cycleCount = 0
  private minAgents: number
  readonly MIN_AGREEING_AGENTS = 2
  readonly WEIGHTED_CONFIDENCE_THRESHOLD = 25

  constructor(config: CoordinatorConfig) {
    this.name = config.name
    this.minAgents = config.minAgents ?? 2
    this.voting = new Voting(config.name, this.MIN_AGREEING_AGENTS, this.WEIGHTED_CONFIDENCE_THRESHOLD)
    this.executor_ = config.executor ?? null
    this.safetyGuard_ = config.safetyGuard ?? null
    this.audit_ = config.audit ?? null
  }

  registerAgent(agent: IAgent): void {
    this.agents.set(agent.agentId, agent)
  }

  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId)
  }

  getAgents(): IAgent[] {
    return Array.from(this.agents.values())
  }

  getExecutor(): IExecutor | null {
    return this.executor_
  }

  getSafetyGuard(): ISafetyGuard | null {
    return this.safetyGuard_
  }

  getAudit(): IAudit | null {
    return this.audit_
  }

  setExecutor(ex: IExecutor): void {
    this.executor_ = ex
  }

  setSafetyGuard(sg: ISafetyGuard): void {
    this.safetyGuard_ = sg
  }

  setAudit(a: IAudit): void {
    this.audit_ = a
  }

  async submitProposal(proposal: AgentProposal): Promise<SubmissionResult> {
    if (this.safetyGuard_ && this.safetyGuard_.isOpen()) {
      return {
        consensus: {
          approved: false,
          action: proposal.action,
          confidence: 0,
          agentVotes: [],
          tiebreaker: "",
          reason: `Safety guard open — proposal ${proposal.id} rejected`,
        },
      }
    }

    let hasEnoughConsensus = false
    let consensus: ConsensusResult
    const knowledgeMod = (proposal.params?.knowledgeModifier as number | undefined) ?? 0

    // If agents are registered, run voting
    if (this.agents.size > 0) {
      const votes = await this.collectVotes(proposal)
      for (const v of votes) {
        const repScore = frameworkReputation.getScore(v.agentId)
        const repWeight = Math.max(0.1, Math.min(1.0, repScore / 100))
        this.voting.recordVote({
          agentId: v.agentId,
          proposalId: proposal.id,
          approved: v.approved,
          confidence: v.confidence,
          reputationWeight: repWeight,
          knowledgeWeight: 1 + knowledgeMod / 100,
          reason: v.reason,
          timestamp: v.timestamp,
        })
      }
      consensus = this.resolveConsensus(proposal, votes)
      hasEnoughConsensus = consensus.approved
    } else {
      // No agents registered yet — pass through directly
      hasEnoughConsensus = true
      consensus = {
        approved: true,
        action: proposal.action,
        confidence: proposal.confidence,
        agentVotes: [],
        tiebreaker: "",
        reason: "No voting agents — direct execution",
      }
    }

    if (!hasEnoughConsensus) {
      return { consensus }
    }

    if (!this.executor_) {
      return {
        consensus: { ...consensus, approved: false, reason: "No executor configured" },
      }
    }

    const canExec = this.executor_.canExecute(proposal)
    if (!canExec.allowed) {
      return {
        consensus: { ...consensus, approved: false, reason: canExec.reason },
      }
    }

    const executionResult = await this.executor_.execute(proposal)

    if (this.audit_) {
      this.audit_.record(Audit.createEntry({
        agentId: proposal.agentId,
        action: proposal.action,
        proposal,
        result: executionResult,
        approved: consensus.approved,
        confidence: consensus.confidence,
        voters: this.agents.size,
        knowledgeModifier: knowledgeMod,
      }))
    }

    for (const agent of this.agents.values()) {
      agent.onFeedback({
        success: executionResult.success,
        profit: executionResult.profit ?? 0,
        reason: executionResult.errorMsg,
      })
    }

    return { consensus, executionResult }
  }

  private async collectProposals(ctx: Record<string, unknown>): Promise<AgentProposal[]> {
    const proposals: AgentProposal[] = []
    for (const agent of this.agents.values()) {
      try {
        const prop = agent.propose(ctx)
        if (prop) proposals.push(prop)
      } catch (e) {
        console.warn(`[${this.name}] Agent ${agent.agentId} failed to propose:`, e)
      }
    }
    return proposals
  }

  private async collectVotes(proposal: AgentProposal): Promise<AgentVote[]> {
    const votes: AgentVote[] = []
    for (const agent of this.agents.values()) {
      try {
        const vote = agent.vote(proposal)
        if (vote) votes.push(vote)
      } catch (e) {
        console.warn(`[${this.name}] Agent ${agent.agentId} failed to vote:`, e)
      }
    }
    return votes
  }

  private resolveConsensus(proposal: AgentProposal, votes: AgentVote[]): ConsensusResult {
    const buyVotes = votes.filter(v => v.approved)
    const sellVotes = votes.filter(v => !v.approved)
    const holdVotes = votes.filter(v => !v.approved)

    const knowledgeModifier = (proposal.params?.knowledgeModifier as number | undefined) ?? 0
    const knowledgeWeight = 1 + knowledgeModifier / 100

    const weightedConf = (v: AgentVote): number => {
      const repScore = frameworkReputation.getScore(v.agentId)
      const repWeight = Math.max(0.1, Math.min(1.0, repScore / 100))
      return (v.confidence / 100) * repWeight * knowledgeWeight
    }

    const total = votes.length || 1
    const buyScore = buyVotes.reduce((s, v) => s + weightedConf(v) * 100, 0) / total
    const sellScore = sellVotes.reduce((s, v) => s + weightedConf(v) * 100, 0) / total
    const holdScore = holdVotes.reduce((s, v) => s + weightedConf(v) * 100, 0) / total

    let action: string
    let winningScore: number
    let agreeingVotes: AgentVote[]

    if (buyScore >= sellScore && buyScore >= holdScore) {
      action = "buy"
      winningScore = buyScore
      agreeingVotes = buyVotes
    } else if (sellScore >= buyScore && sellScore >= holdScore) {
      action = "sell"
      winningScore = sellScore
      agreeingVotes = sellVotes
    } else {
      action = "hold"
      winningScore = holdScore
      agreeingVotes = holdVotes
    }

    const hasEnoughAgents = agreeingVotes.length >= this.MIN_AGREEING_AGENTS
    const hasEnoughConf = winningScore >= this.WEIGHTED_CONFIDENCE_THRESHOLD
    const isNotHold = action !== "hold"

    let approved = false
    let reason = ""
    let tiebreaker = ""

    if (!isNotHold) {
      reason = `Hold won (${holdScore.toFixed(1)}% vs buy ${buyScore.toFixed(1)}% sell ${sellScore.toFixed(1)}%)`
    } else if (!hasEnoughAgents) {
      reason = `Only ${agreeingVotes.length} agents agree on ${action} (min: ${this.MIN_AGREEING_AGENTS})`
    } else if (!hasEnoughConf) {
      reason = `Confidence too low: ${winningScore.toFixed(1)}% (min: ${this.WEIGHTED_CONFIDENCE_THRESHOLD}%)`
    } else {
      approved = true
      reason = `${action.toUpperCase()} approved: ${agreeingVotes.length}/${votes.length} agents, ${winningScore.toFixed(1)}% confidence`
    }

    return {
      approved,
      action,
      confidence: winningScore,
      agentVotes: votes.map(v => ({
        agentId: v.agentId,
        approved: v.approved,
        confidence: v.confidence,
        reason: v.reason,
      })),
      tiebreaker,
      reason,
    }
  }

  async runCycle(): Promise<CycleReport> {
    this.cycleCount++
    const report: CycleReport = {
      cycleId: this.cycleCount,
      proposalsSubmitted: 0,
      consensusReached: 0,
      executionsDispatched: 0,
      errors: 0,
      timestamp: Date.now(),
    }

    // Safety check
    if (this.safetyGuard_ && this.safetyGuard_.isOpen()) {
      console.warn(`[${this.name}] Safety guard open — cycle skipped`)
      return report
    }

    // Collect proposals
    const proposals = await this.collectProposals({})
    report.proposalsSubmitted = proposals.length

    for (const proposal of proposals) {
      try {
        // Collect votes
        const votes = await this.collectVotes(proposal)
        const knowledgeMod = (proposal.params?.knowledgeModifier as number | undefined) ?? 0
        for (const v of votes) {
          const repScore = frameworkReputation.getScore(v.agentId)
          const repWeight = Math.max(0.1, Math.min(1.0, repScore / 100))
          this.voting.recordVote({
            agentId: v.agentId,
            proposalId: proposal.id,
            approved: v.approved,
            confidence: v.confidence,
            reputationWeight: repWeight,
            knowledgeWeight: 1 + knowledgeMod / 100,
            reason: v.reason,
            timestamp: v.timestamp,
          })
        }

        // Resolve consensus
        const consensus = this.resolveConsensus(proposal, votes)
        report.consensusReached++

        if (consensus.approved && this.executor_) {
          // Execute
          const result = await this.executor_.execute(proposal)
          report.executionsDispatched++

          // Audit
          if (this.audit_) {
            const knowledgeMod = (proposal.params?.knowledgeModifier as number | undefined)
            this.audit_.record(Audit.createEntry({
              agentId: proposal.agentId,
              action: proposal.action,
              proposal,
              result,
              approved: consensus.approved,
              confidence: consensus.confidence,
              voters: votes.length,
              knowledgeModifier: knowledgeMod,
            }))
          }

          // Feedback to agents
          for (const agent of this.agents.values()) {
            agent.onFeedback({
              success: result.success,
              profit: result.profit ?? 0,
              reason: result.errorMsg,
            })
          }
        }
      } catch (e) {
        report.errors++
        console.warn(`[${this.name}] Cycle error on proposal ${proposal.id}:`, e)
      }
    }

    return report
  }
}
