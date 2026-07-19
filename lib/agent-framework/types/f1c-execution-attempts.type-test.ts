import type { CommandId } from "./f1a-foundation"
import type { FencingToken, OperationalAuthorityRevision } from "./f1b-operational-control"
import type {
  AttemptCreationRequestId,
  AttemptCreationResult,
  AttemptNumber,
  AttemptReason,
  CancelledBeforeSigningTransactionAttempt,
  ConfirmedTransactionAttempt,
  CreateReplacementProof,
  EffectAuthorization,
  EffectAuthorizationId,
  EffectAuthorizationReference,
  EffectAuthorizationState,
  EffectAuthorizationVersion,
  ExecutionAttempt,
  ExecutionAttemptId,
  ExternalNonceUsageObservation,
  F1cConstructibleExecutionAttemptState,
  ImmutableExecutionEconomicCeilingDigest,
  NonceReservation,
  NonceReservationAtomicityContract,
  NonceReservationId,
  NonceReservationProtectionState,
  NonceReservationRevision,
  NonceValue,
  PlannedReplacementTransactionAttempt,
  PositiveSubmissionEvidence,
  ReadOnlyObservationProof,
  ReplacementAtomicityContract,
  ReplacementLineageId,
  ReservedFutureF1dExecutionAttemptState,
  RevertedTransactionAttempt,
  SignedPayloadHash,
  SignedTransactionAttempt,
  SigningResourceFence,
  SigningResourceKey,
  SigningResourceRevision,
  SubmissionUnknownTransactionAttempt,
  SubmittedTransactionAttempt,
  TechnicalRetryOrdinal,
  TransactionAttempt,
  TransactionAttemptId,
  TransactionAttemptRevision,
  TransactionHash,
} from "./f1c-execution-attempts"

type Assert<Condition extends true> = Condition
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false
type IsAssignable<From, To> = [From] extends [To] ? true : false
type Not<Value extends boolean> = Value extends true ? false : true
type HasRequiredKey<Shape, Key extends keyof Shape> =
  Equal<Pick<Shape, Key>, Required<Pick<Shape, Key>>>

type _AttemptReasonClosed = Assert<Equal<
  AttemptReason,
  "INITIAL" | "RETRY_PRE_EFFECT" | "RECOVERY_DIRECTED_NEW_ATTEMPT"
>>
type _AuthorizationStatesClosed = Assert<Equal<
  EffectAuthorizationState,
  "CURRENT" | "REVOKED" | "SUPERSEDED" | "EXPIRED"
>>
type _ExecutionStatesClosed = Assert<Equal<
  ExecutionAttempt["state"],
  F1cConstructibleExecutionAttemptState
>>
type _F1dStatesClosed = Assert<Equal<
  ReservedFutureF1dExecutionAttemptState,
  "SETTLED" | "RECONCILIATION_PENDING" | "RECONCILED"
>>
type _F1dNotConstructible = Assert<Not<IsAssignable<
  ReservedFutureF1dExecutionAttemptState,
  ExecutionAttempt["state"]
>>>

type _AuthorizationIdNotVersion = Assert<Not<IsAssignable<EffectAuthorizationId, EffectAuthorizationVersion>>>
type _AuthorizationVersionNotId = Assert<Not<IsAssignable<EffectAuthorizationVersion, EffectAuthorizationId>>>
type _AuthorizationVersionNotF1bRevision = Assert<Not<IsAssignable<
  EffectAuthorizationVersion,
  OperationalAuthorityRevision
>>>
type _F1bRevisionNotAuthorizationVersion = Assert<Not<IsAssignable<
  OperationalAuthorityRevision,
  EffectAuthorizationVersion
