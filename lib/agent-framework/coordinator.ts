import type {
  ICoordinator,
  ConsensusResult,
  CycleReport,
  SubmissionResult,
  OperationalUnavailable,
  OperationalStateSnapshot,
  OperationalEvidenceStatus,
  OperationalDegradationCode,
  IOperationalRecoveryControl,
  IOperationalRecoveryAuthorizer,
  OperationalRecoveryRequest,
  OperationalRecoveryResult,
} from "./ICoordinator"
import type { IAgent, AgentProposal, AgentVote } from "./IAgent"
import type { IExecutor } from "./IExecutor"
import type { ISafetyGuard } from "./ISafetyGuard"
import type { IAudit } from "./IAudit"
import type { IIntentPublisher, IntentStatus } from "./intent-types"
import type { DecisionReport, RejectionMetadata, RejectionCode, RejectionStage, RejectedBy } from "./decision-report"
import { Voting, type VoteResult } from "./voting"
import { Audit } from "./audit"
import { IntentDeduplicator } from "./intent-deduplicator"
import { PolicyEngine, type PolicyEngineConfig } from "./policy-engine"
import type { KnowledgeReport, ResolvedKnowledgeContext } from "./knowledge-types"
import type {
  CoordinatorDecisionDependencies,
  CoordinatorKnowledgeResolver,
  CoordinatorReputationReader,
  CoordinatorSettlementRegistry,
  CoordinatorSettlementReplay,
} from "./coordinator-dependencies"
import type { OnChainProofReconciler } from "./onchain-proof-reconciler"

/** Dedicated error for rejection evidence failures in cycle.
 *  Public message is fixed; internal cause preserved but not exposed. */
export class CycleRejectionEvidenceError extends Error {
  readonly code: string
  readonly cause?: Error

  constructor(code: string, cause?: Error) {
    super("Cycle rejection evidence failure")
    this.name = "CycleRejectionEvidenceError"
    this.code = code
    this.cause = cause
  }
}

export interface DecisionReportWriteResult {
  saved: boolean
  mode: "updated_existing" | "published_new"
  error?: string
}

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
  recoveryAuthorizer?: IOperationalRecoveryAuthorizer
  proofReconciler?: OnChainProofReconciler
}

export class Coordinator implements ICoordinator, IOperationalRecoveryControl {
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
  private operationalStatus_: "OPERATIONAL" | "RECOVERY_REQUIRED"
  private degradedAt_: number | undefined
  private degradationCode_: OperationalDegradationCode | undefined
  private operationalEvidenceStatus_: OperationalEvidenceStatus
  private readonly recoveryAuthorizer_: IOperationalRecoveryAuthorizer | null
  private readonly reputation_: CoordinatorReputationReader
  private readonly knowledge_: CoordinatorKnowledgeResolver
  private readonly settlementRegistry_: CoordinatorSettlementRegistry
  private readonly settlementReplay_: CoordinatorSettlementReplay
  private readonly proofReconciler_: OnChainProofReconciler | null
  private recoveryInProgress_: Promise<OperationalRecoveryResult> | null = null
  private recoveryProbeSequence_ = 0

  private static readonly OPERATIONAL_PUBLIC_REASON = "Operational recovery required" as const
  private static readonly RESTART_LIMITATION = "HIGH: restart may clear RECOVERY_REQUIRED; not production-ready without durable operational state" as const

  constructor(config: CoordinatorConfig, deps: CoordinatorDecisionDependencies) {
    if (!deps || typeof deps !== "object") {
      throw new TypeError("Coordinator requires deps to be an object")
    }
    if (!deps.reputation) {
      throw new TypeError("Coordinator requires deps.reputation.getScore to be a function")
    }
    if (typeof deps.reputation.getScore !== "function") {
      throw new TypeError("Coordinator requires deps.reputation.getScore to be a function")
    }
    if (!deps.knowledge) {
      throw new TypeError("Coordinator requires deps.knowledge.query to be a function")
    }
    if (typeof deps.knowledge.query !== "function") {
      throw new TypeError("Coordinator requires deps.knowledge.query to be a function")
    }
    if (!deps.settlementRegistry || typeof deps.settlementRegistry.registerPending !== "function") {
      throw new TypeError("Coordinator requires deps.settlementRegistry.registerPending to be a function")
    }
    if (!deps.settlementReplay || typeof deps.settlementReplay.replayForCorrelationId !== "function") {
      throw new TypeError("Coordinator requires deps.settlementReplay.replayForCorrelationId to be a function")
    }

    this.reputation_ = deps.reputation
    this.knowledge_ = deps.knowledge
    this.settlementRegistry_ = deps.settlementRegistry
    this.settlementReplay_ = deps.settlementReplay
    this.proofReconciler_ = config.proofReconciler ?? null
    this.name = config.name
    this.minAgents = config.minAgents ?? 2
    this.voting = new Voting(config.name, this.MIN_AGREEING_AGENTS, this.WEIGHTED_CONFIDENCE_THRESHOLD)
    this.executor_ = config.executor ?? null
    this.safetyGuard_ = config.safetyGuard ?? null
    const auditConfigurationProvided = config.audit !== undefined
    this.audit_ = config.audit ?? null
    this.deduplicator = new IntentDeduplicator(config.dedupWindowMs ?? 120_000)
    this.intentPublisher_ = config.intentPublisher ?? null
    this.policyEngine = config.policyEngine ?? new PolicyEngine()
    this.recoveryAuthorizer_ = config.recoveryAuthorizer ?? null
    // Omitted Audit is a supported compatibility construction that starts
    // degraded. An explicitly injected invalid null (legacy tests via cast) is
    // detected by the first evidence write and preserves the typed K-2c.4 throw.
    this.operationalStatus_ = auditConfigurationProvided ? "OPERATIONAL" : "RECOVERY_REQUIRED"
    this.degradedAt_ = auditConfigurationProvided ? undefined : Date.now()
    this.degradationCode_ = auditConfigurationProvided ? undefined : "AUDIT_UNAVAILABLE"
    this.operationalEvidenceStatus_ = auditConfigurationProvided ? "available" : "unavailable"
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
    if (this.operationalStatus_ === "RECOVERY_REQUIRED") return
    this.audit_ = a
  }

  getPolicyEngine(): PolicyEngine {
    return this.policyEngine
  }

