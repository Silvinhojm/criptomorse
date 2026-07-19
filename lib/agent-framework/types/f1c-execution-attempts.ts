import type {
  AuthorizationEvaluationId,
  CommandId,
  OperationNamespace,
  PayloadDigest,
  PolicyVersion,
} from "./f1a-foundation"
import type {
  ActiveEconomicEpochProof,
  EconomicEpoch,
  ExistingFencingPrecondition,
  OperationalAuthorityProof,
  OwnershipProof,
} from "./f1b-operational-control"

/** RI-L2 F1c type-only contracts. No runtime or economic capability. */
type Nominal<Name extends string> = { readonly __f1cExecutionNominal: Name }
export type NonEmptyReadonlyArray<Value> = readonly [Value, ...Value[]]

export type EffectInstanceKey = string & Nominal<"EffectInstanceKey">
export type EffectAuthorizationId = string & Nominal<"EffectAuthorizationId">
export type EffectAuthorizationVersion = string & Nominal<"EffectAuthorizationVersion">
export type AttemptCreationRequestId = string & Nominal<"AttemptCreationRequestId">
export type AttemptCreationRequestDigest = string & Nominal<"AttemptCreationRequestDigest">
export type ExecutionAttemptId = string & Nominal<"ExecutionAttemptId">
export type AttemptNumber = number & Nominal<"AttemptNumber">
export type TransactionAttemptId = string & Nominal<"TransactionAttemptId">
export type TransactionAttemptRevision = string & Nominal<"TransactionAttemptRevision">
export type TechnicalRetryOrdinal = number & Nominal<"TechnicalRetryOrdinal">
export type NonceReservationId = string & Nominal<"NonceReservationId">
export type NonceReservationRevision = string & Nominal<"NonceReservationRevision">
export type NonceValue = number & Nominal<"NonceValue">
export type ChainId = string & Nominal<"ChainId">
export type SignerAddress = string & Nominal<"SignerAddress">
export type SigningResourceKey = readonly [chainId: ChainId, signerAddress: SignerAddress] &
  Nominal<"SigningResourceKey">
export type SigningResourceRevision = string & Nominal<"SigningResourceRevision">
export type SigningResourceFence = string & Nominal<"SigningResourceFence">
export type ReplacementLineageId = string & Nominal<"ReplacementLineageId">
export type SignedPayloadHash = string & Nominal<"SignedPayloadHash">
export type TransactionHash = string & Nominal<"TransactionHash">
export type ImmutableExecutionEconomicCeilingDigest = string &
  Nominal<"ImmutableExecutionEconomicCeilingDigest">
export type EconomicBoundsDigest = string & Nominal<"EconomicBoundsDigest">
export type CanonicalParametersDigest = PayloadDigest & Nominal<"CanonicalParametersDigest">
export type MaximumEconomicBoundsDigest = string & Nominal<"MaximumEconomicBoundsDigest">
export type CausalEventId = string & Nominal<"CausalEventId">
export type CausalEventSequence = string & Nominal<"CausalEventSequence">
export type SubmissionEvidenceId = string & Nominal<"SubmissionEvidenceId">
export type ReceiptEvidenceId = string & Nominal<"ReceiptEvidenceId">
export type DropEvidenceId = string & Nominal<"DropEvidenceId">
export type ConflictEvidenceId = string & Nominal<"ConflictEvidenceId">
export type CancellationEvidenceId = string & Nominal<"CancellationEvidenceId">
export type SigningEvidenceId = string & Nominal<"SigningEvidenceId">
export type IssuanceEvidenceId = string & Nominal<"IssuanceEvidenceId">
export type ExternalNonceObservationId = string & Nominal<"ExternalNonceObservationId">
export type ExternalNonceConflictEvidenceId = string & Nominal<"ExternalNonceConflictEvidenceId">
export type AttemptCreatedAt = string & Nominal<"AttemptCreatedAt">
export type EffectAuthorizationIssuedAt = string & Nominal<"EffectAuthorizationIssuedAt">
export type SubmissionAttemptedAt = string & Nominal<"SubmissionAttemptedAt">
export type SubmissionOutcomeObservedAt = string & Nominal<"SubmissionOutcomeObservedAt">
export type ProvenSubmissionTimestamp = string & Nominal<"ProvenSubmissionTimestamp">
export type ConfirmedAt = string & Nominal<"ConfirmedAt">
export type ObservedAt = string & Nominal<"ObservedAt">
export type ReplacementCommittedAt = string & Nominal<"ReplacementCommittedAt">

