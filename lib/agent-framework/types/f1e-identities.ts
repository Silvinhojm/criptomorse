import type { ChainId } from "./f1c-execution-attempts"

/**
 * RI-L2 F1e.1 nominal identities and digest descriptors.
 *
 * These declarations are type-only. They do not hash, canonicalize, persist,
 * compare revisions, read a clock, or grant authority.
 */
type Nominal<Name extends string> = { readonly __f1eNominal: Name }
type Opaque<Base, Name extends string> = Base & Nominal<Name>

export type AuditEvidenceId = Opaque<string, "AuditEvidenceId">
export type AuditRevision = Opaque<string, "AuditRevision">
export type AuditCreationRequestId = Opaque<string, "AuditCreationRequestId">
export type AuditCreationRequestDigest = Opaque<string, "AuditCreationRequestDigest">
export type AuditEvidenceCutoffSequence = Opaque<string, "AuditEvidenceCutoffSequence">
export type AuditEvidenceSchemaVersion = Opaque<string, "AuditEvidenceSchemaVersion">
export type CanonicalizationProfileVersion = Opaque<string, "CanonicalizationProfileVersion">
export type AuditRecordedAt = Opaque<string, "AuditRecordedAt">
export type AuditCorrectionId = Opaque<string, "AuditCorrectionId">
export type AuditCorrectionReason = Opaque<string, "AuditCorrectionReason">
export type AuditableCanonicalPayloadRef = Opaque<string, "AuditableCanonicalPayloadRef">
export type CanonicalPayloadDigest = Opaque<string, "CanonicalPayloadDigest">
export type AuditEvidenceCommitmentDigest = Opaque<string, "AuditEvidenceCommitmentDigest">

export type AuditAssemblyAuthorityRef = Opaque<string, "AuditAssemblyAuthorityRef">
export type AuditRecordAuthorityRef = Opaque<string, "AuditRecordAuthorityRef">
export type AnchorEligibilityAuthorityRef = Opaque<string, "AnchorEligibilityAuthorityRef">
export type AnchorRequestAuthorityRef = Opaque<string, "AnchorRequestAuthorityRef">
export type AnchorSubmissionAuthorityRef = Opaque<string, "AnchorSubmissionAuthorityRef">
export type AnchorConfirmationAuthorityRef = Opaque<string, "AnchorConfirmationAuthorityRef">

export type AnchorRequestId = Opaque<string, "AnchorRequestId">
export type AnchorRevision = Opaque<string, "AnchorRevision">
export type AnchorRequestCreationRequestId = Opaque<string, "AnchorRequestCreationRequestId">
export type AnchorSubmissionAttemptId = Opaque<string, "AnchorSubmissionAttemptId">
export type AnchorArtifactDigest = Opaque<string, "AnchorArtifactDigest">
export type AnchorArtifactSchemaVersion = Opaque<string, "AnchorArtifactSchemaVersion">
export type ExternalAnchorTransactionHash = Opaque<string, "ExternalAnchorTransactionHash">
export type AnchorProfileId = Opaque<string, "AnchorProfileId">
export type AnchorProfileVersion = Opaque<string, "AnchorProfileVersion">
export type AnchorNetworkIdentity = Opaque<string, "AnchorNetworkIdentity">
export type AnchorAnchoredAt = Opaque<string, "AnchorAnchoredAt">
export type AnchorFailureReasonRef = Opaque<string, "AnchorFailureReasonRef">

export type HashAlgorithmId = Opaque<string, "HashAlgorithmId">
export type HashAlgorithmVersion = Opaque<string, "HashAlgorithmVersion">
export type DigestEncoding = "LOWERCASE_HEX"
export type DomainSeparatorId = Opaque<string, "DomainSeparatorId">
export type DomainSeparatorVersion = Opaque<string, "DomainSeparatorVersion">

export type HashAlgorithmDescriptor = {
  readonly algorithmId: HashAlgorithmId
  readonly algorithmVersion: HashAlgorithmVersion
  readonly digestEncoding: DigestEncoding
  readonly domainSeparatorId: DomainSeparatorId
  readonly domainSeparatorVersion: DomainSeparatorVersion
}

export type CanonicalPayloadDigestRef = {
  readonly kind: "CANONICAL_PAYLOAD_DIGEST_REF"
  readonly digest: CanonicalPayloadDigest
  readonly algorithm: HashAlgorithmDescriptor
  readonly schemaVersion: AuditEvidenceSchemaVersion
  readonly canonicalizationProfileVersion: CanonicalizationProfileVersion
}

export type AuditEvidenceCommitmentDigestRef = {
  readonly kind: "AUDIT_EVIDENCE_COMMITMENT_DIGEST_REF"
  readonly digest: AuditEvidenceCommitmentDigest
  readonly algorithm: HashAlgorithmDescriptor
  readonly envelopeSchemaVersion: AuditEvidenceSchemaVersion
  readonly canonicalPayload: CanonicalPayloadDigestRef
}

export type AnchorProfileBinding = {
  readonly profileId: AnchorProfileId
  readonly profileVersion: AnchorProfileVersion
  readonly network: AnchorNetworkIdentity
  readonly chainId: ChainId | null
}

export type AnchorArtifactDigestDescriptor = {
  readonly kind: "ANCHOR_ARTIFACT_DIGEST_DESCRIPTOR"
  readonly digest: AnchorArtifactDigest
  readonly algorithm: HashAlgorithmDescriptor
  readonly artifactSchemaVersion: AnchorArtifactSchemaVersion
  readonly targetProfile: AnchorProfileBinding
  readonly evidenceCommitment: AuditEvidenceCommitmentDigestRef
}

export type ProfileBoundExternalTransactionRef = {
  readonly kind: "PROFILE_BOUND_EXTERNAL_TRANSACTION"
  readonly transactionHash: ExternalAnchorTransactionHash
  readonly profile: AnchorProfileBinding
}

export type AuditEvidenceRef = {
  readonly kind: "AUDIT_EVIDENCE_REF"
  readonly auditEvidenceId: AuditEvidenceId
  readonly auditRevision: AuditRevision
  readonly commitment: AuditEvidenceCommitmentDigestRef
}

export type AnchorRequestRef = {
  readonly kind: "ANCHOR_REQUEST_REF"
  readonly anchorRequestId: AnchorRequestId
  readonly anchorRevision: AnchorRevision
  readonly artifact: AnchorArtifactDigestDescriptor
}

export type F1eTypeCapabilityBoundary = {
  readonly typesProvideAtomicity: false
  readonly typesProvideDurability: false
  readonly typesProvideConsensus: false
  readonly typesProvideEconomicTruth: false
  readonly typesGrantRuntimeAuthority: false
}