  getOperationalStatus(): OperationalStateSnapshot {
    return {
      operationalStatus: this.operationalStatus_,
      degradedAt: this.degradedAt_,
      degradationCode: this.degradationCode_,
      publicReason: this.operationalStatus_ === "RECOVERY_REQUIRED" ? Coordinator.OPERATIONAL_PUBLIC_REASON : undefined,
      evidenceStatus: this.operationalEvidenceStatus_,
      durability: "instance_memory",
      restartLimitation: Coordinator.RESTART_LIMITATION,
    }
  }

  /**
   * K-2c.5 operational state is deliberately instance-memory only.
   * A process restart can erase RECOVERY_REQUIRED. Severity: HIGH.
   * This limitation remains active and is not production-ready until a future,
   * separately authorized durable operational-state phase is implemented.
   */
  private _enterRecoveryRequired(code: OperationalDegradationCode, evidenceStatus: OperationalEvidenceStatus): void {
    if (this.operationalStatus_ === "RECOVERY_REQUIRED") return
    this.operationalStatus_ = "RECOVERY_REQUIRED"
    this.degradedAt_ = Date.now()
    this.degradationCode_ = code
    this.operationalEvidenceStatus_ = evidenceStatus
  }

  private _getOperationalReadiness(sourcePath: "submitProposal" | "runCycle", executionOccurred = false):
    | { operational: true }
    | { operational: false; unavailable: OperationalUnavailable } {
    if (this.operationalStatus_ === "OPERATIONAL") return { operational: true }
    return {
      operational: false,
      unavailable: {
        kind: "operational_unavailable",
        operationalStatus: "RECOVERY_REQUIRED",
        degradedAt: this.degradedAt_ ?? 0,
        degradationCode: this.degradationCode_ ?? "AUDIT_UNAVAILABLE",
        publicReason: Coordinator.OPERATIONAL_PUBLIC_REASON,
        recoveryRequired: true,
        evidenceStatus: this.operationalEvidenceStatus_ === "available" ? "unavailable" : this.operationalEvidenceStatus_,
        sourcePath,
        executionOccurred,
        durability: "instance_memory",
        restartLimitation: Coordinator.RESTART_LIMITATION,
      },
    }
  }

  private _operationalConsensus(action: string): ConsensusResult {
    return {
      approved: false,
      action,
      confidence: 0,
      agentVotes: [],
      tiebreaker: "",
      reason: Coordinator.OPERATIONAL_PUBLIC_REASON,
    }
  }

  private _operationalSubmission(
    proposal: AgentProposal,
    unavailable: OperationalUnavailable,
    consensus?: ConsensusResult,
    executionResult?: SubmissionResult["executionResult"],
  ): SubmissionResult {
    return {
      ...unavailable,
      consensus: {
        ...(consensus ?? this._operationalConsensus(proposal.action)),
        reason: Coordinator.OPERATIONAL_PUBLIC_REASON,
      },
      executionResult,
    }
  }

  private _operationalCycle(report: Omit<Extract<CycleReport, { kind: "cycle_report" }>, "kind">, unavailable: OperationalUnavailable): CycleReport {
    return { ...report, ...unavailable }
  }

  async attemptOperationalRecovery(request: OperationalRecoveryRequest): Promise<OperationalRecoveryResult> {
    if (this.operationalStatus_ === "OPERATIONAL") {
      return this._recoveryResult("already_operational", true, "available")
    }

    // Runtime authorization is the security boundary. Interface hiding is not.
    const authorizer = this.recoveryAuthorizer_
    if (!authorizer) {
      return this._recoveryResult("denied", false, this.operationalEvidenceStatus_)
    }

    let authorized = false
    try {
      authorized = authorizer.authorizeOperationalRecovery({
        coordinatorName: this.name,
        requestedBy: request.requestedBy,
        degradedAt: this.degradedAt_ ?? 0,
        degradationCode: this.degradationCode_ ?? "AUDIT_UNAVAILABLE",
      }) === true
    } catch {
      authorized = false
    }
    if (!authorized) {
      return this._recoveryResult("denied", false, this.operationalEvidenceStatus_)
    }

    if (this.recoveryInProgress_) {
      return this._recoveryResult("recovery_in_progress", false, this.operationalEvidenceStatus_)
    }

    const candidateAudit = request.candidateAudit ?? this.audit_
    if (!candidateAudit) {
      return this._recoveryResult("failed", false, this.operationalEvidenceStatus_)
    }

    const recoveryAttempt = this._performOperationalRecovery(request.requestedBy, candidateAudit)
    this.recoveryInProgress_ = recoveryAttempt
    try {
      return await recoveryAttempt
    } finally {
      if (this.recoveryInProgress_ === recoveryAttempt) this.recoveryInProgress_ = null
    }
  }

