import type { CommandId } from "./f1a-foundation"
import type {
  FencingToken,
  OperationalAuthorityProof,
  OperationalAuthorityRevision,
} from "./f1b-operational-control"
import type {
  AttemptCreatedAt,
  AttemptNumber,
  AttemptReason,
  CausalEventId,
  CausalEventSequence,
  EffectAuthorizationReference,
  EffectInstanceKey,
  ExecutionAttemptId,
  ImmutableExecutionEconomicCeilingDigest,
  NonEmptyReadonlyArray,
  NonceReservationId,
  ReplacementLineageId,
  SignedPayloadHash,
  TransactionAttemptId,
  TransactionHash,
} from "./f1c-execution-attempts"
import type {
  CanonicalBlockEvidence,
  CanonicalLineageSnapshotDigest,
  CanonicalReceiptEvidence,
  DeterministicCommitFinalityProof,
  DeterministicCommitRequirement,
  FinalityPolicyVersion,
  FinalityRequirement,
  HistoricalFinalityRequirementEnvelope,
  ProbabilisticConfirmationRequirement,
  ProbabilisticFinalityProof,
  SettlementProofId,
} from "./f1d-finality"
import type {
  DomainEvidenceDigest,
  EvidenceRef,
  ProofDigest,
  SettlementId,
  SettlementKey,
  SettlementRevision,
} from "./f1d-settlement-identities"
import type {
  ReceiptObservationData,
  ReorgObservation,
  SettlementObservationId,
  SettlementObservationSequence,
} from "./f1d-settlement-observations"

declare const settlementBrand: unique symbol
type SettlementOpaque<Name extends string> = string & { readonly [settlementBrand]: Name }

export type SettledAt = SettlementOpaque<"SettledAt">
export type RecoveryRequirementId = SettlementOpaque<"RecoveryRequirementId">
export type SettlementDisputeId = SettlementOpaque<"SettlementDisputeId">
export type CanonicalTransactionReference = {
  readonly kind: "CANONICAL_TRANSACTION_REFERENCE"
  readonly settlementKey: SettlementKey
  readonly executionAttemptId: ExecutionAttemptId
  readonly nonceReservationId: NonceReservationId
  readonly replacementLineageId: ReplacementLineageId
  readonly transactionAttemptId: TransactionAttemptId
  readonly transactionHash: TransactionHash
  readonly signedPayloadHash: SignedPayloadHash
  readonly canonicalReceiptDigest: DomainEvidenceDigest
  readonly lineageSnapshotDigest: CanonicalLineageSnapshotDigest
  readonly authorityMode: "AUTHORITATIVE"
}

export type ExecutionAttemptIdentitySnapshot = {
  readonly executionAttemptId: ExecutionAttemptId
  readonly commandId: CommandId
  readonly effectInstanceKey: EffectInstanceKey
  readonly attemptNumber: AttemptNumber
  readonly attemptReason: AttemptReason
  readonly initialEffectAuthorizationReference: EffectAuthorizationReference
  readonly immutableExecutionEconomicCeilingDigest: ImmutableExecutionEconomicCeilingDigest
  readonly attemptCreatedAt: AttemptCreatedAt
  readonly createdEventId: CausalEventId
  readonly causalEventSequence: CausalEventSequence
  readonly transactionAttemptIds: NonEmptyReadonlyArray<TransactionAttemptId>
  readonly nonceReservationId: NonceReservationId
}

