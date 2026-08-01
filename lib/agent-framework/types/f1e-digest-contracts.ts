import type {
  AuditEvidenceSchemaVersion,
  CanonicalizationProfileVersion,
  CanonicalPayloadDigest,
  CanonicalPayloadDigestRef,
  HashAlgorithmDescriptor,
} from "./f1e-identities"

/**
 * Neutral, client-safe digest contracts for RI-L2 F1e.2.
 *
 * This module contains no verifier, hashing code, projection, redaction,
 * client mapper, storage, provider, or other effectful capability.
 */
type Nominal<Name extends string> = { readonly __f1e2Nominal: Name }
type Opaque<Base, Name extends string> = Base & Nominal<Name>

export type { CanonicalPayloadDigest, CanonicalPayloadDigestRef }

export type CanonicalPayloadDigestDescriptor = {
  readonly kind: "CANONICAL_PAYLOAD_DIGEST_DESCRIPTOR"
  readonly algorithm: HashAlgorithmDescriptor
  readonly schemaVersion: AuditEvidenceSchemaVersion
  readonly canonicalizationProfileVersion: CanonicalizationProfileVersion
  readonly payloadKind: "AUDITABLE_CANONICAL_PAYLOAD"
}

export type AggregateProjectionDigest = Opaque<string, "AggregateProjectionDigest">
export type AggregateProjectionSchemaVersion = Opaque<string, "AggregateProjectionSchemaVersion">
export type AggregateProjectionDigestDescriptor = {
  readonly kind: "AGGREGATE_PROJECTION_DIGEST_DESCRIPTOR"
  readonly algorithm: HashAlgorithmDescriptor
  readonly schemaVersion: AggregateProjectionSchemaVersion
  readonly canonicalizationProfileVersion: CanonicalizationProfileVersion
  readonly payloadKind: "F1E_AGGREGATE_INTERNAL_PROJECTION"
}
export type AggregateProjectionDigestRef = {
  readonly kind: "AGGREGATE_PROJECTION_DIGEST_REF"
  readonly digest: AggregateProjectionDigest
  readonly descriptor: AggregateProjectionDigestDescriptor
}

export type RedactionManifestDigest = Opaque<string, "RedactionManifestDigest">
export type RedactionManifestSchemaVersion = Opaque<string, "RedactionManifestSchemaVersion">
export type RedactionManifestDigestDescriptor = {
  readonly kind: "REDACTION_MANIFEST_DIGEST_DESCRIPTOR"
  readonly algorithm: HashAlgorithmDescriptor
  readonly schemaVersion: RedactionManifestSchemaVersion
  readonly canonicalizationProfileVersion: CanonicalizationProfileVersion
  readonly payloadKind: "F1E_REDACTION_MANIFEST_WITHOUT_DIGEST"
}
export type RedactionManifestDigestRef = {
  readonly kind: "REDACTION_MANIFEST_DIGEST_REF"
  readonly digest: RedactionManifestDigest
  readonly descriptor: RedactionManifestDigestDescriptor
}

export type ResourceLimitId = Opaque<string, "ResourceLimitId">
export type InvariantId = Opaque<string, "InvariantId">

