import type {
  NonceValue,
  SignedPayloadHash,
  SubmissionAttemptedAt,
  TransactionAttemptId,
  TransactionAttemptRevision,
  TransactionHash,
} from "./f1c-execution-attempts"
import type {
  AcceptedTerminalDispatchGuard,
  AllConclusivelyRejectedProjection,
  AuthoritativeSubmissionChildSetDigest,
  AvailableDispatchGuard,
  BeginSubmissionProof,
  BindingConflictProjectionFailure,
  ChildRevisionAndDigestEntry,
  CompleteSubmissionChildSnapshotProof,
  ConsumedSubmissionRetryAuthorization,
  DispatchActiveGuard,
  DispatchGuardAcquireStartResult,
  DispatchInFlightProjection,
  DispatchIntentRecordedSubmissionAttempt,
  DispatchStartedSubmissionAttempt,
  GatewayAdapterIdentityOrClass,
  ImmutableSubmissionBindingDigest,
  ImmutableSubmissionBindingInput,
  IncompleteSnapshotProjectionFailure,
  IntentOnlyProjection,
  IntentReservedDispatchGuard,
  InvalidatedSubmissionRetryAuthorization,
  IssuedSubmissionRetryAuthorization,
  NegativeReadbackResolvedProjection,
  NoSubmissionChildrenProjection,
  ProjectionAwareSubmissionMutationProof,
  ProjectionAwareReplacementProof,
  ProjectionCommitResult,
  ProjectionPreparationResult,
  ProviderIdempotencyKey,
  ReadbackResolvedSubmissionAttempt,
  ReceiptOutcomeObservedProjection,
  RegisterSubmissionAttemptIntent,
  RetryAuthorizationConsumptionResult,
  RetryAuthorizationEmissionResult,
  RetryConsumptionDirectGuardTransitionContract,
  RetryEligibilityAssessment,
  SingleUseGatewayInvocationPermit,
  SubmissionAcceptedObservedAttempt,
  SubmissionAcceptedProjection,
  SubmissionAttemptId,
  SubmissionAttemptLifecycle,
  SubmissionAttemptRecord,
  SubmissionAttemptRevision,
  SubmissionChildSetSchemaVersion,
  SubmissionDispatchAtomicityContract,
  SubmissionLookupEvidence,
  SubmissionRejectedObservedAttempt,
  SubmissionRetryAuthorization,
  SubmissionRetryAuthorizationId,
  SubmissionRetryConsumptionRequestId,
  SubmissionUnknownAttempt,
  SubmissionUnresolvedUnknownProjection,
  TerminalParentBlockedDispatchGuard,
  TransactionSubmissionDispatchGuard,
  TransactionSubmissionDispatchRevision,
  TransactionSubmissionProjectionResult,
  TransactionSubmissionProjectionRevision,
  TransactionSubmissionSharedBindingInput,
  TransactionSubmissionSharedBindingDigest,
  UnknownBlockedDispatchGuard,
} from "./f1c-submission-projection"

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

type _SubmissionIdNotTransactionId = Assert<Not<IsAssignable<SubmissionAttemptId, TransactionAttemptId>>>
type _TransactionIdNotSubmissionId = Assert<Not<IsAssignable<TransactionAttemptId, SubmissionAttemptId>>>
type _SubmissionIdNotHash = Assert<Not<IsAssignable<SubmissionAttemptId, TransactionHash>>>
type _SubmissionIdNotProviderKey = Assert<Not<IsAssignable<SubmissionAttemptId, ProviderIdempotencyKey>>>
type _GatewayNotSubmissionId = Assert<Not<IsAssignable<GatewayAdapterIdentityOrClass, SubmissionAttemptId>>>
type _ChildRevisionNotParentRevision = Assert<Not<IsAssignable<SubmissionAttemptRevision, TransactionAttemptRevision>>>
type _ProjectionRevisionNotParentRevision = Assert<Not<IsAssignable<
  TransactionSubmissionProjectionRevision,
  TransactionAttemptRevision
>>>
type _DispatchRevisionNotProjectionRevision = Assert<Not<IsAssignable<
  TransactionSubmissionDispatchRevision,
  TransactionSubmissionProjectionRevision
>>>
type _SharedNotPerChildDigest = Assert<Not<IsAssignable<
  TransactionSubmissionSharedBindingDigest,
  ImmutableSubmissionBindingDigest