export type SettlementProof =
  | { readonly proofKind: "DETERMINISTIC_SETTLEMENT_PROOF"; readonly settlementProofId: SettlementProofId; readonly settlementKey: SettlementKey; readonly settlementRevision: SettlementRevision; readonly canonicalTransaction: CanonicalTransactionReference; readonly canonicalReceipt: CanonicalReceiptEvidence; readonly canonicalBlock: CanonicalBlockEvidence; readonly finalityRequirement: DeterministicCommitRequirement; readonly historicalFinalityRequirement: Extract<HistoricalFinalityRequirementEnvelope, { mode: "DETERMINISTIC_COMMIT" }>; readonly finalityProof: DeterministicCommitFinalityProof; readonly authorityMode: "AUTHORITATIVE" }
  | { readonly proofKind: "PROBABILISTIC_SETTLEMENT_PROOF"; readonly settlementProofId: SettlementProofId; readonly settlementKey: SettlementKey; readonly settlementRevision: SettlementRevision; readonly canonicalTransaction: CanonicalTransactionReference; readonly canonicalReceipt: CanonicalReceiptEvidence; readonly canonicalBlock: CanonicalBlockEvidence; readonly finalityRequirement: ProbabilisticConfirmationRequirement; readonly historicalFinalityRequirement: Extract<HistoricalFinalityRequirementEnvelope, { mode: "PROBABILISTIC_CONFIRMATIONS" }>; readonly finalityProof: ProbabilisticFinalityProof; readonly authorityMode: "AUTHORITATIVE" }

export type ArcDeterministicSettlementDecisionRequest = {
  readonly route: "ARC_DETERMINISTIC_DIRECT"
  readonly fromState: "RECEIPT_OBSERVED"
  readonly toState: "SETTLED"
  readonly settlementKey: SettlementKey
  readonly expectedSettlementRevision: SettlementRevision
  readonly executionAttemptId: ExecutionAttemptId
  readonly nonceReservationId: NonceReservationId
  readonly replacementLineageId: ReplacementLineageId
  readonly completeLineageSnapshotDigest: CanonicalLineageSnapshotDigest
  readonly canonicalReceipt: CanonicalReceiptEvidence
  readonly canonicalBlock: CanonicalBlockEvidence
  readonly finalityRequirement: DeterministicCommitRequirement
  readonly finalityProof: DeterministicCommitFinalityProof
  readonly operationalAuthorityProof: OperationalAuthorityProof
  readonly fencingToken: FencingToken
  readonly authorityRevision: OperationalAuthorityRevision
  readonly disputeOrConflictRef: null
  readonly authorityMode: "AUTHORITATIVE"
  readonly decisionProofDigest: DomainEvidenceDigest
}

export type ProbabilisticSettlementDecisionRequest = {
  readonly route: "PROBABILISTIC_AFTER_CONFIRMATION"
  readonly fromState: "CONFIRMED_UNFINALIZED"
  readonly toState: "SETTLED"
  readonly settlementKey: SettlementKey
  readonly expectedSettlementRevision: SettlementRevision
  readonly executionAttemptId: ExecutionAttemptId
  readonly nonceReservationId: NonceReservationId
  readonly replacementLineageId: ReplacementLineageId
  readonly completeLineageSnapshotDigest: CanonicalLineageSnapshotDigest
  readonly canonicalReceipt: CanonicalReceiptEvidence
  readonly canonicalBlock: CanonicalBlockEvidence
  readonly finalityRequirement: ProbabilisticConfirmationRequirement
  readonly finalityProof: ProbabilisticFinalityProof
  readonly operationalAuthorityProof: OperationalAuthorityProof
  readonly fencingToken: FencingToken
  readonly authorityRevision: OperationalAuthorityRevision
  readonly disputeOrConflictRef: null
  readonly authorityMode: "AUTHORITATIVE"
  readonly decisionProofDigest: DomainEvidenceDigest
}

export type BlockchainSettlementDecisionRequest =
  | ArcDeterministicSettlementDecisionRequest
  | ProbabilisticSettlementDecisionRequest

export type SettledSettlement = {
  readonly state: "SETTLED"
  readonly settlementId: SettlementId
  readonly settlementKey: SettlementKey
  readonly settlementRevision: SettlementRevision
  readonly executionAttemptId: ExecutionAttemptId
  readonly nonceReservationId: NonceReservationId
  readonly replacementLineageId: ReplacementLineageId
  readonly observationHeadSequence: SettlementObservationSequence
  readonly canonicalTransaction: CanonicalTransactionReference
  readonly canonicalReceipt: CanonicalReceiptEvidence
  readonly canonicalBlock: CanonicalBlockEvidence
  readonly finalityRequirement: FinalityRequirement
  readonly settlementProof: SettlementProof
  readonly settledAt: SettledAt
  readonly dispute?: never
}