export interface EffectAuthorizationReference {
  readonly effectAuthorizationId: EffectAuthorizationId
  readonly effectAuthorizationVersion: EffectAuthorizationVersion
}

export interface AllowedEffect {
  readonly operationNamespace: OperationNamespace
  readonly action: string & Nominal<"AllowedEffectAction">
  readonly canonicalParametersDigest: CanonicalParametersDigest
}

export interface EffectAuthorizationValidityExpiresAt {
  readonly kind: "EXPIRES_AT"
  readonly expiresAt: string & Nominal<"EffectAuthorizationExpiresAt">
}

export interface EffectAuthorizationValidityNoExpiration {
  readonly kind: "NO_EXPIRATION"
  readonly expiresAt?: never
}

export type EffectAuthorizationValidity =
  | EffectAuthorizationValidityExpiresAt
  | EffectAuthorizationValidityNoExpiration

interface EffectAuthorizationBase {
  readonly effectAuthorizationId: EffectAuthorizationId
  readonly effectAuthorizationVersion: EffectAuthorizationVersion
  readonly commandId: CommandId
  readonly authorizationEvaluationId: AuthorizationEvaluationId
  readonly executionAttemptId: ExecutionAttemptId
  readonly effectInstanceKey: EffectInstanceKey
  readonly allowedEffect: AllowedEffect
  readonly maximumEconomicBoundsDigest: MaximumEconomicBoundsDigest
  readonly policyVersion: PolicyVersion
  readonly economicEpoch: EconomicEpoch
  readonly validity: EffectAuthorizationValidity
  readonly issuedAt: EffectAuthorizationIssuedAt
  readonly issuanceEvidenceId: IssuanceEvidenceId
}

export type EffectAuthorizationState = "CURRENT" | "REVOKED" | "SUPERSEDED" | "EXPIRED"

export type EffectAuthorization = {
  readonly [State in EffectAuthorizationState]: EffectAuthorizationBase & {
    readonly state: State
  }
}[EffectAuthorizationState]

export type AttemptReason = "INITIAL" | "RETRY_PRE_EFFECT" | "RECOVERY_DIRECTED_NEW_ATTEMPT"

export interface AttemptCreationRequest {
  readonly attemptCreationRequestId: AttemptCreationRequestId
  readonly commandId: CommandId
  readonly effectInstanceKey: EffectInstanceKey
  readonly authorizationEvaluationId: AuthorizationEvaluationId
  readonly requestDigest: AttemptCreationRequestDigest
  readonly allowedEffect: AllowedEffect
  readonly maximumEconomicBoundsDigest: MaximumEconomicBoundsDigest
  readonly policyVersion: PolicyVersion
  readonly economicEpoch: EconomicEpoch
  readonly validity: EffectAuthorizationValidity
  readonly proposedExecutionAttemptId?: ExecutionAttemptId
  readonly proposedEffectAuthorizationId?: EffectAuthorizationId
}

export interface AttemptPairProof {
  readonly proofKind: "ATTEMPT_PAIR_PROOF"
  readonly attemptCreationRequestId: AttemptCreationRequestId
  readonly requestDigest: AttemptCreationRequestDigest
  readonly effectAuthorizationReference: EffectAuthorizationReference
  readonly executionAttemptId: ExecutionAttemptId
  readonly economicEffectAuthorized: false
}

