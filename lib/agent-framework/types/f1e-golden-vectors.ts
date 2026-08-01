import type {
  AuditEvidenceSchemaVersion,
  CanonicalizationProfileVersion,
  CanonicalPayloadDigest,
  CanonicalPayloadDigestRef,
  DomainSeparatorId,
  DomainSeparatorVersion,
  HashAlgorithmId,
  HashAlgorithmVersion,
} from "./f1e-identities"
import type { CanonicalBytesHex, CanonicalSchema, CanonicalizationProfile, CanonicalValue, SemanticInputReason } from "./f1e-canonicalization"
import { canonicalizeControlledValue } from "./f1e-canonicalization"

type Nominal<Name extends string> = { readonly __f1e2GoldenNominal: Name }
type Opaque<Base, Name extends string> = Base & Nominal<Name>

export type GoldenVectorId = Opaque<string, "GoldenVectorId">
export type RawInputBytesHex = Opaque<string, "RawInputBytesHex">
export type CanonicalParserProfileVersion = Opaque<string, "CanonicalParserProfileVersion">
export type GoldenVectorSetVersion = Opaque<string, "GoldenVectorSetVersion">
export type NormativeVectorFileName = Opaque<string, "NormativeVectorFileName">
export type NonNegativeSafeInteger = Opaque<number, "NonNegativeSafeInteger">
export type Sha256UpperHex = Opaque<string, "Sha256UpperHex">

export type GoldenVectorSetCheckpoint = {
  readonly kind: "GOLDEN_VECTOR_SET_CHECKPOINT"
  readonly setVersion: GoldenVectorSetVersion
  readonly normativeFileName: NormativeVectorFileName
  readonly sizeBytes: NonNegativeSafeInteger
  readonly lines: NonNegativeSafeInteger
  readonly sha256UpperHex: Sha256UpperHex
  readonly vectorIdsInCanonicalOrder: readonly GoldenVectorId[]
  readonly immutableForVersion: true
}

export function createGoldenVectorSetVersion(value: string): GoldenVectorSetVersion | null {
  return value.length > 0 && value === value.normalize("NFC") ? value as GoldenVectorSetVersion : null
}

export function createNormativeVectorFileName(value: string): NormativeVectorFileName | null {
  if (value.length === 0 || value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("\u0000") || /^[A-Za-z]:/.test(value)) return null
  return value === value.normalize("NFC") ? value as NormativeVectorFileName : null
}

export function createNonNegativeSafeInteger(value: number): NonNegativeSafeInteger | null {
  return Number.isSafeInteger(value) && value >= 0 ? value as NonNegativeSafeInteger : null
}

export function createSha256UpperHex(value: string): Sha256UpperHex | null {
  return /^[0-9A-F]{64}$/.test(value) ? value as Sha256UpperHex : null
}

export type LosslessLogicalInput =
  | { readonly token: "NULL" }
  | { readonly token: "BOOLEAN"; readonly value: boolean }
  | { readonly token: "STRING"; readonly value: string }
  | { readonly token: "NUMBER_LEXEME"; readonly lexeme: string }
  | { readonly token: "ARRAY"; readonly items: readonly LosslessLogicalInput[] }
  | { readonly token: "OBJECT_PAIRS"; readonly entries: readonly (readonly [rawKey: string, value: LosslessLogicalInput])[] }

export type GoldenVectorBase = {
  readonly vectorId: GoldenVectorId
  readonly profileVersion: CanonicalizationProfileVersion
  readonly immutableForVersion: true
}

export type ValidCanonicalizationGoldenVector = GoldenVectorBase & {
  readonly kind: "VALID_CANONICALIZATION_VECTOR"
  readonly logicalInput: CanonicalValue
  readonly expectedCanonicalBytesHex: CanonicalBytesHex
  readonly expectedDigest: CanonicalPayloadDigestRef
}

export type InvalidLogicalInputGoldenVector = GoldenVectorBase & {
  readonly kind: "INVALID_LOGICAL_INPUT_VECTOR"
  readonly input: LosslessLogicalInput
  readonly expectedReason: SemanticInputReason
  readonly expectedCanonicalBytesHex?: never
  readonly expectedDigest?: never
}

