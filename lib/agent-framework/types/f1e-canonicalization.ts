import type {
  CanonicalizationProfileVersion,
} from "./f1e-identities"
import type {
  CanonicalPayloadDigestDescriptor,
  InvariantId,
  ResourceLimitId,
} from "./f1e-digest-contracts"

type Nominal<Name extends string> = { readonly __f1e2Nominal: Name }
type Opaque<Base, Name extends string> = Base & Nominal<Name>

export type CanonicalBytesHex = Opaque<string, "CanonicalBytesHex">
export type ProfileText = Opaque<string, "ProfileText">

export type SemanticInputReason =
  | "UNKNOWN_FIELD"
  | "DUPLICATE_KEY"
  | "INVALID_UNICODE"
  | "FLOAT_FORBIDDEN"
  | "INVALID_INTEGER"
  | "INVALID_TIMESTAMP"
  | "INVALID_ORDER"
  | "INVALID_DIGEST"

export type UnsupportedReason =
  | "UNSUPPORTED_SCHEMA"
  | "UNSUPPORTED_PROFILE"
  | "UNSUPPORTED_ALGORITHM"

export type CanonicalScalar = null | boolean | string
export type CanonicalValue =
  | CanonicalScalar
  | { readonly kind: "CANONICAL_INTEGER"; readonly value: string }
  | readonly CanonicalValue[]
  | { readonly kind: "CANONICAL_OBJECT"; readonly entries: readonly CanonicalObjectEntry[] }

export type CanonicalObjectEntry = {
  readonly key: string
  readonly value: CanonicalValue
}

export type CanonicalSchema =
  | { readonly kind: "NULL" }
  | { readonly kind: "BOOLEAN" }
  | { readonly kind: "STRING" }
  | { readonly kind: "INTEGER" }
  | { readonly kind: "TIMESTAMP" }
  | { readonly kind: "LOWERCASE_HEX"; readonly exactLength?: number }
  | {
      readonly kind: "ARRAY"
      readonly element: CanonicalSchema
      readonly ordering: "ORDERED" | "SET_BY_CANONICAL_BYTES"
    }
  | {
      readonly kind: "OBJECT"
      readonly fields: readonly CanonicalObjectField[]
    }

export type CanonicalObjectField = {
  readonly name: string
  readonly required: boolean
  readonly schema: CanonicalSchema
}

export type CanonicalizationProfile = {
  readonly profileId: "ACE-JSON-V1"
  readonly profileVersion: CanonicalizationProfileVersion
  readonly unicodeVersion: "17.0"
}

export type CanonicalizationLimits = {
  readonly maxDepth: number
  readonly maxNodes: number
  readonly maxInputBytes: number
}

export type CanonicalizationInput =
  | { readonly kind: "UTF8_BYTES"; readonly bytes: Uint8Array }
  | { readonly kind: "PROFILE_TEXT"; readonly text: ProfileText }

export type CanonicalizationResult =
  | {
      readonly kind: "CANONICALIZED"
      readonly payload: CanonicalValue
      readonly canonicalBytes: Uint8Array
      readonly canonicalBytesHex: CanonicalBytesHex
      readonly descriptor: CanonicalPayloadDigestDescriptor
      readonly reason?: never
      readonly limitId?: never
      readonly invariantId?: never
    }
  | {
      readonly kind: "NONCANONICAL_INPUT_REJECTED"
      readonly reason: SemanticInputReason
      readonly payload?: never
      readonly canonicalBytes?: never
      readonly canonicalBytesHex?: never
      readonly descriptor?: never
      readonly limitId?: never
      readonly invariantId?: never
    }
  | {
      readonly kind: "CANONICALIZATION_UNSUPPORTED"
      readonly reason: UnsupportedReason
      readonly payload?: never
      readonly canonicalBytes?: never
      readonly canonicalBytesHex?: never
      readonly descriptor?: never
      readonly limitId?: never
      readonly invariantId?: never
    }
  | {
      readonly kind: "CANONICALIZATION_RESOURCE_LIMIT_EXCEEDED"
      readonly reason: "RESOURCE_LIMIT_EXCEEDED"
      readonly limitId: ResourceLimitId
      readonly payload?: never
      readonly canonicalBytes?: never
      readonly canonicalBytesHex?: never
      readonly descriptor?: never
      readonly invariantId?: never
    }
  | {
      readonly kind: "CANONICALIZATION_INTERNAL_INVARIANT_VIOLATION"
      readonly reason: "INTERNAL_INVARIANT_VIOLATION"
      readonly invariantId: InvariantId
      readonly payload?: never
      readonly canonicalBytes?: never
      readonly canonicalBytesHex?: never
      readonly descriptor?: never
      readonly limitId?: never
    }

