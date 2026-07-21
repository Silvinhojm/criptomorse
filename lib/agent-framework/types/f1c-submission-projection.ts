import type { CommandId } from "./f1a-foundation"
import type {
  ActiveEconomicEpochProof,
  ExistingFencingPrecondition,
  OperationalAuthorityProof,
  OwnershipProof,
} from "./f1b-operational-control"
import type {
  CausalEventSequence,
  ChainId,
  CreateReplacementProof,
  EffectAuthorizationReference,
  EffectInstanceKey,
  ExecutionAttemptId,
  ImmutableExecutionEconomicCeilingDigest,
  NonEmptyReadonlyArray,
  NonceReservationId,
  NonceReservationRevision,
  NonceValue,
  ProvenSubmissionTimestamp,
  ReceiptObservationEvidence,
  SignedPayloadHash,
  SigningResourceAuthorityProof,
  SigningResourceFence,
  SigningResourceKey,
  SubmissionAttemptedAt,
  TransactionAttemptId,
  TransactionAttemptRevision,
  TransactionHash,
} from "./f1c-execution-attempts"

/** RI-L2 F1c EXT-009..013 type-only contracts. */
type Nominal<Name extends string> = { readonly __f1cProjectionNominal: Name }

export type SubmissionAttemptId = string & Nominal<"SubmissionAttemptId">
export type SubmissionAttemptRevision = string & Nominal<"SubmissionAttemptRevision">
export type SubmissionIntentRecordedAt = string & Nominal<"SubmissionIntentRecordedAt">
export type SubmissionObservationId = string & Nominal<"SubmissionObservationId">
export type SubmissionProvenanceId = string & Nominal<"SubmissionProvenanceId">
export type ProviderIdempotencyKey = string & Nominal<"ProviderIdempotencyKey">
export type GatewayAdapterIdentityOrClass = string & Nominal<"GatewayAdapterIdentityOrClass">
export type ProviderIdentity = string & Nominal<"ProviderIdentity">
export type ChainNetworkIdentity = readonly [chainId: ChainId, network: string & Nominal<"NetworkIdentity">] &
  Nominal<"ChainNetworkIdentity">
export type ImmutableSubmissionBindingDigest = string & Nominal<"ImmutableSubmissionBindingDigest">
export type TransactionSubmissionSharedBindingDigest = string &
  Nominal<"TransactionSubmissionSharedBindingDigest">
export type AuthoritativeSubmissionChildSetDigest = string &
  Nominal<"AuthoritativeSubmissionChildSetDigest">
export type SubmissionEvidenceAndOutcomeDigest = string & Nominal<"SubmissionEvidenceAndOutcomeDigest">
export type AuthoritativeSubmissionEvidenceDigest = string & Nominal<"AuthoritativeSubmissionEvidenceDigest">
export type CanonicalEconomicIdentityDigest = string & Nominal<"CanonicalEconomicIdentityDigest">
export type CanonicalPayloadDestinationDigest = string & Nominal<"CanonicalPayloadDestinationDigest">
export type CanonicalPayloadValueDigest = string & Nominal<"CanonicalPayloadValueDigest">
export type SharedBindingSchemaVersion = string & Nominal<"SharedBindingSchemaVersion">
export type SubmissionChildSetSchemaVersion = string & Nominal<"SubmissionChildSetSchemaVersion">
export type CompleteSubmissionChildSnapshotProofId = string &
  Nominal<"CompleteSubmissionChildSnapshotProofId">
export type SubmissionChildIndexRevision = string & Nominal<"SubmissionChildIndexRevision">
export type SubmissionChildIndexScope = string & Nominal<"SubmissionChildIndexScope">
export type SubmissionChildIndexAuthorityReference = string &
  Nominal<"SubmissionChildIndexAuthorityReference">
export type TransactionSubmissionProjectionRequestId = string &
  Nominal<"TransactionSubmissionProjectionRequestId">
export type TransactionSubmissionProjectionRevision = string &
  Nominal<"TransactionSubmissionProjectionRevision">
export type TransactionSubmissionPreparedProjectionProofId = string &
  Nominal<"TransactionSubmissionPreparedProjectionProofId">
export type TransactionSubmissionCommittedProjectionProofId = string &
  Nominal<"TransactionSubmissionCommittedProjectionProofId">
export type TransactionSubmissionDispatchGuardId = string &
  Nominal<"TransactionSubmissionDispatchGuardId">
export type TransactionSubmissionDispatchRevision = string &
  Nominal<"TransactionSubmissionDispatchRevision">
export type SingleUseGatewayInvocationPermit = string & Nominal<"SingleUseGatewayInvocationPermit">
export type ReplayCapabilityOrPolicyDigest = string & Nominal<"ReplayCapabilityOrPolicyDigest">
export type SubmissionRetryAuthorizationId = string & Nominal<"SubmissionRetryAuthorizationId">
export type SubmissionRetryAuthorizationRevision = string &
  Nominal<"SubmissionRetryAuthorizationRevision">
export type SubmissionRetryConsumptionRequestId = string &
  Nominal<"SubmissionRetryConsumptionRequestId">
export type SubmissionRetryConsumptionRequestDigest = string &
  Nominal<"SubmissionRetryConsumptionRequestDigest">
export type ImmutableSubmissionBoundsDigest = string & Nominal<"ImmutableSubmissionBoundsDigest">

export interface TransactionSubmissionSharedBindingInput {
  readonly schemaVersion: SharedBindingSchemaVersion
  readonly transactionAttemptId: TransactionAttemptId
  readonly executionAttemptId: ExecutionAttemptId
  readonly commandIdOrExplicitAbsence: CommandId | null
  readonly effectInstanceKeyOrExplicitAbsence: EffectInstanceKey | null
  readonly nonceReservationId: NonceReservationId
  readonly signingResourceKey: SigningResourceKey
  readonly nonce: NonceValue
  readonly signedPayloadHash: SignedPayloadHash
  readonly chainNetworkIdentity: ChainNetworkIdentity
  readonly authorizingEffectAuthorizationReference: EffectAuthorizationReference
  readonly immutableExecutionEconomicCeilingDigest: ImmutableExecutionEconomicCeilingDigest
  readonly canonicalEconomicIdentityDigest: CanonicalEconomicIdentityDigest
  readonly canonicalPayloadDestinationDigest: CanonicalPayloadDestinationDigest
  readonly canonicalPayloadValueDigest: CanonicalPayloadValueDigest
}