  private async _performOperationalRecovery(requestedBy: string, candidateAudit: IAudit): Promise<OperationalRecoveryResult> {
    const recoveryProbeId = `operational_recovery_${this.name}_${++this.recoveryProbeSequence_}`
    const now = Date.now()
    const proposal: AgentProposal = {
      id: `proposal_${recoveryProbeId}`,
      agentId: "operational_recovery_control",
      action: "TEST",
      params: { recoveryProbeId, requestedBy },
      confidence: 100,
      timestamp: now,
    }
    const decisionReport: DecisionReport = {
      id: `decision_${recoveryProbeId}`,
      intentId: recoveryProbeId,
      agentId: proposal.agentId,
      action: proposal.action,
      params: { recoveryProbeId, requestedBy },
      auditStatus: "not_attempted",
      createdAt: now,
      resolvedAt: now,
    }

    let initialWrite: DecisionReportWriteResult
    try {
      initialWrite = await this._saveDecisionReport(recoveryProbeId, decisionReport)
    } catch {
      return this._recoveryResult("failed", false, this.operationalEvidenceStatus_, recoveryProbeId)
    }
    if (!initialWrite.saved) {
      return this._recoveryResult("failed", false, this.operationalEvidenceStatus_, recoveryProbeId)
    }

    const auditEntry = Audit.createEntry({
      agentId: proposal.agentId,
      action: proposal.action,
      proposal,
      result: null,
      approved: false,
      confidence: 100,
      voters: 0,
      tags: ["operational_recovery_probe", `recovery_probe:${recoveryProbeId}`],
    })
    let auditRecorded = false
    try {
      auditRecorded = candidateAudit.record(auditEntry)?.recorded === true
    } catch {
      auditRecorded = false
    }
    if (!auditRecorded) {
      return this._recoveryResult("failed", false, this.operationalEvidenceStatus_, recoveryProbeId)
    }

    decisionReport.auditId = auditEntry.id
    decisionReport.auditStatus = "recorded"
    let finalWrite: DecisionReportWriteResult
    try {
      finalWrite = await this._saveDecisionReport(recoveryProbeId, decisionReport)
    } catch {
      return this._recoveryResult("failed", false, this.operationalEvidenceStatus_, recoveryProbeId)
    }
    if (!finalWrite.saved) {
      return this._recoveryResult("failed", false, this.operationalEvidenceStatus_, recoveryProbeId)
    }

    const persistedReport = this.intentPublisher_?.getRecord(recoveryProbeId)?.decisionReport
    const persistedAudit = candidateAudit.getById?.(auditEntry.id) ?? null
    const reportReadBackValid = persistedReport?.id === decisionReport.id &&
      persistedReport.auditStatus === "recorded" &&
      persistedReport.auditId === auditEntry.id &&
      persistedReport.params?.recoveryProbeId === recoveryProbeId
    const auditReadBackValid = persistedAudit?.id === auditEntry.id &&
      persistedAudit.tags.includes(`recovery_probe:${recoveryProbeId}`)
    if (!reportReadBackValid || !auditReadBackValid) {
      return this._recoveryResult("failed", false, this.operationalEvidenceStatus_, recoveryProbeId)
    }

    // Candidate backend installation and OPERATIONAL transition happen only
    // after both independent read-backs have succeeded, while mutex is held.
    this.audit_ = candidateAudit
    this.operationalStatus_ = "OPERATIONAL"
    this.degradedAt_ = undefined
    this.degradationCode_ = undefined
    this.operationalEvidenceStatus_ = "available"
    return this._recoveryResult("recovered", true, "available", recoveryProbeId)
  }

  private _recoveryResult(
    status: OperationalRecoveryResult["status"],
    recovered: boolean,
    evidenceStatus: OperationalEvidenceStatus,
    recoveryProbeId?: string,
  ): OperationalRecoveryResult {
    return {
      kind: "operational_recovery_result",
      status,
      operationalStatus: this.operationalStatus_,
      publicReason: status === "recovery_in_progress"
        ? "Recovery already in progress"
        : this.operationalStatus_ === "OPERATIONAL" ? "Operational" : Coordinator.OPERATIONAL_PUBLIC_REASON,
      recovered,
      evidenceStatus,
      recoveryProbeId,
      durability: "instance_memory",
      restartLimitation: Coordinator.RESTART_LIMITATION,
    }
  }

  async submitProposal(proposal: AgentProposal): Promise<SubmissionResult> {
    const primaryOperationalReadiness = this._getOperationalReadiness("submitProposal")
    if (!primaryOperationalReadiness.operational) {
      return this._operationalSubmission(proposal, primaryOperationalReadiness.unavailable)
    }

    const startTime = Date.now()
    const intentId = `intent_${proposal.agentId}_${proposal.timestamp ?? startTime}`

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
      const safetyConsensus: ConsensusResult = {
        approved: false, action: proposal.action, confidence: 0,
        agentVotes: [], tiebreaker: "",
        reason: `Safety guard open — proposal ${proposal.id} rejected`,
      }
      return await this._recordRejection({
        proposal, intentId, decisionReport: dp,
        rejection: {
          rejectedBy: "safety_guard",
          rejectionCode: "SAFETY_GUARD_OPEN",
          rejectionStage: "intake",
          rejectionReason: safetyConsensus.reason,
          sourcePath: "submitProposal",
          occurredAt: Date.now(),
        },
        consensus: safetyConsensus,
      })
    }

    const dup = this.deduplicator.isDuplicate(proposal.agentId, proposal.action, proposal.params)
    if (dup.duplicate) {
      dp.dedupSkipped = true
      if (dup.count <= this.deduplicator.MAX_WARNINGS) {
        console.warn(`[${this.name}] 🚫 Duplicate intent from ${proposal.agentId} — discarded (×${dup.count} in ${this.deduplicator.WINDOW_MS / 1000}s)`)
      }
      const dupConsensus: ConsensusResult = {
        approved: false, action: proposal.action, confidence: 0,
        agentVotes: [], tiebreaker: "",
        reason: `Duplicate intent from ${proposal.agentId} — discarded (×${dup.count})`,
      }
      return await this._recordRejection({
        proposal, intentId, decisionReport: dp,
        rejection: {
          rejectedBy: "deduplicator",
          rejectionCode: "DUPLICATE_INTENT",
          rejectionStage: "intake",
          rejectionReason: dupConsensus.reason,
          sourcePath: "submitProposal",
          occurredAt: Date.now(),
        },
        consensus: dupConsensus,
      })
    }

    proposal.params.intentId = intentId
    proposal.params.correlationId = settlementCorrelationId
    proposal.params.settlementCorrelationId = settlementCorrelationId
    proposal.params.proposalId = proposal.id
    proposal.params.decisionReportId = dp.id

    this._transitionIntent(intentId, "CREATED")
    console.log(`[${this.name}] 📋 Intent #${intentId} — ${proposal.agentId} → ${proposal.action}`)

    // ── Canonical Knowledge stage ──
    const canonicalKnowledge = await this._resolveKnowledge(proposal)
    const knowledgeMod = this.policyEngine.isAllowed("allowKnowledgeOverride", proposal.params?.rede as string | undefined)
      ? canonicalKnowledge.modifier : 0
    proposal.params.knowledgeModifier = knowledgeMod
    proposal.params.knowledgeWarnings = canonicalKnowledge.warnings
    this._applyKnowledgeToDecisionReport(dp, canonicalKnowledge, knowledgeMod)

    // ── canTrade gate ──
    if (!canonicalKnowledge.canTrade) {
      dp.rejectedBy = "knowledge"
      const knowConsensus: ConsensusResult = {
        approved: false, action: proposal.action, confidence: 0,
        agentVotes: [], tiebreaker: "",
        reason: "Knowledge Service rejected proposal: canTrade=false",
      }
      const knowResult = await this._recordRejection({
        proposal, intentId, decisionReport: dp,
        rejection: {
          rejectedBy: "knowledge",
          rejectionCode: "KNOWLEDGE_CAN_TRADE_FALSE",
          rejectionStage: "knowledge",
          rejectionReason: knowConsensus.reason,
          sourcePath: "submitProposal",
          occurredAt: Date.now(),
        },
        consensus: knowConsensus,
      })
      console.log(`[${this.name}] 🛑 Knowledge rejected: canTrade=false`)
      return knowResult
    }

