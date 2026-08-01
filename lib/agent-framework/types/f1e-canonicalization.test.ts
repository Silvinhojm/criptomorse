import type { CanonicalPayloadDigestDescriptor, ResourceLimitId } from "./f1e-digest-contracts"
import type { AuditEvidenceSchemaVersion, CanonicalizationProfileVersion } from "./f1e-identities"
import { canonicalize, profileText } from "./f1e-canonicalization"
import type { CanonicalSchema } from "./f1e-canonicalization"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const descriptor = {
  kind: "CANONICAL_PAYLOAD_DIGEST_DESCRIPTOR",
  schemaVersion: "1" as AuditEvidenceSchemaVersion,
  canonicalizationProfileVersion: "1" as CanonicalizationProfileVersion,
  payloadKind: "AUDITABLE_CANONICAL_PAYLOAD",
  algorithm: {
    algorithmId: "SHA-256",
    algorithmVersion: "1",
    digestEncoding: "LOWERCASE_HEX",
    domainSeparatorId: "CANONICAL_PAYLOAD",
    domainSeparatorVersion: "1",
  },
} as CanonicalPayloadDigestDescriptor

const profile = { profileId: "ACE-JSON-V1", profileVersion: "1" as CanonicalizationProfileVersion, unicodeVersion: "17.0" } as const
const limits = { maxDepth: 32, maxNodes: 1_024, maxInputBytes: 65_536 }

function run(input: string, schema: CanonicalSchema, runtime = "17.0") {
  return canonicalize({ kind: "PROFILE_TEXT", text: profileText(input) }, schema, profile, runtime, descriptor, limits)
}

export function runCanonicalizationTests(): void {
  const nullableObject: CanonicalSchema = { kind: "OBJECT", fields: [{ name: "value", required: false, schema: { kind: "NULL" } }] }
  const absent = run("{}", nullableObject)
  const explicitNull = run('{"value":null}', nullableObject)
  expect(absent.kind === "CANONICALIZED" && explicitNull.kind === "CANONICALIZED", "null/absent setup")
  expect(absent.kind === "CANONICALIZED" && explicitNull.kind === "CANONICALIZED" && String(absent.canonicalBytesHex) !== String(explicitNull.canonicalBytesHex), "null must differ from absent")

  const composed = run('"é"', { kind: "STRING" })
  const decomposed = run('"e\\u0301"', { kind: "STRING" })
  expect(composed.kind === "CANONICALIZED" && decomposed.kind === "CANONICALIZED" && String(composed.canonicalBytesHex) === String(decomposed.canonicalBytesHex), "NFC equivalence")

  const objectSchema: CanonicalSchema = { kind: "OBJECT", fields: [{ name: "é", required: true, schema: { kind: "INTEGER" } }] }
  expect(run('{"é":1,"é":2}', objectSchema).kind === "NONCANONICAL_INPUT_REJECTED", "duplicate key")
  expect(run('{"é":1,"e\\u0301":2}', objectSchema).kind === "NONCANONICAL_INPUT_REJECTED", "duplicate NFC key")
  expect(run('"\\ud800"', { kind: "STRING" }).kind === "NONCANONICAL_INPUT_REJECTED", "isolated surrogate")

  const invalidUtf8 = canonicalize({ kind: "UTF8_BYTES", bytes: new Uint8Array([0xc3, 0x28]) }, { kind: "STRING" }, profile, "17.0", descriptor, limits)
  expect(invalidUtf8.kind === "NONCANONICAL_INPUT_REJECTED", "invalid UTF-8")

  const dangerousSchema: CanonicalSchema = { kind: "OBJECT", fields: [] }
  const protoAsData = run('{"__proto__":1}', { kind: "OBJECT", fields: [{ name: "__proto__", required: true, schema: { kind: "INTEGER" } }] })
  expect(protoAsData.kind === "CANONICALIZED" && protoAsData.payload !== null && typeof protoAsData.payload === "object" && "kind" in protoAsData.payload && protoAsData.payload.kind === "CANONICAL_OBJECT" && protoAsData.payload.entries[0]?.key === "__proto__", "__proto__ preserved as own data")
  for (const key of ["__proto__", "constructor", "prototype"] as const) {
    expect(run(`{"${key}":1}`, dangerousSchema).kind === "NONCANONICAL_INPUT_REJECTED", `closed schema ${key}`)
  }
  expect(({} as { polluted?: boolean }).polluted !== true, "prototype pollution")

  for (const numeric of ["1.5", "1e2", "-0", "NaN", "Infinity"] as const) {
    expect(run(numeric, { kind: "INTEGER" }).kind === "NONCANONICAL_INPUT_REJECTED", `reject ${numeric}`)
  }
  expect(run('{"unknown":1}', dangerousSchema).kind === "NONCANONICAL_INPUT_REJECTED", "unknown field")

  const ordered = run('["é","z"]', { kind: "ARRAY", element: { kind: "STRING" }, ordering: "SET_BY_CANONICAL_BYTES" })
  expect(ordered.kind === "CANONICALIZED" && new TextDecoder().decode(ordered.canonicalBytes) === '["z","é"]', "unsigned UTF-8 ordering")
  expect(run('"2026-12-31T23:59:59.999Z"', { kind: "TIMESTAMP" }).kind === "CANONICALIZED", "valid timestamp")
  expect(run('"2026-12-31T23:59:60.000Z"', { kind: "TIMESTAMP" }).kind === "NONCANONICAL_INPUT_REJECTED", "leap second")
  expect(run("null", { kind: "NULL" }, "16.0").kind === "CANONICALIZATION_UNSUPPORTED", "Unicode mismatch")

  const constrained = canonicalize({ kind: "PROFILE_TEXT", text: profileText("null") }, { kind: "NULL" }, profile, "17.0", descriptor, { ...limits, maxInputBytes: 2 })
  expect(constrained.kind === "CANONICALIZATION_RESOURCE_LIMIT_EXCEEDED" && Boolean(constrained.limitId as ResourceLimitId), "resource family")
}

runCanonicalizationTests()
