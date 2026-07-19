import type { ExecutionAttemptIdentitySnapshot } from "./f1d-settlement"
import type {
  CompleteEffectProof,
  DefinitiveReconciliationResult,
  EffectCompletenessProof,
  FeeComponent,
  ReconciledExecutionAttempt,
  ReconciledFee,
  ReconciledRefund,
  RefundComponent,
} from "./f1d-reconciliation"
import type { ReconciliationCorrection } from "./f1d-corrections"
import type { F1dHandoffEligibility } from "./f1d-handoff"

type Assert<Condition extends true> = Condition
type IsAssignable<From, To> = [From] extends [To] ? true : false
type Not<Value extends boolean> = Value extends true ? false : true
type HasRequiredKey<Shape, Key extends keyof Shape> = Record<never, never> extends Pick<Shape, Key> ? false : true
type ExpectedIdentityKeys =
  | "executionAttemptId" | "commandId" | "effectInstanceKey" | "attemptNumber"
  | "attemptReason" | "initialEffectAuthorizationReference"
  | "immutableExecutionEconomicCeilingDigest" | "attemptCreatedAt" | "createdEventId"
  | "causalEventSequence" | "transactionAttemptIds" | "nonceReservationId"

type _IdentityExactlyTwelve = Assert<IsAssignable<keyof ExecutionAttemptIdentitySnapshot, ExpectedIdentityKeys>>
type _AllIdentityKeysPresent = Assert<IsAssignable<ExpectedIdentityKeys, keyof ExecutionAttemptIdentitySnapshot>>
type _TransactionAttemptsNonEmpty = Assert<IsAssignable<ExecutionAttemptIdentitySnapshot["transactionAttemptIds"], readonly [ExecutionAttemptIdentitySnapshot["transactionAttemptIds"][number], ...ExecutionAttemptIdentitySnapshot["transactionAttemptIds"][number][]]>>
type _ObservedFeeNotReconciled = Assert<Not<IsAssignable<Extract<FeeComponent, { stage: "OBSERVED_FEE" }>, ReconciledFee>>>
type _FinalFeeNotReconciled = Assert<Not<IsAssignable<Extract<FeeComponent, { stage: "FINAL_FEE" }>, ReconciledFee>>>
type _DisputedRefundNotReconciled = Assert<Not<IsAssignable<Extract<RefundComponent, { stage: "DISPUTED_REFUND" }>, ReconciledRefund>>>
type _IncompleteNotComplete = Assert<Not<IsAssignable<Extract<EffectCompletenessProof, { classification: "INCOMPLETE" }>, CompleteEffectProof>>>
type _ReconciledNeedsEligibility = Assert<HasRequiredKey<ReconciledExecutionAttempt, "reconciliationEligibility">>
type _ReconciledNeedsConclusion = Assert<HasRequiredKey<ReconciledExecutionAttempt, "reconciliationConclusion">>
type _ReconciledNeedsResult = Assert<HasRequiredKey<ReconciledExecutionAttempt, "reconciliationResult">>
type _CorrectionNeedsPredecessor = Assert<HasRequiredKey<ReconciliationCorrection, "predecessor">>
type _CorrectionNeedsEvidence = Assert<HasRequiredKey<ReconciliationCorrection, "correctionEvidenceRefs">>
type _HandoffCannotAudit = Assert<IsAssignable<F1dHandoffEligibility["createsAuditEvidence"], false>>
type _HandoffCannotAnchor = Assert<IsAssignable<F1dHandoffEligibility["createsAnchor"], false>>

declare const identity: ExecutionAttemptIdentitySnapshot
declare const identityWithoutCommand: Omit<ExecutionAttemptIdentitySnapshot, "commandId">
declare const identityWithEmptyAttempts: Omit<ExecutionAttemptIdentitySnapshot, "transactionAttemptIds"> & { readonly transactionAttemptIds: readonly [] }
declare const reconciled: ReconciledExecutionAttempt
declare const reconciledWithoutEligibility: Omit<ReconciledExecutionAttempt, "reconciliationEligibility">
declare const reconciledWithoutConclusion: Omit<ReconciledExecutionAttempt, "reconciliationConclusion">
declare const reconciledWithoutResult: Omit<ReconciledExecutionAttempt, "reconciliationResult">
declare const definitive: DefinitiveReconciliationResult
declare const observedFee: Extract<FeeComponent, { stage: "OBSERVED_FEE" }>

const validIdentity: ExecutionAttemptIdentitySnapshot = identity
const validReconciled: ReconciledExecutionAttempt = reconciled
const validDefinitive: DefinitiveReconciliationResult = definitive
// @ts-expect-error all twelve identity fields are required
const invalidIdentity: ExecutionAttemptIdentitySnapshot = identityWithoutCommand
// @ts-expect-error transaction attempts are non-empty
const invalidEmptyAttempts: ExecutionAttemptIdentitySnapshot = identityWithEmptyAttempts
// @ts-expect-error eligibility is mandatory
const invalidEligibility: ReconciledExecutionAttempt = reconciledWithoutEligibility
// @ts-expect-error conclusion is mandatory
const invalidConclusion: ReconciledExecutionAttempt = reconciledWithoutConclusion
// @ts-expect-error definitive result is mandatory
const invalidResult: ReconciledExecutionAttempt = reconciledWithoutResult
// @ts-expect-error definitive fees accept only RECONCILED_FEE
const invalidDefinitiveFee: DefinitiveReconciliationResult = { ...definitive, fees: [observedFee] }

export type F1dReconciliationTypeTests =
  | _IdentityExactlyTwelve | _AllIdentityKeysPresent | _TransactionAttemptsNonEmpty
  | _ObservedFeeNotReconciled | _FinalFeeNotReconciled | _DisputedRefundNotReconciled
  | _IncompleteNotComplete | _ReconciledNeedsEligibility | _ReconciledNeedsConclusion
  | _ReconciledNeedsResult | _CorrectionNeedsPredecessor | _CorrectionNeedsEvidence
  | _HandoffCannotAudit | _HandoffCannotAnchor