export interface ImmutableSubmissionBindingInput extends TransactionSubmissionSharedBindingInput {
  readonly submissionAttemptId: SubmissionAttemptId
  readonly gatewayAdapterIdentityOrClass: GatewayAdapterIdentityOrClass
  readonly providerIdentity?: ProviderIdentity
  readonly providerIdempotencyKey?: ProviderIdempotencyKey
}

export interface SubmissionObservation {
  readonly observationId: SubmissionObservationId
  readonly submissionAttemptId: SubmissionAttemptId
  readonly kind: "ACCEPTED" | "REJECTED" | "UNKNOWN" | "READBACK" | "RECEIPT"
  readonly evidenceAndOutcomeDigest: SubmissionEvidenceAndOutcomeDigest
  readonly causalEventSequence: CausalEventSequence
}

export interface SubmissionProvenance {
  readonly provenanceId: SubmissionProvenanceId
  readonly submissionAttemptId: SubmissionAttemptId
  readonly source: "GATEWAY" | "PROVIDER" | "CHAIN_READBACK" | "RECEIPT_OBSERVER"
  readonly providerIdentity?: ProviderIdentity
  readonly causalEventSequence: CausalEventSequence
}

interface SubmissionLookupEvidenceBase {
  readonly submissionAttemptId: SubmissionAttemptId
  readonly transactionAttemptId: TransactionAttemptId
  readonly nonceReservationId: NonceReservationId
  readonly nonce: NonceValue
  readonly signedPayloadHash: SignedPayloadHash
  readonly chainNetworkIdentity: ChainNetworkIdentity
  readonly evidenceAndOutcomeDigest: SubmissionEvidenceAndOutcomeDigest
}

export interface TransactionHashLookupEvidence extends SubmissionLookupEvidenceBase {
  readonly kind: "TRANSACTION_HASH_LOOKUP"
  readonly transactionHash: TransactionHash
  readonly signingResourceKey?: never
  readonly canonicalLookupValue?: never
}

export interface SigningResourceNonceLookupEvidence extends SubmissionLookupEvidenceBase {
  readonly kind: "SIGNING_RESOURCE_NONCE_LOOKUP"
  readonly signingResourceKey: SigningResourceKey
  readonly transactionHash?: never
  readonly canonicalLookupValue?: never
}

export interface ChainSpecificSubmissionLookupEvidence extends SubmissionLookupEvidenceBase {
  readonly kind: "CHAIN_SPECIFIC_LOOKUP"
  readonly canonicalLookupKind: string & Nominal<"ChainSpecificLookupKind">
  readonly canonicalLookupValue: string & Nominal<"ChainSpecificLookupValue">
  readonly transactionHash?: never
  readonly signingResourceKey?: never
}

export type SubmissionLookupEvidence =
  | TransactionHashLookupEvidence
  | SigningResourceNonceLookupEvidence
  | ChainSpecificSubmissionLookupEvidence

export interface PositiveAcceptanceEvidence {
  readonly submissionAttemptId: SubmissionAttemptId
  readonly transactionAttemptId: TransactionAttemptId
  readonly transactionHash: TransactionHash
  readonly evidenceAndOutcomeDigest: SubmissionEvidenceAndOutcomeDigest
}

export interface ConclusiveRejectionEvidence {
  readonly submissionAttemptId: SubmissionAttemptId
  readonly transactionAttemptId: TransactionAttemptId
  readonly evidenceAndOutcomeDigest: SubmissionEvidenceAndOutcomeDigest
  readonly conclusivelyRejected: true
}

export interface NegativeReadbackEvidence {
  readonly submissionAttemptId: SubmissionAttemptId
  readonly transactionAttemptId: TransactionAttemptId
  readonly evidenceAndOutcomeDigest: SubmissionEvidenceAndOutcomeDigest
  readonly authoritativeBoundaryProvesNotAccepted: true
  readonly isolatedNotFound: false
}

export type ClosedReadbackResolutionOutcome =
  | { readonly kind: "ACCEPTED_PROVEN"; readonly positiveEvidence: NonEmptyReadonlyArray<PositiveAcceptanceEvidence> }
  | { readonly kind: "REJECTED_CONCLUSIVELY"; readonly rejectionEvidence: NonEmptyReadonlyArray<ConclusiveRejectionEvidence> }
  | { readonly kind: "NOT_ACCEPTED_PROVEN_BY_AUTHORITATIVE_BOUNDARY"; readonly negativeEvidence: NonEmptyReadonlyArray<NegativeReadbackEvidence> }

interface SubmissionAttemptCommonBinding {
  readonly submissionAttemptId: SubmissionAttemptId
  readonly transactionAttemptId: TransactionAttemptId
  readonly executionAttemptId: ExecutionAttemptId
  readonly commandId?: CommandId
  readonly nonceReservationId: NonceReservationId
  readonly signingResourceKey: SigningResourceKey
  readonly nonce: NonceValue
  readonly signedPayloadHash: SignedPayloadHash
  readonly transactionHash?: TransactionHash
  readonly authorizingEffectAuthorizationReference: EffectAuthorizationReference
  readonly chainNetworkIdentity: ChainNetworkIdentity
  readonly gatewayAdapterIdentityOrClass: GatewayAdapterIdentityOrClass
  readonly providerIdentity?: ProviderIdentity
  readonly providerIdempotencyKey?: ProviderIdempotencyKey
  readonly sharedBindingDigest: TransactionSubmissionSharedBindingDigest
  readonly immutableSubmissionBindingDigest: ImmutableSubmissionBindingDigest
  readonly submissionIntentRecordedAt: SubmissionIntentRecordedAt
  readonly causalEventSequence: CausalEventSequence
  readonly revision: SubmissionAttemptRevision
}