export type OpenSettlementDispute = {
  readonly state: "OPEN"
  readonly disputeId: SettlementDisputeId
  readonly disputedSettlementId: SettlementId
  readonly disputedSettlementRevision: SettlementRevision
  readonly triggeringObservationRefs: readonly SettlementObservationId[]
  readonly reasonCode: "INVALID_FINALITY_PROOF" | "CANONICAL_RECEIPT_CONFLICT" | "CANONICAL_BLOCK_CONFLICT" | "LINEAGE_CONFLICT" | "POLICY_VERSION_MISMATCH" | "PROVIDER_INCONSISTENCY" | "CONSENSUS_EMERGENCY"
  readonly priorSettlementProofId: SettlementProofId
  readonly priorFinalityPolicyVersion: FinalityPolicyVersion
  readonly recoveryRequirementId: RecoveryRequirementId
  readonly resolutionRef?: never
  readonly correctionRef?: never
  readonly preservesPriorDecision: true
}
export type ResolvedSettlementDispute = Omit<OpenSettlementDispute, "state" | "resolutionRef" | "correctionRef"> & {
  readonly state: "RESOLVED"
  readonly resolutionRef: EvidenceRef
  readonly correctionRef: EvidenceRef
}
export type SettlementDispute = OpenSettlementDispute | ResolvedSettlementDispute

export type DisputedSettlement = {
  readonly state: "DISPUTED"
  readonly settlementId: SettlementId
  readonly settlementKey: SettlementKey
  readonly settlementRevision: SettlementRevision
  readonly settledPredecessor: SettledSettlement
  readonly contradictionEvidenceRefs: readonly SettlementObservationId[]
  readonly dispute: SettlementDispute
  readonly recoveryRequirementId: RecoveryRequirementId
  readonly prohibitedProjectionState: "REORG_OBSERVED"
  readonly reconciliationBlocked: true
  readonly f1eHandoffBlocked: true
}

export type SettlementRecord =
  | { readonly state: "NOT_OBSERVED"; readonly settlementId: SettlementId; readonly settlementKey: SettlementKey; readonly settlementRevision: SettlementRevision; readonly settlementProof?: never }
  | { readonly state: "RECEIPT_OBSERVED"; readonly settlementId: SettlementId; readonly settlementKey: SettlementKey; readonly settlementRevision: SettlementRevision; readonly receiptObservations: readonly ReceiptObservationData[]; readonly settlementProof?: never }
  | { readonly state: "CONFIRMED_UNFINALIZED"; readonly settlementId: SettlementId; readonly settlementKey: SettlementKey; readonly settlementRevision: SettlementRevision; readonly finalityRequirement: Extract<FinalityRequirement, { mode: "PROBABILISTIC_CONFIRMATIONS" }>; readonly settlementProof?: never }
  | { readonly state: "REORG_OBSERVED"; readonly settlementId: SettlementId; readonly settlementKey: SettlementKey; readonly settlementRevision: SettlementRevision; readonly reorg: ReorgObservation; readonly settlementProof?: never }
  | SettledSettlement
  | DisputedSettlement

export type SettledExecutionAttempt = ExecutionAttemptIdentitySnapshot & {
  readonly state: "SETTLED"
  readonly priorState: "SETTLEMENT_PENDING"
  readonly settlement: SettledSettlement
  readonly settlementProof: SettlementProof
  readonly reconciliationEligibility?: never
  readonly reconciliationConclusion?: never
  readonly reconciliationResult?: never
}

export type SettlementDecisionResult =
  | { readonly kind: "SETTLED_COMMITTED"; readonly record: SettledSettlement }
  | { readonly kind: "IDEMPOTENT_SETTLEMENT_RETURNED"; readonly record: SettledSettlement }
  | { readonly kind: "STALE_SETTLEMENT_REVISION"; readonly committed: false }
  | { readonly kind: "SETTLEMENT_CONFLICT"; readonly committed: false; readonly recoveryRequired: true }
  | { readonly kind: "CANONICALITY_NOT_PROVEN"; readonly committed: false }
  | { readonly kind: "FINALITY_NOT_PROVEN"; readonly committed: false }

export type SettlementProofDigest = ProofDigest