export type AttemptCreationResult =
  | { readonly kind: "ATTEMPT_PAIR_CREATED"; readonly proof: AttemptPairProof }
  | { readonly kind: "EXISTING_ATTEMPT_PAIR_RETURNED"; readonly proof: AttemptPairProof }
  | { readonly kind: "PAYLOAD_CONFLICT"; readonly pairCreated: false }
  | { readonly kind: "ACTIVE_EFFECT_CONFLICT"; readonly pairCreated: false }
  | { readonly kind: "AUTHORIZATION_STALE"; readonly pairCreated: false }
  | { readonly kind: "AUTHORITY_NOT_OPERATIONAL"; readonly pairCreated: false }
  | {
      readonly kind: "OUTCOME_UNKNOWN_REQUIRES_READBACK"
      readonly pairCreated: false
      readonly mutatingActionAllowed: false
      readonly blindRetryAllowed: false
      readonly authoritativeReadbackRequired: true
    }

export type F1cConstructibleExecutionAttemptState =
  | "CREATED"
  | "PREPARING"
  | "AWAITING_NONCE"
  | "TRANSACTION_ACTIVE"
  | "SETTLEMENT_PENDING"
  | "FAILED_PRE_EFFECT"
  | "FAILED_POST_EFFECT_UNKNOWN"
  | "CANCELLED_PRE_EFFECT"
  | "SUPERSEDED"

export type ReservedFutureF1dExecutionAttemptState =
  | "SETTLED"
  | "RECONCILIATION_PENDING"
  | "RECONCILED"

interface ExecutionAttemptBase {
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
}

interface PreTransactionExecutionAttempt extends ExecutionAttemptBase {
  readonly transactionAttemptIds: readonly []
  readonly nonceReservationId: null
}

interface ActiveTransactionExecutionAttempt extends ExecutionAttemptBase {
  readonly transactionAttemptIds: NonEmptyReadonlyArray<TransactionAttemptId>
  readonly nonceReservationId: NonceReservationId
}

export type ExecutionAttempt =
  | (PreTransactionExecutionAttempt & { readonly state: "CREATED" | "PREPARING" | "AWAITING_NONCE" })
  | (ActiveTransactionExecutionAttempt & { readonly state: "TRANSACTION_ACTIVE" | "SETTLEMENT_PENDING" })
  | (PreTransactionExecutionAttempt & { readonly state: "FAILED_PRE_EFFECT" | "CANCELLED_PRE_EFFECT" | "SUPERSEDED" })
  | (ActiveTransactionExecutionAttempt & { readonly state: "FAILED_POST_EFFECT_UNKNOWN" })

export interface SigningResourceAuthorityProof {
  readonly proofKind: "SIGNING_RESOURCE_AUTHORITY_PROOF"
  readonly signingResourceKey: SigningResourceKey
  readonly signingResourceRevision: SigningResourceRevision
  readonly signingResourceFence: SigningResourceFence
  readonly operationalAuthority: OperationalAuthorityProof
  readonly activeEconomicEpoch: ActiveEconomicEpochProof
  readonly runtimeValidationProvided: false
  readonly economicEffectAuthorized: false
}

export type NonceReservationProtectionState =
  | "RESERVED_PROTECTED"
  | "SIGNED_PROTECTED"
  | "SUBMISSION_UNKNOWN_PROTECTED"
  | "SUBMITTED_PROTECTED"
  | "RECEIPT_OBSERVED_PROTECTED"
  | "DROPPED_PROVEN_PROTECTED"
  | "ABANDONED_BLOCKED"
  | "CONFLICTED"

interface NonceReservationBase {
  readonly nonceReservationId: NonceReservationId
  readonly revision: NonceReservationRevision
  readonly signingResourceKey: SigningResourceKey
  readonly nonce: NonceValue
  readonly executionAttemptId: ExecutionAttemptId
  readonly replacementLineageId: ReplacementLineageId
  readonly currentHeadTransactionAttemptId: TransactionAttemptId
}

