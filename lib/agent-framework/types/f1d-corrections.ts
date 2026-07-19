import type { EvidenceRef, ReconciliationInputSnapshotDigest, ReconciliationMethodVersion, ReconciliationRevision } from "./f1d-settlement-identities"
import type { DefinitiveReconciliationResult, ReconciliationConclusionReference } from "./f1d-reconciliation"

declare const correctionBrand: unique symbol
type CorrectionId = string & { readonly [correctionBrand]: "ReconciliationCorrectionId" }
type CorrectionReasonCode = string & { readonly [correctionBrand]: "CorrectionReasonCode" }

export type ReconciliationCorrection = {
  readonly correctionId: CorrectionId
  readonly predecessor: ReconciliationConclusionReference
  readonly expectedPredecessorRevision: ReconciliationRevision
  readonly supersedesConclusionDigest: ReconciliationConclusionReference["conclusionDigest"]
  readonly correctionReasonCode: CorrectionReasonCode
  readonly correctionEvidenceRefs: readonly EvidenceRef[]
  readonly correctedInputSnapshotDigest: ReconciliationInputSnapshotDigest
  readonly correctedMethodVersion: ReconciliationMethodVersion
  readonly correctedResult: DefinitiveReconciliationResult
  readonly preservesPredecessor: true
}

export type CorrectionCommitResult =
  | { readonly kind: "CORRECTION_COMMITTED"; readonly correction: ReconciliationCorrection }
  | { readonly kind: "IDEMPOTENT_CORRECTION_RETURNED"; readonly correction: ReconciliationCorrection }
  | { readonly kind: "STALE_PREDECESSOR_REVISION"; readonly committed: false }
  | { readonly kind: "DIVERGENT_SINGLE_HEAD_CONFLICT"; readonly committed: false; readonly recoveryRequired: true }

export type CorrectionStorageContract = {
  readonly kind: "FUTURE_STORAGE_CONTRACT"
  readonly appendOnly: true
  readonly singleHeadCasRequired: true
  readonly predecessorOverwriteAllowed: false
  readonly typeSystemProvidesAtomicity: false
}
