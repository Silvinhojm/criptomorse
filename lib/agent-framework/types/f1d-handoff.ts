import type { DomainEvidenceDigest, ReconciliationId, ReconciliationRevision, SettlementId, SettlementRevision } from "./f1d-settlement-identities"
import type { ReconciliationConclusionReference } from "./f1d-reconciliation"
import type { SettlementProof } from "./f1d-settlement"

export type F1dHandoffEligibility = {
  readonly kind: "F1D_HANDOFF_ELIGIBILITY"
  readonly settlementId: SettlementId
  readonly settlementRevision: SettlementRevision
  readonly settlementProof: SettlementProof
  readonly reconciliationId: ReconciliationId
  readonly reconciliationRevision: ReconciliationRevision
  readonly reconciliationConclusion: ReconciliationConclusionReference
  readonly definitiveResultDigest: DomainEvidenceDigest
  readonly settlementUndisputed: true
  readonly reconciliationUndisputed: true
  readonly authorityMode: "AUTHORITATIVE"
  readonly createsAuditEvidence: false
  readonly createsAnchorRequest: false
  readonly createsAnchor: false
  readonly publishesAnchor: false
  readonly auditEvidence?: never
  readonly anchorRequest?: never
  readonly anchor?: never
  readonly publisher?: never
}

export type F1dCapabilityBoundary = {
  readonly auditEvidenceCapability: "NONE"
  readonly anchorRequestCapability: "NONE"
  readonly anchorPublishCapability: "NONE"
  readonly runtimeExecutionCapability: "NONE"
  readonly economicEffectCapability: "NONE"
}
