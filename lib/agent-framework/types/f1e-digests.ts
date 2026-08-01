import type {
  CanonicalPayloadDigest,
  CanonicalPayloadDigestRef,
  HashAlgorithmDescriptor,
} from "./f1e-identities"
import type {
  AggregateProjectionDigest,
  AggregateProjectionDigestDescriptor,
  CanonicalPayloadDigestDescriptor,
  InvariantId,
  RedactionManifestDigest,
  RedactionManifestDigestDescriptor,
  ResourceLimitId,
} from "./f1e-digest-contracts"
import type {
  SemanticInputReason,
  UnsupportedReason,
} from "./f1e-canonicalization"
import { bytesToLowerHex } from "./f1e-canonicalization"

type DigestVerificationDomainMap = {
  readonly CANONICAL_PAYLOAD: {
    readonly descriptor: CanonicalPayloadDigestDescriptor
    readonly digest: CanonicalPayloadDigest
  }
  readonly AGGREGATE_PROJECTION: {
    readonly descriptor: AggregateProjectionDigestDescriptor
    readonly digest: AggregateProjectionDigest
  }
  readonly REDACTION_MANIFEST: {
    readonly descriptor: RedactionManifestDigestDescriptor
    readonly digest: RedactionManifestDigest
  }
}

type DigestVerificationDomain = keyof DigestVerificationDomainMap
type DomainDescriptor<D extends DigestVerificationDomain> =
  DigestVerificationDomainMap[D]["descriptor"]
type DomainDigest<D extends DigestVerificationDomain> =
  DigestVerificationDomainMap[D]["digest"]

type PureDigestVerificationResult<D extends DigestVerificationDomain> =
  | {
      readonly kind: "DIGEST_MATCH"
      readonly domain: D
      readonly descriptor: DomainDescriptor<D>
      readonly digest: DomainDigest<D>
      readonly reason?: never
      readonly expectedDescriptor?: never
      readonly actualDescriptor?: never
      readonly expectedDigest?: never
      readonly actualDigest?: never
      readonly limitId?: never
      readonly invariantId?: never
    }
  | {
      readonly kind: "DIGEST_INPUT_REJECTED"
      readonly domain: D
      readonly reason: SemanticInputReason
      readonly descriptor?: never
      readonly digest?: never
      readonly expectedDescriptor?: never
      readonly actualDescriptor?: never
      readonly expectedDigest?: never
      readonly actualDigest?: never
      readonly limitId?: never
      readonly invariantId?: never
    }
  | {
      readonly kind: "DIGEST_UNSUPPORTED"
      readonly domain: D
      readonly reason: UnsupportedReason
      readonly descriptor?: never
      readonly digest?: never
      readonly expectedDescriptor?: never
      readonly actualDescriptor?: never
      readonly expectedDigest?: never
      readonly actualDigest?: never
      readonly limitId?: never
      readonly invariantId?: never
    }
  | {
      readonly kind: "DIGEST_DESCRIPTOR_MISMATCH"
      readonly domain: D
      readonly reason: "DESCRIPTOR_MISMATCH"
      readonly expectedDescriptor: DomainDescriptor<D>
      readonly actualDescriptor: DomainDescriptor<D>
      readonly descriptor?: never
      readonly digest?: never
      readonly expectedDigest?: never
      readonly actualDigest?: never
      readonly limitId?: never
      readonly invariantId?: never
    }
  | {
      readonly kind: "DIGEST_VALUE_MISMATCH"
      readonly domain: D
      readonly reason: "DIGEST_VALUE_MISMATCH"
      readonly descriptor: DomainDescriptor<D>
      readonly expectedDigest: DomainDigest<D>
      readonly actualDigest: DomainDigest<D>
      readonly digest?: never
      readonly expectedDescriptor?: never
      readonly actualDescriptor?: never
      readonly limitId?: never
      readonly invariantId?: never
    }
  | {
      readonly kind: "DIGEST_RESOURCE_LIMIT_EXCEEDED"
      readonly domain: D
      readonly reason: "RESOURCE_LIMIT_EXCEEDED"
      readonly limitId: ResourceLimitId
      readonly descriptor?: never
      readonly digest?: never
      readonly expectedDescriptor?: never
      readonly actualDescriptor?: never
      readonly expectedDigest?: never
      readonly actualDigest?: never
      readonly invariantId?: never
    }
  | {
      readonly kind: "DIGEST_INTERNAL_INVARIANT_VIOLATION"
      readonly domain: D
      readonly reason: "INTERNAL_INVARIANT_VIOLATION"
      readonly invariantId: InvariantId
      readonly descriptor?: never
      readonly digest?: never
      readonly expectedDescriptor?: never
      readonly actualDescriptor?: never
      readonly expectedDigest?: never
      readonly actualDigest?: never
      readonly limitId?: never
    }