export interface ReservedProtectedNonceReservation extends NonceReservationBase {
  readonly state: "RESERVED_PROTECTED"
  readonly signedPayloadHash: null
  readonly submissionEvidence?: never
  readonly receiptEvidence?: never
}

export interface SignedProtectedNonceReservation extends NonceReservationBase {
  readonly state: "SIGNED_PROTECTED"
  readonly signedPayloadHash: SignedPayloadHash
  readonly submissionEvidence?: never
  readonly receiptEvidence?: never
}

export interface SubmissionUnknownProtectedNonceReservation extends NonceReservationBase {
  readonly state: "SUBMISSION_UNKNOWN_PROTECTED"
  readonly signedPayloadHash: SignedPayloadHash
  readonly unknownEvidence: NonEmptyReadonlyArray<TransactionSubmissionUnknownEvidence>
  readonly receiptEvidence?: never
}

export interface SubmittedProtectedNonceReservation extends NonceReservationBase {
  readonly state: "SUBMITTED_PROTECTED"
  readonly signedPayloadHash: SignedPayloadHash
  readonly submissionEvidence: NonEmptyReadonlyArray<PositiveSubmissionEvidence>
  readonly receiptEvidence?: never
}

export interface ReceiptObservedProtectedNonceReservation extends NonceReservationBase {
  readonly state: "RECEIPT_OBSERVED_PROTECTED"
  readonly signedPayloadHash: SignedPayloadHash
  readonly submissionEvidence: NonEmptyReadonlyArray<PositiveSubmissionEvidence>
  readonly receiptEvidence: NonEmptyReadonlyArray<ReceiptObservationEvidence>
}

export interface DroppedProvenProtectedNonceReservation extends NonceReservationBase {
  readonly state: "DROPPED_PROVEN_PROTECTED"
  readonly signedPayloadHash: SignedPayloadHash
  readonly dropEvidenceIds: NonEmptyReadonlyArray<DropEvidenceId>
  readonly receiptEvidence?: never
}

export interface AbandonedBlockedNonceReservation extends NonceReservationBase {
  readonly state: "ABANDONED_BLOCKED"
  readonly adjudicationEvidenceId: DropEvidenceId | ConflictEvidenceId
  readonly nonceProtected: true
}

export interface ConflictedNonceReservation extends NonceReservationBase {
  readonly state: "CONFLICTED"
  readonly conflictEvidenceId: ConflictEvidenceId | ExternalNonceConflictEvidenceId
  readonly recoveryRequired: true
}

export type NonceReservation =
  | ReservedProtectedNonceReservation
  | SignedProtectedNonceReservation
  | SubmissionUnknownProtectedNonceReservation
  | SubmittedProtectedNonceReservation
  | ReceiptObservedProtectedNonceReservation
  | DroppedProvenProtectedNonceReservation
  | AbandonedBlockedNonceReservation
  | ConflictedNonceReservation

export interface NonceReservationAtomicityContract {
  readonly mustBeAtomic: true
  readonly uniquenessScope: "SIGNING_RESOURCE_KEY_AND_NONCE"
  readonly duplicateConcurrentReservationsMayBothSucceed: false
  readonly futureStorageContract: true
  readonly notATypeLevelGuarantee: true
  readonly f1cImplementsStorage: false
}

export interface AuthorizedLineagePositionRoot {
  readonly kind: "ROOT"
  readonly replacementLineageId?: never
  readonly replacesTransactionAttemptId?: never
}

export interface AuthorizedLineagePositionReplacement {
  readonly kind: "REPLACEMENT"
  readonly replacementLineageId: ReplacementLineageId
  readonly replacesTransactionAttemptId: TransactionAttemptId
}

export type AuthorizedLineagePosition =
  | AuthorizedLineagePositionRoot
  | AuthorizedLineagePositionReplacement