>>>
type _ExecutionIdNotTransactionId = Assert<Not<IsAssignable<ExecutionAttemptId, TransactionAttemptId>>>
type _TransactionIdNotExecutionId = Assert<Not<IsAssignable<TransactionAttemptId, ExecutionAttemptId>>>
type _RequestIdNotExecutionId = Assert<Not<IsAssignable<AttemptCreationRequestId, ExecutionAttemptId>>>
type _AttemptNumberNotNonce = Assert<Not<IsAssignable<AttemptNumber, NonceValue>>>
type _NonceNotAttemptNumber = Assert<Not<IsAssignable<NonceValue, AttemptNumber>>>
type _TechnicalRetryNotAttemptNumber = Assert<Not<IsAssignable<TechnicalRetryOrdinal, AttemptNumber>>>
type _ReservationIdNotRevision = Assert<Not<IsAssignable<NonceReservationId, NonceReservationRevision>>>
type _SigningRevisionNotFence = Assert<Not<IsAssignable<SigningResourceRevision, SigningResourceFence>>>
type _SigningFenceNotProcessingFence = Assert<Not<IsAssignable<SigningResourceFence, FencingToken>>>
type _LineageNotReservation = Assert<Not<IsAssignable<ReplacementLineageId, NonceReservationId>>>
type _PayloadHashNotTransactionHash = Assert<Not<IsAssignable<SignedPayloadHash, TransactionHash>>>
type _ParentRevisionNotChildId = Assert<Not<IsAssignable<TransactionAttemptRevision, TransactionAttemptId>>>

type _AuthorizationReferenceExact = Assert<Equal<
  keyof EffectAuthorizationReference,
  "effectAuthorizationId" | "effectAuthorizationVersion"
>>
type _AuthorizationBindsExecution = Assert<HasRequiredKey<EffectAuthorization, "executionAttemptId">>
type _AuthorizationBindsEffect = Assert<HasRequiredKey<EffectAuthorization, "effectInstanceKey">>
type _ExecutionInitialReferenceRequired = Assert<HasRequiredKey<ExecutionAttempt, "initialEffectAuthorizationReference">>
type _EconomicCeilingRequired = Assert<Equal<
  ExecutionAttempt["immutableExecutionEconomicCeilingDigest"],
  ImmutableExecutionEconomicCeilingDigest
>>

type _NonceProtectionStatesClosed = Assert<Equal<
  NonceReservationProtectionState,
  | "RESERVED_PROTECTED"
  | "SIGNED_PROTECTED"
  | "SUBMISSION_UNKNOWN_PROTECTED"
  | "SUBMITTED_PROTECTED"
  | "RECEIPT_OBSERVED_PROTECTED"
  | "DROPPED_PROVEN_PROTECTED"
  | "ABANDONED_BLOCKED"
  | "CONFLICTED"
>>
type _NonceReservationNeverReplaced = Assert<Not<IsAssignable<"REPLACED", NonceReservation["state"]>>>
type _CurrentHeadRequired = Assert<HasRequiredKey<NonceReservation, "currentHeadTransactionAttemptId">>
type _NonceAtomic = Assert<Equal<NonceReservationAtomicityContract["mustBeAtomic"], true>>
type _NonceAtomicityNotTypeGuarantee = Assert<Equal<
  NonceReservationAtomicityContract["notATypeLevelGuarantee"],
  true
>>

type _TransactionStatesClosed = Assert<Equal<
  TransactionAttempt["state"],
  | "PLANNED"
  | "NONCE_RESERVED"
  | "SIGNED"
  | "SUBMISSION_UNKNOWN"
  | "SUBMITTED"
  | "CONFIRMED"
  | "DROPPED_PROVEN"
  | "REPLACED"
  | "REVERTED"
  | "CANCELLED_BEFORE_SIGNING"
>>
type _RootAndReplacementAreDistinct = Assert<Not<IsAssignable<
  PlannedReplacementTransactionAttempt,
  Extract<TransactionAttempt, { lineagePosition: { kind: "ROOT" } }>
