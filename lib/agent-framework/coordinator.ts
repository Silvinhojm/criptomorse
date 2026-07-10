import type { ICoordinator, ConsensusResult, CycleReport, SubmissionResult } from "./ICoordinator"
import type { IAgent, AgentProposal, AgentVote } from "./IAgent"
import type { IExecutor } from "./IExecutor"
import type { ISafetyGuard } from "./ISafetyGuard"
import type { IAudit } from "./IAudit"
import type { IIntentPublisher, IntentStatus } from "./intent-types"
import type { DecisionReport } from "./decision-report"
import { Voting, type VoteResult } from "./voting"
import { Audit } from "./audit"
import { frameworkReputation, frameworkKnowledge, frameworkSettlementRegistry, replaySettlementForCorrelationId } from "./singletons"
import { IntentDeduplicator } from "./intent-deduplicator"
import { PolicyEngine, type PolicyEngineConfig } from "./policy-engine"

export { type ConsensusResult, type CycleReport, type SubmissionResult }

export interface CoordinatorConfig {
  name: string
  minAgents?: number
  minConfidence?: number
  executor?: IExecutor
  safetyGuard?: ISafetyGuard
  audit?: IAudit
  dedupWindowMs?: number
  intentPublisher?: IIntentPublisher
  policyEngine?: PolicyEngine
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
  readonly WEIGHTED_CONFIDENCE_THRESHOLD = 15
  readonly deduplicator: IntentDeduplicator
  private intentPublisher_: IIntentPublisher | null
  readonly policyEngine: PolicyEngine