export interface DispatchIntentRecordedSubmissionAttempt extends SubmissionAttemptCommonBinding {
  readonly lifecycle: "DISPATCH_INTENT_RECORDED"
  readonly submissionAttemptedAt: null
  readonly observations: readonly []
  readonly evidence: readonly []
  readonly conclusiveOutcome: null
  readonly acceptanceEvidence?: never
  readonly rejectionEvidence?: never
  readonly lookupEvidence?: never
  readonly resolutionOutcome?: never
}

export interface DispatchStartedSubmissionAttempt extends SubmissionAttemptCommonBinding {
  readonly lifecycle: "DISPATCH_STARTED"
  readonly submissionAttemptedAt: SubmissionAttemptedAt
  readonly observations: readonly SubmissionObservation[]
  readonly evidence: readonly SubmissionLookupEvidence[]
  readonly conclusiveOutcome: null
  readonly acceptanceEvidence?: never
  readonly rejectionEvidence?: never
  readonly resolutionOutcome?: never
}

export interface SubmissionAcceptedObservedAttempt extends SubmissionAttemptCommonBinding {
  readonly lifecycle: "SUBMISSION_ACCEPTED_OBSERVED"
  readonly submissionAttemptedAt: SubmissionAttemptedAt
  readonly observations: NonEmptyReadonlyArray<SubmissionObservation>
  readonly evidence: NonEmptyReadonlyArray<SubmissionLookupEvidence>
  readonly acceptanceEvidence: NonEmptyReadonlyArray<PositiveAcceptanceEvidence>
  readonly acceptanceProvenance: NonEmptyReadonlyArray<SubmissionProvenance>
  readonly conclusiveOutcome: "ACCEPTED"
  readonly rejectionEvidence?: never
  readonly resolutionOutcome?: never
}

export interface SubmissionRejectedObservedAttempt extends SubmissionAttemptCommonBinding {
  readonly lifecycle: "SUBMISSION_REJECTED_OBSERVED"
  readonly submissionAttemptedAt: SubmissionAttemptedAt
  readonly observations: NonEmptyReadonlyArray<SubmissionObservation>
  readonly evidence: NonEmptyReadonlyArray<SubmissionLookupEvidence>
  readonly rejectionEvidence: NonEmptyReadonlyArray<ConclusiveRejectionEvidence>
  readonly rejectionProvenance: NonEmptyReadonlyArray<SubmissionProvenance>
  readonly conclusiveOutcome: "REJECTED"
  readonly acceptanceEvidence?: never
  readonly resolutionOutcome?: never
}

export interface SubmissionUnknownAttempt extends SubmissionAttemptCommonBinding {
  readonly lifecycle: "SUBMISSION_UNKNOWN"
  readonly submissionAttemptedAt: SubmissionAttemptedAt
  readonly observations: NonEmptyReadonlyArray<SubmissionObservation>
  readonly evidence: NonEmptyReadonlyArray<SubmissionLookupEvidence>
  readonly lookupEvidence: NonEmptyReadonlyArray<SubmissionLookupEvidence>
  readonly submittedAt: null
  readonly conclusiveOutcome: null
  readonly acceptanceEvidence?: never
  readonly rejectionEvidence?: never
  readonly resolutionOutcome?: never
}

export interface ReadbackResolvedSubmissionAttempt extends SubmissionAttemptCommonBinding {
  readonly lifecycle: "READBACK_RESOLVED"
  readonly submissionAttemptedAt: SubmissionAttemptedAt
  readonly observations: NonEmptyReadonlyArray<SubmissionObservation>
  readonly evidence: NonEmptyReadonlyArray<SubmissionLookupEvidence>
  readonly priorUnknownHistory: NonEmptyReadonlyArray<SubmissionObservation>
  readonly resolutionOutcome: ClosedReadbackResolutionOutcome
  readonly resolutionProvenance: NonEmptyReadonlyArray<SubmissionProvenance>
  readonly conclusiveOutcome: "RESOLVED"
  readonly acceptanceEvidence?: never
  readonly rejectionEvidence?: never
}

export type SubmissionAttemptRecord =
  | DispatchIntentRecordedSubmissionAttempt
  | DispatchStartedSubmissionAttempt
  | SubmissionAcceptedObservedAttempt
  | SubmissionRejectedObservedAttempt
  | SubmissionUnknownAttempt
  | ReadbackResolvedSubmissionAttempt

export type SubmissionAttemptLifecycle = SubmissionAttemptRecord["lifecycle"]

export interface RegisterSubmissionAttemptIntent {
  readonly submissionAttemptId: SubmissionAttemptId
  readonly transactionAttemptId: TransactionAttemptId
  readonly sharedBindingDigest: TransactionSubmissionSharedBindingDigest
  readonly immutableSubmissionBindingDigest: ImmutableSubmissionBindingDigest
  readonly expectedParentRevision: TransactionAttemptRevision
  readonly expectedGuardRevision: TransactionSubmissionDispatchRevision
  readonly mutationProof: ProjectionAwareSubmissionMutationProof
}

export type RegisterSubmissionAttemptResult =
  | { readonly kind: "INTENT_RECORDED"; readonly record: DispatchIntentRecordedSubmissionAttempt }
  | { readonly kind: "EXISTING_INTENT_RETURNED"; readonly record: DispatchIntentRecordedSubmissionAttempt }
  | { readonly kind: "PAYLOAD_CONFLICT"; readonly recordCreated: false }
  | { readonly kind: "PROJECTION_OR_GUARD_STALE"; readonly recordCreated: false }
  | { readonly kind: "GATE_BLOCKED"; readonly recordCreated: false }

export interface AuthoritativeSubmissionChildSetEntry {
  readonly submissionAttemptId: SubmissionAttemptId
  readonly immutableSubmissionBindingDigest: ImmutableSubmissionBindingDigest
  readonly childRevision: SubmissionAttemptRevision
  readonly lifecycle: SubmissionAttemptLifecycle
  readonly causalEventSequence: CausalEventSequence
  readonly evidenceAndOutcomeDigest: SubmissionEvidenceAndOutcomeDigest
}