export type InvalidRawInputGoldenVector = GoldenVectorBase & {
  readonly kind: "INVALID_RAW_INPUT_VECTOR"
  readonly rawBytesHex: RawInputBytesHex
  readonly parserProfileVersion: CanonicalParserProfileVersion
  readonly expectedReason: SemanticInputReason
  readonly expectedCanonicalBytesHex?: never
  readonly expectedDigest?: never
}

export type GoldenVector = ValidCanonicalizationGoldenVector | InvalidLogicalInputGoldenVector | InvalidRawInputGoldenVector

export type GoldenVectorRecipe = {
  readonly vectorId: GoldenVectorId
  readonly input: { readonly kind: "TEXT"; readonly text: string } | { readonly kind: "BYTES"; readonly bytes: Uint8Array }
  readonly schema: CanonicalSchema
}

const PROFILE_VERSION = "1" as CanonicalizationProfileVersion
const algorithm = {
  algorithmId: "SHA-256" as HashAlgorithmId,
  algorithmVersion: "1" as HashAlgorithmVersion,
  digestEncoding: "LOWERCASE_HEX" as const,
  domainSeparatorId: "CANONICAL_PAYLOAD" as DomainSeparatorId,
  domainSeparatorVersion: "1" as DomainSeparatorVersion,
}

function canonicalDigestRef(digest: string): CanonicalPayloadDigestRef {
  return {
    kind: "CANONICAL_PAYLOAD_DIGEST_REF",
    digest: digest as CanonicalPayloadDigest,
    algorithm,
    schemaVersion: "1" as AuditEvidenceSchemaVersion,
    canonicalizationProfileVersion: PROFILE_VERSION,
  }
}

function freezeVector<T extends GoldenVector>(vector: T): Readonly<T> {
  return Object.freeze(vector)
}

export const F1E_GOLDEN_PROFILE: CanonicalizationProfile = Object.freeze({
  profileId: "ACE-JSON-V1",
  profileVersion: PROFILE_VERSION,
  unicodeVersion: "17.0",
})

const STRING_SCHEMA: CanonicalSchema = Object.freeze({ kind: "STRING" })
const NULL_SCHEMA: CanonicalSchema = Object.freeze({ kind: "NULL" })
const INTEGER_SCHEMA: CanonicalSchema = Object.freeze({ kind: "INTEGER" })
const TIMESTAMP_SCHEMA: CanonicalSchema = Object.freeze({ kind: "TIMESTAMP" })
const OBJECT_SCHEMA: CanonicalSchema = Object.freeze({
  kind: "OBJECT",
  fields: Object.freeze([
    Object.freeze({ name: "count", schema: INTEGER_SCHEMA, required: true }),
    Object.freeze({ name: "timestamp", schema: TIMESTAMP_SCHEMA, required: true }),
  ]),
})

