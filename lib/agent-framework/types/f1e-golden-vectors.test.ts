import type { CanonicalPayloadDigestDescriptor } from "./f1e-digest-contracts"
import type { AuditEvidenceSchemaVersion, CanonicalizationProfileVersion, DomainSeparatorId, DomainSeparatorVersion, HashAlgorithmId, HashAlgorithmVersion } from "./f1e-identities"
import { canonicalize, profileText } from "./f1e-canonicalization"
import { digestCanonicalBytesForDescriptor, frameCanonicalBytes, verifyCanonicalPayloadDigest } from "./f1e-digests"
import { F1E_GOLDEN_PROFILE, F1E_GOLDEN_VECTOR_RECIPES, F1E_INVALID_LOGICAL_GOLDEN_VECTORS, F1E_INVALID_RAW_GOLDEN_VECTORS, F1E_VALID_GOLDEN_VECTORS, createGoldenVectorSetVersion, createNonNegativeSafeInteger, createNormativeVectorFileName, createSha256UpperHex, orderedGoldenVectorIds, serializeGoldenVectorSet } from "./f1e-golden-vectors"

function expect(condition: boolean, message: string): void { if (!condition) throw new Error(message) }

const algorithm = {
  algorithmId: "SHA-256" as HashAlgorithmId,
  algorithmVersion: "1" as HashAlgorithmVersion,
  digestEncoding: "LOWERCASE_HEX" as const,
  domainSeparatorId: "CANONICAL_PAYLOAD" as DomainSeparatorId,
  domainSeparatorVersion: "1" as DomainSeparatorVersion,
}
const descriptor: CanonicalPayloadDigestDescriptor = { kind: "CANONICAL_PAYLOAD_DIGEST_DESCRIPTOR", schemaVersion: "1" as AuditEvidenceSchemaVersion, canonicalizationProfileVersion: "1" as CanonicalizationProfileVersion, payloadKind: "AUDITABLE_CANONICAL_PAYLOAD", algorithm }
const separator = { id: "CANONICAL_PAYLOAD", version: "1", separator: "ARCFLOW:RI-L2:F1E:CANONICAL_PAYLOAD:V1" }
const limits = { maxDepth: 32, maxNodes: 1_024, maxInputBytes: 65_536 }