export type ChildRevisionAndDigestEntry = AuthoritativeSubmissionChildSetEntry;

export interface CompleteSubmissionChildSnapshotProof {
  readonly completeSnapshotProofId: CompleteSubmissionChildSnapshotProofId
  readonly transactionAttemptId: TransactionAttemptId
  readonly expectedParentRevision: TransactionAttemptRevision
  readonly authoritativeIndexScope: SubmissionChildIndexScope
  readonly authoritativeIndexRevision: SubmissionChildIndexRevision
  readonly authoritativeIndexCausalSequence: CausalEventSequence
  readonly sharedBindingDigest: TransactionSubmissionSharedBindingDigest
  readonly authoritativeChildSetDigest: AuthoritativeSubmissionChildSetDigest
  readonly childCount: number
  readonly childEntries: readonly ChildRevisionAndDigestEntry[]
  readonly issuedBy: SubmissionChildIndexAuthorityReference
  readonly completenessProvidedByFutureStorage: true
  readonly completenessGuaranteedByTypes: false
}

export interface ProjectionCommonContext {
  readonly transactionAttemptId: TransactionAttemptId
  readonly expectedParentRevision: TransactionAttemptRevision
  readonly projectionRevision: TransactionSubmissionProjectionRevision
  readonly sharedBindingDigest: TransactionSubmissionSharedBindingDigest
  readonly authoritativeChildSetDigest: AuthoritativeSubmissionChildSetDigest
  readonly completeSnapshotProof: CompleteSubmissionChildSnapshotProof
  readonly childCount: number
  readonly boundChildRevisionsAndDigests: readonly ChildRevisionAndDigestEntry[]
  readonly decisionCausalSequence: CausalEventSequence
  readonly authoritativeEvidenceDigest: AuthoritativeSubmissionEvidenceDigest
}

export interface ProjectionFailureContext {
  readonly transactionAttemptId: TransactionAttemptId
  readonly expectedParentRevision: TransactionAttemptRevision
  readonly expectedProjectionRevision: TransactionSubmissionProjectionRevision
  readonly expectedDispatchGuardRevision: TransactionSubmissionDispatchRevision
  readonly completeSnapshotProof?: never
  readonly committedProjectionProof?: never
  readonly retryAssessment?: never
  readonly gatewayInvocationPermit?: never
}

export type RetryEligibilityAssessment =
  | { readonly kind: "RETRY_NOT_APPLICABLE"; readonly reason: string & Nominal<"RetryNotApplicableReason"> }
  | {
      readonly kind: "RETRY_BLOCKED"
      readonly blockingChildIds: NonEmptyReadonlyArray<SubmissionAttemptId>
      readonly reason: string & Nominal<"RetryBlockedReason">
    }
  | {
      readonly kind: "RETRY_ELIGIBLE_FOR_AUTHORIZATION_EVALUATION"
      readonly sourceProjectionRevision: TransactionSubmissionProjectionRevision
      readonly expectedParentRevision: TransactionAttemptRevision
      readonly expectedDispatchGuardRevision: TransactionSubmissionDispatchRevision
      readonly sharedBindingDigest: TransactionSubmissionSharedBindingDigest
      readonly authoritativeChildSetDigest: AuthoritativeSubmissionChildSetDigest
      readonly boundChildRevisionsAndDigests: readonly ChildRevisionAndDigestEntry[]
      readonly replayCapabilityOrPolicyDigest: ReplayCapabilityOrPolicyDigest
    }

interface CommittedProjectionVariantBase {
  readonly context: ProjectionCommonContext
  readonly committedProjectionProofId: TransactionSubmissionCommittedProjectionProofId
  readonly settlement?: never
  readonly finality?: never
}

export interface NoSubmissionChildrenProjection extends CommittedProjectionVariantBase {
  readonly kind: "NO_SUBMISSION_CHILDREN"
  readonly childCount: 0
  readonly retryAssessment: Extract<RetryEligibilityAssessment, { kind: "RETRY_NOT_APPLICABLE" }>
  readonly attemptedChildIds?: never
  readonly acceptedChildIds?: never
  readonly rejectedChildIds?: never
  readonly unknownChildIds?: never
}

export interface IntentOnlyProjection extends CommittedProjectionVariantBase {
  readonly kind: "INTENT_ONLY"
  readonly intentChildIds: NonEmptyReadonlyArray<SubmissionAttemptId>
  readonly retryAssessment: Extract<RetryEligibilityAssessment, { kind: "RETRY_BLOCKED" }>
  readonly attemptedChildIds?: never
  readonly acceptedChildIds?: never
  readonly outcomeEvidence?: never
}

export interface DispatchInFlightProjection extends CommittedProjectionVariantBase {
  readonly kind: "DISPATCH_IN_FLIGHT"
  readonly inFlightChildIds: NonEmptyReadonlyArray<SubmissionAttemptId>
  readonly retryAssessment: Extract<RetryEligibilityAssessment, { kind: "RETRY_BLOCKED" }>
  readonly acceptedChildIds?: never
  readonly rejectionEvidence?: never
}

export interface SubmissionAcceptedProjection extends CommittedProjectionVariantBase {
  readonly kind: "SUBMISSION_ACCEPTED"
  readonly acceptedChildIds: NonEmptyReadonlyArray<SubmissionAttemptId>
  readonly positiveEvidence: NonEmptyReadonlyArray<PositiveAcceptanceEvidence>
  readonly positiveProvenance: NonEmptyReadonlyArray<SubmissionProvenance>
  readonly retryAssessment: Extract<RetryEligibilityAssessment, { kind: "RETRY_NOT_APPLICABLE" }>
  readonly negativeOnlyConclusion?: never
}