>>>
type _SignedAttemptedAtNull = Assert<Equal<SignedTransactionAttempt["submissionAttemptedAt"], null>>
type _UnknownRequiresEvidence = Assert<HasRequiredKey<SubmissionUnknownTransactionAttempt, "unknownEvidence">>
type _UnknownSubmittedAtNull = Assert<Equal<SubmissionUnknownTransactionAttempt["submittedAt"], null>>
type _SubmittedRequiresPositiveEvidence = Assert<HasRequiredKey<
  SubmittedTransactionAttempt,
  "positiveSubmissionEvidence"
>>
type _SubmittedPositiveEvidenceNonEmpty = Assert<IsAssignable<
  SubmittedTransactionAttempt["positiveSubmissionEvidence"],
  readonly [PositiveSubmissionEvidence, ...PositiveSubmissionEvidence[]]
>>
type _ConfirmedRequiresReceipt = Assert<HasRequiredKey<ConfirmedTransactionAttempt, "receiptEvidence">>
type _RevertedRequiresReceipt = Assert<HasRequiredKey<RevertedTransactionAttempt, "receiptEvidence">>
type _ConfirmedHasNoSettlement = Assert<Equal<ConfirmedTransactionAttempt["settlement"], undefined>>
type _RevertedHasNoFinality = Assert<Equal<RevertedTransactionAttempt["finality"], undefined>>
type _CancelledHasNoSignedPayload = Assert<Equal<
  CancelledBeforeSigningTransactionAttempt["signedPayloadHash"],
  undefined
>>

type _ExternalObservationNotTransactionAttempt = Assert<Not<IsAssignable<
  ExternalNonceUsageObservation,
  TransactionAttempt
>>>
type _ExternalObservationHasNoAuthorizedTransactionId = Assert<Equal<
  ExternalNonceUsageObservation["transactionAttemptId"],
  undefined
>>
type _SigningResourceHasNoSecretKeys = Assert<Not<
  "privateKey" extends keyof SigningResourceKey ? true : false
>>
type _ReplacementProofCannotExecute = Assert<Equal<CreateReplacementProof["economicEffectAuthorized"], false>>
type _ObservationCannotCreateEffect = Assert<Equal<ReadOnlyObservationProof["mayCreateEffect"], false>>
type _LineageLinear = Assert<Equal<ReplacementAtomicityContract["lineageBranchingAllowed"], false>>
type _LineageStorageFuture = Assert<Equal<ReplacementAtomicityContract["futureStorageContract"], true>>

type _AttemptCreationKinds = Assert<Equal<
  AttemptCreationResult["kind"],
  | "ATTEMPT_PAIR_CREATED"
  | "EXISTING_ATTEMPT_PAIR_RETURNED"
  | "PAYLOAD_CONFLICT"
  | "ACTIVE_EFFECT_CONFLICT"
  | "AUTHORIZATION_STALE"
  | "AUTHORITY_NOT_OPERATIONAL"
  | "OUTCOME_UNKNOWN_REQUIRES_READBACK"
>>
type _UnknownCreationHasNoProof = Assert<Not<
  "proof" extends keyof Extract<AttemptCreationResult, { kind: "OUTCOME_UNKNOWN_REQUIRES_READBACK" }>
    ? true
    : false
>>
type _CommandIdNotExecutionId = Assert<Not<IsAssignable<CommandId, ExecutionAttemptId>>>

export type F1cExecutionAttemptsTypeTests =
  | _AttemptReasonClosed
  | _AuthorizationStatesClosed
  | _ExecutionStatesClosed
  | _F1dNotConstructible
  | _AuthorizationIdNotVersion
  | _AuthorizationVersionNotF1bRevision
  | _ExecutionIdNotTransactionId
  | _AttemptNumberNotNonce
  | _SigningRevisionNotFence
  | _SigningFenceNotProcessingFence
  | _NonceReservationNeverReplaced
  | _TransactionStatesClosed
  | _UnknownRequiresEvidence
  | _SubmittedRequiresPositiveEvidence
  | _ConfirmedRequiresReceipt
  | _RevertedRequiresReceipt
  | _ExternalObservationNotTransactionAttempt
  | _ReplacementProofCannotExecute
  | _AttemptCreationKinds
