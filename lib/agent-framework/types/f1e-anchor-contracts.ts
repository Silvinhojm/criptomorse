import type {
  NonEmptyReadonlyArray,
} from "./f1c-execution-attempts"
import type { F1dHandoffEligibility } from "./f1d-handoff"
import type {
  EvidenceRef,
  ProofDigest,
  ReconciliationId,
  ReconciliationRevision,
} from "./f1d-settlement-identities"
import type {
  AnchorAnchoredAt,
  AnchorArtifactDigestDescriptor,
  AnchorConfirmationAuthorityRef,
  AnchorEligibilityAuthorityRef,
  AnchorFailureReasonRef,
  AnchorProfileBinding,
  AnchorRequestAuthorityRef,
  AnchorRequestCreationRequestId,
  AnchorRequestId,
  AnchorRequestRef,
  AnchorRevision,
  AnchorSubmissionAttemptId,
  AnchorSubmissionAuthorityRef,
  AuditEvidenceRef,
  CanonicalPayloadDigestRef,
  ProfileBoundExternalTransactionRef,
} from "./f1e-identities"

/** Type-only Anchor lifecycle contracts. No publisher or external call. */
export type AnchorEligibilityProof = {
  readonly kind: "ANCHOR_ELIGIBILITY_PROOF"
  readonly auditEvidenceRef: AuditEvidenceRef
  readonly auditEvidenceUndisputed: true
  readonly auditHeadCurrent: true
  readonly artifact: AnchorArtifactDigestDescriptor
  readonly profile: AnchorProfileBinding
  readonly eligibilityAuthorityRef: AnchorEligibilityAuthorityRef
  readonly f1dHandoff: F1dHandoffEligibility
  readonly proofDigest: ProofDigest
  readonly createsRequest: false
  readonly createsSubmission: false
  readonly createsConfirmation: false
}

export type AnchorPreRequestState =
  | {
      readonly state: "NOT_READY"
      readonly blockers: readonly EvidenceRef[]
      readonly eligibility?: never
      readonly artifact?: never
      readonly anchorRequestId?: never
    }
  | {
      readonly state: "ELIGIBLE"
      readonly eligibility: AnchorEligibilityProof
      readonly artifact: AnchorArtifactDigestDescriptor
      readonly blockers?: never
      readonly anchorRequestId?: never
      readonly requestAuthorityRef?: never
    }

export type AnchorRequestBase = {
  readonly anchorRequestId: AnchorRequestId
  readonly anchorRevision: AnchorRevision
  readonly creationRequestId: AnchorRequestCreationRequestId
  readonly auditEvidenceRef: AuditEvidenceRef
  readonly artifact: AnchorArtifactDigestDescriptor
  readonly profile: AnchorProfileBinding
  readonly eligibility: AnchorEligibilityProof
  readonly requestAuthorityRef: AnchorRequestAuthorityRef
}

export type AnchorSubmissionAttemptBinding = {
  readonly anchorRequestRef: AnchorRequestRef
  readonly attemptId: AnchorSubmissionAttemptId
  readonly artifact: AnchorArtifactDigestDescriptor
  readonly profile: AnchorProfileBinding
  readonly submissionAuthorityRef: AnchorSubmissionAuthorityRef
}

export type AnchorSubmissionEvidence = {
  readonly kind: "ANCHOR_SUBMISSION_ADMITTED"
  readonly attempt: AnchorSubmissionAttemptBinding
  readonly admissionEvidenceRefs: NonEmptyReadonlyArray<EvidenceRef>
  readonly externalTransaction: ProfileBoundExternalTransactionRef | null
  readonly authorityMode: "AUTHORITATIVE"
}

export type AnchorAdmissionOutcomeUnknownEvidence = {
  readonly kind: "ANCHOR_ADMISSION_OUTCOME_UNKNOWN"
  readonly classification: "ADMISSION_OUTCOME_UNKNOWN"
  readonly attempt: AnchorSubmissionAttemptBinding
  readonly submissionEvidence: null
  readonly externalTransaction: ProfileBoundExternalTransactionRef | null
  readonly observationEvidenceRefs: NonEmptyReadonlyArray<EvidenceRef>
  readonly timeoutWasSoleCause: false
  readonly retrySafeProof?: never
}