export interface AllConclusivelyRejectedProjection extends CommittedProjectionVariantBase {
  readonly kind: "ALL_CONCLUSIVELY_REJECTED"
  readonly rejectedChildIds: NonEmptyReadonlyArray<SubmissionAttemptId>
  readonly rejectionEvidence: NonEmptyReadonlyArray<ConclusiveRejectionEvidence>
  readonly rejectionProvenance: NonEmptyReadonlyArray<SubmissionProvenance>
  readonly absenceOfAcceptedInFlightOrUnknownProvenBySnapshot: true
  readonly retryAssessment: Extract<RetryEligibilityAssessment, { kind: "RETRY_ELIGIBLE_FOR_AUTHORIZATION_EVALUATION" }>
  readonly acceptedChildIds?: never
  readonly unknownChildIds?: never
  readonly inFlightChildIds?: never
}

export interface SubmissionUnresolvedUnknownProjection extends CommittedProjectionVariantBase {
  readonly kind: "SUBMISSION_UNRESOLVED_UNKNOWN"
  readonly unknownChildIds: NonEmptyReadonlyArray<SubmissionAttemptId>
  readonly lookupEvidence: NonEmptyReadonlyArray<SubmissionLookupEvidence>
  readonly retryAssessment: Extract<RetryEligibilityAssessment, { kind: "RETRY_BLOCKED" }>
  readonly acceptedChildIds?: never
}

export interface NegativeReadbackResolvedProjection extends CommittedProjectionVariantBase {
  readonly kind: "NEGATIVE_READBACK_RESOLVED"
  readonly resolvedChildIds: NonEmptyReadonlyArray<SubmissionAttemptId>
  readonly negativeEvidence: NonEmptyReadonlyArray<NegativeReadbackEvidence | ConclusiveRejectionEvidence>
  readonly negativeProvenance: NonEmptyReadonlyArray<SubmissionProvenance>
  readonly absenceOfAcceptedInFlightOrUnknownProvenBySnapshot: true
  readonly retryAssessment: Extract<RetryEligibilityAssessment, { kind: "RETRY_ELIGIBLE_FOR_AUTHORIZATION_EVALUATION" }>
  readonly acceptedChildIds?: never
  readonly openUnknownChildIds?: never
}

export interface ReceiptOutcomeObservedProjection extends CommittedProjectionVariantBase {
  readonly kind: "RECEIPT_OUTCOME_OBSERVED"
  readonly receiptEvidence: NonEmptyReadonlyArray<ReceiptObservationEvidence>
  readonly receiptProvenance: NonEmptyReadonlyArray<SubmissionProvenance>
  readonly materializedPositiveSubmissionEvidence: NonEmptyReadonlyArray<PositiveAcceptanceEvidence>
  readonly outcome: "CONFIRMED" | "REVERTED"
  readonly retryAssessment: Extract<RetryEligibilityAssessment, { kind: "RETRY_NOT_APPLICABLE" }>
}

export interface LateObservationOnTerminalParentProjection extends CommittedProjectionVariantBase {
  readonly kind: "LATE_OBSERVATION_ON_TERMINAL_PARENT"
  readonly terminalParentEvidenceDigest: SubmissionEvidenceAndOutcomeDigest
  readonly lateObservationChildIds: NonEmptyReadonlyArray<SubmissionAttemptId>
  readonly lateObservationEvidence: NonEmptyReadonlyArray<SubmissionObservation>
  readonly recoveryDirective: string & Nominal<"LateObservationRecoveryDirective">
  readonly retryAssessment: Extract<RetryEligibilityAssessment, { kind: "RETRY_NOT_APPLICABLE" }>
  readonly parentReactivation?: never
}

export interface IncompleteSnapshotProjectionFailure {
  readonly kind: "INCOMPLETE_SNAPSHOT_FAIL_CLOSED"
  readonly failure: ProjectionFailureContext
  readonly incompleteScope: SubmissionChildIndexScope
  readonly reason: string & Nominal<"IncompleteSnapshotReason">
}

export interface BindingConflictProjectionFailure {
  readonly kind: "BINDING_CONFLICT_REQUIRES_RECOVERY"
  readonly failure: ProjectionFailureContext
  readonly conflictingChildIds: NonEmptyReadonlyArray<SubmissionAttemptId>
  readonly conflictingDigests: NonEmptyReadonlyArray<ImmutableSubmissionBindingDigest>
}

export interface IncompatiblePositiveEvidenceProjectionFailure {
  readonly kind: "INCOMPATIBLE_POSITIVE_EVIDENCE_REQUIRES_RECOVERY"
  readonly failure: ProjectionFailureContext
  readonly incompatibleAcceptedChildIds: NonEmptyReadonlyArray<SubmissionAttemptId>
  readonly incompatibleEvidence: NonEmptyReadonlyArray<PositiveAcceptanceEvidence>
}

export interface StaleProjectionFailure {
  readonly kind: "STALE_PROJECTION_REQUIRES_REREAD"
  readonly failure: ProjectionFailureContext
  readonly staleDimensions: NonEmptyReadonlyArray<
    "PARENT_REVISION" | "CHILD_SET_DIGEST" | "CHILD_REVISION" | "PROJECTION_REVISION" | "DISPATCH_GUARD_REVISION"
  >
}

export type TransactionSubmissionProjectionResult =
  | NoSubmissionChildrenProjection
  | IntentOnlyProjection
  | DispatchInFlightProjection
  | SubmissionAcceptedProjection
  | AllConclusivelyRejectedProjection
  | SubmissionUnresolvedUnknownProjection
  | NegativeReadbackResolvedProjection
  | ReceiptOutcomeObservedProjection
  | LateObservationOnTerminalParentProjection
  | IncompleteSnapshotProjectionFailure
  | BindingConflictProjectionFailure
  | IncompatiblePositiveEvidenceProjectionFailure
  | StaleProjectionFailure

export interface TransactionSubmissionProjectionRequest {
  readonly projectionRequestId: TransactionSubmissionProjectionRequestId
  readonly transactionAttemptId: TransactionAttemptId
  readonly expectedParentRevision: TransactionAttemptRevision
  readonly expectedProjectionRevision: TransactionSubmissionProjectionRevision
  readonly expectedDispatchGuardRevision: TransactionSubmissionDispatchRevision
  readonly completeSnapshotProof: CompleteSubmissionChildSnapshotProof
  readonly sharedBindingDigest: TransactionSubmissionSharedBindingDigest
  readonly authoritativeChildSetDigest: AuthoritativeSubmissionChildSetDigest
}