type RawValue =
  | null
  | boolean
  | string
  | RawNumber
  | readonly RawValue[]
  | RawObject

type RawNumber = { readonly kind: "RAW_NUMBER"; readonly token: string }
type RawObject = { readonly kind: "RAW_OBJECT"; readonly entries: readonly RawEntry[] }
type RawEntry = { readonly key: string; readonly value: RawValue }

class CanonicalizationFailure extends Error {
  constructor(readonly reason: SemanticInputReason) {
    super(reason)
  }
}

class ResourceLimitFailure extends Error {
  constructor(readonly limitId: ResourceLimitId) {
    super(String(limitId))
  }
}

const encoder = new TextEncoder()
const DEFAULT_LIMITS: CanonicalizationLimits = {
  maxDepth: 64,
  maxNodes: 100_000,
  maxInputBytes: 1_048_576,
}

function resourceLimitId(value: string): ResourceLimitId {
  return value as ResourceLimitId
}

function invariantId(value: string): InvariantId {
  return value as InvariantId
}

export function profileText(text: string): ProfileText {
  assertValidUnicode(text)
  return text as ProfileText
}

export function bytesToLowerHex(bytes: Uint8Array): string {
  let output = ""
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0")
  return output
}

function decodeInput(input: CanonicalizationInput, limits: CanonicalizationLimits): string {
  if (input.kind === "PROFILE_TEXT") {
    const bytes = encoder.encode(input.text)
    if (bytes.length > limits.maxInputBytes) throw new ResourceLimitFailure(resourceLimitId("MAX_INPUT_BYTES"))
    assertValidUnicode(input.text)
    return input.text
  }
  if (input.bytes.length > limits.maxInputBytes) throw new ResourceLimitFailure(resourceLimitId("MAX_INPUT_BYTES"))
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(input.bytes)
  } catch {
    throw new CanonicalizationFailure("INVALID_UNICODE")
  }
}

class LosslessJsonParser {
  private offset = 0
  private nodes = 0

  constructor(
    private readonly text: string,
    private readonly limits: CanonicalizationLimits,
  ) {}

  parse(): RawValue {
    this.skipWhitespace()
    const value = this.parseValue(0)
    this.skipWhitespace()
    if (this.offset !== this.text.length) throw new CanonicalizationFailure("INVALID_ORDER")
    return value
  }

  private countNode(depth: number): void {
    if (depth > this.limits.maxDepth) throw new ResourceLimitFailure(resourceLimitId("MAX_DEPTH"))
    this.nodes += 1
    if (this.nodes > this.limits.maxNodes) throw new ResourceLimitFailure(resourceLimitId("MAX_NODES"))
  }

  private parseValue(depth: number): RawValue {
    this.countNode(depth)
    const char = this.text[this.offset]
    if (char === '"') return this.parseString()
    if (char === "{") return this.parseObject(depth)
    if (char === "[") return this.parseArray(depth)
    if (char === "t" && this.consumeLiteral("true")) return true
    if (char === "f" && this.consumeLiteral("false")) return false
    if (char === "n" && this.consumeLiteral("null")) return null
    if (char === "-" || (char >= "0" && char <= "9")) return this.parseNumber()
    throw new CanonicalizationFailure("INVALID_ORDER")
  }

  private parseObject(depth: number): RawObject {
    this.offset += 1
    this.skipWhitespace()
    const entries: RawEntry[] = []
    if (this.text[this.offset] === "}") {
      this.offset += 1
      return { kind: "RAW_OBJECT", entries }
    }
    while (true) {
      if (this.text[this.offset] !== '"') throw new CanonicalizationFailure("INVALID_ORDER")
      const key = this.parseString()
      this.skipWhitespace()
      if (this.text[this.offset] !== ":") throw new CanonicalizationFailure("INVALID_ORDER")
      this.offset += 1
      this.skipWhitespace()
      entries.push({ key, value: this.parseValue(depth + 1) })
      this.skipWhitespace()
      const char = this.text[this.offset]
      if (char === "}") {
        this.offset += 1
        return { kind: "RAW_OBJECT", entries }
      }
      if (char !== ",") throw new CanonicalizationFailure("INVALID_ORDER")
      this.offset += 1
      this.skipWhitespace()
    }
  }