export const F1E_VALID_GOLDEN_VECTORS: readonly ValidCanonicalizationGoldenVector[] = Object.freeze([
  freezeVector({ kind: "VALID_CANONICALIZATION_VECTOR", vectorId: "CANONICAL_NULL" as GoldenVectorId, profileVersion: PROFILE_VERSION, immutableForVersion: true, logicalInput: null, expectedCanonicalBytesHex: "6e756c6c" as CanonicalBytesHex, expectedDigest: canonicalDigestRef("fc51832961f05f9dba527357d25a2f151494f0ef8d1b003581649f95b3a0c037") }),
  freezeVector({ kind: "VALID_CANONICALIZATION_VECTOR", vectorId: "NFC_COMPOSED" as GoldenVectorId, profileVersion: PROFILE_VERSION, immutableForVersion: true, logicalInput: "é", expectedCanonicalBytesHex: "22c3a922" as CanonicalBytesHex, expectedDigest: canonicalDigestRef("db2814d35de6d8ad96e07ec783891452820d989f294b155854a6089dadcb0c72") }),
  freezeVector({ kind: "VALID_CANONICALIZATION_VECTOR", vectorId: "NFC_DECOMPOSED" as GoldenVectorId, profileVersion: PROFILE_VERSION, immutableForVersion: true, logicalInput: "e\u0301", expectedCanonicalBytesHex: "22c3a922" as CanonicalBytesHex, expectedDigest: canonicalDigestRef("db2814d35de6d8ad96e07ec783891452820d989f294b155854a6089dadcb0c72") }),
  freezeVector({ kind: "VALID_CANONICALIZATION_VECTOR", vectorId: "CLOSED_OBJECT_ORDER" as GoldenVectorId, profileVersion: PROFILE_VERSION, immutableForVersion: true, logicalInput: { kind: "CANONICAL_OBJECT", entries: [{ key: "count", value: { kind: "CANONICAL_INTEGER", value: "7" } }, { key: "timestamp", value: "2026-12-31T23:59:59.999Z" }] }, expectedCanonicalBytesHex: "7b22636f756e74223a372c2274696d657374616d70223a22323032362d31322d33315432333a35393a35392e3939395a227d" as CanonicalBytesHex, expectedDigest: canonicalDigestRef("7e9825fe23d775788e412800df82fb6c10c5ad7925133b6eb81a3db762c1919d") }),
])

export const F1E_INVALID_LOGICAL_GOLDEN_VECTORS: readonly InvalidLogicalInputGoldenVector[] = Object.freeze([
  freezeVector({ kind: "INVALID_LOGICAL_INPUT_VECTOR", vectorId: "DUPLICATE_KEY" as GoldenVectorId, profileVersion: PROFILE_VERSION, immutableForVersion: true, input: { token: "OBJECT_PAIRS", entries: [["count", { token: "NUMBER_LEXEME", lexeme: "1" }], ["count", { token: "NUMBER_LEXEME", lexeme: "2" }], ["timestamp", { token: "STRING", value: "2026-12-31T23:59:59.999Z" }]] }, expectedReason: "DUPLICATE_KEY" }),
  freezeVector({ kind: "INVALID_LOGICAL_INPUT_VECTOR", vectorId: "FLOAT" as GoldenVectorId, profileVersion: PROFILE_VERSION, immutableForVersion: true, input: { token: "NUMBER_LEXEME", lexeme: "1.5" }, expectedReason: "FLOAT_FORBIDDEN" }),
  freezeVector({ kind: "INVALID_LOGICAL_INPUT_VECTOR", vectorId: "LEAP_SECOND" as GoldenVectorId, profileVersion: PROFILE_VERSION, immutableForVersion: true, input: { token: "STRING", value: "2026-12-31T23:59:60.000Z" }, expectedReason: "INVALID_TIMESTAMP" }),
  freezeVector({ kind: "INVALID_LOGICAL_INPUT_VECTOR", vectorId: "UNKNOWN_FIELD" as GoldenVectorId, profileVersion: PROFILE_VERSION, immutableForVersion: true, input: { token: "OBJECT_PAIRS", entries: [["count", { token: "NUMBER_LEXEME", lexeme: "7" }], ["timestamp", { token: "STRING", value: "2026-12-31T23:59:59.999Z" }], ["extra", { token: "BOOLEAN", value: true }]] }, expectedReason: "UNKNOWN_FIELD" }),
])

export const F1E_INVALID_RAW_GOLDEN_VECTORS: readonly InvalidRawInputGoldenVector[] = Object.freeze([
  freezeVector({ kind: "INVALID_RAW_INPUT_VECTOR", vectorId: "INVALID_UTF8" as GoldenVectorId, profileVersion: PROFILE_VERSION, immutableForVersion: true, rawBytesHex: "c328" as RawInputBytesHex, parserProfileVersion: "1" as CanonicalParserProfileVersion, expectedReason: "INVALID_UNICODE" }),
])

