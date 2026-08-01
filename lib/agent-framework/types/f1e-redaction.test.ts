import type { ProofDigest } from "./f1d-settlement-identities"
import type { AuditEvidenceRef } from "./f1e-identities"
import type { RedactionManifestDigestRef } from "./f1e-digest-contracts"
import { redactToClientDto } from "./f1e-client-mapper"
import type { PublicAnchorRef, PublicAuditRef, PublicRedactionManifestRef } from "./f1e-client-dto"
import { projectRedactionManifest } from "./f1e-redaction"
import type { DisclosurePolicyId, DisclosurePolicyVersion, RedactionManifestId, RedactionManifestVersion, StableDisclosureClassId, StableDisclosureFieldId } from "./f1e-redaction"

function expect(condition: boolean, message: string): void { if (!condition) throw new Error(message) }

export function runRedactionTests(): void {
  const field = "field" as StableDisclosureFieldId
  const classId = "public" as StableDisclosureClassId
  const projected = projectRedactionManifest({
    source: { kind: "AUDIT_SOURCE", auditEvidenceRef: auditRef() },
    manifestId: "manifest" as RedactionManifestId,
    version: "1" as RedactionManifestVersion,
    policy: { policyId: "policy" as DisclosurePolicyId, policyVersion: "1" as DisclosurePolicyVersion, rules: [{ fieldId: field, classId, action: "MASK" }] },
    fields: [{ fieldId: field, classId, sourceValueDigest: "value" as ProofDigest }],
  })
  expect(projected.kind === "REDACTION_PROJECTED" && projected.payload.entries[0]?.action === "MASK", "redaction projection")

  const dto = redactToClientDto(
    { kind: "INVALID_INPUT_FAIL_CLOSED", reason: "IMPOSSIBLE_AXIS_COMBINATION", inputDigest: "input" as ProofDigest },
    {
      auditRef: { disclosure: "INCLUDED", value: "audit" as PublicAuditRef },
      anchorCurrentRef: { disclosure: "INCLUDED", value: "anchor" as PublicAnchorRef },
      anchorHistory: [],
      manifestRef: "manifest" as PublicRedactionManifestRef,
      manifestDigest: manifestDigest(),
    },
  )
  const serialized = JSON.stringify(dto)
  expect(Object.keys(dto).length === 8, "exact eight predecessor fields")
  expect(dto.manifestDigest.kind === "REDACTION_MANIFEST_DIGEST_REF", "structured manifest ref")
  for (const forbidden of ["secrets", "credentials", "rawCapability", "capabilityRefs", "providerToken", "signingMaterial", "otp", "keyShare", "rawSignature", "privatePrompt", "rawEvidence", "handoff", "evidenceRefs", "authorityRefs", "fencing", "provenance", "confirmationProof"] as const) {
    expect(!serialized.includes(`\"${forbidden}\"`), `client serialization excludes ${forbidden}`)
  }
}

function auditRef(): AuditEvidenceRef {
  const algorithm = { algorithmId: "SHA-256", algorithmVersion: "1", digestEncoding: "LOWERCASE_HEX" as const, domainSeparatorId: "D", domainSeparatorVersion: "1" }
  return { kind: "AUDIT_EVIDENCE_REF", auditEvidenceId: "audit", auditRevision: "1", commitment: { kind: "AUDIT_EVIDENCE_COMMITMENT_DIGEST_REF", digest: "commitment", algorithm, envelopeSchemaVersion: "1", canonicalPayload: { kind: "CANONICAL_PAYLOAD_DIGEST_REF", digest: "payload", algorithm, schemaVersion: "1", canonicalizationProfileVersion: "1" } } } as AuditEvidenceRef
}
function manifestDigest(): RedactionManifestDigestRef {
  const algorithm = { algorithmId: "SHA-256", algorithmVersion: "1", digestEncoding: "LOWERCASE_HEX" as const, domainSeparatorId: "REDACTION_MANIFEST", domainSeparatorVersion: "1" }
  return { kind: "REDACTION_MANIFEST_DIGEST_REF", digest: "digest", descriptor: { kind: "REDACTION_MANIFEST_DIGEST_DESCRIPTOR", algorithm, schemaVersion: "1", canonicalizationProfileVersion: "1", payloadKind: "F1E_REDACTION_MANIFEST_WITHOUT_DIGEST" } } as RedactionManifestDigestRef
}

runRedactionTests()