  private parseArray(depth: number): readonly RawValue[] {
    this.offset += 1
    this.skipWhitespace()
    const values: RawValue[] = []
    if (this.text[this.offset] === "]") {
      this.offset += 1
      return values
    }
    while (true) {
      values.push(this.parseValue(depth + 1))
      this.skipWhitespace()
      const char = this.text[this.offset]
      if (char === "]") {
        this.offset += 1
        return values
      }
      if (char !== ",") throw new CanonicalizationFailure("INVALID_ORDER")
      this.offset += 1
      this.skipWhitespace()
    }
  }

  private parseString(): string {
    this.offset += 1
    let result = ""
    while (this.offset < this.text.length) {
      const char = this.text[this.offset]
      this.offset += 1
      if (char === '"') {
        assertValidUnicode(result)
        return result
      }
      if (char === "\\") {
        const escaped = this.text[this.offset]
        this.offset += 1
        if (escaped === '"' || escaped === "\\" || escaped === "/") result += escaped
        else if (escaped === "b") result += "\b"
        else if (escaped === "f") result += "\f"
        else if (escaped === "n") result += "\n"
        else if (escaped === "r") result += "\r"
        else if (escaped === "t") result += "\t"
        else if (escaped === "u") result += this.parseUnicodeEscape()
        else throw new CanonicalizationFailure("INVALID_UNICODE")
        continue
      }
      if (char.charCodeAt(0) <= 0x1f) throw new CanonicalizationFailure("INVALID_UNICODE")
      result += char
    }
    throw new CanonicalizationFailure("INVALID_ORDER")
  }

  private parseUnicodeEscape(): string {
    const firstHex = this.text.slice(this.offset, this.offset + 4)
    if (!/^[0-9a-fA-F]{4}$/.test(firstHex)) throw new CanonicalizationFailure("INVALID_UNICODE")
    this.offset += 4
    const first = Number.parseInt(firstHex, 16)
    if (first >= 0xd800 && first <= 0xdbff) {
      if (this.text.slice(this.offset, this.offset + 2) !== "\\u") throw new CanonicalizationFailure("INVALID_UNICODE")
      this.offset += 2
      const secondHex = this.text.slice(this.offset, this.offset + 4)
      if (!/^[0-9a-fA-F]{4}$/.test(secondHex)) throw new CanonicalizationFailure("INVALID_UNICODE")
      this.offset += 4
      const second = Number.parseInt(secondHex, 16)
      if (second < 0xdc00 || second > 0xdfff) throw new CanonicalizationFailure("INVALID_UNICODE")
      return String.fromCodePoint(0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00))
    }
    if (first >= 0xdc00 && first <= 0xdfff) throw new CanonicalizationFailure("INVALID_UNICODE")
    if (first <= 0x1f) throw new CanonicalizationFailure("INVALID_UNICODE")
    return String.fromCodePoint(first)
  }

  private parseNumber(): RawNumber {
    const remaining = this.text.slice(this.offset)
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(remaining)
    if (!match) throw new CanonicalizationFailure("INVALID_INTEGER")
    this.offset += match[0].length
    return { kind: "RAW_NUMBER", token: match[0] }
  }

  private consumeLiteral(literal: string): boolean {
    if (this.text.slice(this.offset, this.offset + literal.length) !== literal) return false
    this.offset += literal.length
    return true
  }

  private skipWhitespace(): void {
    while (this.offset < this.text.length && /[\u0009\u000a\u000d\u0020]/.test(this.text[this.offset])) this.offset += 1
  }
}

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) throw new CanonicalizationFailure("INVALID_UNICODE")
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) throw new CanonicalizationFailure("INVALID_UNICODE")
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalizationFailure("INVALID_UNICODE")
    }
  }
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (char) => char.codePointAt(0) as number)
  const rightPoints = Array.from(right, (char) => char.codePointAt(0) as number)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index]
  }
  return leftPoints.length - rightPoints.length
}

function validateTimestamp(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(value)
  if (!match) throw new CanonicalizationFailure("INVALID_TIMESTAMP")
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) throw new CanonicalizationFailure("INVALID_TIMESTAMP")
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (day < 1 || day > days[month - 1]) throw new CanonicalizationFailure("INVALID_TIMESTAMP")
}

