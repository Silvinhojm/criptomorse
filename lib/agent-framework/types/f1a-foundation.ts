/**
 * RI-L2 F1a: pure, dormant contracts for admission and authorization.
 *
 * This module intentionally contains types only. It has no constructors,
 * validators, clocks, persistence, runtime authority, or economic capability.
 */

declare const f1aOpaqueBrand: unique symbol

type Opaque<Base, Tag extends string> = Base & {
  readonly [f1aOpaqueBrand]: Tag
}

export type ClaimedIssuerId = Opaque<string, "ClaimedIssuerId">
export type CommandId = Opaque<string, "CommandId">
export type VerifiedIssuerId = Opaque<string, "VerifiedIssuerId">
export type OperationNamespace = Opaque<string, "OperationNamespace">
export type IdempotencyKey = Opaque<string, "IdempotencyKey">
export type PayloadDigest = Opaque<string, "PayloadDigest">
export type TransportReceiptId = Opaque<string, "TransportReceiptId">
export type AuthorizationEvaluationId = Opaque<string, "AuthorizationEvaluationId">
export type PolicyVersion = Opaque<string, "PolicyVersion">
export type DecisionReportId = Opaque<string, "DecisionReportId">
export type VerifiedEvaluatorId = Opaque<string, "VerifiedEvaluatorId">

export type TransportReceivedAt = Opaque<string, "TransportReceivedAt">
export type AcceptedAt = Opaque<string, "AcceptedAt">
export type EvaluatedAt = Opaque<string, "EvaluatedAt">
export type AuthorizedAt = Opaque<string, "AuthorizedAt">

export type AggregateRevision = Opaque<number, "AggregateRevision">
export type AuthorizationRevision = Opaque<number, "AuthorizationRevision">

export type CommandAdmissionState =
  | "RECEIVED"
  | "ACCEPTED"
  | "IDENTITY_INVALID"
  | "IDEMPOTENCY_CONFLICT"

export type AdmissionResult =
  | "NEW_COMMAND_ACCEPTED"
  | "EXISTING_COMMAND_RETURNED"
  | "EXISTING_COMMAND_IN_PROGRESS"
  | "IDEMPOTENCY_PAYLOAD_CONFLICT"
  | "IDENTITY_INVALID"

export type CommandAuthorizationState =
  | "NOT_EVALUATED"
  | "AUTHORIZED"
  | "REJECTED"

export type AuthorizationEvaluationResult =
  | "AUTHORIZED"
  | "REJECTED"
  | "INVALIDATED"
  | "SUPERSEDED"
  | "ERROR_FAIL_CLOSED"

export interface IdempotencyScope {
  readonly verifiedIssuerId: VerifiedIssuerId
  readonly operationNamespace: OperationNamespace
  readonly idempotencyKey: IdempotencyKey
}

export interface IdempotencyBinding extends IdempotencyScope {
  readonly payloadDigest: PayloadDigest
}

export interface AcceptedCommandAdmission {
  readonly commandId: CommandId
  readonly admissionState: "ACCEPTED"
  readonly binding: IdempotencyBinding
  readonly winningTransportReceiptId: TransportReceiptId
  readonly transportReceivedAt: TransportReceivedAt
  readonly acceptedAt: AcceptedAt
  readonly aggregateRevision: AggregateRevision
}

export interface NewCommandAccepted {
  readonly result: "NEW_COMMAND_ACCEPTED"
  readonly admission: AcceptedCommandAdmission
}

export interface ExistingCommandReturned {
  readonly result: "EXISTING_COMMAND_RETURNED"
  readonly admissionState: "ACCEPTED"
  readonly commandId: CommandId
  readonly binding: IdempotencyBinding
  readonly aggregateRevision: AggregateRevision
  readonly samePayloadDigest: true
}

export interface ExistingCommandInProgress {
  readonly result: "EXISTING_COMMAND_IN_PROGRESS"
  readonly admissionState: "ACCEPTED"
  readonly commandId: CommandId
  readonly binding: IdempotencyBinding
  readonly aggregateRevision: AggregateRevision
  readonly samePayloadDigest: true
}

export interface IdempotencyPayloadConflict {
  readonly result: "IDEMPOTENCY_PAYLOAD_CONFLICT"
  readonly admissionState: "IDEMPOTENCY_CONFLICT"
  readonly scope: IdempotencyScope
  readonly existingCommandId: CommandId
  readonly existingPayloadDigest: PayloadDigest
  readonly receivedPayloadDigest: PayloadDigest
  readonly samePayloadDigest: false
}

export interface IdentityInvalidAdmission {
  readonly result: "IDENTITY_INVALID"
  readonly admissionState: "IDENTITY_INVALID"
  readonly claimedIssuerId: ClaimedIssuerId
  readonly transportReceiptId: TransportReceiptId
  readonly transportReceivedAt: TransportReceivedAt
}

export type AdmissionResultRecord =
  | NewCommandAccepted
  | ExistingCommandReturned
  | ExistingCommandInProgress
  | IdempotencyPayloadConflict
  | IdentityInvalidAdmission

interface AuthorizationEvaluationBase {
  readonly authorizationEvaluationId: AuthorizationEvaluationId
  readonly commandId: CommandId
  readonly authorizationRevision: AuthorizationRevision
  readonly policyVersion: PolicyVersion
  readonly decisionReportId: DecisionReportId
  readonly evaluatedBy: VerifiedEvaluatorId
  readonly evaluatedAt: EvaluatedAt
  /**
   * Explicit historical link. When present, the referenced evaluation must
   * belong to the same command; enforcing that invariant is future runtime
   * work and is deliberately absent from F1a.
   */
  readonly supersedesEvaluationId?: AuthorizationEvaluationId
}

export interface AuthorizedEvaluation extends AuthorizationEvaluationBase {
  readonly result: "AUTHORIZED"
  readonly authorizedAt: AuthorizedAt
}

type NonAuthorizedEvaluationResult = Exclude<AuthorizationEvaluationResult, "AUTHORIZED">

interface NonAuthorizedEvaluationRecord<Result extends NonAuthorizedEvaluationResult>
  extends AuthorizationEvaluationBase {
  readonly result: Result
  readonly authorizedAt?: never
}

export type NonAuthorizedEvaluation = {
  readonly [Result in NonAuthorizedEvaluationResult]: NonAuthorizedEvaluationRecord<Result>
}[NonAuthorizedEvaluationResult]

export type AuthorizationEvaluation =
  | AuthorizedEvaluation
  | NonAuthorizedEvaluation
