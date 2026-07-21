import type { F1dHandoffEligibility } from "./f1d-handoff"
import type {
  AuditEvidenceCommitment,
  AuditEvidenceCompletenessProof,
  AuditEvidenceProjection,
  AuditEvidenceProvenanceBinding,
  CompleteAuditEvidenceProof,
  RecordedAuditEvidence,
} from "./f1e-audit-contracts"

type Assert<Condition extends true> = Condition
type IsAssignable<From, To> = [From] extends [To] ? true : false
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false

type _CompletenessStatesExhaustive = Assert<
  Equal<AuditEvidenceCompletenessProof["classification"], "COMPLETE" | "INCOMPLETE" | "DISPUTED">
>
type _ProjectionStatesExhaustive = Assert<
  Equal<AuditEvidenceProjection["state"], "NOT_READY" | "READY" | "RECORDING" | "RECORDED" | "DISPUTED" | "CORRECTED">
>
type _CompleteProofIsEligible = Assert<Equal<CompleteAuditEvidenceProof["auditEligible"], true>>
type _HandoffCreatesNoAudit = Assert<Equal<F1dHandoffEligibility["createsAuditEvidence"], false>>
type _HandoffCreatesNoAnchor = Assert<Equal<F1dHandoffEligibility["createsAnchor"], false>>
type _CommitmentHasOneDigestOwner = Assert<Equal<keyof Pick<AuditEvidenceCommitment, "digest">, "digest">>
type _RecordedTopLevelEvidenceHashIsNever = Assert<Equal<RecordedAuditEvidence["evidenceHash"], undefined>>
type _RecordedTopLevelPayloadDigestIsNever = Assert<Equal<RecordedAuditEvidence["canonicalPayloadDigest"], undefined>>

// @ts-expect-error Provenance without cutoff cannot satisfy the contract.
type _MissingCutoffRejected = Assert<IsAssignable<Omit<AuditEvidenceProvenanceBinding, "cutoffSequence">, AuditEvidenceProvenanceBinding>>
// @ts-expect-error RECORDED without completeness is invalid.
type _RecordedWithoutCompletenessRejected = Assert<IsAssignable<Omit<RecordedAuditEvidence, "completeness">, RecordedAuditEvidence>>
// @ts-expect-error RECORDED without provenance is invalid.
type _RecordedWithoutProvenanceRejected = Assert<IsAssignable<Omit<RecordedAuditEvidence, "provenance">, RecordedAuditEvidence>>
// @ts-expect-error RECORDED without record authority is invalid.
type _RecordedWithoutRecordAuthorityRejected = Assert<IsAssignable<Omit<RecordedAuditEvidence, "recordAuthorityRef">, RecordedAuditEvidence>>
// @ts-expect-error Incomplete evidence is not a complete proof.
type _IncompleteIsNotComplete = Assert<IsAssignable<Extract<AuditEvidenceCompletenessProof, { classification: "INCOMPLETE" }>, CompleteAuditEvidenceProof>>
// @ts-expect-error Disputed evidence is not a complete proof.
type _DisputedIsNotComplete = Assert<IsAssignable<Extract<AuditEvidenceCompletenessProof, { classification: "DISPUTED" }>, CompleteAuditEvidenceProof>>
// @ts-expect-error NOT_READY cannot carry a record.
type _NotReadyRecordRejected = Assert<IsAssignable<{ state: "NOT_READY"; blockers: readonly []; record: RecordedAuditEvidence }, AuditEvidenceProjection>>
// @ts-expect-error READY cannot synthesize a recorded record.
type _ReadyRecordRejected = Assert<IsAssignable<{ state: "READY"; handoff: F1dHandoffEligibility; record: RecordedAuditEvidence }, AuditEvidenceProjection>>

export type {
  _CompletenessStatesExhaustive,
  _ProjectionStatesExhaustive,
  _CompleteProofIsEligible,
  _HandoffCreatesNoAudit,
  _HandoffCreatesNoAnchor,
  _CommitmentHasOneDigestOwner,
  _RecordedTopLevelEvidenceHashIsNever,
  _RecordedTopLevelPayloadDigestIsNever,
  _MissingCutoffRejected,
  _RecordedWithoutCompletenessRejected,
  _RecordedWithoutProvenanceRejected,
  _RecordedWithoutRecordAuthorityRejected,
  _IncompleteIsNotComplete,
  _DisputedIsNotComplete,
  _NotReadyRecordRejected,
  _ReadyRecordRejected,
}
