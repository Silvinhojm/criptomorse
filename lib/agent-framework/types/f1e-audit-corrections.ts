import type { AuditCorrectionRecord, RecordedAuditEvidence } from "./f1e-audit-contracts"
import type {
  AuditEvidenceCommitmentDigestRef,
  AuditEvidenceRef,
  AuditRevision,
} from "./f1e-identities"

/** Type-only correction outcomes and future-storage boundaries. */
export type { AuditCorrectionRecord } from "./f1e-audit-contracts"

export type AuditCreationResult =
  | { readonly kind: "AUDIT_RECORDED"; readonly record: RecordedAuditEvidence }
  | { readonly kind: "IDEMPOTENT_AUDIT_RETURNED"; readonly record: RecordedAuditEvidence }
  | { readonly kind: "STALE_AUDIT_REVISION"; readonly committed: false }
  | {
      readonly kind: "AUDIT_CREATION_CONFLICT"
      readonly committed: false
      readonly recoveryRequired: true
    }

export type AuditCorrectionCommitResult =
  | {
      readonly kind: "CORRECTION_COMMITTED"
      readonly committed: true
      readonly recoveryRequired: false
      readonly correction: AuditCorrectionRecord
    }
  | {
      readonly kind: "IDEMPOTENT_CORRECTION_RETURNED"
      readonly committed: false
      readonly recoveryRequired: false
      readonly correction: AuditCorrectionRecord
    }
  | {
      readonly kind: "STALE_PREDECESSOR_REVISION"
      readonly committed: false
      readonly recoveryRequired: false
      readonly expected: AuditRevision
      readonly actual: AuditRevision
    }
  | {
      readonly kind: "CORRECTION_CONFLICT_RECOVERY_REQUIRED"
      readonly committed: false
      readonly recoveryRequired: true
      readonly predecessor: AuditEvidenceRef
      readonly conflictingDigest: AuditEvidenceCommitmentDigestRef
    }

export type AuditCorrectionStorageBoundary = {
  readonly kind: "FUTURE_STORAGE_CONTRACT"
  readonly appendOnlyLineageRequired: true
  readonly atomicCompareAndSwapRequired: true
  readonly globalAcyclicityRequired: true
  readonly typesProvideAtomicity: false
  readonly typesProvideDurability: false
  readonly revisionLexicalOrderingForbidden: true
  readonly timestampOrderingForCasForbidden: true
}