  constructor(config: CoordinatorConfig) {
    this.name = config.name
    this.minAgents = config.minAgents ?? 2
    this.voting = new Voting(config.name, this.MIN_AGREEING_AGENTS, this.WEIGHTED_CONFIDENCE_THRESHOLD)
    this.executor_ = config.executor ?? null
    this.safetyGuard_ = config.safetyGuard ?? null
    this.audit_ = config.audit ?? null
    this.deduplicator = new IntentDeduplicator(config.dedupWindowMs ?? 120_000)
    this.intentPublisher_ = config.intentPublisher ?? null
    this.policyEngine = config.policyEngine ?? new PolicyEngine()
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

  getPolicyEngine(): PolicyEngine {
    return this.policyEngine
  }

  async submitProposal(proposal: AgentProposal): Promise<SubmissionResult> {
    const startTime = Date.now()
    const intentId = `intent_${proposal.agentId}_${startTime}`

    const dp: DecisionReport = {
      id: `decision_${startTime}_${proposal.agentId}`,
      intentId,
      agentId: proposal.agentId,
      action: proposal.action,
      params: proposal.params ?? {},
      createdAt: startTime,
    }
    const settlementCorrelationId = intentId

    if (this.safetyGuard_ && this.safetyGuard_.isOpen()) {
      dp.voting = { votes: [], totalVoters: 0, approved: false, confidence: 0, reason: "Safety guard open", weightedConfidence: 0, minAgentsRequired: this.MIN_AGREEING_AGENTS }
      dp.resolvedAt = Date.now()
      dp.durationMs = dp.resolvedAt - startTime
      this._saveDecisionReport(intentId, dp)
      return {
        consensus: {
          approved: false, action: proposal.action, confidence: 0,
          agentVotes: [], tiebreaker: "",
          reason: `Safety guard open — proposal ${proposal.id} rejected`,
        },
      }
    }

    const dup = this.deduplicator.isDuplicate(proposal.agentId, proposal.action, proposal.params)
    if (dup.duplicate) {
      dp.dedupSkipped = true
      dp.resolvedAt = Date.now()
      dp.durationMs = dp.resolvedAt - startTime
      this._saveDecisionReport(intentId, dp)
      if (dup.count <= this.deduplicator.MAX_WARNINGS) {
        console.warn(`[${this.name}] 🚫 Duplicate intent from ${proposal.agentId} — discarded (×${dup.count} in ${this.deduplicator.WINDOW_MS / 1000}s)`)
      }
      return {
        consensus: {
          approved: false, action: proposal.action, confidence: 0,
          agentVotes: [], tiebreaker: "",
          reason: `Duplicate intent from ${proposal.agentId} — discarded (×${dup.count})`,
        },
      }
    }

    proposal.params.intentId = intentId
    proposal.params.correlationId = settlementCorrelationId
    proposal.params.settlementCorrelationId = settlementCorrelationId
    proposal.params.proposalId = proposal.id
    proposal.params.decisionReportId = dp.id

    this._transitionIntent(intentId, "CREATED")
    console.log(`[${this.name}] 📋 Intent #${intentId} — ${proposal.agentId} → ${proposal.action}`)

    // ── Knowledge stage ──
    let knowledgeMod = (proposal.params?.knowledgeModifier as number | undefined) ?? 0
    const agentKr = proposal.params?.knowledgeReport
    let kr: Record<string, number> | undefined = agentKr as Record<string, number> | undefined
    let canTrade = true

    if (kr) {
      dp.knowledgeStatus = "provided"
      canTrade = (proposal.params?.knowledgeReport as any)?.canTrade ?? true
    } else {
      // No agent-provided knowledge — query canonical Knowledge Service
      const fromToken = proposal.params?.fromToken as string | undefined
      const toToken = proposal.params?.toToken as string | undefined
      const network = proposal.params?.rede as string | undefined
      if (fromToken && toToken && network) {
        try {
          const action = proposal.action?.toUpperCase() === "SELL" ? "SELL" : "BUY"
          const report = await frameworkKnowledge.query({
            pair: { from: fromToken, to: toToken },
            network,
            action,
            agent: proposal.agentId,
            amount: typeof proposal.params?.amountUsd === "number"
              ? BigInt(Math.round(proposal.params.amountUsd * 100))
              : 0n,
          })
          dp.knowledgeStatus = "queried"
          canTrade = report.canTrade
          knowledgeMod = report.confidenceModifier
          proposal.params.knowledgeModifier = knowledgeMod
          proposal.params.knowledgeWarnings = report.warnings
          kr = {
            liquidity: report.liquidity,
            gasScore: report.gasScore,
            routeScore: report.routeScore,
            marketScore: report.marketScore,
            riskScore: report.riskScore,
            expectedValue: report.expectedValue,
          }
        } catch (e) {
          dp.knowledgeStatus = "failed"
          dp.knowledgeError = (e as Error).message
          console.warn(`[${this.name}] ⚠️ Knowledge Service unavailable:`, (e as Error).message)
        }
      } else {
        dp.knowledgeStatus = "unavailable"
      }
    }

    if (kr) {
      dp.knowledge = {
        liquidity: kr.liquidity ?? 0,
        gasScore: kr.gasScore ?? 0,
        routeScore: kr.routeScore ?? 0,
        marketScore: kr.marketScore ?? 0,
        riskScore: kr.riskScore ?? 0,
        expectedValue: kr.expectedValue ?? 0,
        confidenceModifier: knowledgeMod,
        warnings: (proposal.params?.knowledgeWarnings as string[]) ?? [],
        recommendations: [],
      }
      console.log(`[${this.name}] 📊 Knowledge — 💧${dp.knowledge.liquidity} ⛽${dp.knowledge.gasScore} 🛣️${dp.knowledge.routeScore} 📊${dp.knowledge.marketScore} ⚠️${dp.knowledge.riskScore} modifier ${knowledgeMod >= 0 ? "+" : ""}${knowledgeMod.toFixed(0)}%`)
    }

    // ── canTrade gate ──
    if (dp.knowledge && !canTrade) {
      dp.rejectedBy = "knowledge"
      this._transitionIntent(intentId, "REJECTED")
      dp.resolvedAt = Date.now()
      dp.durationMs = dp.resolvedAt - startTime
      this._saveDecisionReport(intentId, dp)
      console.log(`[${this.name}] 🛑 Knowledge rejected: canTrade=false`)
      return {
        consensus: {
          approved: false, action: proposal.action, confidence: 0,
          agentVotes: [], tiebreaker: "",
          reason: "Knowledge Service rejected proposal: canTrade=false",
        },
      }
    }

    this._transitionIntent(intentId, "KNOWLEDGE_VALIDATED")

    // ── Pre-vote policy check ──
    const preVotePolicy = this._checkPreVotePolicy(proposal)
    if (!preVotePolicy.allowed) {
      dp.rejectedBy = "policy"
      this._transitionIntent(intentId, "REJECTED")
      dp.resolvedAt = Date.now()
      dp.durationMs = dp.resolvedAt - startTime
      this._saveDecisionReport(intentId, dp)
      if (this.audit_) {
        this.audit_.record(Audit.createEntry({
          agentId: proposal.agentId, action: proposal.action, proposal,
          result: null, approved: false, confidence: 0, voters: 0,
          tags: ["policy_rejection", "pre_vote"],
        }))
      }
      console.log(`[${this.name}] 🛑 Policy rejected (pre-vote): ${preVotePolicy.reason}`)
      return {
        consensus: {
          approved: false, action: proposal.action, confidence: 0,
          agentVotes: [], tiebreaker: "",
          reason: preVotePolicy.reason,
        },
      }
    }

    // apply knowledge override policy
    if (!this.policyEngine.isAllowed("allowKnowledgeOverride", proposal.params?.rede as string | undefined)) {
      knowledgeMod = 0
      proposal.params.knowledgeModifier = 0
    }

    let hasEnoughConsensus = false
    let consensus: ConsensusResult
    const allVotes: { agentId: string; approved: boolean; confidence: number; reason: string }[] = []

    // ── Voting stage ──
    if (this.agents.size > 0) {
      this._transitionIntent(intentId, "VOTING")
      console.log(`[${this.name}] 🗳️ Voting — ${this.agents.size} agents, knowledgeWeight ${(1 + knowledgeMod / 100).toFixed(2)}`)
      this.voting.clearVotes(proposal.id)
      const votes = await this.collectVotes(proposal)
      for (const v of votes) {
        const repScore = frameworkReputation.getScore(v.agentId)
        const repWeight = Math.max(0.5, Math.min(1.0, repScore / 100))
        this.voting.recordVote({
          agentId: v.agentId, proposalId: proposal.id,
          approved: v.approved, confidence: v.confidence,
          reputationWeight: repWeight,
          knowledgeWeight: 1 + knowledgeMod / 100,
          reason: v.reason, timestamp: v.timestamp,
        })
        allVotes.push({ agentId: v.agentId, approved: v.approved, confidence: v.confidence, reason: v.reason })
      }
      const voteResult = this.voting.resolve(proposal)
      consensus = this.mapVoteResultToConsensus(proposal, voteResult)
      hasEnoughConsensus = consensus.approved
      const agreed = allVotes.filter(v => v.approved).length
      console.log(`[${this.name}] 🗳️ Result — ${agreed}/${allVotes.length} approve → ${consensus.approved ? "✅" : "❌"} ${consensus.reason}`)
    } else {
      this.voting.clearVotes(proposal.id)
      const voteResult = this.voting.resolve(proposal)
      consensus = this.mapVoteResultToConsensus(proposal, {
        ...voteResult,
        reason: "Voting rejected: no voting agents available",
      })
      hasEnoughConsensus = false
      console.log(`[${this.name}] Voting rejected: no voting agents available`)
    }

    dp.voting = {
      votes: allVotes,
      totalVoters: this.agents.size,
      approved: consensus.approved,
      confidence: consensus.confidence,
      reason: consensus.reason,
      weightedConfidence: consensus.confidence,
      minAgentsRequired: this.MIN_AGREEING_AGENTS,
    }

    if (!hasEnoughConsensus) {
      this._transitionIntent(intentId, "REJECTED")
      dp.resolvedAt = Date.now()
      dp.durationMs = dp.resolvedAt - startTime
      this._saveDecisionReport(intentId, dp)
      console.log(`[${this.name}] ❌ Rejected — ${consensus.reason}`)
      return { consensus }
    }

    if (!this.executor_) {
      this._transitionIntent(intentId, "REJECTED")
      dp.resolvedAt = Date.now()
      dp.durationMs = dp.resolvedAt - startTime
      this._saveDecisionReport(intentId, dp)
      console.log(`[${this.name}] ❌ Rejected — no executor configured`)
      return {
        consensus: {
          ...consensus,
          approved: false,
          reason: "No executor configured",
        },
      }
    }

    // ── Pre-execution policy check ──
    const preExecPolicy = this._checkPreExecPolicy(proposal)
    if (!preExecPolicy.allowed) {
      dp.rejectedBy = "policy"
      this._transitionIntent(intentId, "REJECTED")
      dp.resolvedAt = Date.now()
      dp.durationMs = dp.resolvedAt - startTime
      this._saveDecisionReport(intentId, dp)
      if (this.audit_) {
        this.audit_.record(Audit.createEntry({
          agentId: proposal.agentId, action: proposal.action, proposal,
          result: null, approved: false, confidence: 0, voters: 0,
          tags: ["policy_rejection", "pre_exec"],
        }))
      }
      console.log(`[${this.name}] 🛑 Policy rejected (pre-exec): ${preExecPolicy.reason}`)
      return {
        consensus: {
          ...consensus,
          approved: false,
          reason: preExecPolicy.reason,
        },
      }
    }

    const canExec = this.executor_.canExecute(proposal)
    if (!canExec.allowed) {
      this._transitionIntent(intentId, "REJECTED")
      dp.resolvedAt = Date.now()
      dp.durationMs = dp.resolvedAt - startTime
      this._saveDecisionReport(intentId, dp)
      console.log(`[${this.name}] ❌ Rejected — ${canExec.reason}`)
      return {
        consensus: {
          ...consensus,
          approved: false,
          reason: canExec.reason,
        },
      }
    }

    // ── Execution stage ──
    this._transitionIntent(intentId, "APPROVED")
    this._transitionIntent(intentId, "EXECUTING")
    const execStart = Date.now()
    console.log(`[${this.name}] ⚡ Executing — ${proposal.action} via ${this.executor_.name}`)
    const executionResult = await this.executor_.execute(proposal)
    const execDuration = Date.now() - execStart
    const isProvisionalDispatch = executionResult.isProvisional === true || executionResult.settlementStatus === "dispatched" || executionResult.details?.isProvisional === true || executionResult.details?.settlementStatus === "dispatched"
    const isAdapterDispatchFailure = executionResult.dispatchStatus === "failed" ||
      executionResult.details?.dispatchStatus === "failed"

    dp.execution = {
      success: executionResult.success,
      profit: executionResult.profit ?? 0,
      gasCost: executionResult.gasCost ?? 0,
      durationMs: execDuration,
      txHash: executionResult.txHash,
      errorMsg: executionResult.errorMsg,
      adapter: this.executor_.name,
      correlationId: executionResult.correlationId ?? settlementCorrelationId,
      intentId: executionResult.intentId ?? intentId,
      proposalId: executionResult.proposalId ?? proposal.id,
      decisionReportId: executionResult.decisionReportId ?? dp.id,
      ordemId: executionResult.ordemId,
      dispatchStatus: executionResult.dispatchStatus,
      settlementStatus: executionResult.settlementStatus,
      isProvisional: executionResult.isProvisional,
    }

    // Phase 2e.1: dispatch accepted by an adapter is not verified settlement.
    // IntentStatus has no PENDING_SETTLEMENT yet, so EXECUTING remains the closest non-final state.
    if (isProvisionalDispatch && executionResult.success) {
      this._transitionIntent(intentId, "EXECUTING")
      dp.onChainStatus = "skipped"
      this._registerPendingSettlement({
        correlationId: executionResult.correlationId ?? settlementCorrelationId,
        intentId: executionResult.intentId ?? intentId,
        proposalId: executionResult.proposalId ?? proposal.id,
        decisionReportId: executionResult.decisionReportId ?? dp.id,
        ordemId: executionResult.ordemId,
        fromToken: proposal.params?.fromToken as string | undefined,
        toToken: proposal.params?.toToken as string | undefined,
        timestamp: Date.now(),
        isTradingAdapter: this.executor_.name === "TradingAdapter",
        isSuccessful: executionResult.success === true,
        isAcceptedDispatch: executionResult.dispatchStatus === "dispatched",
        isDispatchedSettlement: executionResult.settlementStatus === "dispatched",
        isProvisional: executionResult.isProvisional === true,
        synthetic: executionResult.details?.synthetic === true,
      })
    } else {
      this._transitionIntent(intentId, executionResult.success ? "COMPLETED" : "FAILED")
    }
    if (isProvisionalDispatch && executionResult.success) {
      console.log(`[${this.name}] Dispatched - settlement pending (${execDuration}ms) correlation:${settlementCorrelationId}`)
    } else {
      console.log(`[${this.name}] ${executionResult.success ? "✅" : "❌"} Executed — ${execDuration}ms profit $${(executionResult.profit ?? 0).toFixed(4)}${executionResult.txHash ? ` tx:${executionResult.txHash.slice(0, 14)}` : ""}`)
    }

    // ── Audit stage ──
    let auditId: string | undefined
    if (this.audit_) {
      const entry = Audit.createEntry({
        agentId: proposal.agentId, action: proposal.action, proposal,
        result: executionResult, approved: consensus.approved,
        confidence: consensus.confidence, voters: this.agents.size,
        knowledgeModifier: knowledgeMod,
        onChainStatus: isProvisionalDispatch ? "skipped" : "pending",
      })
      this.audit_.record(entry)
      auditId = entry.id
      dp.auditId = auditId
    }

    // ── Feedback ──
    if (!isProvisionalDispatch && !isAdapterDispatchFailure) {
      for (const agent of this.agents.values()) {
        agent.onFeedback({
          success: executionResult.success,
          profit: executionResult.profit ?? 0,
          reason: executionResult.errorMsg,
        })
      }
    }

    dp.resolvedAt = Date.now()
    dp.durationMs = dp.resolvedAt - startTime
    this._saveDecisionReport(intentId, dp)

    // ── On-chain proof ──
    if (executionResult.success && !isProvisionalDispatch && this.intentPublisher_?.anchorDecision) {
      this.intentPublisher_.anchorDecision(intentId, dp).then(result => {
        if (result) {
          dp.onChainHash = result.hash
          dp.onChainTx = result.txHash
          dp.onChainStatus = "confirmed"
          if (this.audit_ && auditId) {
            this.audit_.updateEntry(auditId, { onChainHash: result.hash, onChainTx: result.txHash, onChainStatus: "confirmed" })
          }
          this._saveDecisionReport(intentId, dp)
          console.log(`[${this.name}] 🔗 On-chain proof: tx:${result.txHash} block:${result.blockNumber} hash:${result.hash.slice(0, 18)}...`)
        }
      }).catch(() => {})
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

  private mapVoteResultToConsensus(proposal: AgentProposal, voteResult: VoteResult): ConsensusResult {
    return {
      approved: voteResult.approved,
      action: proposal.action,
      confidence: voteResult.confidence,
      agentVotes: voteResult.votes.map(v => ({
        agentId: v.agentId,
        approved: v.approved,
        confidence: v.confidence,
        reason: v.reason,
      })),
      tiebreaker: "",
      reason: voteResult.reason,
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

    // Retry pending on-chain proofs
    if (this.intentPublisher_?.anchorDecision && "retryPendingProofs" in this.intentPublisher_) {
      const resolved = await (this.intentPublisher_ as any).retryPendingProofs()
      if (resolved > 0) {
        console.log(`[${this.name}] 🔗 Retry resolved ${resolved} pending on-chain proofs`)
      }
    }

    // Collect proposals
    const proposals = await this.collectProposals({})
    report.proposalsSubmitted = proposals.length

    for (const proposal of proposals) {
      const cycleIntentId = `intent_${proposal.agentId}_${Date.now()}`
      const cycleDecisionReportId = `decision_cycle_${this.cycleCount}_${proposal.agentId}_${Date.now()}`
      try {
        // Dedup check
        const dup = this.deduplicator.isDuplicate(proposal.agentId, proposal.action, proposal.params)
        if (dup.duplicate) {
          if (dup.count <= this.deduplicator.MAX_WARNINGS) {
            console.warn(`[${this.name}] 🚫 Duplicate intent from agent ${proposal.agentId} in cycle — discarded (×${dup.count})`)
          }
          continue
        }
        proposal.params.intentId = cycleIntentId
        proposal.params.correlationId = cycleIntentId
        proposal.params.settlementCorrelationId = cycleIntentId
        proposal.params.proposalId = proposal.id
        proposal.params.decisionReportId = cycleDecisionReportId
        this._transitionIntent(cycleIntentId, "CREATED")

        // ── Knowledge enforcement ──
        let knowledgeMod = (proposal.params?.knowledgeModifier as number | undefined) ?? 0
        if (!proposal.params?.knowledgeReport) {
          const fromToken = proposal.params?.fromToken as string | undefined
          const toToken = proposal.params?.toToken as string | undefined
          const network = proposal.params?.rede as string | undefined
          if (fromToken && toToken && network) {
            try {
              const action = proposal.action?.toUpperCase() === "SELL" ? "SELL" : "BUY"
              const report = await frameworkKnowledge.query({
                pair: { from: fromToken, to: toToken },
                network, action,
                agent: proposal.agentId,
                amount: typeof proposal.params?.amountUsd === "number"
                  ? BigInt(Math.round(proposal.params.amountUsd * 100))
                  : 0n,
              })
              knowledgeMod = report.confidenceModifier
              proposal.params.knowledgeModifier = knowledgeMod
              proposal.params.knowledgeWarnings = report.warnings
              proposal.params.knowledgeCanTrade = report.canTrade
            } catch (e) {
              console.warn(`[${this.name}] ⚠️ Knowledge Service unavailable in cycle:`, (e as Error).message)
            }
          }
        }

        // ── canTrade gate ──
        if (proposal.params?.knowledgeCanTrade === false) {
          this._transitionIntent(cycleIntentId, "REJECTED")
          console.warn(`[${this.name}] 🛑 Knowledge rejected in cycle: canTrade=false`)
          report.errors++
          continue
        }

        // ── Pre-vote policy check ──
        const preVotePolicy = this._checkPreVotePolicy(proposal)
        if (!preVotePolicy.allowed) {
          this._transitionIntent(cycleIntentId, "REJECTED")
          if (this.audit_) {
            this.audit_.record(Audit.createEntry({
              agentId: proposal.agentId, action: proposal.action, proposal,
              result: null, approved: false, confidence: 0, voters: 0,
              tags: ["policy_rejection", "pre_vote"],
            }))
          }
          console.warn(`[${this.name}] 🛑 Policy rejected in cycle (pre-vote): ${preVotePolicy.reason}`)
          report.errors++
          continue
        }

        this._transitionIntent(cycleIntentId, "KNOWLEDGE_VALIDATED")
        this._transitionIntent(cycleIntentId, "VOTING")

        // Collect votes
        this.voting.clearVotes(proposal.id)
        const votes = await this.collectVotes(proposal)
        for (const v of votes) {
          const repScore = frameworkReputation.getScore(v.agentId)
          const repWeight = Math.max(0.5, Math.min(1.0, repScore / 100))
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
        const voteResult = this.voting.resolve(proposal)
        const consensus = this.mapVoteResultToConsensus(proposal, voteResult)
        report.consensusReached++

        if (consensus.approved && this.executor_) {
          // ── Pre-execution policy check ──
          const preExecPolicy = this._checkPreExecPolicy(proposal)
          if (!preExecPolicy.allowed) {
            this._transitionIntent(cycleIntentId, "REJECTED")
            if (this.audit_) {
              this.audit_.record(Audit.createEntry({
                agentId: proposal.agentId, action: proposal.action, proposal,
                result: null, approved: false, confidence: 0, voters: 0,
                tags: ["policy_rejection", "pre_exec"],
              }))
            }
            console.warn(`[${this.name}] 🛑 Policy rejected in cycle (pre-exec): ${preExecPolicy.reason}`)
            report.errors++
            continue
          }

          this._transitionIntent(cycleIntentId, "APPROVED")
          this._transitionIntent(cycleIntentId, "EXECUTING")

          // Execute
          const result = await this.executor_.execute(proposal)
          const isProvisionalDispatch = result.isProvisional === true || result.settlementStatus === "dispatched" || result.details?.isProvisional === true || result.details?.settlementStatus === "dispatched"
          const isAdapterDispatchFailure = result.dispatchStatus === "failed" ||
            result.details?.dispatchStatus === "failed"
          if (isProvisionalDispatch && result.success) {
            // IntentStatus has no PENDING_SETTLEMENT yet; keep cycle intents non-final while settlement is pending.
            this._transitionIntent(cycleIntentId, "EXECUTING")
            this._registerPendingSettlement({
              correlationId: result.correlationId ?? cycleIntentId,
              intentId: result.intentId ?? cycleIntentId,
              proposalId: result.proposalId ?? proposal.id,
              decisionReportId: result.decisionReportId ?? cycleDecisionReportId,
              ordemId: result.ordemId,
              fromToken: proposal.params?.fromToken as string | undefined,
              toToken: proposal.params?.toToken as string | undefined,
              timestamp: Date.now(),
              isTradingAdapter: this.executor_.name === "TradingAdapter",
              isSuccessful: result.success === true,
              isAcceptedDispatch: result.dispatchStatus === "dispatched",
              isDispatchedSettlement: result.settlementStatus === "dispatched",
              isProvisional: result.isProvisional === true,
              synthetic: result.details?.synthetic === true,
            })
          } else {
            this._transitionIntent(cycleIntentId, result.success ? "COMPLETED" : "FAILED")
          }
          report.executionsDispatched++

          // Audit
          if (this.audit_) {
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
          if (!isProvisionalDispatch && !isAdapterDispatchFailure) {
            for (const agent of this.agents.values()) {
              agent.onFeedback({
                success: result.success,
                profit: result.profit ?? 0,
                reason: result.errorMsg,
              })
            }
          }

          // On-chain proof
          if (result.success && !isProvisionalDispatch && this.intentPublisher_?.anchorDecision) {
            const dp: DecisionReport = {
              id: cycleDecisionReportId,
              intentId: cycleIntentId,
              agentId: proposal.agentId,
              action: proposal.action,
              params: proposal.params ?? {},
              createdAt: Date.now(),
              resolvedAt: Date.now(),
              onChainStatus: "pending",
              execution: {
                success: result.success,
                profit: result.profit ?? 0,
                gasCost: result.gasCost ?? 0,
                durationMs: 0,
                txHash: result.txHash,
                adapter: this.executor_?.name ?? "unknown",
                correlationId: result.correlationId ?? cycleIntentId,
                intentId: result.intentId ?? cycleIntentId,
                proposalId: result.proposalId ?? proposal.id,
                decisionReportId: result.decisionReportId ?? cycleDecisionReportId,
                ordemId: result.ordemId,
                dispatchStatus: result.dispatchStatus,
                settlementStatus: result.settlementStatus,
                isProvisional: result.isProvisional,
              },
            }
            this.intentPublisher_.anchorDecision(cycleIntentId, dp).then(anchorResult => {
              if (anchorResult) {
                dp.onChainHash = anchorResult.hash
                dp.onChainTx = anchorResult.txHash
                dp.onChainStatus = "confirmed"
                console.log(`[${this.name}] 🔗 On-chain proof (cycle): tx:${anchorResult.txHash} block:${anchorResult.blockNumber}`)
              }
            }).catch(() => {})
          }
        } else {
          this._transitionIntent(cycleIntentId, "REJECTED")
        }
      } catch (e) {
        report.errors++
        this._transitionIntent(cycleIntentId, "FAILED")
        console.warn(`[${this.name}] Cycle error on proposal ${proposal.id}:`, e)
      }
    }

    return report
  }

  private _saveDecisionReport(intentId: string, report: DecisionReport): void {
    if (!this.intentPublisher_) return
    const existing = this.intentPublisher_.getRecord(intentId)
    if (existing) {
      this.intentPublisher_.setDecisionReport(intentId, report)
      this._syncSettlementFromRegistry(intentId)
    } else {
      this.intentPublisher_.publish({
        id: intentId,
        agentId: report.agentId,
        action: report.action,
        params: report.params,
        confidence: report.voting?.confidence ?? 0,
        timestamp: report.createdAt,
      }).then(() => {
        const recordExists = this.intentPublisher_?.getRecord(intentId)
        if (recordExists) {
          this.intentPublisher_!.setDecisionReport(intentId, report)
          this._syncSettlementFromRegistry(intentId)
        } else {
          console.warn(`[${this.name}] ⚠️ DecisionReport ${report.id} not saved — publish succeeded but intent ${intentId} not found (race or trim)`)
        }
      }).catch((e: unknown) => {
        console.error(`[${this.name}] ❌ Failed to publish intent ${intentId} for report ${report.id}:`, e)
      })
    }
  }

  /** Post-save settlement replay: sync any existing or queued settlement
   *  records into the just-saved DecisionReport.  Idempotent and safe —
   *  confirmed canonical settlement cannot be downgraded by stale updates. */
  private _syncSettlementFromRegistry(intentId: string): void {
    replaySettlementForCorrelationId(intentId)
  }

  private _transitionIntent(intentId: string, status: IntentStatus): void {
    if (!this.intentPublisher_) return
    const existing = this.intentPublisher_.getRecord(intentId)
    if (existing) {
      this.intentPublisher_.updateStatus(intentId, status)
    } else {
      this.intentPublisher_.publish({
        id: intentId,
        agentId: "coordinator",
        action: status,
        params: {},
        confidence: 100,
        timestamp: Date.now(),
      }).then(() => {
        this.intentPublisher_?.updateStatus(intentId, status)
      }).catch((e: unknown) => {
        console.warn(`[${this.name}] ⚠️ Failed to publish intent transition ${intentId} → ${status}:`, e)
      })
    }
  }

  // ── Policy checks ──

  private _registerPendingSettlement(args: {
    correlationId: string
    intentId: string
    proposalId: string
    decisionReportId: string
    ordemId?: string
    fromToken?: string
    toToken?: string
    timestamp: number
    isTradingAdapter: boolean
    isSuccessful: boolean
    isAcceptedDispatch: boolean
    isDispatchedSettlement: boolean
    isProvisional: boolean
    synthetic: boolean
  }): void {
    if (!args.correlationId || !args.isTradingAdapter || !args.isSuccessful || !args.isAcceptedDispatch || !args.isDispatchedSettlement || !args.isProvisional) return

    const record = frameworkSettlementRegistry.registerPending({
      settlementId: `settlement_${args.correlationId}`,
      correlationId: args.correlationId,
      intentId: args.intentId,
      proposalId: args.proposalId,
      decisionReportId: args.decisionReportId,
      ordemId: args.ordemId,
      adapter: "trading",
      status: "dispatched",
      canonicalSettlement: false,
      synthetic: args.synthetic,
      source: "coordinator",
      fromToken: args.fromToken,
      toToken: args.toToken,
      timestamp: args.timestamp,
    })

    console.log(`[${this.name}] Settlement pending registered correlation:${record.correlationId}`)
  }

  private _checkPreVotePolicy(proposal: AgentProposal): { allowed: boolean; reason: string } {
    const network = proposal.params?.rede as string | undefined

    if (this.policyEngine.isAllowed("requireMinimumConfidence", network)) {
      if (proposal.confidence < 10) {
        return { allowed: false, reason: `Confiança muito baixa: ${proposal.confidence}% (mín: 10%)` }
      }
    }

    return { allowed: true, reason: "" }
  }

  private _checkPreExecPolicy(proposal: AgentProposal): { allowed: boolean; reason: string } {
    const network = proposal.params?.rede as string | undefined

    if (!this.policyEngine.isAllowed("allowSyntheticRoutes", network)) {
      const fromToken = proposal.params?.fromToken as string | undefined
      const toToken = proposal.params?.toToken as string | undefined
      if (fromToken && toToken) {
        const stables = new Set(["USDC", "USDT", "DAI", "EURC"])
        if (stables.has(fromToken.toUpperCase()) && stables.has(toToken.toUpperCase())) {
          return { allowed: false, reason: `Rotas sintéticas bloqueadas em ${network ?? "default"}` }
        }
      }
    }

    if (!this.policyEngine.isAllowed("allowDirectStressTransactions", network)) {
      const isDirect = proposal.params?.directTx === true
      if (isDirect) {
        return { allowed: false, reason: `Transações diretas bloqueadas em ${network ?? "default"}` }
      }
    }

    return { allowed: true, reason: "" }
  }
}