export type AnchorConfirmationOutcomeUnknownEvidence = {
  readonly kind: "ANCHOR_CONFIRMATION_OUTCOME_UNKNOWN"
  readonly classification: "CONFIRMATION_OUTCOME_UNKNOWN"
  readonly attempt: AnchorSubmissionAttemptBinding
  readonly submissionEvidence: AnchorSubmissionEvidence
  readonly externalTransaction: ProfileBoundExternalTransactionRef | null
  readonly observationEvidenceRefs: NonEmptyReadonlyArray<EvidenceRef>
  readonly timeoutWasSoleCause: false
  readonly retrySafeProof?: never
}

export type AnchorSubmissionUnknownEvidence =
  | AnchorAdmissionOutcomeUnknownEvidence
  | AnchorConfirmationOutcomeUnknownEvidence

export type PreAttemptConclusiveFailure = {
  readonly kind: "PRE_ATTEMPT_CONCLUSIVE_FAILURE"
  readonly requestRef: AnchorRequestRef
  readonly profile: AnchorProfileBinding
  readonly failureEvidenceRefs: NonEmptyReadonlyArray<AnchorFailureReasonRef>
  readonly conclusive: true
  readonly attempt?: never
  readonly submissionEvidence?: never
  readonly externalTransaction?: never
  readonly submissionAuthorityRef?: never
}

export type AdmissionConclusivelyRejectedFailure = {
  readonly kind: "ADMISSION_CONCLUSIVELY_REJECTED"
  readonly attempt: AnchorSubmissionAttemptBinding
  readonly submissionEvidence: null
  readonly externalTransaction: ProfileBoundExternalTransactionRef | null
  readonly rejectionEvidenceRefs: NonEmptyReadonlyArray<AnchorFailureReasonRef>
  readonly conclusive: true
  readonly failureEvidenceRefs?: never
}

export type PostAdmissionConclusiveFailure = {
  readonly kind: "POST_ADMISSION_CONCLUSIVE_FAILURE"
  readonly attempt: AnchorSubmissionAttemptBinding
  readonly submissionEvidence: AnchorSubmissionEvidence
  readonly externalTransaction: ProfileBoundExternalTransactionRef | null
  readonly failureEvidenceRefs: NonEmptyReadonlyArray<AnchorFailureReasonRef>
  readonly conclusive: true
  readonly rejectionEvidenceRefs?: never
}

export type AnchorFailureEvidence =
  | PreAttemptConclusiveFailure
  | AdmissionConclusivelyRejectedFailure
  | PostAdmissionConclusiveFailure

export type AnchorConfirmationProof = {
  readonly kind: "ANCHOR_CONFIRMATION_PROOF"
  readonly attempt: AnchorSubmissionAttemptBinding
  readonly submissionEvidence: AnchorSubmissionEvidence | null
  readonly auditEvidenceRef: AuditEvidenceRef
  readonly canonicalPayload: CanonicalPayloadDigestRef
  readonly reconciliationId: ReconciliationId
  readonly reconciliationRevision: ReconciliationRevision
  readonly eligibilityProofDigest: ProofDigest
  readonly externalTransaction: ProfileBoundExternalTransactionRef | null
  readonly confirmationEvidenceRefs: NonEmptyReadonlyArray<EvidenceRef>
  readonly confirmationAuthorityRef: AnchorConfirmationAuthorityRef
  readonly authorityMode: "AUTHORITATIVE"
  readonly provesEconomicTruth: false
  readonly provesSettlement: false
  readonly provesDelivery: false
}

export type RequestedAnchorRequestRecord = AnchorRequestBase & {
  readonly state: "REQUESTED"
  readonly attempt?: never
  readonly submissionEvidence?: never
  readonly unknownEvidence?: never
  readonly confirmationProof?: never
  readonly failure?: never
  readonly successor?: never
  readonly anchoredAt?: never
}

