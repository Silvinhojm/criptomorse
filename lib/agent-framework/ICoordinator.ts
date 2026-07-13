import type { IAgent, AgentProposal } from "./IAgent"
import type { IExecutor, ExecutionResult } from "./IExecutor"
import type { ISafetyGuard } from "./ISafetyGuard"
import type { IAudit } from "./IAudit"

export interface ConsensusResult {
  approved: boolean
  action: string
  confidence: number
  agentVotes: { agentId: string; approved: boolean; confidence: number; reason: string }[]
  tiebreaker: string
  reason: string
}

export type OperationalStatus = "OPERATIONAL" | "RECOVERY_REQUIRED"

export type OperationalEvidenceStatus = "available" | "unavailable" | "unproven"

export type OperationalUnavailableEvidenceStatus = "unavailable" | "unproven"

export type OperationalDegradationCode =
  | "AUDIT_UNAVAILABLE"
  | "AUDIT_WRITE_REJECTED"
  | "AUDIT_WRITE_EXCEPTION"
  | "DECISION_REPORT_INITIAL_SAVE_FAILED"
  | "DECISION_REPORT_FINAL_SAVE_FAILED"
  | "EXECUTION_EVIDENCE_PERSISTENCE_FAILED"
  | "INVALID_REJECTION_METADATA"

export interface OperationalUnavailable {
  kind: "operational_unavailable"
  operationalStatus: "RECOVERY_REQUIRED"
  degradedAt: number
  degradationCode: OperationalDegradationCode
  publicReason: "Operational recovery required"
  recoveryRequired: true
  evidenceStatus: OperationalUnavailableEvidenceStatus
  sourcePath: "submitProposal" | "runCycle"
  executionOccurred: boolean
  durability: "instance_memory"
  restartLimitation: "HIGH: restart may clear RECOVERY_REQUIRED; not production-ready without durable operational state"
}

export interface OperationalStateSnapshot {
  operationalStatus: OperationalStatus
  degradedAt?: number
  degradationCode?: OperationalDegradationCode
  publicReason?: "Operational recovery required"
  evidenceStatus: OperationalEvidenceStatus
  durability: "instance_memory"
  restartLimitation: "HIGH: restart may clear RECOVERY_REQUIRED; not production-ready without durable operational state"
}

export interface OperationalRecoveryAuthorizationContext {
  coordinatorName: string
  requestedBy: string
  degradedAt: number
  degradationCode: OperationalDegradationCode
}

export interface IOperationalRecoveryAuthorizer {
  authorizeOperationalRecovery(context: OperationalRecoveryAuthorizationContext): boolean
}

export interface OperationalRecoveryRequest {
  requestedBy: string
  candidateAudit?: IAudit
}

export interface OperationalRecoveryResult {
  kind: "operational_recovery_result"
  status: "recovered" | "denied" | "failed" | "already_operational" | "recovery_in_progress"
  operationalStatus: OperationalStatus
  publicReason: "Operational recovery required" | "Operational" | "Recovery already in progress"
  recovered: boolean
  evidenceStatus: OperationalEvidenceStatus
  recoveryProbeId?: string
  durability: "instance_memory"
  restartLimitation: "HIGH: restart may clear RECOVERY_REQUIRED; not production-ready without durable operational state"
}

export interface CycleReportBase {
  cycleId: number
  proposalsSubmitted: number
  consensusReached: number
  executionsDispatched: number
  errors: number
  timestamp: number
}

export interface OperationalCycleReport extends CycleReportBase, OperationalUnavailable {}

export interface CompletedCycleReport extends CycleReportBase {
  kind: "cycle_report"
}

export type CycleReport = CompletedCycleReport | OperationalCycleReport

export interface DecisionSubmissionResult {
  kind: "decision"
  consensus: ConsensusResult
  executionResult?: ExecutionResult
}

/**
 * `consensus` is retained only as a legacy compatibility view for current
 * callers. `kind` and the operational fields are the canonical truth: this is
 * system unavailability, not a proposal rejection and not audited evidence.
 */
export interface OperationalSubmissionResult extends OperationalUnavailable {
  consensus: ConsensusResult
  executionResult?: ExecutionResult
}

export type SubmissionResult = DecisionSubmissionResult | OperationalSubmissionResult

export interface IOperationalRecoveryControl {
  attemptOperationalRecovery(request: OperationalRecoveryRequest): Promise<OperationalRecoveryResult>
}

import type { PolicyEngine } from "./policy-engine"

export interface ICoordinator {
  readonly name: string
  registerAgent(agent: IAgent): void
  unregisterAgent(agentId: string): void
  getAgents(): IAgent[]
  submitProposal(proposal: AgentProposal): Promise<SubmissionResult>
  runCycle(): Promise<CycleReport>
  getExecutor(): IExecutor | null
  getSafetyGuard(): ISafetyGuard | null
  getAudit(): IAudit | null
  getPolicyEngine(): PolicyEngine
  getOperationalStatus(): OperationalStateSnapshot
}
