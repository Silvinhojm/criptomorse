import type { ProofDigest } from "./f1d-settlement-identities"
import type { AuditEvidenceRef, AnchorRequestRef } from "./f1e-identities"
import type {
  AggregateProjectionDigestRef,
  InvariantId,
  RedactionManifestDigest,
  RedactionManifestDigestDescriptor,
  RedactionManifestDigestRef,
} from "./f1e-digest-contracts"
import { canonicalizeControlledValue } from "./f1e-canonicalization"
import type {
  RedactionManifestDigestVerificationResult,
  RegisteredDomainSeparator,
} from "./f1e-digests"
import {
  digestCanonicalBytesForDescriptor,
  hashAlgorithmDescriptorsEqual,
} from "./f1e-digests"

type Nominal<Name extends string> = { readonly __f1e2Nominal: Name }
type Opaque<Base, Name extends string> = Base & Nominal<Name>

export type DisclosurePolicyId = Opaque<string, "DisclosurePolicyId">
export type DisclosurePolicyVersion = Opaque<string, "DisclosurePolicyVersion">
export type RedactionManifestId = Opaque<string, "RedactionManifestId">
export type RedactionManifestVersion = Opaque<string, "RedactionManifestVersion">
export type StableDisclosureFieldId = Opaque<string, "StableDisclosureFieldId">
export type StableDisclosureClassId = Opaque<string, "StableDisclosureClassId">

export type RedactionAction = "INCLUDE" | "OMIT" | "MASK" | "COMMIT_ONLY"

export type RedactionManifestEntry = {
  readonly fieldId: StableDisclosureFieldId
  readonly classId: StableDisclosureClassId
  readonly action: RedactionAction
  readonly sourceValueDigest: ProofDigest | null
}

export type RedactionSourceBinding =
  | {
      readonly kind: "AUDIT_SOURCE"
      readonly auditEvidenceRef: AuditEvidenceRef
      readonly anchorRequestRef?: never
      readonly aggregateProjection?: never
    }
  | {
      readonly kind: "ANCHOR_SOURCE"
      readonly anchorRequestRef: AnchorRequestRef
      readonly auditEvidenceRef?: never
      readonly aggregateProjection?: never
    }
  | {
      readonly kind: "AGGREGATE_SOURCE"
      readonly aggregateProjection: AggregateProjectionDigestRef
      readonly auditEvidenceRef?: never
      readonly anchorRequestRef?: never
    }

export type RedactionManifestCanonicalFields = {
  readonly kind: "REDACTION_MANIFEST"
  readonly source: RedactionSourceBinding
  readonly manifestId: RedactionManifestId
  readonly version: RedactionManifestVersion
  readonly policyId: DisclosurePolicyId
  readonly policyVersion: DisclosurePolicyVersion
  readonly entries: readonly RedactionManifestEntry[]
}

export type RedactionManifestCanonicalPayload = RedactionManifestCanonicalFields & {
  readonly digest?: never
}

export type RedactionManifest = RedactionManifestCanonicalFields & {
  readonly digest: RedactionManifestDigestRef
}

export type DisclosurePolicyRule = {
  readonly fieldId: StableDisclosureFieldId
  readonly classId: StableDisclosureClassId
  readonly action: RedactionAction
}

export type DisclosurePolicy = {
  readonly policyId: DisclosurePolicyId
  readonly policyVersion: DisclosurePolicyVersion
  readonly rules: readonly DisclosurePolicyRule[]
}

export type RedactionSourceField = {
  readonly fieldId: StableDisclosureFieldId
  readonly classId: StableDisclosureClassId
  readonly sourceValueDigest: ProofDigest | null
}

export type RedactionProjectionInput = {
  readonly source: RedactionSourceBinding
  readonly manifestId: RedactionManifestId
  readonly version: RedactionManifestVersion
  readonly policy: DisclosurePolicy
  readonly fields: readonly RedactionSourceField[]
}

export type RedactionProjectionResult =
  | { readonly kind: "REDACTION_PROJECTED"; readonly payload: RedactionManifestCanonicalPayload }
  | {
      readonly kind: "REDACTION_INPUT_REJECTED"
      readonly reason: "DUPLICATE_POLICY_FIELD" | "DUPLICATE_SOURCE_FIELD" | "POLICY_FIELD_MISSING" | "CLASS_MISMATCH"
    }

function fieldKey(fieldId: StableDisclosureFieldId): string {
  return String(fieldId)
}