export async function runGoldenVectorTests(): Promise<void> {
  expect(createGoldenVectorSetVersion("F1E2-V1") !== null, "set-version constructor")
  expect(createNormativeVectorFileName("f1e-golden-vectors.ndjson") !== null, "filename constructor")
  expect(createNonNegativeSafeInteger(0) !== null && createSha256UpperHex("A".repeat(64)) !== null, "checkpoint scalar constructors")
  expect(createNonNegativeSafeInteger(-1) === null && createNonNegativeSafeInteger(1.5) === null && createNonNegativeSafeInteger(Number.MAX_SAFE_INTEGER + 1) === null, "non-negative safe integer negatives")
  for (const invalidFile of ["C:\\vectors.ndjson", "/vectors.ndjson", "..", "a/b", "a\\b", "a\u0000b"] as const) expect(createNormativeVectorFileName(invalidFile) === null, `invalid filename ${JSON.stringify(invalidFile)}`)
  const ids = orderedGoldenVectorIds()
  expect(ids.length === F1E_VALID_GOLDEN_VECTORS.length + F1E_INVALID_LOGICAL_GOLDEN_VECTORS.length + F1E_INVALID_RAW_GOLDEN_VECTORS.length, "unique membership")
  for (const vector of F1E_VALID_GOLDEN_VECTORS) {
    expect(vector.immutableForVersion === true, `${String(vector.vectorId)} immutable`)
    const recipe = F1E_GOLDEN_VECTOR_RECIPES.find((candidate) => candidate.vectorId === vector.vectorId)
    expect(Boolean(recipe), `${String(vector.vectorId)} recipe`)
    if (!recipe) continue
    const input = recipe.input.kind === "TEXT" ? { kind: "PROFILE_TEXT" as const, text: profileText(recipe.input.text) } : { kind: "UTF8_BYTES" as const, bytes: recipe.input.bytes }
    const result = canonicalize(input, recipe.schema, F1E_GOLDEN_PROFILE, "17.0", descriptor, limits)
    expect(result.kind === "CANONICALIZED", `${String(vector.vectorId)} canonicalizes`)
    if (result.kind !== "CANONICALIZED") continue
    expect(String(result.canonicalBytesHex) === String(vector.expectedCanonicalBytesHex), `${String(vector.vectorId)} bytes`)
    const digest = await digestCanonicalBytesForDescriptor(result.canonicalBytes, "1", algorithm, separator)
    expect(digest.kind === "DIGEST_COMPUTED" && digest.lowercaseHex === String(vector.expectedDigest.digest), `${String(vector.vectorId)} digest:${digest.kind === "DIGEST_COMPUTED" ? digest.lowercaseHex : digest.kind}`)
  }
  for (const vector of [...F1E_INVALID_LOGICAL_GOLDEN_VECTORS, ...F1E_INVALID_RAW_GOLDEN_VECTORS]) {
    const recipe = F1E_GOLDEN_VECTOR_RECIPES.find((candidate) => candidate.vectorId === vector.vectorId)
    expect(Boolean(recipe), `${String(vector.vectorId)} recipe`)
    if (!recipe) continue
    const input = recipe.input.kind === "TEXT" ? { kind: "PROFILE_TEXT" as const, text: profileText(recipe.input.text) } : { kind: "UTF8_BYTES" as const, bytes: recipe.input.bytes }
    const result = canonicalize(input, recipe.schema, F1E_GOLDEN_PROFILE, "17.0", descriptor, limits)
    expect(result.kind === "NONCANONICAL_INPUT_REJECTED" && result.reason === vector.expectedReason, `${String(vector.vectorId)} invalid`)
  }

  const framed = frameCanonicalBytes(separator.separator, "1", new Uint8Array([0x6e, 0x75, 0x6c, 0x6c]))
  expect(framed !== null && new TextDecoder().decode(framed) === `${separator.separator}\u00001\u0000null`, "reproducible framing")
  for (const invalid of ["", "a".repeat(130), "nul\u0000x", "tab\tx", "space x", "del\u007f", "não-ascii"] as const) {
    expect(frameCanonicalBytes(invalid, "1", new Uint8Array()) === null, `separator rejects ${JSON.stringify(invalid)}`)
  }
  const invalidRegistered = await digestCanonicalBytesForDescriptor(new Uint8Array(), "1", algorithm, { id: "x".repeat(65), version: "1", separator: "S" })
  expect(invalidRegistered.kind === "DIGEST_INPUT_REJECTED", "65-octet domain id rejected")

  const canonicalNull = F1E_VALID_GOLDEN_VECTORS[0]
  const expectedRef = canonicalNull.expectedDigest
  const descriptorMismatch = await verifyCanonicalPayloadDigest(new TextEncoder().encode("null"), { ...descriptor, payloadKind: "AUDITABLE_CANONICAL_PAYLOAD", schemaVersion: "2" as AuditEvidenceSchemaVersion }, expectedRef, separator)
  expect(descriptorMismatch.kind === "DIGEST_DESCRIPTOR_MISMATCH", "descriptor mismatch is distinct")
  const valueMismatch = await verifyCanonicalPayloadDigest(new TextEncoder().encode("true"), descriptor, expectedRef, separator)
  expect(valueMismatch.kind === "DIGEST_VALUE_MISMATCH", "value mismatch is distinct")

  const checkpointBytes = serializeGoldenVectorSet()
  expect(checkpointBytes.length > 0 && checkpointBytes[checkpointBytes.length - 1] === 0x0a, "checkpoint UTF-8 LF")
  const changed = new Uint8Array(checkpointBytes)
  changed[0] ^= 1
  const originalInput = new Uint8Array(checkpointBytes.length)
  originalInput.set(checkpointBytes)
  const changedInput = new Uint8Array(changed.length)
  changedInput.set(changed)
  const originalHash = new Uint8Array(await crypto.subtle.digest("SHA-256", originalInput))
  const changedHash = new Uint8Array(await crypto.subtle.digest("SHA-256", changedInput))
  expect(originalHash.some((byte, index) => byte !== changedHash[index]), "byte change breaks checkpoint")
}

void runGoldenVectorTests()