function validateAgainstSchema(raw: RawValue, schema: CanonicalSchema): CanonicalValue {
  if (schema.kind === "NULL") {
    if (raw !== null) throw new CanonicalizationFailure("INVALID_ORDER")
    return null
  }
  if (schema.kind === "BOOLEAN") {
    if (typeof raw !== "boolean") throw new CanonicalizationFailure("INVALID_ORDER")
    return raw
  }
  if (schema.kind === "STRING" || schema.kind === "TIMESTAMP" || schema.kind === "LOWERCASE_HEX") {
    if (typeof raw !== "string") throw new CanonicalizationFailure("INVALID_ORDER")
    const normalized = raw.normalize("NFC")
    if (schema.kind === "TIMESTAMP") validateTimestamp(normalized)
    if (schema.kind === "LOWERCASE_HEX") {
      const lengthPattern = schema.exactLength === undefined ? "+" : `{${schema.exactLength}}`
      if (!new RegExp(`^[0-9a-f]${lengthPattern}$`).test(normalized)) throw new CanonicalizationFailure("INVALID_DIGEST")
    }
    return normalized
  }
  if (schema.kind === "INTEGER") {
    if (!isRawNumber(raw)) throw new CanonicalizationFailure("INVALID_INTEGER")
    if (!/^-?(?:0|[1-9][0-9]*)$/.test(raw.token) || raw.token === "-0") {
      if (/[.eE]/.test(raw.token)) throw new CanonicalizationFailure("FLOAT_FORBIDDEN")
      throw new CanonicalizationFailure("INVALID_INTEGER")
    }
    return { kind: "CANONICAL_INTEGER", value: raw.token }
  }
  if (schema.kind === "ARRAY") {
    if (!Array.isArray(raw)) throw new CanonicalizationFailure("INVALID_ORDER")
    const values = raw.map((value) => validateAgainstSchema(value, schema.element))
    if (schema.ordering === "ORDERED") return values
    const encoded = values.map((value) => ({ value, bytes: encodeCanonicalValue(value) }))
    encoded.sort((left, right) => compareUnsignedBytes(left.bytes, right.bytes))
    for (let index = 1; index < encoded.length; index += 1) {
      if (compareUnsignedBytes(encoded[index - 1].bytes, encoded[index].bytes) === 0) throw new CanonicalizationFailure("DUPLICATE_KEY")
    }
    return encoded.map((entry) => entry.value)
  }
  if (!isRawObject(raw)) throw new CanonicalizationFailure("INVALID_ORDER")
  const fields = new Map<string, CanonicalObjectField>()
  for (const field of schema.fields) {
    const normalized = field.name.normalize("NFC")
    if (fields.has(normalized)) throw new Error("DUPLICATE_SCHEMA_FIELD_AFTER_NFC")
    fields.set(normalized, field)
  }
  const seen = new Set<string>()
  const entries: CanonicalObjectEntry[] = []
  for (const entry of raw.entries) {
    const key = entry.key.normalize("NFC")
    if (seen.has(key)) throw new CanonicalizationFailure("DUPLICATE_KEY")
    seen.add(key)
    const field = fields.get(key)
    if (!field) throw new CanonicalizationFailure("UNKNOWN_FIELD")
    entries.push({ key, value: validateAgainstSchema(entry.value, field.schema) })
  }
  for (const [name, field] of fields) {
    if (field.required && !seen.has(name)) throw new CanonicalizationFailure("UNKNOWN_FIELD")
  }
  entries.sort((left, right) => compareCodePoints(left.key, right.key))
  return { kind: "CANONICAL_OBJECT", entries }
}

function isRawNumber(value: RawValue): value is RawNumber {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value && value.kind === "RAW_NUMBER"
}

function isRawObject(value: RawValue): value is RawObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value && value.kind === "RAW_OBJECT"
}

function quoteCanonicalString(value: string): string {
  let output = '"'
  for (const char of value) {
    const code = char.codePointAt(0) as number
    if (char === '"') output += '\\"'
    else if (char === "\\") output += "\\\\"
    else if (char === "\b") output += "\\b"
    else if (char === "\f") output += "\\f"
    else if (char === "\n") output += "\\n"
    else if (char === "\r") output += "\\r"
    else if (char === "\t") output += "\\t"
    else if (code <= 0x1f) output += `\\u${code.toString(16).padStart(4, "0")}`
    else output += char
  }
  return `${output}"`
}

function canonicalText(value: CanonicalValue): string {
  if (value === null) return "null"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "string") return quoteCanonicalString(value)
  if (isCanonicalArray(value)) return `[${value.map(canonicalText).join(",")}]`
  if (value.kind === "CANONICAL_INTEGER") return value.value
  return `{${value.entries.map((entry) => `${quoteCanonicalString(entry.key)}:${canonicalText(entry.value)}`).join(",")}}`
}

