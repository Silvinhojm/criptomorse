import type {
  OperationalAuthorityProof,
  OperationalAuthorityRevision,
  FencingToken,
} from "./f1b-operational-control"
import type { CausalEventId, CausalEventSequence } from "./f1c-execution-attempts"
import type { F1dHandoffEligibility } from "./f1d-handoff"
import type { ReconciliationConclusionReference } from "./f1d-reconciliation"
import type {
  DomainEvidenceDigest,
  EvidenceRef,
  ProofDigest,
  ReconciliationId,
  ReconciliationRevision,
  SettlementId,
  SettlementRevision,
} from "./f1d-settlement-identities"
import type {
  AuditAssemblyAuthorityRef,
  AuditCorrectionId,
  AuditCorrectionReason,
  AuditCreationRequestDigest,
  AuditCreationRequestId,
  AuditEvidenceCutoffSequence,
  AuditEvidenceId,
  AuditEvidenceRef,
  AuditEvidenceSchemaVersion,
  AuditRecordAuthorityRef,
  AuditRecordedAt,
  AuditRevision,
  AuditableCanonicalPayloadRef,
  AuditEvidenceCommitmentDigestRef,
  CanonicalizationProfileVersion,
  CanonicalPayloadDigest,
} from "./f1e-identities"

/** Type-only AuditEvidence contracts. No recorder, storage, or canonicalizer. */
export type AuditEvidenceProvenanceBinding = {
  readonly kind: "AUDIT_EVIDENCE_PROVENANCE"
  readonly handoff: F1dHandoffEligibility
  readonly settlementId: SettlementId
  readonly settlementRevision: SettlementRevision
  readonly reconciliationId: ReconciliationId
  readonly reconciliationRevision: ReconciliationRevision
  readonly reconciliationConclusion: ReconciliationConclusionReference
  readonly cutoffSequence: AuditEvidenceCutoffSequence
  readonly includedEvidenceRefs: readonly EvidenceRef[]
  readonly sourceEvidenceDigest: DomainEvidenceDigest
  readonly authorityMode: "AUTHORITATIVE"
}

type AuditEvidenceCompletenessBase = {
  readonly expectedMemberSetDigest: ProofDigest
  readonly observedMemberSetDigest: ProofDigest
  readonly proofDigest: ProofDigest
}

export type CompleteAuditEvidenceProof = AuditEvidenceCompletenessBase & {
  readonly classification: "COMPLETE"
  readonly missingEvidenceRefs: readonly []
  readonly disputedEvidenceRefs: readonly []
  readonly auditEligible: true
  readonly disputeRef?: never
}

export type IncompleteAuditEvidenceProof = AuditEvidenceCompletenessBase & {
  readonly classification: "INCOMPLETE"
  readonly missingEvidenceRefs: readonly EvidenceRef[]
  readonly disputedEvidenceRefs: readonly []
  readonly auditEligible: false
  readonly disputeRef?: never
}

export type DisputedAuditEvidenceProof = AuditEvidenceCompletenessBase & {
  readonly classification: "DISPUTED"
  readonly missingEvidenceRefs: readonly EvidenceRef[]
  readonly disputedEvidenceRefs: readonly EvidenceRef[]
  readonly disputeRef: EvidenceRef
  readonly auditEligible: false
}

export type AuditEvidenceCompletenessProof =
  | CompleteAuditEvidenceProof
  | IncompleteAuditEvidenceProof
  | DisputedAuditEvidenceProof

export type AuditEvidenceCommitment = {
  readonly kind: "AUDIT_EVIDENCE_COMMITMENT"
  readonly digest: AuditEvidenceCommitmentDigestRef
  readonly canonicalPayload: AuditableCanonicalPayloadRef
  readonly provenanceDigest: ProofDigest
  readonly completenessDigest: ProofDigest
  readonly cutoffSequence: AuditEvidenceCutoffSequence
}

export type AuditCreationKey = {
  readonly reconciliationId: ReconciliationId
  readonly reconciliationRevision: ReconciliationRevision
  readonly canonicalPayloadDigest: CanonicalPayloadDigest
  readonly schemaVersion: AuditEvidenceSchemaVersion
  readonly canonicalizationProfileVersion: CanonicalizationProfileVersion
}

export type AuditRecordingRequest = {
  readonly kind: "AUDIT_RECORDING_REQUEST"
  readonly creationRequestId: AuditCreationRequestId
  readonly creationRequestDigest: AuditCreationRequestDigest
  readonly key: AuditCreationKey
  readonly provenance: AuditEvidenceProvenanceBinding
  readonly completeness: CompleteAuditEvidenceProof
  readonly assemblyAuthorityRef: AuditAssemblyAuthorityRef
}

export type RecordedAuditEvidence = {
  readonly state: "RECORDED"
  readonly auditEvidenceId: AuditEvidenceId
  readonly auditRevision: AuditRevision
  readonly creationRequestId: AuditCreationRequestId
  readonly creationRequestDigest: AuditCreationRequestDigest
  readonly predecessorAuditEvidenceRef: AuditEvidenceRef | null
  readonly provenance: AuditEvidenceProvenanceBinding
  readonly completeness: CompleteAuditEvidenceProof
  readonly commitment: AuditEvidenceCommitment
  readonly assemblyAuthorityRef: AuditAssemblyAuthorityRef
  readonly recordAuthorityRef: AuditRecordAuthorityRef
  readonly operationalAuthorityProof: OperationalAuthorityProof
  readonly fencingToken: FencingToken
  readonly authorityRevision: OperationalAuthorityRevision
  readonly causalEventId: CausalEventId
  readonly causalEventSequence: CausalEventSequence
  readonly auditedAt: AuditRecordedAt
  readonly disputeRef: null
  readonly immutable: true
  readonly evidenceHash?: never
  readonly canonicalPayloadDigest?: never
}

export type AuditCorrectionRecord = {
  readonly kind: "AUDIT_CORRECTION"
  readonly correctionId: AuditCorrectionId
  readonly predecessor: AuditEvidenceRef
  readonly successor: AuditEvidenceRef
  readonly reason: AuditCorrectionReason
  readonly correctionEvidenceRefs: readonly EvidenceRef[]
  readonly expectedPredecessorRevision: AuditRevision
  readonly causalEventSequence: CausalEventSequence
  readonly recordAuthorityRef: AuditRecordAuthorityRef
  readonly preservesPredecessor: true
  readonly mutatesPredecessor: false
}

export type AuditEvidenceProjection =
  | {
      readonly state: "NOT_READY"
      readonly blockers: readonly EvidenceRef[]
      readonly handoff?: never
      readonly recording?: never
      readonly record?: never
    }
  | {
      readonly state: "READY"
      readonly handoff: F1dHandoffEligibility
      readonly blockers?: never
      readonly recording?: never
      readonly record?: never
    }
  | {
      readonly state: "RECORDING"
      readonly recording: AuditRecordingRequest
      readonly blockers?: never
      readonly handoff?: never
      readonly record?: never
    }
  | {
      readonly state: "RECORDED"
      readonly record: RecordedAuditEvidence
      readonly disputeRef: null
      readonly predecessor?: never
      readonly correction?: never
    }
  | {
      readonly state: "DISPUTED"
      readonly predecessor: RecordedAuditEvidence
      readonly disputeRef: EvidenceRef
      readonly record?: never
      readonly correction?: never
    }
  | {
      readonly state: "CORRECTED"
      readonly predecessor: AuditEvidenceRef
      readonly record: RecordedAuditEvidence
      readonly correction: AuditCorrectionRecord
      readonly disputeRef?: never
    }