>>>
type _PerChildNotSharedDigest = Assert<Not<IsAssignable<
  ImmutableSubmissionBindingDigest,
  TransactionSubmissionSharedBindingDigest
>>>
type _SharedNotChildSetDigest = Assert<Not<IsAssignable<
  TransactionSubmissionSharedBindingDigest,
  AuthoritativeSubmissionChildSetDigest
>>>
type _ChildSetNotPerChildDigest = Assert<Not<IsAssignable<
  AuthoritativeSubmissionChildSetDigest,
  ImmutableSubmissionBindingDigest
>>>
type _SharedInputExcludesGateway = Assert<Not<
  "gatewayAdapterIdentityOrClass" extends keyof TransactionSubmissionSharedBindingInput ? true : false
>>
type _PerChildInputRequiresGateway = Assert<HasRequiredKey<
  ImmutableSubmissionBindingInput,
  "gatewayAdapterIdentityOrClass"
>>
type _PerChildInputCarriesSharedPayload = Assert<HasRequiredKey<
  ImmutableSubmissionBindingInput,
  "signedPayloadHash"
>>
type _RetryAuthorizationIdNotPermit = Assert<Not<IsAssignable<
  SubmissionRetryAuthorizationId,
  SingleUseGatewayInvocationPermit
>>>
type _RetryConsumptionIdNotAuthorizationId = Assert<Not<IsAssignable<
  SubmissionRetryConsumptionRequestId,
  SubmissionRetryAuthorizationId
>>>

type _LifecycleClosed = Assert<Equal<
  SubmissionAttemptLifecycle,
  | "DISPATCH_INTENT_RECORDED"
  | "DISPATCH_STARTED"
  | "SUBMISSION_ACCEPTED_OBSERVED"
  | "SUBMISSION_REJECTED_OBSERVED"
  | "SUBMISSION_UNKNOWN"
  | "READBACK_RESOLVED"
>>
type _RecordLifecycleClosed = Assert<Equal<SubmissionAttemptRecord["lifecycle"], SubmissionAttemptLifecycle>>
type _IntentAttemptedAtNull = Assert<Equal<
  DispatchIntentRecordedSubmissionAttempt["submissionAttemptedAt"],
  null
>>
type _StartAttemptedAtRequired = Assert<Equal<
  DispatchStartedSubmissionAttempt["submissionAttemptedAt"],
  SubmissionAttemptedAt
>>
type _AcceptedRequiresPositiveEvidence = Assert<HasRequiredKey<
  SubmissionAcceptedObservedAttempt,
  "acceptanceEvidence"
>>
type _RejectedRequiresEvidence = Assert<HasRequiredKey<
  SubmissionRejectedObservedAttempt,
  "rejectionEvidence"
>>
type _UnknownRequiresLookup = Assert<HasRequiredKey<SubmissionUnknownAttempt, "lookupEvidence">>
type _UnknownSubmittedAtNull = Assert<Equal<SubmissionUnknownAttempt["submittedAt"], null>>
type _ReadbackRequiresOutcome = Assert<HasRequiredKey<ReadbackResolvedSubmissionAttempt, "resolutionOutcome">>
type _IntentHasNoAcceptance = Assert<Equal<
  DispatchIntentRecordedSubmissionAttempt["acceptanceEvidence"],
  undefined
>>
type _UnknownLookupNonEmpty = Assert<IsAssignable<
  SubmissionUnknownAttempt["lookupEvidence"],
  readonly [SubmissionLookupEvidence, ...SubmissionLookupEvidence[]]
>>

type _ProjectionKindsClosed = Assert<Equal<
  TransactionSubmissionProjectionResult["kind"],
  | "NO_SUBMISSION_CHILDREN"
  | "INTENT_ONLY"
  | "DISPATCH_IN_FLIGHT"
  | "SUBMISSION_ACCEPTED"
  | "ALL_CONCLUSIVELY_REJECTED"
  | "SUBMISSION_UNRESOLVED_UNKNOWN"
  | "NEGATIVE_READBACK_RESOLVED"
  | "RECEIPT_OUTCOME_OBSERVED"
  | "LATE_OBSERVATION_ON_TERMINAL_PARENT"
  | "INCOMPLETE_SNAPSHOT_FAIL_CLOSED"
  | "BINDING_CONFLICT_REQUIRES_RECOVERY"
  | "INCOMPATIBLE_POSITIVE_EVIDENCE_REQUIRES_RECOVERY"
  | "STALE_PROJECTION_REQUIRES_REREAD"