    this._transitionIntent(intentId, "KNOWLEDGE_VALIDATED")

    // ── Pre-vote policy check ──
    const preVotePolicy = this._checkPreVotePolicy(proposal)
    if (!preVotePolicy.allowed) {
      dp.rejectedBy = "policy"
      const preVoteConsensus: ConsensusResult = {
        approved: false, action: proposal.action, confidence: 0,
        agentVotes: [], tiebreaker: "",
        reason: preVotePolicy.reason,
      }
      const preVoteResult = await this._recordRejection({
        proposal, intentId, decisionReport: dp,
        rejection: {
          rejectedBy: "policy",
          rejectionCode: "PRE_VOTE_POLICY_REJECTED",
          rejectionStage: "pre_vote_policy",
          rejectionReason: preVotePolicy.reason,
          sourcePath: "submitProposal",
          occurredAt: Date.now(),
        },
        consensus: preVoteConsensus,
      })
      console.log(`[${this.name}] 🛑 Policy rejected (pre-vote): ${preVotePolicy.reason}`)
      return preVoteResult
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
        const repScore = this.reputation_.getScore(v.agentId)
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
      const voteResult = await this._recordRejection({
        proposal, intentId, decisionReport: dp,
        rejection: {
          rejectedBy: "voting",
          rejectionCode: "VOTING_REJECTED",
          rejectionStage: "voting",
          rejectionReason: consensus.reason,
          sourcePath: "submitProposal",
          occurredAt: Date.now(),
        },
        consensus,
      })
      console.log(`[${this.name}] ❌ Rejected — ${consensus.reason}`)
      return voteResult
    }

    if (!this.executor_) {
      const noExecConsensus: ConsensusResult = {
        ...consensus,
        approved: false,
        reason: "No executor configured",
      }
      const noExecResult = await this._recordRejection({
        proposal, intentId, decisionReport: dp,
        rejection: {
          rejectedBy: "coordinator",
          rejectionCode: "NO_EXECUTOR",
          rejectionStage: "capability",
          rejectionReason: noExecConsensus.reason,
          sourcePath: "submitProposal",
          occurredAt: Date.now(),
        },
        consensus: noExecConsensus,
      })
      console.log(`[${this.name}] ❌ Rejected — no executor configured`)
      return noExecResult
    }

    // ── Pre-execution policy check ──
    const preExecPolicy = this._checkPreExecPolicy(proposal)
    if (!preExecPolicy.allowed) {
      dp.rejectedBy = "policy"
      const preExecConsensus: ConsensusResult = {
        ...consensus,
        approved: false,
        reason: preExecPolicy.reason,
      }
      const preExecResult = await this._recordRejection({
        proposal, intentId, decisionReport: dp,
        rejection: {
          rejectedBy: "policy",
          rejectionCode: "PRE_EXEC_POLICY_REJECTED",
          rejectionStage: "pre_exec_policy",
          rejectionReason: preExecPolicy.reason,
          sourcePath: "submitProposal",
          occurredAt: Date.now(),
        },
        consensus: preExecConsensus,
      })
      console.log(`[${this.name}] 🛑 Policy rejected (pre-exec): ${preExecPolicy.reason}`)
      return preExecResult
    }

    const canExec = this._safeCanExecute(proposal)
    if (!canExec.allowed) {
      const canExecConsensus: ConsensusResult = {
        ...consensus,
        approved: false,
        reason: canExec.reason,
      }
      const canExecResult = await this._recordRejection({
        proposal, intentId, decisionReport: dp,
        rejection: {
          rejectedBy: "executor",
          rejectionCode: "EXECUTOR_CAN_EXECUTE_FALSE",
          rejectionStage: "execution_guard",
          rejectionReason: canExec.reason,
          sourcePath: "submitProposal",
          occurredAt: Date.now(),
        },
        consensus: canExecConsensus,
      })
      console.log(`[${this.name}] ❌ Rejected — ${canExec.reason}`)
      return canExecResult
    }

    // ── Execution stage ──
    this._transitionIntent(intentId, "APPROVED")
    this._transitionIntent(intentId, "EXECUTING")
    const execStart = Date.now()
    console.log(`[${this.name}] ⚡ Executing — ${proposal.action} via ${this.executor_.name}`)
    const finalOperationalReadiness = this._getOperationalReadiness("submitProposal")
    if (!finalOperationalReadiness.operational) {
      return this._operationalSubmission(proposal, finalOperationalReadiness.unavailable, consensus)
    }
    const executionPromise = this.executor_.execute(proposal)
    const executionResult = await executionPromise
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

    // ── Mandatory execution evidence stage ──
    let auditId: string | undefined
    let executionEvidenceFailure: OperationalDegradationCode | undefined
    if (!this.audit_) {
      executionEvidenceFailure = "AUDIT_UNAVAILABLE"
    } else {
      const entry = Audit.createEntry({
        agentId: proposal.agentId, action: proposal.action, proposal,
        result: executionResult, approved: consensus.approved,
        confidence: consensus.confidence, voters: this.agents.size,
        knowledgeModifier: knowledgeMod,
        onChainStatus: isProvisionalDispatch ? "skipped" : "pending",
      })
      try {
        const write = this.audit_.record(entry)
        if (write?.recorded === true) {
          auditId = entry.id
          dp.auditId = auditId
        } else {
          executionEvidenceFailure = "AUDIT_WRITE_REJECTED"
        }
      } catch {
        executionEvidenceFailure = "AUDIT_WRITE_EXCEPTION"
      }
    }

    if (executionEvidenceFailure) {
      this._enterRecoveryRequired(executionEvidenceFailure, "unproven")
    }

