import type {
  AnchorAdmissionOutcomeUnknownEvidence,
  AnchorConfirmationOutcomeUnknownEvidence,
  AnchorConfirmationProof,
  AnchorFailureEvidence,
  AnchorLifecycleRecord,
  AnchorRequestRecord,
  AnchoredAnchorRequestRecord,
  FailedAnchorRequestRecord,
  RequestedAnchorRequestRecord,
  SafeSupersessionBasis,
  SubmittedAnchorRequestRecord,
  SupersededAnchorRequestRecord,
  UnknownAnchorRequestRecord,
} from "./f1e-anchor-contracts"
import type {
  AnchorRequestRef,
  AnchorSubmissionAttemptId,
  ExternalAnchorTransactionHash,
  ProfileBoundExternalTransactionRef,
} from "./f1e-identities"

type Assert<Condition extends true> = Condition
type IsAssignable<From, To> = [From] extends [To] ? true : false
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false

type _RequestStatesExhaustive = Assert<
  Equal<
    AnchorRequestRecord["state"],
    "REQUESTED" | "SUBMITTED" | "SUBMISSION_UNKNOWN" | "FAILED" | "ANCHORED" | "SUPERSEDED"
  >
>
type _LifecycleStatesExhaustive = Assert<
  Equal<AnchorLifecycleRecord["state"], "NOT_READY" | "ELIGIBLE" | AnchorRequestRecord["state"]>
>
type _UnknownClassificationsExhaustive = Assert<
  Equal<
    AnchorAdmissionOutcomeUnknownEvidence["classification"] | AnchorConfirmationOutcomeUnknownEvidence["classification"],
    "ADMISSION_OUTCOME_UNKNOWN" | "CONFIRMATION_OUTCOME_UNKNOWN"
  >
>
type _FailureKindsExhaustive = Assert<
  Equal<
    AnchorFailureEvidence["kind"],
    "PRE_ATTEMPT_CONCLUSIVE_FAILURE" | "ADMISSION_CONCLUSIVELY_REJECTED" | "POST_ADMISSION_CONCLUSIVE_FAILURE"
  >
>
type _ConfirmationDeniesEconomicTruth = Assert<Equal<AnchorConfirmationProof["provesEconomicTruth"], false>>
type _ConfirmationDeniesSettlement = Assert<Equal<AnchorConfirmationProof["provesSettlement"], false>>
type _ConfirmationDeniesDelivery = Assert<Equal<AnchorConfirmationProof["provesDelivery"], false>>
type _AnchoredAtBelongsToRecord = Assert<Equal<keyof Pick<AnchoredAnchorRequestRecord, "anchoredAt">, "anchoredAt">>
type _SafeSupersessionExcludesSubmitted = Assert<
  Equal<Extract<SafeSupersessionBasis, { predecessorSupersedableState: "SUBMITTED" }>, never>
>
type _SafeSupersessionExcludesUnknown = Assert<
  Equal<Extract<SafeSupersessionBasis, { predecessorSupersedableState: "SUBMISSION_UNKNOWN" }>, never>
>