function isCanonicalArray(value: CanonicalValue): value is readonly CanonicalValue[] {
  return Array.isArray(value)
}

export function encodeCanonicalValue(value: CanonicalValue): Uint8Array {
  return encoder.encode(canonicalText(value))
}

function compareUnsignedBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return left.length - right.length
}

export function canonicalize(
  input: CanonicalizationInput,
  schema: CanonicalSchema,
  profile: CanonicalizationProfile,
  runtimeUnicodeVersion: string,
  descriptor: CanonicalPayloadDigestDescriptor,
  limits: CanonicalizationLimits = DEFAULT_LIMITS,
): CanonicalizationResult {
  if (profile.profileId !== "ACE-JSON-V1" || profile.unicodeVersion !== "17.0" || runtimeUnicodeVersion !== "17.0") {
    return { kind: "CANONICALIZATION_UNSUPPORTED", reason: "UNSUPPORTED_PROFILE" }
  }
  try {
    const text = decodeInput(input, limits)
    const raw = new LosslessJsonParser(text, limits).parse()
    const payload = validateAgainstSchema(raw, schema)
    const canonicalBytes = encodeCanonicalValue(payload)
    return {
      kind: "CANONICALIZED",
      payload,
      canonicalBytes,
      canonicalBytesHex: bytesToLowerHex(canonicalBytes) as CanonicalBytesHex,
      descriptor,
    }
  } catch (error) {
    if (error instanceof ResourceLimitFailure) {
      return { kind: "CANONICALIZATION_RESOURCE_LIMIT_EXCEEDED", reason: "RESOURCE_LIMIT_EXCEEDED", limitId: error.limitId }
    }
    if (error instanceof CanonicalizationFailure) {
      return { kind: "NONCANONICAL_INPUT_REJECTED", reason: error.reason }
    }
    return {
      kind: "CANONICALIZATION_INTERNAL_INVARIANT_VIOLATION",
      reason: "INTERNAL_INVARIANT_VIOLATION",
      invariantId: invariantId("CANONICALIZER_UNEXPECTED_FAILURE"),
    }
  }
}

const CONTROLLED_DEFAULT_MAX_DEPTH = 32

/** Internal-only encoder for controlled records produced by RI-L2 contracts. */
export function canonicalizeControlledValue(value: unknown, maxDepth: number = CONTROLLED_DEFAULT_MAX_DEPTH): Uint8Array {
  return encoder.encode(encodeControlled(value, new Set<object>(), 0, maxDepth))
}

function encodeControlled(value: unknown, ancestors: Set<object>, depth: number, maxDepth: number): string {
  if (depth > maxDepth) throw new Error("CONTROLLED_MAX_DEPTH_EXCEEDED")
  if (value === null) return "null"
  if (typeof value === "string") {
    assertValidUnicode(value)
    return quoteCanonicalString(value.normalize("NFC"))
  }
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error("CONTROLLED_NUMBER_NOT_SAFE_INTEGER")
    return String(value)
  }
  if (typeof value !== "object") throw new Error("CONTROLLED_VALUE_NOT_CANONICAL")
  if (ancestors.has(value)) throw new Error("CONTROLLED_VALUE_CYCLE")
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return `[${value.map((item) => encodeControlled(item, ancestors, depth + 1, maxDepth)).join(",")}]`
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new Error("CONTROLLED_OBJECT_PROTOTYPE")
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const normalizedDescriptors = new Map<string, PropertyDescriptor>()
    for (const originalKey of Object.keys(descriptors)) {
      const normalizedKey = originalKey.normalize("NFC")
      if (normalizedDescriptors.has(normalizedKey)) throw new Error("CONTROLLED_DUPLICATE_KEY_AFTER_NFC")
      normalizedDescriptors.set(normalizedKey, descriptors[originalKey])
    }
    const keys = [...normalizedDescriptors.keys()].sort(compareCodePoints)
    const parts: string[] = []
    for (const key of keys) {
      const descriptor = normalizedDescriptors.get(key)
      if (!descriptor || !("value" in descriptor)) throw new Error("CONTROLLED_ACCESSOR_FORBIDDEN")
      parts.push(`${quoteCanonicalString(key)}:${encodeControlled(descriptor.value, ancestors, depth + 1, maxDepth)}`)
    }
    return `{${parts.join(",")}}`
  } finally {
    ancestors.delete(value)
  }
}