interface TransactionAttemptIdentity {
  readonly transactionAttemptId: TransactionAttemptId
  readonly transactionAttemptRevision: TransactionAttemptRevision
  readonly executionAttemptId: ExecutionAttemptId
  readonly technicalRetryOrdinal: TechnicalRetryOrdinal
  readonly authorizingEffectAuthorizationReference: EffectAuthorizationReference
  readonly immutableExecutionEconomicCeilingDigest: ImmutableExecutionEconomicCeilingDigest
  readonly causalEventId: CausalEventId
  readonly causalEventSequence: CausalEventSequence
  readonly lineagePosition: AuthorizedLineagePosition
}

interface ReservationContext {
  readonly nonceReservationId: NonceReservationId
  readonly signingResourceKey: SigningResourceKey
  readonly nonce: NonceValue
  readonly replacementLineageId: ReplacementLineageId
}

interface SignedContext extends ReservationContext {
  readonly signedPayloadHash: SignedPayloadHash
  readonly signingEvidenceId: SigningEvidenceId
  readonly transactionHashEvidence: readonly TransactionHashEvidence[]
}

export interface TransactionHashEvidence {
  readonly transactionHash: TransactionHash
  readonly provenance: "CALCULATED_FROM_SIGNED_PAYLOAD" | "RPC_RESPONSE" | "RECEIPT" | "NONCE_DISCOVERY"
  readonly observedAt: ObservedAt
  readonly evidenceId: SubmissionEvidenceId
}

export interface PositiveSubmissionEvidence {
  readonly submissionEvidenceId: SubmissionEvidenceId
  readonly transactionAttemptId: TransactionAttemptId
  readonly transactionHash: TransactionHash
  readonly observedAt: SubmissionOutcomeObservedAt
  readonly provenance: "GATEWAY_ACCEPTANCE" | "CHAIN_DISCOVERY" | "RECEIPT_MATERIALIZATION"
}

export interface TransactionSubmissionUnknownEvidence {
  readonly evidenceId: SubmissionEvidenceId
  readonly transactionAttemptId: TransactionAttemptId
  readonly nonceReservationId: NonceReservationId
  readonly signedPayloadHash: SignedPayloadHash
  readonly observedAt: SubmissionOutcomeObservedAt
  readonly authoritativeReadbackRequired: true
}

export interface ReceiptObservationEvidence {
  readonly receiptEvidenceId: ReceiptEvidenceId
  readonly transactionAttemptId: TransactionAttemptId
  readonly transactionHash: TransactionHash
  readonly confirmedAt: ConfirmedAt
  readonly outcome: "CONFIRMED" | "REVERTED"
  readonly settlementProven: false
  readonly finalityProven: false
}

export interface PlannedRootTransactionAttempt extends TransactionAttemptIdentity {
  readonly state: "PLANNED"
  readonly lineagePosition: AuthorizedLineagePositionRoot
  readonly nonceReservationId: null
  readonly signingResourceKey: null
  readonly nonce: null
  readonly signedPayloadHash: null
  readonly submissionAttemptedAt: null
  readonly submittedAt: null
}

export interface PlannedReplacementTransactionAttempt extends TransactionAttemptIdentity, ReservationContext {
  readonly state: "PLANNED"
  readonly lineagePosition: AuthorizedLineagePositionReplacement
  readonly signedPayloadHash: null
  readonly submissionAttemptedAt: null
  readonly submittedAt: null
  readonly replacementAuthorizationProof: CreateReplacementProof
}

export interface NonceReservedTransactionAttempt extends TransactionAttemptIdentity, ReservationContext {
  readonly state: "NONCE_RESERVED"
  readonly signedPayloadHash: null
  readonly submissionAttemptedAt: null
  readonly submittedAt: null
}

export interface SignedTransactionAttempt extends TransactionAttemptIdentity, SignedContext {
  readonly state: "SIGNED"
  readonly submissionAttemptedAt: null
  readonly submissionOutcomeObservedAt: null
  readonly submittedAt: null
  readonly confirmedAt?: never
}