export type CanonicalPayloadDigestVerificationResult =
  PureDigestVerificationResult<"CANONICAL_PAYLOAD">
export type AggregateProjectionDigestVerificationResult =
  PureDigestVerificationResult<"AGGREGATE_PROJECTION">
export type RedactionManifestDigestVerificationResult =
  PureDigestVerificationResult<"REDACTION_MANIFEST">

export type RegisteredDomainSeparator = {
  readonly id: string
  readonly version: string
  readonly separator: string
}

export type DigestComputationResult =
  | { readonly kind: "DIGEST_COMPUTED"; readonly lowercaseHex: string }
  | { readonly kind: "DIGEST_UNSUPPORTED"; readonly reason: UnsupportedReason }
  | { readonly kind: "DIGEST_INPUT_REJECTED"; readonly reason: SemanticInputReason }

const encoder = new TextEncoder()

function isPrintableAsciiComponent(value: string, maximumLength: number): boolean {
  if (value.length < 1 || value.length > maximumLength) return false
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x21 || code > 0x7e) return false
  }
  return true
}

export function frameCanonicalBytes(
  separator: string,
  schemaVersion: string,
  canonicalBytes: Uint8Array,
): Uint8Array | null {
  if (!isPrintableAsciiComponent(separator, 129)) return null
  if (!isPrintableAsciiComponent(schemaVersion, 64)) return null
  const separatorBytes = encoder.encode(separator)
  const schemaBytes = encoder.encode(schemaVersion)
  const framed = new Uint8Array(separatorBytes.length + schemaBytes.length + canonicalBytes.length + 2)
  framed.set(separatorBytes, 0)
  framed[separatorBytes.length] = 0
  framed.set(schemaBytes, separatorBytes.length + 1)
  framed[separatorBytes.length + schemaBytes.length + 1] = 0
  framed.set(canonicalBytes, separatorBytes.length + schemaBytes.length + 2)
  return framed
}

function supportedAlgorithm(algorithm: HashAlgorithmDescriptor): boolean {
  return String(algorithm.algorithmId) === "SHA-256"
    && String(algorithm.algorithmVersion) === "1"
    && algorithm.digestEncoding === "LOWERCASE_HEX"
}

function separatorMatches(
  algorithm: HashAlgorithmDescriptor,
  registered: RegisteredDomainSeparator,
): boolean {
  return String(algorithm.domainSeparatorId) === registered.id
    && String(algorithm.domainSeparatorVersion) === registered.version
    && isPrintableAsciiComponent(registered.id, 64)
    && isPrintableAsciiComponent(registered.version, 64)
    && isPrintableAsciiComponent(registered.separator, 129)
}