export interface TransactionSubmissionPreparedProjectionProof {
  readonly preparedProjectionProofId: TransactionSubmissionPreparedProjectionProofId
  readonly context: ProjectionCommonContext
  readonly authenticatedChildBindings: readonly ChildRevisionAndDigestEntry[]
  readonly expectedDispatchGuardRevision: TransactionSubmissionDispatchRevision
  readonly preparedDecision: Exclude<
    TransactionSubmissionProjectionResult,
    | IncompleteSnapshotProjectionFailure
    | BindingConflictProjectionFailure
    | IncompatiblePositiveEvidenceProjectionFailure
    | StaleProjectionFailure
  >["kind"]
  readonly economicEffectAuthorized: false
}

export type ProjectionPreparationResult =
  | { readonly kind: "PROJECTION_PREPARED"; readonly proof: TransactionSubmissionPreparedProjectionProof }
  | IncompleteSnapshotProjectionFailure
  | BindingConflictProjectionFailure
  | IncompatiblePositiveEvidenceProjectionFailure
  | StaleProjectionFailure

export type ProjectionCommitResult =
  | {
      readonly kind: "PROJECTION_COMMITTED"
      readonly committedProjectionRevision: TransactionSubmissionProjectionRevision
      readonly result: Exclude<TransactionSubmissionProjectionResult, { readonly failure: ProjectionFailureContext }>
      readonly committedProofId: TransactionSubmissionCommittedProjectionProofId
    }
  | {
      readonly kind: "IDEMPOTENT_COMMITTED_PROJECTION_RETURNED"
      readonly result: Exclude<TransactionSubmissionProjectionResult, { readonly failure: ProjectionFailureContext }>
      readonly committedProofId: TransactionSubmissionCommittedProjectionProofId
    }
  | StaleProjectionFailure
  | { readonly kind: "CONCURRENT_PROJECTION_CONFLICT"; readonly failure: ProjectionFailureContext }
  | { readonly kind: "INCOMPLETE_OR_BINDING_CONFLICT"; readonly failure: ProjectionFailureContext }

interface DispatchGuardBase {
  readonly dispatchGuardId: TransactionSubmissionDispatchGuardId
  readonly transactionAttemptId: TransactionAttemptId
  readonly dispatchRevision: TransactionSubmissionDispatchRevision
  readonly sharedBindingDigest: TransactionSubmissionSharedBindingDigest
  readonly authoritativeChildSetDigest: AuthoritativeSubmissionChildSetDigest
  readonly parentRevision: TransactionAttemptRevision
  readonly projectionRevision: TransactionSubmissionProjectionRevision
  readonly causalEventSequence: CausalEventSequence
}

export interface AvailableDispatchGuard extends DispatchGuardBase {
  readonly state: "AVAILABLE"
  readonly activeSubmissionAttemptId: null
}

export interface IntentReservedDispatchGuard extends DispatchGuardBase {
  readonly state: "INTENT_RESERVED"
  readonly activeSubmissionAttemptId: SubmissionAttemptId
}

export interface DispatchActiveGuard extends DispatchGuardBase {
  readonly state: "DISPATCH_ACTIVE"
  readonly activeSubmissionAttemptId: SubmissionAttemptId
  readonly gatewayInvocationPermit: SingleUseGatewayInvocationPermit
}

export interface UnknownBlockedDispatchGuard extends DispatchGuardBase {
  readonly state: "UNKNOWN_BLOCKED"
  readonly activeSubmissionAttemptId: SubmissionAttemptId
  readonly gatewayInvocationPermit?: never
}

export interface AcceptedTerminalDispatchGuard extends DispatchGuardBase {
  readonly state: "ACCEPTED_TERMINAL"
  readonly activeSubmissionAttemptId: SubmissionAttemptId
  readonly gatewayInvocationPermit?: never
}

export interface TerminalParentBlockedDispatchGuard extends DispatchGuardBase {
  readonly state: "TERMINAL_PARENT_BLOCKED"
  readonly activeSubmissionAttemptId: SubmissionAttemptId | null
  readonly gatewayInvocationPermit?: never
}

export type TransactionSubmissionDispatchGuard =
  | AvailableDispatchGuard
  | IntentReservedDispatchGuard
  | DispatchActiveGuard
  | UnknownBlockedDispatchGuard
  | AcceptedTerminalDispatchGuard
  | TerminalParentBlockedDispatchGuard

export interface SubmissionDispatchAtomicityContract {
  readonly scope: "TRANSACTION_ATTEMPT"
  readonly maxConcurrentDispatchStarted: 1
  readonly multiProviderSimultaneousFanoutEnabledByDefault: false
  readonly crossIdDispatchExclusionMustBeAtomic: true
  readonly duplicateAnyIdLogicalDispatchStartsMayBothSucceed: false
  readonly childOnlyCasIsSufficient: false
  readonly futureStorageContract: true
  readonly notATypeLevelGuarantee: true
}

export interface ProjectionAwareSubmissionMutationProof {
  readonly proofKind: "PROJECTION_AWARE_SUBMISSION_MUTATION_PROOF"
  readonly transactionAttemptId: TransactionAttemptId
  readonly expectedParentRevision: TransactionAttemptRevision
  readonly currentProjectionRevision: TransactionSubmissionProjectionRevision
  readonly currentCommittedProjectionProofId: TransactionSubmissionCommittedProjectionProofId
  readonly completeSnapshotProof: CompleteSubmissionChildSnapshotProof
  readonly authoritativeChildSetDigest: AuthoritativeSubmissionChildSetDigest
  readonly expectedDispatchGuardRevision: TransactionSubmissionDispatchRevision
  readonly operationalAuthority: OperationalAuthorityProof
  readonly activeEconomicEpoch: ActiveEconomicEpochProof
  readonly ownership: OwnershipProof
  readonly processingFencingPrecondition: ExistingFencingPrecondition
  readonly signingResourceAuthority: SigningResourceAuthorityProof
  readonly signingResourceFence: SigningResourceFence
  readonly effectAuthorizationReference: EffectAuthorizationReference
  readonly immutableBoundsDigest: ImmutableSubmissionBoundsDigest
  readonly economicEffectAuthorized: false
}