    dp.outcome = "approved"
    dp.auditStatus = auditId ? "recorded" : "write_failed"
    dp.resolvedAt = Date.now()
    dp.durationMs = dp.resolvedAt - startTime
    let executionReportSaved = false
    try {
      executionReportSaved = (await this._saveDecisionReport(intentId, dp)).saved
    } catch {
      executionReportSaved = false
    }
    if (!executionReportSaved) {
      this._enterRecoveryRequired("EXECUTION_EVIDENCE_PERSISTENCE_FAILED", "unproven")
    }

    if (executionEvidenceFailure || !executionReportSaved) {
      const unavailable = this._getOperationalReadiness("submitProposal", true)
      if (!unavailable.operational) {
        return this._operationalSubmission(proposal, unavailable.unavailable, consensus, executionResult)
      }
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

    // ── On-chain proof ──
    if (executionResult.success && !isProvisionalDispatch && this.intentPublisher_?.anchorDecision) {
      this.intentPublisher_.anchorDecision(intentId, dp).then(result => {
        if (result && this.proofReconciler_?.reconcileConfirmedProof(intentId, result).reconciled) {
          console.log(`[${this.name}] 🔗 On-chain proof: tx:${result.txHash} block:${result.blockNumber} hash:${result.hash.slice(0, 18)}...`)
        }
      }).catch(() => {})
    }

    return { kind: "decision", consensus, executionResult }
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
    const primaryOperationalReadiness = this._getOperationalReadiness("runCycle")
    if (!primaryOperationalReadiness.operational) {
      return this._operationalCycle({
        cycleId: this.cycleCount,
        proposalsSubmitted: 0,
        consensusReached: 0,
        executionsDispatched: 0,
        errors: 0,
        timestamp: Date.now(),
      }, primaryOperationalReadiness.unavailable)
    }

    this.cycleCount++
    const report: Extract<CycleReport, { kind: "cycle_report" }> = {
      kind: "cycle_report",
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
        // ── Gate 1: Dedup (intake) ──
        const dup = this.deduplicator.isDuplicate(proposal.agentId, proposal.action, proposal.params)
        if (dup.duplicate) {
          if (dup.count <= this.deduplicator.MAX_WARNINGS) {
            console.warn(`[${this.name}] 🚫 Duplicate intent from agent ${proposal.agentId} in cycle — discarded (×${dup.count})`)
          }
          await this._recordCycleRejection({
            proposal, cycleIntentId, cycleDecisionReportId,
            rejectionCode: "DUPLICATE_INTENT",
            rejectionStage: "intake",
            rejectedBy: "deduplicator",
            rejectionReason: `Duplicate intent from ${proposal.agentId} — discarded (×${dup.count})`,
            report,
          })
          continue
        }

        proposal.params.intentId = cycleIntentId
        proposal.params.correlationId = cycleIntentId
        proposal.params.settlementCorrelationId = cycleIntentId
        proposal.params.proposalId = proposal.id
        proposal.params.decisionReportId = cycleDecisionReportId
        this._transitionIntent(cycleIntentId, "CREATED")

        // ── Canonical Knowledge enforcement ──
        const canonicalKnowledge = await this._resolveKnowledge(proposal)
        const knowledgeMod = this.policyEngine.isAllowed("allowKnowledgeOverride", proposal.params?.rede as string | undefined)
          ? canonicalKnowledge.modifier : 0
        proposal.params.knowledgeModifier = knowledgeMod
        proposal.params.knowledgeWarnings = canonicalKnowledge.warnings

        // ── Gate 2: canTrade (knowledge) ──
        if (!canonicalKnowledge.canTrade) {
          await this._recordCycleRejection({
            proposal, cycleIntentId, cycleDecisionReportId,
            rejectionCode: "KNOWLEDGE_CAN_TRADE_FALSE",
            rejectionStage: "knowledge",
            rejectedBy: "knowledge",
            rejectionReason: "Knowledge Service rejected proposal: canTrade=false",
            report,
            canonicalKnowledge,
            appliedModifier: knowledgeMod,
          })
          continue
        }

        // ── Gate 3: Pre-vote policy ──
        const preVotePolicy = this._checkPreVotePolicy(proposal)
        if (!preVotePolicy.allowed) {
          await this._recordCycleRejection({
            proposal, cycleIntentId, cycleDecisionReportId,
            rejectionCode: "PRE_VOTE_POLICY_REJECTED",
            rejectionStage: "pre_vote_policy",
            rejectedBy: "policy",
            rejectionReason: preVotePolicy.reason,
            report,
            canonicalKnowledge,
            appliedModifier: knowledgeMod,
          })
          continue
        }

        this._transitionIntent(cycleIntentId, "KNOWLEDGE_VALIDATED")
        this._transitionIntent(cycleIntentId, "VOTING")

        // Collect votes
        this.voting.clearVotes(proposal.id)
        const votes = await this.collectVotes(proposal)
        for (const v of votes) {
          const repScore = this.reputation_.getScore(v.agentId)
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

        const votingSection = {
          votes: votes.map(v => ({ agentId: v.agentId, approved: v.approved, confidence: v.confidence, reason: v.reason })),
          totalVoters: this.agents.size,
          approved: consensus.approved,
          confidence: consensus.confidence,
          reason: consensus.reason,
          weightedConfidence: consensus.confidence,
          minAgentsRequired: this.MIN_AGREEING_AGENTS,
        }

        // ── Gate 4: Voting ──
        if (!consensus.approved) {
          await this._recordCycleRejection({
            proposal, cycleIntentId, cycleDecisionReportId,
            rejectionCode: "VOTING_REJECTED",
            rejectionStage: "voting",
            rejectedBy: "voting",
            rejectionReason: consensus.reason,
            report,
            canonicalKnowledge,
            appliedModifier: knowledgeMod,
            voting: votingSection,
          })
          continue
        }

        // ── Gate 5: Executor presence (capability) ──
        if (!this.executor_) {
          await this._recordCycleRejection({
            proposal, cycleIntentId, cycleDecisionReportId,
            rejectionCode: "NO_EXECUTOR",
            rejectionStage: "capability",
            rejectedBy: "coordinator",
            rejectionReason: "No executor configured",
            report,
            canonicalKnowledge,
            appliedModifier: knowledgeMod,
            voting: votingSection,
          })
          continue
        }

        report.consensusReached++

        // ── Gate 6: Pre-execution policy ──
        const preExecPolicy = this._checkPreExecPolicy(proposal)
        if (!preExecPolicy.allowed) {
          await this._recordCycleRejection({
            proposal, cycleIntentId, cycleDecisionReportId,
            rejectionCode: "PRE_EXEC_POLICY_REJECTED",
            rejectionStage: "pre_exec_policy",
            rejectedBy: "policy",
            rejectionReason: preExecPolicy.reason,
            report,
            canonicalKnowledge,
            appliedModifier: knowledgeMod,
            voting: votingSection,
          })
          continue
        }

        // ── Gate 7: canExecute (execution_guard) ──
        const canExec = this._safeCanExecute(proposal)
        if (!canExec.allowed) {
          await this._recordCycleRejection({
            proposal, cycleIntentId, cycleDecisionReportId,
            rejectionCode: "EXECUTOR_CAN_EXECUTE_FALSE",
            rejectionStage: "execution_guard",
            rejectedBy: "executor",
            rejectionReason: canExec.reason,
            report,
            canonicalKnowledge,
            appliedModifier: knowledgeMod,
            voting: votingSection,
          })
          continue
        }

        // ── Execution stage (unchanged) ──
        this._transitionIntent(cycleIntentId, "APPROVED")
        this._transitionIntent(cycleIntentId, "EXECUTING")

        // Execute
        const finalOperationalReadiness = this._getOperationalReadiness("runCycle")
        if (!finalOperationalReadiness.operational) {
          return this._operationalCycle(report, finalOperationalReadiness.unavailable)
        }
        const executionPromise = this.executor_.execute(proposal)
        const result = await executionPromise
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

        const cycleDecisionReport: DecisionReport = {
          id: cycleDecisionReportId,
          intentId: cycleIntentId,
          agentId: proposal.agentId,
          action: proposal.action,
          params: proposal.params ?? {},
          outcome: "approved",
          createdAt: Date.now(),
          resolvedAt: Date.now(),
          onChainStatus: isProvisionalDispatch ? "skipped" : "pending",
          execution: {
            success: result.success,
            profit: result.profit ?? 0,
            gasCost: result.gasCost ?? 0,
            durationMs: 0,
            txHash: result.txHash,
            errorMsg: result.errorMsg,
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
        this._applyKnowledgeToDecisionReport(cycleDecisionReport, canonicalKnowledge, knowledgeMod)

        // Mandatory execution evidence
        let cycleEvidenceFailure: OperationalDegradationCode | undefined
        if (!this.audit_) {
          cycleEvidenceFailure = "AUDIT_UNAVAILABLE"
        } else {
          const auditEntry = Audit.createEntry({
            agentId: proposal.agentId,
            action: proposal.action,
            proposal,
            result,
            approved: consensus.approved,
            confidence: consensus.confidence,
            voters: votes.length,
            knowledgeModifier: knowledgeMod,
          })
          try {
            const auditWrite = this.audit_.record(auditEntry)
            if (auditWrite?.recorded === true) {
              cycleDecisionReport.auditId = auditEntry.id
            } else {
              cycleEvidenceFailure = "AUDIT_WRITE_REJECTED"
            }
          } catch {
            cycleEvidenceFailure = "AUDIT_WRITE_EXCEPTION"
          }
        }
        cycleDecisionReport.auditStatus = cycleDecisionReport.auditId ? "recorded" : "write_failed"
        if (cycleEvidenceFailure) {
          this._enterRecoveryRequired(cycleEvidenceFailure, "unproven")
        }

        let cycleReportSaved = false
        try {
          cycleReportSaved = (await this._saveDecisionReport(cycleIntentId, cycleDecisionReport)).saved
        } catch {
          cycleReportSaved = false
        }
        if (!cycleReportSaved) {
          this._enterRecoveryRequired("EXECUTION_EVIDENCE_PERSISTENCE_FAILED", "unproven")
        }
        if (cycleEvidenceFailure || !cycleReportSaved) {
          const unavailable = this._getOperationalReadiness("runCycle", true)
          if (!unavailable.operational) return this._operationalCycle(report, unavailable.unavailable)
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
          this.intentPublisher_.anchorDecision(cycleIntentId, cycleDecisionReport).then(anchorResult => {
            if (anchorResult && this.proofReconciler_?.reconcileConfirmedProof(cycleIntentId, anchorResult).reconciled) {
              console.log(`[${this.name}] 🔗 On-chain proof (cycle): tx:${anchorResult.txHash} block:${anchorResult.blockNumber}`)
            }
          }).catch(() => {})
        }
      } catch (e) {
        // Evidence failure: save/audit error inside _recordCycleRejection.
        // Must abort cycle to prevent economic continuation without evidence.
        if (e instanceof CycleRejectionEvidenceError) {
          throw e
        }
        report.errors++
        this._transitionIntent(cycleIntentId, "FAILED")
        console.warn(`[${this.name}] Cycle error on proposal ${proposal.id}:`, e)
      }
    }

    return report
  }

  private async _resolveKnowledge(proposal: AgentProposal): Promise<ResolvedKnowledgeContext> {
    const action = this._classifyKnowledgeAction(proposal.action)

    if (action === "UNKNOWN") {
      return { canTrade: false, modifier: 0, source: "failed", status: "failed", warnings: [], error: "Knowledge resolution failed" }
    }

    const fromToken = proposal.params?.fromToken as string | undefined
    const toToken = proposal.params?.toToken as string | undefined
    const network = proposal.params?.rede as string | undefined

    // Economic actions require fromToken, toToken, and network.
    // Fail-closed before any other check — a provided report cannot
    // authorize a malformed economic proposal.
    if (action !== "NON_ECONOMIC" && (!fromToken || !toToken || !network)) {
      return { canTrade: false, modifier: 0, source: "failed", status: "failed", warnings: [], error: "Knowledge resolution failed" }
    }

    // Provided report: skip duplicate query.
    const provided = proposal.params?.knowledgeReport
    if (provided !== undefined) {
      const report = this._normalizeKnowledgeReport(provided)
      if (report) {
        return { report, canTrade: report.canTrade, modifier: report.confidenceModifier, source: "provided", status: "provided", warnings: [...report.warnings] }
      }
      return { canTrade: false, modifier: 0, source: "failed", status: "failed", warnings: [], error: "Knowledge resolution failed" }
    }

    // Non-economic actions: no pair/network needed. Allow pass-through.
    if (action === "NON_ECONOMIC") {
      return { canTrade: true, modifier: 0, source: "unavailable", status: "unavailable", warnings: [] }
    }

    try {
      const queried = await this.knowledge_.query({
        pair: { from: fromToken!, to: toToken! },
        network: network!,
        action,
        agent: proposal.agentId,
        amount: typeof proposal.params?.amountUsd === "number" ? BigInt(Math.round(proposal.params.amountUsd * 100)) : 0n,
      })
      const report = this._normalizeKnowledgeReport(queried)
      if (!report) throw new Error("invalid KnowledgeReport")
      return { report, canTrade: report.canTrade, modifier: report.confidenceModifier, source: "queried", status: "queried", warnings: [...report.warnings] }
    } catch {
      return { canTrade: false, modifier: 0, source: "failed", status: "failed", warnings: [], error: "Knowledge resolution failed" }
    }
  }

  private _classifyKnowledgeAction(action: string): "BUY" | "SELL" | "NON_ECONOMIC" | "UNKNOWN" {
    const normalized = action.trim().toUpperCase()
    if (normalized === "BUY" || normalized === "SELL") return normalized
    if (normalized === "HOLD" || normalized === "TEST") return "NON_ECONOMIC"
    return "UNKNOWN"
  }

  private _normalizeKnowledgeReport(value: unknown): KnowledgeReport | undefined {
    if (!value || typeof value !== "object") return undefined
    const v = value as Record<string, unknown>
    const numeric = ["liquidity", "gasScore", "routeScore", "marketScore", "riskScore", "expectedValue"]
    if (typeof v.canTrade !== "boolean" || numeric.some(key => typeof v[key] !== "number" || !Number.isFinite(v[key]))) return undefined
    const modifier = typeof v.confidenceModifier === "number" && Number.isFinite(v.confidenceModifier) ? v.confidenceModifier : 0
    return {
      canTrade: v.canTrade,
      reason: typeof v.reason === "string" ? v.reason : undefined,
      liquidity: v.liquidity as number,
      gasScore: v.gasScore as number,
      routeScore: v.routeScore as number,
      marketScore: v.marketScore as number,
      riskScore: v.riskScore as number,
      expectedValue: v.expectedValue as number,
      confidenceModifier: modifier,
      warnings: Array.isArray(v.warnings) ? v.warnings.filter((item): item is string => typeof item === "string") : [],
      recommendations: Array.isArray(v.recommendations) ? v.recommendations.filter((item): item is string => typeof item === "string") : [],
      sources: (v.sources && typeof v.sources === "object" ? v.sources : { liquidity: false, route: false, gas: false, price: false, history: false, reputation: false }) as KnowledgeReport["sources"],
      timestamp: typeof v.timestamp === "number" && Number.isFinite(v.timestamp) ? v.timestamp : Date.now(),
    }
  }

  private _applyKnowledgeToDecisionReport(dp: DecisionReport, context: ResolvedKnowledgeContext, appliedModifier: number): void {
    const report = context.report
    dp.knowledgeStatus = context.status
    dp.knowledgeError = context.error
    dp.knowledge = {
      canTrade: context.canTrade,
      source: context.source,
      liquidity: report?.liquidity ?? 0,
      gasScore: report?.gasScore ?? 0,
      routeScore: report?.routeScore ?? 0,
      marketScore: report?.marketScore ?? 0,
      riskScore: report?.riskScore ?? 0,
      expectedValue: report?.expectedValue ?? 0,
      confidenceModifier: appliedModifier,
      warnings: [...context.warnings],
      recommendations: [...(report?.recommendations ?? [])],
      gasContext: report?.gasContext,
    }
  }

  private async _saveDecisionReport(intentId: string, report: DecisionReport): Promise<DecisionReportWriteResult> {
    if (!this.intentPublisher_) {
      return { saved: false, mode: "updated_existing", error: "IntentPublisher not available" }
    }
    const existing = this.intentPublisher_.getRecord(intentId)
    if (existing) {
      const ok = this.intentPublisher_.setDecisionReport(intentId, report)
      if (!ok) {
        return { saved: false, mode: "updated_existing", error: "setDecisionReport returned false" }
      }
      this._syncSettlementFromRegistry(intentId)
      return { saved: true, mode: "updated_existing" }
    }
    try {
      await this.intentPublisher_.publish({
        id: intentId,
        agentId: report.agentId,
        action: report.action,
        params: report.params,
        confidence: report.voting?.confidence ?? 0,
        timestamp: report.createdAt,
      })
      const record = this.intentPublisher_?.getRecord(intentId)
      if (!record) {
        return { saved: false, mode: "published_new", error: "Publish succeeded but intent not found (race or trim)" }
      }
      const ok = this.intentPublisher_!.setDecisionReport(intentId, report)
      if (!ok) {
        return { saved: false, mode: "published_new", error: "setDecisionReport returned false after publish" }
      }
      this._syncSettlementFromRegistry(intentId)
      return { saved: true, mode: "published_new" }
    } catch (e) {
      const msg = (e as Error).message ?? String(e)
      return { saved: false, mode: "published_new", error: `Publish failed: ${msg}` }
    }
  }

  private async _recordRejection(args: {
    proposal: AgentProposal
    intentId: string
    decisionReport: DecisionReport
    rejection: RejectionMetadata
    consensus: ConsensusResult
  }): Promise<SubmissionResult> {
    await this._recordRejectionCore(args)
    return { kind: "decision", consensus: args.consensus }
  }

  private async _recordRejectionCore(args: {
    proposal: AgentProposal
    intentId: string
    decisionReport: DecisionReport
    rejection: RejectionMetadata
    consensus: ConsensusResult
  }): Promise<void> {
    const { proposal, intentId, decisionReport: dp, rejection } = args

    if (!rejection.rejectedBy || !rejection.rejectionCode || !rejection.rejectionStage || !rejection.sourcePath) {
      this._enterRecoveryRequired("INVALID_REJECTION_METADATA", "unavailable")
      throw new CycleRejectionEvidenceError("INVALID_REJECTION_METADATA",
        new Error(`Invalid rejection metadata: missing required field in ${dp.id}`))
    }

    dp.outcome = "rejected"
    dp.rejection = rejection
    dp.auditStatus = "not_attempted"
    dp.resolvedAt = Date.now()
    dp.durationMs = dp.resolvedAt - (proposal.timestamp ?? dp.createdAt)

    let write: DecisionReportWriteResult
    try {
      write = await this._saveDecisionReport(intentId, dp)
    } catch (e) {
      this._enterRecoveryRequired("DECISION_REPORT_INITIAL_SAVE_FAILED", "unavailable")
      throw new CycleRejectionEvidenceError("SAVE_INITIAL_FAILED",
        e instanceof Error ? e : new Error(String(e)))
    }
    if (!write.saved) {
      this._enterRecoveryRequired("DECISION_REPORT_INITIAL_SAVE_FAILED", "unavailable")
      throw new CycleRejectionEvidenceError("SAVE_INITIAL_FAILED")
    }

    this._transitionIntent(intentId, "REJECTED")

    let auditRecorded = false
    let auditFailureCode: OperationalDegradationCode | undefined
    if (!this.audit_) {
      auditFailureCode = "AUDIT_UNAVAILABLE"
    } else {
      const entry = Audit.createEntry({
        agentId: proposal.agentId,
        action: proposal.action,
        proposal,
        result: null,
        approved: false,
        confidence: 0,
        voters: 0,
        tags: [
          "rejection",
          `rejection_code:${rejection.rejectionCode}`,
          `rejection_stage:${rejection.rejectionStage}`,
          `rejected_by:${rejection.rejectedBy}`,
          `source_path:${rejection.sourcePath}`,
        ],
      })
      try {
        const auditWrite = this.audit_.record(entry)
        auditRecorded = auditWrite?.recorded === true
        if (!auditRecorded) auditFailureCode = "AUDIT_WRITE_REJECTED"
      } catch {
        auditRecorded = false
        auditFailureCode = "AUDIT_WRITE_EXCEPTION"
      }
    }

    if (auditFailureCode) this._enterRecoveryRequired(auditFailureCode, "unavailable")

    dp.auditStatus = auditRecorded ? "recorded" : "write_failed"
    let finalWrite: DecisionReportWriteResult
    try {
      finalWrite = await this._saveDecisionReport(intentId, dp)
    } catch (e) {
      this._enterRecoveryRequired("DECISION_REPORT_FINAL_SAVE_FAILED", "unavailable")
      throw new CycleRejectionEvidenceError("SAVE_FINAL_FAILED",
        e instanceof Error ? e : new Error(String(e)))
    }
    if (!finalWrite.saved) {
      this._enterRecoveryRequired("DECISION_REPORT_FINAL_SAVE_FAILED", "unavailable")
      throw new CycleRejectionEvidenceError("SAVE_FINAL_FAILED")
    }
    if (!auditRecorded) throw new CycleRejectionEvidenceError("AUDIT_RECORD_FAILED")

  }

  /** Cycle rejection helper — matches _recordRejection contract.
   *  Saves DecisionReport with outcome="rejected", rejection metadata, transitions
   *  intent to REJECTED, creates Audit entry, increments report.errors.
   *  Throws if evidence cannot be persisted or audited. */
  private async _recordCycleRejection(args: {
    proposal: AgentProposal
    cycleIntentId: string
    cycleDecisionReportId: string
    rejectionCode: RejectionCode
    rejectionStage: RejectionStage
    rejectedBy: RejectedBy
    rejectionReason: string
    report: CycleReport
    canonicalKnowledge?: ResolvedKnowledgeContext
    appliedModifier?: number
    voting?: DecisionReport["voting"]
  }): Promise<void> {
    const { proposal, cycleIntentId, cycleDecisionReportId, rejectionCode, rejectionStage, rejectedBy, rejectionReason, report, canonicalKnowledge, appliedModifier, voting } = args

    const knowledge = canonicalKnowledge && appliedModifier !== undefined
      ? this._buildCycleKnowledgeSection(canonicalKnowledge, appliedModifier)
      : undefined

    const dp: DecisionReport = {
      id: cycleDecisionReportId,
      intentId: cycleIntentId,
      agentId: proposal.agentId,
      action: proposal.action,
      params: proposal.params ?? {},
      createdAt: Date.now(),
      knowledge,
      voting,
    }

    const rejection: RejectionMetadata = {
      rejectedBy,
      rejectionCode,
      rejectionStage,
      rejectionReason,
      sourcePath: "runCycle",
      occurredAt: Date.now(),
    }
    const consensus: ConsensusResult = {
      approved: false,
      action: proposal.action,
      confidence: 0,
      agentVotes: [],
      tiebreaker: "",
      reason: rejectionReason,
    }

    await this._recordRejectionCore({ proposal, intentId: cycleIntentId, decisionReport: dp, rejection, consensus })

    report.errors++
  }

  private _buildCycleKnowledgeSection(knowledge: ResolvedKnowledgeContext, modifier: number): DecisionReport["knowledge"] {
    return {
      canTrade: knowledge.canTrade,
      source: knowledge.status,
      liquidity: knowledge.report?.liquidity ?? 0,
      gasScore: knowledge.report?.gasScore ?? 0,
      routeScore: knowledge.report?.routeScore ?? 0,
      marketScore: knowledge.report?.marketScore ?? 0,
      riskScore: knowledge.report?.riskScore ?? 0,
      expectedValue: knowledge.report?.expectedValue ?? 0,
      confidenceModifier: modifier,
      warnings: [...knowledge.warnings],
      recommendations: [...(knowledge.report?.recommendations ?? [])],
    }
  }

  /** Fail-closed canExecute: any exception, null, undefined, or non-boolean allowed
   *  is treated as execution denied. Never throws, returns safe result. */
  private _safeCanExecute(proposal: AgentProposal): { allowed: boolean; reason: string } {
    if (!this.executor_) {
      return { allowed: false, reason: "Executor cannot execute proposal" }
    }
    try {
      const result = this.executor_.canExecute(proposal)
      const allowed = result && typeof result === "object" && result.allowed === true
      return { allowed, reason: allowed ? "" : "Executor cannot execute proposal" }
    } catch {
      return { allowed: false, reason: "Executor cannot execute proposal" }
    }
  }

  /** Post-save settlement replay: sync any existing or queued settlement
   *  records into the just-saved DecisionReport.  Idempotent and safe —
   *  confirmed canonical settlement cannot be downgraded by stale updates. */
  private _syncSettlementFromRegistry(intentId: string): void {
    this.settlementReplay_.replayForCorrelationId(intentId)
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

    const record = this.settlementRegistry_.registerPending({
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