export function projectRedactionManifest(input: RedactionProjectionInput): RedactionProjectionResult {
  const rules = new Map<string, DisclosurePolicyRule>()
  for (const rule of input.policy.rules) {
    const key = fieldKey(rule.fieldId)
    if (rules.has(key)) return { kind: "REDACTION_INPUT_REJECTED", reason: "DUPLICATE_POLICY_FIELD" }
    rules.set(key, rule)
  }
  const seen = new Set<string>()
  const entries: RedactionManifestEntry[] = []
  for (const field of input.fields) {
    const key = fieldKey(field.fieldId)
    if (seen.has(key)) return { kind: "REDACTION_INPUT_REJECTED", reason: "DUPLICATE_SOURCE_FIELD" }
    seen.add(key)
    const rule = rules.get(key)
    if (!rule) return { kind: "REDACTION_INPUT_REJECTED", reason: "POLICY_FIELD_MISSING" }
    if (String(rule.classId) !== String(field.classId)) return { kind: "REDACTION_INPUT_REJECTED", reason: "CLASS_MISMATCH" }
    entries.push({
      fieldId: field.fieldId,
      classId: field.classId,
      action: rule.action,
      sourceValueDigest: field.sourceValueDigest,
    })
  }
  entries.sort((left, right) => {
    const leftId = String(left.fieldId)
    const rightId = String(right.fieldId)
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
  })
  return {
    kind: "REDACTION_PROJECTED",
    payload: {
      kind: "REDACTION_MANIFEST",
      source: input.source,
      manifestId: input.manifestId,
      version: input.version,
      policyId: input.policy.policyId,
      policyVersion: input.policy.policyVersion,
      entries,
    },
  }
}

export function attachRedactionManifestDigest(
  payload: RedactionManifestCanonicalPayload,
  digest: RedactionManifestDigestRef,
): RedactionManifest {
  return {
    kind: payload.kind,
    source: payload.source,
    manifestId: payload.manifestId,
    version: payload.version,
    policyId: payload.policyId,
    policyVersion: payload.policyVersion,
    entries: payload.entries,
    digest,
  }
}

export async function createRedactionManifestDigestRef(
  payload: RedactionManifestCanonicalPayload,
  descriptor: RedactionManifestDigestDescriptor,
  separator: RegisteredDomainSeparator,
): Promise<RedactionManifestDigestRef | null> {
  try {
    const computed = await digestCanonicalBytesForDescriptor(
      canonicalizeControlledValue(payload),
      String(descriptor.schemaVersion),
      descriptor.algorithm,
      separator,
    )
    if (computed.kind !== "DIGEST_COMPUTED") return null
    return {
      kind: "REDACTION_MANIFEST_DIGEST_REF",
      digest: computed.lowercaseHex as RedactionManifestDigest,
      descriptor,
    }
  } catch {
    return null
  }
}

function descriptorsEqual(
  left: RedactionManifestDigestDescriptor,
  right: RedactionManifestDigestDescriptor,
): boolean {
  return left.kind === right.kind
    && hashAlgorithmDescriptorsEqual(left.algorithm, right.algorithm)
    && String(left.schemaVersion) === String(right.schemaVersion)
    && String(left.canonicalizationProfileVersion) === String(right.canonicalizationProfileVersion)
    && left.payloadKind === right.payloadKind
}

export async function verifyRedactionManifestDigest(
  payload: RedactionManifestCanonicalPayload,
  expected: RedactionManifestDigestRef,
  descriptor: RedactionManifestDigestDescriptor,
  separator: RegisteredDomainSeparator,
): Promise<RedactionManifestDigestVerificationResult> {
  if (!descriptorsEqual(expected.descriptor, descriptor)) {
    return {
      kind: "DIGEST_DESCRIPTOR_MISMATCH",
      domain: "REDACTION_MANIFEST",
      reason: "DESCRIPTOR_MISMATCH",
      expectedDescriptor: expected.descriptor,
      actualDescriptor: descriptor,
    }
  }
  try {
    const computed = await digestCanonicalBytesForDescriptor(
      canonicalizeControlledValue(payload),
      String(descriptor.schemaVersion),
      descriptor.algorithm,
      separator,
    )
    if (computed.kind === "DIGEST_UNSUPPORTED") return { kind: "DIGEST_UNSUPPORTED", domain: "REDACTION_MANIFEST", reason: computed.reason }
    if (computed.kind === "DIGEST_INPUT_REJECTED") return { kind: "DIGEST_INPUT_REJECTED", domain: "REDACTION_MANIFEST", reason: computed.reason }
    const actualDigest = computed.lowercaseHex as RedactionManifestDigest
    if (computed.lowercaseHex !== String(expected.digest)) {
      return {
        kind: "DIGEST_VALUE_MISMATCH",
        domain: "REDACTION_MANIFEST",
        reason: "DIGEST_VALUE_MISMATCH",
        descriptor,
        expectedDigest: expected.digest,
        actualDigest,
      }
    }
    return { kind: "DIGEST_MATCH", domain: "REDACTION_MANIFEST", descriptor, digest: expected.digest }
  } catch {
    return {
      kind: "DIGEST_INTERNAL_INVARIANT_VIOLATION",
      domain: "REDACTION_MANIFEST",
      reason: "INTERNAL_INVARIANT_VIOLATION",
      invariantId: "REDACTION_MANIFEST_ENCODING_FAILED" as InvariantId,
    }
  }
}