>>
type _ExactlyThirteenProjectionKinds = Assert<Equal<
  TransactionSubmissionProjectionResult["kind"] extends infer Kind
    ? Kind extends string
      ? Kind
      : never
    : never,
  TransactionSubmissionProjectionResult["kind"]
>>
type _NoChildrenCountZero = Assert<Equal<NoSubmissionChildrenProjection["childCount"], 0>>
type _IntentOnlyHasNoAttemptedChildren = Assert<Equal<IntentOnlyProjection["attemptedChildIds"], undefined>>
type _InFlightBlocksRetry = Assert<Equal<
  DispatchInFlightProjection["retryAssessment"]["kind"],
  "RETRY_BLOCKED"
>>
type _AcceptedRequiresEvidence = Assert<HasRequiredKey<SubmissionAcceptedProjection, "positiveEvidence">>
type _AcceptedEvidenceNonEmpty = Assert<IsAssignable<
  SubmissionAcceptedProjection["positiveEvidence"],
  readonly [SubmissionAcceptedProjection["positiveEvidence"][number], ...SubmissionAcceptedProjection["positiveEvidence"][number][]]
>>
type _AllRejectedRequiresAbsenceProof = Assert<Equal<
  AllConclusivelyRejectedProjection["absenceOfAcceptedInFlightOrUnknownProvenBySnapshot"],
  true
>>
type _AllRejectedHasNoAccepted = Assert<Equal<AllConclusivelyRejectedProjection["acceptedChildIds"], undefined>>
type _UnknownProjectionBlocksRetry = Assert<Equal<
  SubmissionUnresolvedUnknownProjection["retryAssessment"]["kind"],
  "RETRY_BLOCKED"
>>
type _NegativeReadbackCanOnlyAssess = Assert<Equal<
  NegativeReadbackResolvedProjection["retryAssessment"]["kind"],
  "RETRY_ELIGIBLE_FOR_AUTHORIZATION_EVALUATION"
>>
type _ReceiptRequiresEvidence = Assert<HasRequiredKey<ReceiptOutcomeObservedProjection, "receiptEvidence">>
type _ReceiptHasNoSettlement = Assert<Equal<ReceiptOutcomeObservedProjection["settlement"], undefined>>
type _FailureHasNoCompleteSnapshot = Assert<Equal<
  IncompleteSnapshotProjectionFailure["failure"]["completeSnapshotProof"],
  undefined
>>
type _FailureHasNoRetryAssessment = Assert<Equal<
  BindingConflictProjectionFailure["failure"]["retryAssessment"],
  undefined
>>
type _FailureHasNoPermit = Assert<Equal<
  BindingConflictProjectionFailure["failure"]["gatewayInvocationPermit"],
  undefined
>>

type _SnapshotChildEntriesReadonly = Assert<IsAssignable<
  CompleteSubmissionChildSnapshotProof["childEntries"],
  readonly ChildRevisionAndDigestEntry[]
>>
type _SnapshotCompletenessNotTypeGuarantee = Assert<Equal<
  CompleteSubmissionChildSnapshotProof["completenessGuaranteedByTypes"],
  false
>>
type _OldSingularDigestAbsent = Assert<Not<
  "immutableBindingDigest" extends keyof CompleteSubmissionChildSnapshotProof ? true : false
>>
type _SchemaVersionNotDigest = Assert<Not<IsAssignable<
  SubmissionChildSetSchemaVersion,
  AuthoritativeSubmissionChildSetDigest
>>>

type _PreparationKindsClosed = Assert<Equal<
  ProjectionPreparationResult["kind"],
  | "PROJECTION_PREPARED"
  | "INCOMPLETE_SNAPSHOT_FAIL_CLOSED"
  | "BINDING_CONFLICT_REQUIRES_RECOVERY"
  | "INCOMPATIBLE_POSITIVE_EVIDENCE_REQUIRES_RECOVERY"
  | "STALE_PROJECTION_REQUIRES_REREAD"
