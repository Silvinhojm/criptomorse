import type { CanonicalPayloadDigest, CanonicalPayloadDigestDescriptor, AggregateProjectionDigest, AggregateProjectionDigestDescriptor, InvariantId, RedactionManifestDigest, RedactionManifestDigestDescriptor, RedactionManifestDigestRef, ResourceLimitId } from "./f1e-digest-contracts"
import type { CanonicalizationInput, CanonicalizationResult } from "./f1e-canonicalization"
import type { GoldenVector, GoldenVectorId } from "./f1e-golden-vectors"
import type { AnchorHistoricalDirectAnchoredEntry, AnchorHistoricalDirectFailedEntry, AnchorHistoricalUnknownLateAnchoredEntry, AnchorHistoricalUnknownLateFailedEntry, AnchorHistoricalUnknownUnresolvedEntry } from "./f1e-projections"
import type { CanonicalPayloadDigestVerificationResult } from "./f1e-digests"

type Assert<T extends true> = T
type IsAssignable<From, To> = [From] extends [To] ? true : false
type Not<T extends boolean> = T extends true ? false : true

type _canonicalNotAggregate = Assert<Not<IsAssignable<CanonicalPayloadDigest, AggregateProjectionDigest>>>
type _aggregateNotManifest = Assert<Not<IsAssignable<AggregateProjectionDigest, RedactionManifestDigest>>>
type _canonicalDescriptorNotAggregate = Assert<Not<IsAssignable<CanonicalPayloadDigestDescriptor, AggregateProjectionDigestDescriptor>>>
type _aggregateDescriptorNotManifest = Assert<Not<IsAssignable<AggregateProjectionDigestDescriptor, RedactionManifestDigestDescriptor>>>
type _bareManifestDigestNotRef = Assert<Not<IsAssignable<RedactionManifestDigest, RedactionManifestDigestRef>>>
type _descriptorRequired = Assert<Not<IsAssignable<{ readonly kind: "REDACTION_MANIFEST_DIGEST_REF"; readonly digest: RedactionManifestDigest }, RedactionManifestDigestRef>>>
type _resourceNotInvariant = Assert<Not<IsAssignable<ResourceLimitId, InvariantId>>>
type _arbitraryObjectNotInput = Assert<Not<IsAssignable<{ readonly value: string }, CanonicalizationInput>>>
type _accessorShapeNotInput = Assert<Not<IsAssignable<{ readonly get: () => string }, CanonicalizationInput>>>
type _knownCrossFieldRejected = Assert<Not<IsAssignable<{ readonly kind: "CANONICALIZED"; readonly canonicalBytes: Uint8Array; readonly reason: "INVALID_ORDER" }, CanonicalizationResult>>>
type _immutableRequired = Assert<Not<IsAssignable<{ readonly kind: "INVALID_RAW_INPUT_VECTOR"; readonly vectorId: GoldenVectorId; readonly profileVersion: never; readonly rawBytesHex: never; readonly parserProfileVersion: never; readonly expectedReason: "INVALID_UNICODE" }, GoldenVector>>>
type _directAnchoredRejectsLate = Assert<Not<IsAssignable<{ readonly lateResolution: "LATE_ANCHORED" }, AnchorHistoricalDirectAnchoredEntry>>>
type _directFailedRejectsLate = Assert<Not<IsAssignable<{ readonly lateEvidenceRefs: readonly [] }, AnchorHistoricalDirectFailedEntry>>>
type _fiveHistoryVariantsExist = Assert<[
  AnchorHistoricalDirectAnchoredEntry,
  AnchorHistoricalDirectFailedEntry,
  AnchorHistoricalUnknownUnresolvedEntry,
  AnchorHistoricalUnknownLateAnchoredEntry,
  AnchorHistoricalUnknownLateFailedEntry,
] extends readonly [object, object, object, object, object] ? true : false>
type MatchBranch = Extract<CanonicalPayloadDigestVerificationResult, { kind: "DIGEST_MATCH" }>
type DescriptorMismatchBranch = Extract<CanonicalPayloadDigestVerificationResult, { kind: "DIGEST_DESCRIPTOR_MISMATCH" }>
type ValueMismatchBranch = Extract<CanonicalPayloadDigestVerificationResult, { kind: "DIGEST_VALUE_MISMATCH" }>
type InputRejectedBranch = Extract<CanonicalPayloadDigestVerificationResult, { kind: "DIGEST_INPUT_REJECTED" }>
type _failureRequiresDomain = Assert<Not<IsAssignable<Omit<InputRejectedBranch, "domain">, CanonicalPayloadDigestVerificationResult>>>
type _matchRejectsLimit = Assert<Not<IsAssignable<Omit<MatchBranch, "limitId"> & { readonly limitId: ResourceLimitId }, CanonicalPayloadDigestVerificationResult>>>
type _descriptorMismatchRejectsActualDigest = Assert<Not<IsAssignable<Omit<DescriptorMismatchBranch, "actualDigest"> & { readonly actualDigest: CanonicalPayloadDigest }, CanonicalPayloadDigestVerificationResult>>>
type _descriptorMismatchRejectsLimit = Assert<Not<IsAssignable<Omit<DescriptorMismatchBranch, "limitId"> & { readonly limitId: ResourceLimitId }, CanonicalPayloadDigestVerificationResult>>>
type _valueMismatchRejectsExpectedDescriptor = Assert<Not<IsAssignable<Omit<ValueMismatchBranch, "expectedDescriptor"> & { readonly expectedDescriptor: CanonicalPayloadDigestDescriptor }, CanonicalPayloadDigestVerificationResult>>>

export type DigestContractTypeTests =
  | _canonicalNotAggregate
  | _aggregateNotManifest
  | _canonicalDescriptorNotAggregate
  | _aggregateDescriptorNotManifest
  | _bareManifestDigestNotRef
  | _descriptorRequired
  | _resourceNotInvariant
  | _arbitraryObjectNotInput
  | _accessorShapeNotInput
  | _knownCrossFieldRejected
  | _immutableRequired
  | _directAnchoredRejectsLate
  | _directFailedRejectsLate
  | _fiveHistoryVariantsExist
  | _failureRequiresDomain
  | _matchRejectsLimit
  | _descriptorMismatchRejectsActualDigest
  | _descriptorMismatchRejectsLimit
  | _valueMismatchRejectsExpectedDescriptor