export const F1E_GOLDEN_VECTOR_RECIPES: readonly GoldenVectorRecipe[] = Object.freeze([
  Object.freeze({ vectorId: "CANONICAL_NULL" as GoldenVectorId, input: Object.freeze({ kind: "TEXT", text: "null" }), schema: NULL_SCHEMA }),
  Object.freeze({ vectorId: "NFC_COMPOSED" as GoldenVectorId, input: Object.freeze({ kind: "TEXT", text: "\"é\"" }), schema: STRING_SCHEMA }),
  Object.freeze({ vectorId: "NFC_DECOMPOSED" as GoldenVectorId, input: Object.freeze({ kind: "TEXT", text: "\"e\\u0301\"" }), schema: STRING_SCHEMA }),
  Object.freeze({ vectorId: "CLOSED_OBJECT_ORDER" as GoldenVectorId, input: Object.freeze({ kind: "TEXT", text: "{\"timestamp\":\"2026-12-31T23:59:59.999Z\",\"count\":7}" }), schema: OBJECT_SCHEMA }),
  Object.freeze({ vectorId: "DUPLICATE_KEY" as GoldenVectorId, input: Object.freeze({ kind: "TEXT", text: "{\"count\":1,\"count\":2,\"timestamp\":\"2026-12-31T23:59:59.999Z\"}" }), schema: OBJECT_SCHEMA }),
  Object.freeze({ vectorId: "FLOAT" as GoldenVectorId, input: Object.freeze({ kind: "TEXT", text: "1.5" }), schema: INTEGER_SCHEMA }),
  Object.freeze({ vectorId: "LEAP_SECOND" as GoldenVectorId, input: Object.freeze({ kind: "TEXT", text: "\"2026-12-31T23:59:60.000Z\"" }), schema: TIMESTAMP_SCHEMA }),
  Object.freeze({ vectorId: "UNKNOWN_FIELD" as GoldenVectorId, input: Object.freeze({ kind: "TEXT", text: "{\"count\":7,\"timestamp\":\"2026-12-31T23:59:59.999Z\",\"extra\":true}" }), schema: OBJECT_SCHEMA }),
  Object.freeze({ vectorId: "INVALID_UTF8" as GoldenVectorId, input: Object.freeze({ kind: "BYTES", bytes: new Uint8Array([0xc3, 0x28]) }), schema: STRING_SCHEMA }),
])

function compareUtf8Unsigned(left: string, right: string): number {
  const encoder = new TextEncoder()
  const leftBytes = encoder.encode(left.normalize("NFC"))
  const rightBytes = encoder.encode(right.normalize("NFC"))
  const length = Math.min(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index]
  }
  return leftBytes.length - rightBytes.length
}

function allVectors(): readonly GoldenVector[] {
  return [...F1E_VALID_GOLDEN_VECTORS, ...F1E_INVALID_LOGICAL_GOLDEN_VECTORS, ...F1E_INVALID_RAW_GOLDEN_VECTORS]
}

export function orderedGoldenVectorIds(): readonly GoldenVectorId[] {
  const ids = allVectors().map((vector) => String(vector.vectorId).normalize("NFC"))
  if (new Set(ids).size !== ids.length) throw new Error("DUPLICATE_GOLDEN_VECTOR_ID")
  return Object.freeze(ids.sort(compareUtf8Unsigned).map((id) => id as GoldenVectorId))
}

export function serializeGoldenVectorSet(): Uint8Array {
  const vectors = allVectors()
  const ids = orderedGoldenVectorIds()
  const byId = new Map(vectors.map((vector) => [String(vector.vectorId).normalize("NFC"), vector] as const))
  const lines = ids.map((id) => {
    const vector = byId.get(String(id))
    if (!vector) throw new Error("GOLDEN_VECTOR_MEMBERSHIP_INVARIANT")
    return canonicalizeControlledValue(vector)
  })
  const size = lines.reduce((total, line) => total + line.length + 1, 0)
  const serialized = new Uint8Array(size)
  let offset = 0
  for (const line of lines) {
    serialized.set(line, offset)
    offset += line.length
    serialized[offset] = 0x0a
    offset += 1
  }
  return serialized
}