export interface SubmissionUnknownTransactionAttempt extends TransactionAttemptIdentity, SignedContext {
  readonly state: "SUBMISSION_UNKNOWN"
  readonly submissionAttemptedAt: SubmissionAttemptedAt
  readonly submissionOutcomeObservedAt: SubmissionOutcomeObservedAt
  readonly unknownEvidence: NonEmptyReadonlyArray<TransactionSubmissionUnknownEvidence>
  readonly submittedAt: null
  readonly confirmedAt?: never
}

export interface SubmittedTransactionAttempt extends TransactionAttemptIdentity, SignedContext {
  readonly state: "SUBMITTED"
  readonly submissionAttemptedAt: SubmissionAttemptedAt
  readonly submissionOutcomeObservedAt: SubmissionOutcomeObservedAt
  readonly positiveSubmissionEvidence: NonEmptyReadonlyArray<PositiveSubmissionEvidence>
  readonly submittedAt: ProvenSubmissionTimestamp
  readonly confirmedAt: null
}

export interface ConfirmedTransactionAttempt extends TransactionAttemptIdentity, SignedContext {
  readonly state: "CONFIRMED"
  readonly submissionAttemptedAt: SubmissionAttemptedAt
  readonly submissionOutcomeObservedAt: SubmissionOutcomeObservedAt
  readonly positiveSubmissionEvidence: NonEmptyReadonlyArray<PositiveSubmissionEvidence>
  readonly submittedAt: ProvenSubmissionTimestamp
  readonly confirmedAt: ConfirmedAt
  readonly receiptEvidence: NonEmptyReadonlyArray<ReceiptObservationEvidence & { readonly outcome: "CONFIRMED" }>
  readonly settlement?: never
  readonly finality?: never
}

export interface RevertedTransactionAttempt extends TransactionAttemptIdentity, SignedContext {
  readonly state: "REVERTED"
  readonly submissionAttemptedAt: SubmissionAttemptedAt
  readonly submissionOutcomeObservedAt: SubmissionOutcomeObservedAt
  readonly positiveSubmissionEvidence: NonEmptyReadonlyArray<PositiveSubmissionEvidence>
  readonly submittedAt: ProvenSubmissionTimestamp
  readonly confirmedAt: ConfirmedAt
  readonly receiptEvidence: NonEmptyReadonlyArray<ReceiptObservationEvidence & { readonly outcome: "REVERTED" }>
  readonly settlement?: never
  readonly finality?: never
}

export interface DroppedProvenTransactionAttempt extends TransactionAttemptIdentity, SignedContext {
  readonly state: "DROPPED_PROVEN"
  readonly submissionAttemptedAt: SubmissionAttemptedAt
  readonly submissionOutcomeObservedAt: SubmissionOutcomeObservedAt
  readonly submittedAt: ProvenSubmissionTimestamp | null
  readonly dropEvidenceIds: NonEmptyReadonlyArray<DropEvidenceId>
  readonly confirmedAt?: never
}

export interface ReplacedTransactionAttempt extends TransactionAttemptIdentity, SignedContext {
  readonly state: "REPLACED"
  readonly successorTransactionAttemptId: TransactionAttemptId
  readonly replacementCommittedAt: ReplacementCommittedAt
  readonly preservedHistoricalTransactionHashes: readonly TransactionHashEvidence[]
  readonly submissionAttemptedAt: SubmissionAttemptedAt | null
  readonly submittedAt: ProvenSubmissionTimestamp | null
  readonly terminal: true
}

export interface CancelledBeforeSigningTransactionAttempt extends TransactionAttemptIdentity {
  readonly state: "CANCELLED_BEFORE_SIGNING"
  readonly nonceReservationId: NonceReservationId | null
  readonly signingResourceKey: SigningResourceKey | null
  readonly nonce: NonceValue | null
  readonly signedPayloadHash?: never
  readonly submissionAttemptedAt?: never
  readonly submittedAt?: never
  readonly cancellationEvidenceId: CancellationEvidenceId
  readonly terminal: true
}