export interface BeginSubmissionProof {
  readonly proofKind: "BEGIN_SUBMISSION_PROOF"
  readonly submissionAttemptId: SubmissionAttemptId
  readonly immutableSubmissionBindingDigest: ImmutableSubmissionBindingDigest
  readonly expectedSubmissionAttemptRevision: SubmissionAttemptRevision
  readonly expectedTransactionAttemptRevision: TransactionAttemptRevision
  readonly expectedNonceReservationRevision: NonceReservationRevision
  readonly expectedDispatchGuardRevision: TransactionSubmissionDispatchRevision
  readonly mutationProof: ProjectionAwareSubmissionMutationProof
  readonly economicEffectAuthorized: false
}

export interface MarkDispatchStartedRequest {
  readonly submissionAttemptId: SubmissionAttemptId
  readonly expectedSubmissionAttemptRevision: SubmissionAttemptRevision
  readonly expectedCausalEventSequence: CausalEventSequence
  readonly beginSubmissionProof: BeginSubmissionProof
  readonly retryAuthorizationId?: SubmissionRetryAuthorizationId
}

export interface ProjectionAwareReplacementProof {
  readonly proofKind: "PROJECTION_AWARE_REPLACEMENT_PROOF"
  readonly replacementProof: CreateReplacementProof
  readonly submissionMutationProof: ProjectionAwareSubmissionMutationProof
  readonly inFlightOrUnknownChildrenAdjudicated: true
  readonly economicEffectAuthorized: false
}

export interface ResolveSubmissionUnknownRequest {
  readonly submissionAttemptId: SubmissionAttemptId
  readonly expectedSubmissionAttemptRevision: SubmissionAttemptRevision
  readonly expectedCausalEventSequence: CausalEventSequence
  readonly lookupEvidence: NonEmptyReadonlyArray<SubmissionLookupEvidence>
  readonly mutationProof: ProjectionAwareSubmissionMutationProof
}

export type ResolveSubmissionUnknownResult =
  | { readonly kind: "READBACK_RESOLVED"; readonly record: ReadbackResolvedSubmissionAttempt }
  | { readonly kind: "IDEMPOTENT_RESOLUTION_RETURNED"; readonly record: ReadbackResolvedSubmissionAttempt }
  | { readonly kind: "READBACK_INCONCLUSIVE"; readonly recordChanged: false }
  | { readonly kind: "STALE_OR_CONFLICT"; readonly recordChanged: false }
  | { readonly kind: "BINDING_MISMATCH"; readonly recordChanged: false }

export interface RecordSubmissionObservationRequest {
  readonly submissionAttemptId: SubmissionAttemptId
  readonly expectedSubmissionAttemptRevision: SubmissionAttemptRevision
  readonly observation: SubmissionObservation
  readonly provenance: SubmissionProvenance
  readonly mutationProof: ProjectionAwareSubmissionMutationProof
}

export type RecordSubmissionObservationResult =
  | { readonly kind: "OBSERVATION_RECORDED"; readonly record: SubmissionAttemptRecord }
  | { readonly kind: "EXISTING_OBSERVATION_RETURNED"; readonly record: SubmissionAttemptRecord }
  | { readonly kind: "EVIDENCE_CONFLICT"; readonly recordChanged: false }
  | { readonly kind: "STALE_OR_BINDING_MISMATCH"; readonly recordChanged: false }

export type DispatchGuardAcquireStartResult =
  | {
      readonly kind: "START_COMMITTED"
      readonly guard: DispatchActiveGuard
      readonly singleUseGatewayInvocationPermit: SingleUseGatewayInvocationPermit
    }
  | {
      readonly kind: "IDEMPOTENT_ALREADY_STARTED"
      readonly guard: DispatchActiveGuard
      readonly samePermitReference: SingleUseGatewayInvocationPermit
      readonly newPermit?: never
    }
  | { readonly kind: "DISPATCH_GUARD_BUSY_OR_STALE"; readonly startCommitted: false }
  | { readonly kind: "UNKNOWN_BLOCKED"; readonly startCommitted: false }
  | { readonly kind: "ACCEPTED_TERMINAL"; readonly startCommitted: false }
  | { readonly kind: "TERMINAL_PARENT_BLOCKED"; readonly startCommitted: false }
  | { readonly kind: "BINDING_OR_CHILD_SET_CONFLICT"; readonly startCommitted: false }
  | { readonly kind: "AUTHORITY_OR_FENCE_INVALID"; readonly startCommitted: false }
  | { readonly kind: "RETRY_AUTHORIZATION_REQUIRED_OR_INVALID"; readonly startCommitted: false }

interface SubmissionRetryAuthorizationBase {
  readonly retryAuthorizationId: SubmissionRetryAuthorizationId
  readonly transactionAttemptId: TransactionAttemptId
  readonly authorizationRevision: SubmissionRetryAuthorizationRevision
  readonly sourceProjectionRevision: TransactionSubmissionProjectionRevision
  readonly expectedParentRevision: TransactionAttemptRevision
  readonly expectedDispatchGuardRevision: TransactionSubmissionDispatchRevision
  readonly sharedBindingDigest: TransactionSubmissionSharedBindingDigest
  readonly authoritativeChildSetDigest: AuthoritativeSubmissionChildSetDigest
  readonly boundChildRevisionsAndDigests: readonly ChildRevisionAndDigestEntry[]
  readonly boundCausalSequences: readonly CausalEventSequence[]
  readonly replayCapabilityOrPolicyDigest: ReplayCapabilityOrPolicyDigest
  readonly operationalAuthority: OperationalAuthorityProof
  readonly activeEconomicEpoch: ActiveEconomicEpochProof
  readonly ownership: OwnershipProof
  readonly processingFencingPrecondition: ExistingFencingPrecondition
  readonly signingResourceAuthority: SigningResourceAuthorityProof
  readonly effectAuthorizationReference: EffectAuthorizationReference
  readonly immutableBoundsDigest: ImmutableSubmissionBoundsDigest
  readonly gatewayInvocationPermit?: never
  readonly economicEffectAuthorized: false
}