// @ts-expect-error REQUESTED cannot carry an attempt.
type _RequestedAttemptRejected = Assert<IsAssignable<Omit<RequestedAnchorRequestRecord, "attempt"> & { readonly attempt: AnchorSubmissionAttemptId }, AnchorRequestRecord>>
// @ts-expect-error REQUESTED cannot carry submission evidence.
type _RequestedSubmissionRejected = Assert<IsAssignable<Omit<RequestedAnchorRequestRecord, "submissionEvidence"> & { readonly submissionEvidence: unknown }, AnchorRequestRecord>>
// @ts-expect-error REQUESTED cannot carry confirmation proof.
type _RequestedConfirmationRejected = Assert<IsAssignable<Omit<RequestedAnchorRequestRecord, "confirmationProof"> & { readonly confirmationProof: AnchorConfirmationProof }, AnchorRequestRecord>>
// @ts-expect-error SUBMITTED requires submission evidence.
type _SubmittedWithoutEvidenceRejected = Assert<IsAssignable<Omit<SubmittedAnchorRequestRecord, "submissionEvidence">, AnchorRequestRecord>>
// @ts-expect-error UNKNOWN requires classified unknown evidence.
type _UnknownWithoutEvidenceRejected = Assert<IsAssignable<Omit<UnknownAnchorRequestRecord, "unknownEvidence">, AnchorRequestRecord>>
// @ts-expect-error Admission unknown cannot contain positive submission evidence.
type _AdmissionUnknownWithSubmissionRejected = Assert<IsAssignable<Omit<AnchorAdmissionOutcomeUnknownEvidence, "submissionEvidence"> & { readonly submissionEvidence: AnchorConfirmationOutcomeUnknownEvidence["submissionEvidence"] }, AnchorAdmissionOutcomeUnknownEvidence>>
// @ts-expect-error Confirmation unknown cannot contain null submission evidence.
type _ConfirmationUnknownWithoutSubmissionRejected = Assert<IsAssignable<Omit<AnchorConfirmationOutcomeUnknownEvidence, "submissionEvidence"> & { readonly submissionEvidence: null }, AnchorConfirmationOutcomeUnknownEvidence>>
// @ts-expect-error FAILED requires conclusive failure evidence.
type _FailedWithoutFailureRejected = Assert<IsAssignable<Omit<FailedAnchorRequestRecord, "failure">, AnchorRequestRecord>>
// @ts-expect-error ANCHORED requires confirmation proof.
type _AnchoredWithoutConfirmationRejected = Assert<IsAssignable<Omit<AnchoredAnchorRequestRecord, "confirmationProof">, AnchorRequestRecord>>
// @ts-expect-error ANCHORED requires record.anchoredAt.
type _AnchoredWithoutTimestampRejected = Assert<IsAssignable<Omit<AnchoredAnchorRequestRecord, "anchoredAt">, AnchorRequestRecord>>
// @ts-expect-error AnchorConfirmationProof has no anchoredAt field.
type _ConfirmationAnchoredAtPathRejected = AnchorConfirmationProof["anchoredAt"]
// @ts-expect-error Confirmation cannot claim economic truth.
type _ConfirmationEconomicTruthRejected = Assert<IsAssignable<Omit<AnchorConfirmationProof, "provesEconomicTruth"> & { readonly provesEconomicTruth: true }, AnchorConfirmationProof>>
// @ts-expect-error Confirmation cannot claim settlement.
type _ConfirmationSettlementRejected = Assert<IsAssignable<Omit<AnchorConfirmationProof, "provesSettlement"> & { readonly provesSettlement: true }, AnchorConfirmationProof>>
// @ts-expect-error A bare transaction hash is not a profile-bound transaction.
type _BareTransactionRejected = Assert<IsAssignable<ExternalAnchorTransactionHash, ProfileBoundExternalTransactionRef>>
// @ts-expect-error SUBMITTED cannot carry successor/supersession state.
type _SubmittedSuccessorRejected = Assert<IsAssignable<Omit<SubmittedAnchorRequestRecord, "successor"> & { readonly successor: AnchorRequestRef }, AnchorRequestRecord>>
// @ts-expect-error UNKNOWN cannot carry successor/supersession state.
type _UnknownSuccessorRejected = Assert<IsAssignable<Omit<UnknownAnchorRequestRecord, "successor"> & { readonly successor: AnchorRequestRef }, AnchorRequestRecord>>
// @ts-expect-error SUPERSEDED requires a successor.
type _SupersededWithoutSuccessorRejected = Assert<IsAssignable<Omit<SupersededAnchorRequestRecord, "successor">, AnchorRequestRecord>>

export type {
  _RequestStatesExhaustive,
  _LifecycleStatesExhaustive,
  _UnknownClassificationsExhaustive,
  _FailureKindsExhaustive,
  _ConfirmationDeniesEconomicTruth,
  _ConfirmationDeniesSettlement,
  _ConfirmationDeniesDelivery,
  _AnchoredAtBelongsToRecord,
  _SafeSupersessionExcludesSubmitted,
  _SafeSupersessionExcludesUnknown,
  _RequestedAttemptRejected,
  _RequestedSubmissionRejected,
  _RequestedConfirmationRejected,
  _SubmittedWithoutEvidenceRejected,
  _UnknownWithoutEvidenceRejected,
  _AdmissionUnknownWithSubmissionRejected,
  _ConfirmationUnknownWithoutSubmissionRejected,
  _FailedWithoutFailureRejected,
  _AnchoredWithoutConfirmationRejected,
  _AnchoredWithoutTimestampRejected,
  _ConfirmationAnchoredAtPathRejected,
  _ConfirmationEconomicTruthRejected,
  _ConfirmationSettlementRejected,
  _BareTransactionRejected,
  _SubmittedSuccessorRejected,
  _UnknownSuccessorRejected,
  _SupersededWithoutSuccessorRejected,
}