export type SubmittedAnchorRequestRecord = AnchorRequestBase & {
  readonly state: "SUBMITTED"
  readonly submissionEvidence: AnchorSubmissionEvidence
  readonly attempt?: never
  readonly unknownEvidence?: never
  readonly confirmationProof?: never
  readonly failure?: never
  readonly successor?: never
  readonly anchoredAt?: never
}

export type UnknownAnchorRequestRecord = AnchorRequestBase & {
  readonly state: "SUBMISSION_UNKNOWN"
  readonly unknownEvidence: AnchorSubmissionUnknownEvidence
  readonly attempt?: never
  readonly submissionEvidence?: never
  readonly confirmationProof?: never
  readonly failure?: never
  readonly successor?: never
  readonly anchoredAt?: never
}

export type FailedAnchorRequestRecord = AnchorRequestBase & {
  readonly state: "FAILED"
  readonly failure: AnchorFailureEvidence
  readonly attempt?: never
  readonly submissionEvidence?: never
  readonly unknownEvidence?: never
  readonly confirmationProof?: never
  readonly anchoredAt?: never
  readonly successor?: never
}

export type AnchoredAnchorRequestRecord = AnchorRequestBase & {
  readonly state: "ANCHORED"
  readonly confirmationProof: AnchorConfirmationProof
  readonly anchoredAt: AnchorAnchoredAt
  readonly attempt?: never
  readonly unknownEvidence?: never
  readonly failure?: never
  readonly successor?: never
}

export type CoreSupersedableAnchorState = "REQUESTED" | "FAILED" | "ANCHORED"

export type SafeSupersessionBasis =
  | {
      readonly predecessorSupersedableState: "REQUESTED"
      readonly predecessor: AnchorRequestRef
      readonly noAttemptWasCreated: true
      readonly evidenceRefs: NonEmptyReadonlyArray<EvidenceRef>
    }
  | {
      readonly predecessorSupersedableState: "FAILED"
      readonly predecessor: AnchorRequestRef
      readonly conclusiveFailure: AnchorFailureEvidence
      readonly evidenceRefs: NonEmptyReadonlyArray<EvidenceRef>
    }
  | {
      readonly predecessorSupersedableState: "ANCHORED"
      readonly predecessor: AnchorRequestRef
      readonly priorConfirmation: AnchorConfirmationProof
      readonly correctionAuditRef: AuditEvidenceRef
      readonly successorArtifact: AnchorArtifactDigestDescriptor
      readonly evidenceRefs: NonEmptyReadonlyArray<EvidenceRef>
    }

export type SupersededAnchorRequestRecord = AnchorRequestBase & {
  readonly state: "SUPERSEDED"
  readonly basis: SafeSupersessionBasis
  readonly successor: AnchorRequestRef
  readonly lateEvidenceRefs: readonly EvidenceRef[]
  readonly preservesPredecessor: true
  readonly attempt?: never
  readonly submissionEvidence?: never
  readonly unknownEvidence?: never
  readonly confirmationProof?: never
  readonly failure?: never
  readonly anchoredAt?: never
}

export type AnchorRequestRecord =
  | RequestedAnchorRequestRecord
  | SubmittedAnchorRequestRecord
  | UnknownAnchorRequestRecord
  | FailedAnchorRequestRecord
  | AnchoredAnchorRequestRecord
  | SupersededAnchorRequestRecord

export type AnchorLifecycleRecord = AnchorPreRequestState | AnchorRequestRecord

export type AnchorStorageAndRuntimeBoundary = {
  readonly kind: "FUTURE_STORAGE_AND_RUNTIME_CONTRACT"
  readonly requestCreationMustBeAtomic: true
  readonly revisionCasRequired: true
  readonly attemptIdentityUniquenessRequired: true
  readonly requestAndProofValueEqualityRequiresVerifier: true
  readonly externalSubmissionIsFutureRuntimeCapability: true
  readonly confirmationObservationIsFutureRuntimeCapability: true
  readonly typesProvideAtomicity: false
  readonly typesProvideNetworkTruth: false
  readonly typesProvideEconomicTruth: false
}
