import type {
  AcceptedCommandAdmission,
  AcceptedAt,
  AdmissionResult,
  AdmissionResultRecord,
  AggregateRevision,
  AuthorizationEvaluation,
  AuthorizationEvaluationId,
  AuthorizationEvaluationResult,
  AuthorizationRevision,
  AuthorizedAt,
  CommandAdmissionState,
  CommandAuthorizationState,
  CommandId,
  IdempotencyBinding,
  OperationNamespace,
  PayloadDigest,
  VerifiedIssuerId,
} from "./f1a-foundation"

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false

type Expect<Value extends true> = Value
type ExpectFalse<Value extends false> = Value
type Assignable<From, To> = [From] extends [To] ? true : false

type AdmissionStatesAreClosed = Expect<Equal<
  CommandAdmissionState,
  "RECEIVED" | "ACCEPTED" | "IDENTITY_INVALID" | "IDEMPOTENCY_CONFLICT"
>>

type AdmissionResultsAreClosed = Expect<Equal<
  AdmissionResult,
  | "NEW_COMMAND_ACCEPTED"
  | "EXISTING_COMMAND_RETURNED"
  | "EXISTING_COMMAND_IN_PROGRESS"
  | "IDEMPOTENCY_PAYLOAD_CONFLICT"
  | "IDENTITY_INVALID"
>>

type AuthorizationStatesAreClosed = Expect<Equal<
  CommandAuthorizationState,
  "NOT_EVALUATED" | "AUTHORIZED" | "REJECTED"
>>

type AuthorizationResultsAreClosed = Expect<Equal<
  AuthorizationEvaluationResult,
  "AUTHORIZED" | "REJECTED" | "INVALIDATED" | "SUPERSEDED" | "ERROR_FAIL_CLOSED"
>>

type CommandIdIsNominal = ExpectFalse<Assignable<VerifiedIssuerId, CommandId>>
type IssuerIdIsNominal = ExpectFalse<Assignable<CommandId, VerifiedIssuerId>>
type NamespaceIsNotDigest = ExpectFalse<Assignable<OperationNamespace, PayloadDigest>>
type DigestIsNotNamespace = ExpectFalse<Assignable<PayloadDigest, OperationNamespace>>
type AcceptedAtIsNominal = ExpectFalse<Assignable<AcceptedAt, AuthorizedAt>>
type AuthorizedAtIsNominal = ExpectFalse<Assignable<AuthorizedAt, AcceptedAt>>

type RevisionsAreIndependent = ExpectFalse<Assignable<AggregateRevision, AuthorizationRevision>>
type ReverseRevisionsAreIndependent = ExpectFalse<Assignable<AuthorizationRevision, AggregateRevision>>

type AdmissionStateIsNotResult = ExpectFalse<Assignable<CommandAdmissionState, AdmissionResult>>
type AdmissionResultIsNotState = ExpectFalse<Assignable<AdmissionResult, CommandAdmissionState>>
type AuthorizationStateIsNotHistory = ExpectFalse<
  Assignable<CommandAuthorizationState, AuthorizationEvaluationResult>
>

type BindingHasExactlyFourFacts = Expect<Equal<
  keyof IdempotencyBinding,
  "verifiedIssuerId" | "operationNamespace" | "idempotencyKey" | "payloadDigest"
>>

type ExistingReturned = Extract<AdmissionResultRecord, { readonly result: "EXISTING_COMMAND_RETURNED" }>
type ExistingInProgress = Extract<AdmissionResultRecord, { readonly result: "EXISTING_COMMAND_IN_PROGRESS" }>
type PayloadConflict = Extract<AdmissionResultRecord, { readonly result: "IDEMPOTENCY_PAYLOAD_CONFLICT" }>
type SameDigestReturnsExisting = Expect<Equal<ExistingReturned["samePayloadDigest"], true>>
type SameDigestCanRemainInProgress = Expect<Equal<ExistingInProgress["samePayloadDigest"], true>>
type DifferentDigestIsConflict = Expect<Equal<PayloadConflict["samePayloadDigest"], false>>
type ConflictHasBothDigests = Expect<Equal<
  Pick<PayloadConflict, "existingPayloadDigest" | "receivedPayloadDigest">,
  Readonly<{
    existingPayloadDigest: PayloadDigest
    receivedPayloadDigest: PayloadDigest
  }>
>>

type AuthorizedEvaluation = Extract<AuthorizationEvaluation, { readonly result: "AUTHORIZED" }>
type RejectedEvaluation = Extract<AuthorizationEvaluation, { readonly result: "REJECTED" }>
type FailClosedEvaluation = Extract<AuthorizationEvaluation, { readonly result: "ERROR_FAIL_CLOSED" }>
type AuthorizedAtIsRequired = Expect<Equal<AuthorizedEvaluation["authorizedAt"], AuthorizedAt>>
type RejectedHasNoAuthorizedAt = Expect<Equal<RejectedEvaluation["authorizedAt"], undefined>>
type FailClosedHasNoAuthorizedAt = Expect<Equal<FailClosedEvaluation["authorizedAt"], undefined>>
type FailClosedIsNotAuthorized = ExpectFalse<Equal<FailClosedEvaluation["result"], "AUTHORIZED">>
type SupersessionUsesEvaluationId = Expect<Equal<
  NonNullable<AuthorizationEvaluation["supersedesEvaluationId"]>,
  AuthorizationEvaluationId
>>

type AcceptedAdmissionIsReadonly = Expect<Equal<
  AcceptedCommandAdmission,
  Readonly<AcceptedCommandAdmission>
>>
type AuthorizedHistoryIsReadonly = Expect<Equal<
  AuthorizedEvaluation,
  Readonly<AuthorizedEvaluation>
>>
type RejectedHistoryIsReadonly = Expect<Equal<
  RejectedEvaluation,
  Readonly<RejectedEvaluation>
>>

export type F1aFoundationTypeTestSuite =
  | AdmissionStatesAreClosed
  | AdmissionResultsAreClosed
  | AuthorizationStatesAreClosed
  | AuthorizationResultsAreClosed
  | CommandIdIsNominal
  | IssuerIdIsNominal
  | NamespaceIsNotDigest
  | DigestIsNotNamespace
  | AcceptedAtIsNominal
  | AuthorizedAtIsNominal
  | RevisionsAreIndependent
  | ReverseRevisionsAreIndependent
  | AdmissionStateIsNotResult
  | AdmissionResultIsNotState
  | AuthorizationStateIsNotHistory
  | BindingHasExactlyFourFacts
  | SameDigestReturnsExisting
  | SameDigestCanRemainInProgress
  | DifferentDigestIsConflict
  | ConflictHasBothDigests
  | AuthorizedAtIsRequired
  | RejectedHasNoAuthorizedAt
  | FailClosedHasNoAuthorizedAt
  | FailClosedIsNotAuthorized
  | SupersessionUsesEvaluationId
  | AcceptedAdmissionIsReadonly
  | AuthorizedHistoryIsReadonly
  | RejectedHistoryIsReadonly