export async function digestCanonicalBytesForDescriptor(
  canonicalBytes: Uint8Array,
  schemaVersion: string,
  algorithm: HashAlgorithmDescriptor,
  separator: RegisteredDomainSeparator,
): Promise<DigestComputationResult> {
  if (!supportedAlgorithm(algorithm)) return { kind: "DIGEST_UNSUPPORTED", reason: "UNSUPPORTED_ALGORITHM" }
  if (!separatorMatches(algorithm, separator)) return { kind: "DIGEST_INPUT_REJECTED", reason: "INVALID_DIGEST" }
  const framed = frameCanonicalBytes(separator.separator, schemaVersion, canonicalBytes)
  if (!framed) return { kind: "DIGEST_INPUT_REJECTED", reason: "INVALID_DIGEST" }
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return { kind: "DIGEST_UNSUPPORTED", reason: "UNSUPPORTED_ALGORITHM" }
  const digestInput = new Uint8Array(framed.length)
  digestInput.set(framed)
  const digest = await subtle.digest("SHA-256", digestInput)
  return { kind: "DIGEST_COMPUTED", lowercaseHex: bytesToLowerHex(new Uint8Array(digest)) }
}

export function hashAlgorithmDescriptorsEqual(
  left: HashAlgorithmDescriptor,
  right: HashAlgorithmDescriptor,
): boolean {
  return String(left.algorithmId) === String(right.algorithmId)
    && String(left.algorithmVersion) === String(right.algorithmVersion)
    && left.digestEncoding === right.digestEncoding
    && String(left.domainSeparatorId) === String(right.domainSeparatorId)
    && String(left.domainSeparatorVersion) === String(right.domainSeparatorVersion)
}

export function canonicalPayloadDescriptorsEqual(
  left: CanonicalPayloadDigestDescriptor,
  right: CanonicalPayloadDigestDescriptor,
): boolean {
  return left.kind === right.kind
    && hashAlgorithmDescriptorsEqual(left.algorithm, right.algorithm)
    && String(left.schemaVersion) === String(right.schemaVersion)
    && String(left.canonicalizationProfileVersion) === String(right.canonicalizationProfileVersion)
    && left.payloadKind === right.payloadKind
}

export async function verifyCanonicalPayloadDigest(
  canonicalBytes: Uint8Array,
  descriptor: CanonicalPayloadDigestDescriptor,
  expected: CanonicalPayloadDigestRef,
  separator: RegisteredDomainSeparator,
): Promise<CanonicalPayloadDigestVerificationResult> {
  const expectedDescriptor: CanonicalPayloadDigestDescriptor = {
    kind: "CANONICAL_PAYLOAD_DIGEST_DESCRIPTOR",
    algorithm: expected.algorithm,
    schemaVersion: expected.schemaVersion,
    canonicalizationProfileVersion: expected.canonicalizationProfileVersion,
    payloadKind: "AUDITABLE_CANONICAL_PAYLOAD",
  }
  if (!canonicalPayloadDescriptorsEqual(expectedDescriptor, descriptor)) {
    return {
      kind: "DIGEST_DESCRIPTOR_MISMATCH",
      domain: "CANONICAL_PAYLOAD",
      reason: "DESCRIPTOR_MISMATCH",
      expectedDescriptor,
      actualDescriptor: descriptor,
    }
  }
  const computed = await digestCanonicalBytesForDescriptor(
    canonicalBytes,
    String(descriptor.schemaVersion),
    descriptor.algorithm,
    separator,
  )
  if (computed.kind === "DIGEST_UNSUPPORTED") {
    return { kind: "DIGEST_UNSUPPORTED", domain: "CANONICAL_PAYLOAD", reason: computed.reason }
  }
  if (computed.kind === "DIGEST_INPUT_REJECTED") {
    return { kind: "DIGEST_INPUT_REJECTED", domain: "CANONICAL_PAYLOAD", reason: computed.reason }
  }
  const actualDigest = computed.lowercaseHex as CanonicalPayloadDigest
  if (String(expected.digest) !== computed.lowercaseHex) {
    return {
      kind: "DIGEST_VALUE_MISMATCH",
      domain: "CANONICAL_PAYLOAD",
      reason: "DIGEST_VALUE_MISMATCH",
      descriptor,
      expectedDigest: expected.digest,
      actualDigest,
    }
  }
  return {
    kind: "DIGEST_MATCH",
    domain: "CANONICAL_PAYLOAD",
    descriptor,
    digest: expected.digest,
  }
}
