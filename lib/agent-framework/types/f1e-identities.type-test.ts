import type { ReconciliationRevision } from "./f1d-settlement-identities"
import type {
  AnchorArtifactDigest,
  AnchorConfirmationAuthorityRef,
  AnchorEligibilityAuthorityRef,
  AnchorRequestAuthorityRef,
  AnchorRequestId,
  AnchorRevision,
  AnchorSubmissionAttemptId,
  AnchorSubmissionAuthorityRef,
  AuditAssemblyAuthorityRef,
  AuditEvidenceCommitmentDigest,
  AuditEvidenceId,
  AuditRecordAuthorityRef,
  AuditRevision,
  CanonicalPayloadDigest,
  ExternalAnchorTransactionHash,
  F1eTypeCapabilityBoundary,
  ProfileBoundExternalTransactionRef,
} from "./f1e-identities"

type Assert<Condition extends true> = Condition
type IsAssignable<From, To> = [From] extends [To] ? true : false
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false

// @ts-expect-error AuditEvidenceId is not AnchorRequestId.
type _AuditIdIsNotAnchorId = Assert<IsAssignable<AuditEvidenceId, AnchorRequestId>>
// @ts-expect-error AuditRevision is not AnchorRevision.
type _AuditRevisionIsNotAnchorRevision = Assert<IsAssignable<AuditRevision, AnchorRevision>>
// @ts-expect-error AnchorRevision is not ReconciliationRevision.
type _AnchorRevisionIsNotReconciliationRevision = Assert<IsAssignable<AnchorRevision, ReconciliationRevision>>
// @ts-expect-error Request and attempt identities are distinct.
type _RequestIdIsNotAttemptId = Assert<IsAssignable<AnchorRequestId, AnchorSubmissionAttemptId>>
// @ts-expect-error Evidence commitment and artifact digest domains are distinct.
type _EvidenceDigestIsNotArtifactDigest = Assert<IsAssignable<AuditEvidenceCommitmentDigest, AnchorArtifactDigest>>
// @ts-expect-error Artifact digest is not an external transaction hash.
type _ArtifactDigestIsNotTransactionHash = Assert<IsAssignable<AnchorArtifactDigest, ExternalAnchorTransactionHash>>
// @ts-expect-error Canonical payload and evidence commitment digests are distinct.
type _PayloadDigestIsNotEvidenceDigest = Assert<IsAssignable<CanonicalPayloadDigest, AuditEvidenceCommitmentDigest>>
// @ts-expect-error Assembly and record authorities are nominally distinct.
type _AssemblyIsNotRecordAuthority = Assert<IsAssignable<AuditAssemblyAuthorityRef, AuditRecordAuthorityRef>>
// @ts-expect-error Eligibility does not grant request authority.
type _EligibilityIsNotRequestAuthority = Assert<IsAssignable<AnchorEligibilityAuthorityRef, AnchorRequestAuthorityRef>>
// @ts-expect-error Request does not grant submission authority.
type _RequestIsNotSubmissionAuthority = Assert<IsAssignable<AnchorRequestAuthorityRef, AnchorSubmissionAuthorityRef>>
// @ts-expect-error Submission does not grant confirmation authority.
type _SubmissionIsNotConfirmationAuthority = Assert<IsAssignable<AnchorSubmissionAuthorityRef, AnchorConfirmationAuthorityRef>>
// @ts-expect-error A bare transaction hash is not profile-bound.
type _BareTransactionIsNotProfileBound = Assert<IsAssignable<ExternalAnchorTransactionHash, ProfileBoundExternalTransactionRef>>

type _CapabilityBoundaryDeniesAtomicity = Assert<Equal<F1eTypeCapabilityBoundary["typesProvideAtomicity"], false>>
type _CapabilityBoundaryDeniesDurability = Assert<Equal<F1eTypeCapabilityBoundary["typesProvideDurability"], false>>
type _CapabilityBoundaryDeniesTruth = Assert<Equal<F1eTypeCapabilityBoundary["typesProvideEconomicTruth"], false>>
type _CapabilityBoundaryDeniesAuthority = Assert<Equal<F1eTypeCapabilityBoundary["typesGrantRuntimeAuthority"], false>>

export type {
  _AuditIdIsNotAnchorId,
  _AuditRevisionIsNotAnchorRevision,
  _AnchorRevisionIsNotReconciliationRevision,
  _RequestIdIsNotAttemptId,
  _EvidenceDigestIsNotArtifactDigest,
  _ArtifactDigestIsNotTransactionHash,
  _PayloadDigestIsNotEvidenceDigest,
  _AssemblyIsNotRecordAuthority,
  _EligibilityIsNotRequestAuthority,
  _RequestIsNotSubmissionAuthority,
  _SubmissionIsNotConfirmationAuthority,
  _BareTransactionIsNotProfileBound,
  _CapabilityBoundaryDeniesAtomicity,
  _CapabilityBoundaryDeniesDurability,
  _CapabilityBoundaryDeniesTruth,
  _CapabilityBoundaryDeniesAuthority,
}