export type TransactionAttempt =
  | PlannedRootTransactionAttempt
  | PlannedReplacementTransactionAttempt
  | NonceReservedTransactionAttempt
  | SignedTransactionAttempt
  | SubmissionUnknownTransactionAttempt
  | SubmittedTransactionAttempt
  | ConfirmedTransactionAttempt
  | DroppedProvenTransactionAttempt
  | ReplacedTransactionAttempt
  | RevertedTransactionAttempt
  | CancelledBeforeSigningTransactionAttempt

export interface ExternalNonceUsageObservation {
  readonly observationId: ExternalNonceObservationId
  readonly signingResourceKey: SigningResourceKey
  readonly nonce: NonceValue
  readonly observedTransactionHash: TransactionHash
  readonly observedAt: ObservedAt
  readonly provenance: string & Nominal<"ExternalNonceObservationProvenance">
  readonly relatedReservation:
    | { readonly kind: "RELATED"; readonly nonceReservationId: NonceReservationId }
    | { readonly kind: "UNRESOLVED"; readonly nonceReservationId?: never }
  readonly classification: "UNAUTHORIZED_EXTERNAL_USE" | "UNKNOWN_ORIGIN" | "MANUAL_OPERATION"
  readonly transactionAttemptId?: never
}

export interface ExternalNonceConflictEvidence {
  readonly externalNonceConflictEvidenceId: ExternalNonceConflictEvidenceId
  readonly observationId: ExternalNonceObservationId
  readonly nonceReservationId: NonceReservationId
  readonly recoveryRequired: true
}

interface MutatingProofContext {
  readonly operationalAuthority: OperationalAuthorityProof
  readonly activeEconomicEpoch: ActiveEconomicEpochProof
  readonly ownership: OwnershipProof
  readonly processingFencingPrecondition: ExistingFencingPrecondition
  readonly signingResourceAuthority: SigningResourceAuthorityProof
  readonly effectAuthorizationReference: EffectAuthorizationReference
  readonly economicEffectAuthorized: false
}

export interface CreateExecutionAttemptProof extends MutatingProofContext {
  readonly proofKind: "CREATE_EXECUTION_ATTEMPT_PROOF"
  readonly attemptCreationRequestId: AttemptCreationRequestId
}

export interface ReserveNonceProof extends MutatingProofContext {
  readonly proofKind: "RESERVE_NONCE_PROOF"
  readonly executionAttemptId: ExecutionAttemptId
  readonly expectedNonceReservationRevision: NonceReservationRevision
}

export interface RecordSigningIntentProof extends MutatingProofContext {
  readonly proofKind: "RECORD_SIGNING_INTENT_PROOF"
  readonly transactionAttemptId: TransactionAttemptId
  readonly nonceReservationId: NonceReservationId
}

export interface CreateReplacementProof extends MutatingProofContext {
  readonly proofKind: "CREATE_REPLACEMENT_PROOF"
  readonly predecessorTransactionAttemptId: TransactionAttemptId
  readonly expectedHeadTransactionAttemptId: TransactionAttemptId
  readonly nonceReservationId: NonceReservationId
  readonly replacementLineageId: ReplacementLineageId
  readonly replacementWithinImmutableCeiling: true
}

export interface ReadOnlyObservationProof {
  readonly proofKind: "READ_ONLY_OBSERVATION_PROOF"
  readonly transactionAttemptId: TransactionAttemptId
  readonly nonceReservationId: NonceReservationId
  readonly evidenceId: SubmissionEvidenceId | ReceiptEvidenceId | DropEvidenceId
  readonly mayCreateEffect: false
  readonly economicEffectAuthorized: false
}

export interface ReplacementAtomicityContract {
  readonly successorCreationMustBeAtomic: true
  readonly lineageBranchingAllowed: false
  readonly predecessorMayHaveAtMostOneSuccessor: true
  readonly futureStorageContract: true
  readonly notATypeLevelGuarantee: true
  readonly f1cImplementsStorage: false
}