>>
type _CommitKindsClosed = Assert<Equal<
  ProjectionCommitResult["kind"],
  | "PROJECTION_COMMITTED"
  | "IDEMPOTENT_COMMITTED_PROJECTION_RETURNED"
  | "STALE_PROJECTION_REQUIRES_REREAD"
  | "CONCURRENT_PROJECTION_CONFLICT"
  | "INCOMPLETE_OR_BINDING_CONFLICT"
>>

type _GuardStatesClosed = Assert<Equal<
  TransactionSubmissionDispatchGuard["state"],
  | "AVAILABLE"
  | "INTENT_RESERVED"
  | "DISPATCH_ACTIVE"
  | "UNKNOWN_BLOCKED"
  | "ACCEPTED_TERMINAL"
  | "TERMINAL_PARENT_BLOCKED"
>>
type _AvailableHasNullActiveId = Assert<Equal<AvailableDispatchGuard["activeSubmissionAttemptId"], null>>
type _ReservedHasActiveId = Assert<Equal<IntentReservedDispatchGuard["activeSubmissionAttemptId"], SubmissionAttemptId>>
type _ActiveHasPermit = Assert<HasRequiredKey<DispatchActiveGuard, "gatewayInvocationPermit">>
type _UnknownHasNoPermit = Assert<Equal<UnknownBlockedDispatchGuard["gatewayInvocationPermit"], undefined>>
type _AcceptedTerminalHasNoPermit = Assert<Equal<AcceptedTerminalDispatchGuard["gatewayInvocationPermit"], undefined>>
type _TerminalStateExact = Assert<Equal<TerminalParentBlockedDispatchGuard["state"], "TERMINAL_PARENT_BLOCKED">>
type _MaxDispatchOne = Assert<Equal<SubmissionDispatchAtomicityContract["maxConcurrentDispatchStarted"], 1>>
type _FanoutDisabled = Assert<Equal<
  SubmissionDispatchAtomicityContract["multiProviderSimultaneousFanoutEnabledByDefault"],
  false
>>
type _ChildCasInsufficient = Assert<Equal<SubmissionDispatchAtomicityContract["childOnlyCasIsSufficient"], false>>
type _AtomicityNotTypeGuarantee = Assert<Equal<
  SubmissionDispatchAtomicityContract["notATypeLevelGuarantee"],
  true
>>

type _StartKindsClosed = Assert<Equal<
  DispatchGuardAcquireStartResult["kind"],
  | "START_COMMITTED"
  | "IDEMPOTENT_ALREADY_STARTED"
  | "DISPATCH_GUARD_BUSY_OR_STALE"
  | "UNKNOWN_BLOCKED"
  | "ACCEPTED_TERMINAL"
  | "TERMINAL_PARENT_BLOCKED"
  | "BINDING_OR_CHILD_SET_CONFLICT"
  | "AUTHORITY_OR_FENCE_INVALID"
  | "RETRY_AUTHORIZATION_REQUIRED_OR_INVALID"
>>
type _IdempotentStartHasNoNewPermit = Assert<Equal<
  Extract<DispatchGuardAcquireStartResult, { kind: "IDEMPOTENT_ALREADY_STARTED" }>["newPermit"],
  undefined
>>

type _RetryAssessmentKindsClosed = Assert<Equal<
  RetryEligibilityAssessment["kind"],
  "RETRY_NOT_APPLICABLE" | "RETRY_BLOCKED" | "RETRY_ELIGIBLE_FOR_AUTHORIZATION_EVALUATION"
>>
type _AssessmentNotAuthorization = Assert<Not<IsAssignable<
  RetryEligibilityAssessment,
  SubmissionRetryAuthorization
>>>
type _AuthorizationStatusesClosed = Assert<Equal<
  SubmissionRetryAuthorization["status"],
  "ISSUED" | "CONSUMED" | "INVALIDATED"
>>
type _IssuedNotConsumed = Assert<Not<IsAssignable<
  IssuedSubmissionRetryAuthorization,
  ConsumedSubmissionRetryAuthorization
>>>
type _ConsumedNotIssued = Assert<Not<IsAssignable<
  ConsumedSubmissionRetryAuthorization,
  IssuedSubmissionRetryAuthorization
>>>
type _InvalidatedNotIssued = Assert<Not<IsAssignable<
  InvalidatedSubmissionRetryAuthorization,
  IssuedSubmissionRetryAuthorization
