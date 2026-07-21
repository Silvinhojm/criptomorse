import type {
  AuditCorrectionCommitResult,
  AuditCorrectionRecord,
  AuditCorrectionStorageBoundary,
  AuditCreationResult,
} from "./f1e-audit-corrections"

type Assert<Condition extends true> = Condition
type IsAssignable<From, To> = [From] extends [To] ? true : false
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false

type _CreationOutcomesExhaustive = Assert<
  Equal<
    AuditCreationResult["kind"],
    "AUDIT_RECORDED" | "IDEMPOTENT_AUDIT_RETURNED" | "STALE_AUDIT_REVISION" | "AUDIT_CREATION_CONFLICT"
  >
>
type _CorrectionOutcomesExhaustive = Assert<
  Equal<
    AuditCorrectionCommitResult["kind"],
    "CORRECTION_COMMITTED" | "IDEMPOTENT_CORRECTION_RETURNED" | "STALE_PREDECESSOR_REVISION" | "CORRECTION_CONFLICT_RECOVERY_REQUIRED"
  >
>
type _CorrectionPreservesPredecessor = Assert<Equal<AuditCorrectionRecord["preservesPredecessor"], true>>
type _CorrectionCannotMutatePredecessor = Assert<Equal<AuditCorrectionRecord["mutatesPredecessor"], false>>
type _StorageBoundaryIsFuture = Assert<Equal<AuditCorrectionStorageBoundary["kind"], "FUTURE_STORAGE_CONTRACT">>
type _TypesDoNotProvideAtomicity = Assert<Equal<AuditCorrectionStorageBoundary["typesProvideAtomicity"], false>>
type _LexicalRevisionOrderingForbidden = Assert<Equal<AuditCorrectionStorageBoundary["revisionLexicalOrderingForbidden"], true>>
type _TimestampCasOrderingForbidden = Assert<Equal<AuditCorrectionStorageBoundary["timestampOrderingForCasForbidden"], true>>

// @ts-expect-error Correction without predecessor is invalid.
type _MissingPredecessorRejected = Assert<IsAssignable<Omit<AuditCorrectionRecord, "predecessor">, AuditCorrectionRecord>>
// @ts-expect-error Correction without reason is invalid.
type _MissingReasonRejected = Assert<IsAssignable<Omit<AuditCorrectionRecord, "reason">, AuditCorrectionRecord>>
// @ts-expect-error Correction cannot claim predecessor mutation.
type _MutationClaimRejected = Assert<IsAssignable<Omit<AuditCorrectionRecord, "mutatesPredecessor"> & { readonly mutatesPredecessor: true }, AuditCorrectionRecord>>
// @ts-expect-error Stale outcome cannot be committed.
type _StaleCommittedRejected = Assert<IsAssignable<{ readonly kind: "STALE_PREDECESSOR_REVISION"; readonly committed: true; readonly recoveryRequired: false }, AuditCorrectionCommitResult>>
// @ts-expect-error Conflict must require recovery.
type _ConflictWithoutRecoveryRejected = Assert<IsAssignable<Omit<Extract<AuditCorrectionCommitResult, { kind: "CORRECTION_CONFLICT_RECOVERY_REQUIRED" }>, "recoveryRequired"> & { readonly recoveryRequired: false }, AuditCorrectionCommitResult>>

export type {
  _CreationOutcomesExhaustive,
  _CorrectionOutcomesExhaustive,
  _CorrectionPreservesPredecessor,
  _CorrectionCannotMutatePredecessor,
  _StorageBoundaryIsFuture,
  _TypesDoNotProvideAtomicity,
  _LexicalRevisionOrderingForbidden,
  _TimestampCasOrderingForbidden,
  _MissingPredecessorRejected,
  _MissingReasonRejected,
  _MutationClaimRejected,
  _StaleCommittedRejected,
  _ConflictWithoutRecoveryRejected,
}