export interface IssuedSubmissionRetryAuthorization extends SubmissionRetryAuthorizationBase {
  readonly status: "ISSUED"
  readonly predecessorAuthorizationRevision: null
  readonly consumedByRequestId?: never
  readonly invalidationReason?: never
}

export interface ConsumedSubmissionRetryAuthorization extends SubmissionRetryAuthorizationBase {
  readonly status: "CONSUMED"
  readonly predecessorAuthorizationRevision: SubmissionRetryAuthorizationRevision
  readonly issuedSnapshot: IssuedSubmissionRetryAuthorization
  readonly consumedByRequestId: SubmissionRetryConsumptionRequestId
  readonly createdSubmissionAttemptId: SubmissionAttemptId
  readonly invalidationReason?: never
}

export type SubmissionRetryInvalidationReason =
  | "PARENT_ADVANCED"
  | "CHILD_ADVANCED"
  | "CHILD_SET_CHANGED"
  | "PROJECTION_ADVANCED"
  | "DISPATCH_GUARD_ADVANCED"
  | "AUTHORITY_INVALID"
  | "ECONOMIC_EPOCH_CHANGED"
  | "OWNERSHIP_OR_FENCE_CHANGED"
  | "SIGNING_RESOURCE_FENCE_CHANGED"
  | "POLICY_OR_CAPABILITY_CHANGED"
  | "BOUNDS_CHANGED"

export interface InvalidatedSubmissionRetryAuthorization extends SubmissionRetryAuthorizationBase {
  readonly status: "INVALIDATED"
  readonly predecessorAuthorizationRevision: SubmissionRetryAuthorizationRevision
  readonly issuedSnapshot: IssuedSubmissionRetryAuthorization
  readonly invalidationReason: SubmissionRetryInvalidationReason
  readonly consumedByRequestId?: never
  readonly createdSubmissionAttemptId?: never
}

export type SubmissionRetryAuthorization =
  | IssuedSubmissionRetryAuthorization
  | ConsumedSubmissionRetryAuthorization
  | InvalidatedSubmissionRetryAuthorization

export interface SubmissionRetryConsumptionRequest {
  readonly submissionRetryConsumptionRequestId: SubmissionRetryConsumptionRequestId
  readonly retryAuthorizationId: SubmissionRetryAuthorizationId
  readonly transactionAttemptId: TransactionAttemptId
  readonly requestDigest: SubmissionRetryConsumptionRequestDigest
  readonly proposedSubmissionAttemptId: SubmissionAttemptId
  readonly immutableSubmissionBindingDigest: ImmutableSubmissionBindingDigest
  readonly expectedAuthorizationRevision: SubmissionRetryAuthorizationRevision
  readonly expectedGuardRevision: TransactionSubmissionDispatchRevision
  readonly mutationProof: ProjectionAwareSubmissionMutationProof
}

export interface RetryAuthorizationEmissionRequest {
  readonly transactionAttemptId: TransactionAttemptId
  readonly eligibleAssessment: Extract<
    RetryEligibilityAssessment,
    { kind: "RETRY_ELIGIBLE_FOR_AUTHORIZATION_EVALUATION" }
  >
  readonly mutationProof: ProjectionAwareSubmissionMutationProof
}

export type RetryAuthorizationEmissionResult =
  | { readonly kind: "RETRY_AUTHORIZATION_ISSUED"; readonly authorization: IssuedSubmissionRetryAuthorization }
  | { readonly kind: "RETRY_NOT_ELIGIBLE"; readonly assessment: Exclude<RetryEligibilityAssessment, { kind: "RETRY_ELIGIBLE_FOR_AUTHORIZATION_EVALUATION" }> }
  | { readonly kind: "STALE_ASSESSMENT"; readonly authorizationIssued: false }
  | { readonly kind: "AUTHORITY_OR_POLICY_INVALID"; readonly authorizationIssued: false }
  | { readonly kind: "CONFLICT_REQUIRES_REREAD"; readonly authorizationIssued: false }

export type RetryAuthorizationConsumptionResult =
  | {
      readonly kind: "CONSUMED_AND_INTENT_CREATED"
      readonly authorization: ConsumedSubmissionRetryAuthorization
      readonly submissionAttemptRecord: DispatchIntentRecordedSubmissionAttempt
      readonly guard: IntentReservedDispatchGuard
      readonly gatewayInvocationPermit?: never
    }
  | {
      readonly kind: "IDEMPOTENT_EXISTING_INTENT_RETURNED"
      readonly authorization: ConsumedSubmissionRetryAuthorization
      readonly submissionAttemptRecord: DispatchIntentRecordedSubmissionAttempt
      readonly guard: IntentReservedDispatchGuard
      readonly gatewayInvocationPermit?: never
    }
  | { readonly kind: "ALREADY_CONSUMED_BY_DIFFERENT_REQUEST"; readonly intentCreated: false }
  | { readonly kind: "AUTHORIZATION_INVALIDATED"; readonly intentCreated: false }
  | { readonly kind: "STALE_RETRY_AUTHORIZATION"; readonly intentCreated: false }
  | { readonly kind: "PAYLOAD_CONFLICT"; readonly intentCreated: false }

export interface RetryConsumptionDirectGuardTransitionContract {
  readonly from: "DISPATCH_ACTIVE_ADJUDICATED_REJECTED" | "UNKNOWN_BLOCKED_ADJUDICATED_NEGATIVE"
  readonly to: "INTENT_RESERVED"
  readonly observableAvailableIntermediateState: false
  readonly retryAuthorizationRequired: true
  readonly consumptionAndIntentReservationMustBeAtomic: true
  readonly futureStorageContract: true
  readonly notATypeLevelGuarantee: true
}