>>>
type _ConsumedPreservesIssued = Assert<HasRequiredKey<ConsumedSubmissionRetryAuthorization, "issuedSnapshot">>
type _InvalidatedPreservesIssued = Assert<HasRequiredKey<InvalidatedSubmissionRetryAuthorization, "issuedSnapshot">>
type _AuthorizationNeverPermit = Assert<Equal<SubmissionRetryAuthorization["gatewayInvocationPermit"], undefined>>

type _EmissionKindsClosed = Assert<Equal<
  RetryAuthorizationEmissionResult["kind"],
  | "RETRY_AUTHORIZATION_ISSUED"
  | "RETRY_NOT_ELIGIBLE"
  | "STALE_ASSESSMENT"
  | "AUTHORITY_OR_POLICY_INVALID"
  | "CONFLICT_REQUIRES_REREAD"
>>
type _ConsumptionKindsClosed = Assert<Equal<
  RetryAuthorizationConsumptionResult["kind"],
  | "CONSUMED_AND_INTENT_CREATED"
  | "IDEMPOTENT_EXISTING_INTENT_RETURNED"
  | "ALREADY_CONSUMED_BY_DIFFERENT_REQUEST"
  | "AUTHORIZATION_INVALIDATED"
  | "STALE_RETRY_AUTHORIZATION"
  | "PAYLOAD_CONFLICT"
>>
type _ConsumptionDoesNotCreatePermit = Assert<Equal<
  Extract<RetryAuthorizationConsumptionResult, { kind: "CONSUMED_AND_INTENT_CREATED" }>["gatewayInvocationPermit"],
  undefined
>>
type _DirectRetryHasNoAvailableWindow = Assert<Equal<
  RetryConsumptionDirectGuardTransitionContract["observableAvailableIntermediateState"],
  false
>>

type ParentOnlyProof = {
  readonly transactionAttemptId: TransactionAttemptId
  readonly expectedParentRevision: TransactionAttemptRevision
}
type ChildOnlyStartProof = {
  readonly submissionAttemptId: SubmissionAttemptId
  readonly childRevision: SubmissionAttemptRevision
}
type _ParentOnlyProofRejected = Assert<Not<IsAssignable<
  ParentOnlyProof,
  ProjectionAwareSubmissionMutationProof
>>>
type _ChildOnlyProofRejected = Assert<Not<IsAssignable<
  ChildOnlyStartProof,
  ProjectionAwareSubmissionMutationProof
>>>
type _RegisterIntentRequiresGuard = Assert<HasRequiredKey<RegisterSubmissionAttemptIntent, "expectedGuardRevision">>
type _RegisterIntentRequiresProjection = Assert<HasRequiredKey<
  RegisterSubmissionAttemptIntent,
  "mutationProof"
>>
type _BeginSubmissionRequiresProjection = Assert<Equal<
  BeginSubmissionProof["mutationProof"],
  ProjectionAwareSubmissionMutationProof
>>
type _ReplacementRequiresProjection = Assert<Equal<
  ProjectionAwareReplacementProof["submissionMutationProof"],
  ProjectionAwareSubmissionMutationProof
>>
type _NonceNotSubmissionId = Assert<Not<IsAssignable<NonceValue, SubmissionAttemptId>>>
type _PayloadHashNotSharedDigest = Assert<Not<IsAssignable<
  SignedPayloadHash,
  TransactionSubmissionSharedBindingDigest
>>>

export type F1cSubmissionProjectionTypeTests =
  | _SubmissionIdNotTransactionId
  | _SharedNotPerChildDigest
  | _SharedNotChildSetDigest
  | _SharedInputExcludesGateway
  | _PerChildInputRequiresGateway
  | _LifecycleClosed
  | _IntentAttemptedAtNull
  | _StartAttemptedAtRequired
  | _UnknownRequiresLookup
  | _ProjectionKindsClosed
  | _InFlightBlocksRetry
  | _AcceptedRequiresEvidence
  | _AllRejectedRequiresAbsenceProof
  | _FailureHasNoRetryAssessment
  | _GuardStatesClosed
  | _MaxDispatchOne
  | _FanoutDisabled
  | _StartKindsClosed
  | _AuthorizationStatusesClosed
  | _ConsumedNotIssued
  | _ConsumptionDoesNotCreatePermit
  | _ParentOnlyProofRejected
  | _ChildOnlyProofRejected
