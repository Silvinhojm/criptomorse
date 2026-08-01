import type { ProofDigest } from "./f1d-settlement-identities"
import type { RedactionManifestDigestRef } from "./f1e-digest-contracts"
import type { AggregateDominantStatus } from "./f1e-projections"

type Nominal<Name extends string> = { readonly __f1e2Nominal: Name }
type Opaque<Base, Name extends string> = Base & Nominal<Name>

export type ClientServerOnlyGuards = {
  readonly secrets?: never
  readonly credentials?: never
  readonly rawCapability?: never
  readonly capabilityRefs?: never
  readonly providerToken?: never
  readonly signingMaterial?: never
  readonly otp?: never
  readonly keyShare?: never
  readonly rawSignature?: never
  readonly privatePrompt?: never
  readonly rawEvidence?: never
  readonly handoff?: never
  readonly evidenceRefs?: never
  readonly authorityRefs?: never
  readonly fencing?: never
  readonly provenance?: never
  readonly confirmationProof?: never
}

export type PublicAggregateStatus = AggregateDominantStatus | "INVALID_FAIL_CLOSED"
export type ClientReasonCode =
  | "UPSTREAM_RECOVERY"
  | "UPSTREAM_DISPUTE"
  | "AUDIT_DISPUTE"
  | "INCOMPLETE_EVIDENCE"
  | "AUDIT_PENDING"
  | "AUDITED"
  | "ANCHOR_UNKNOWN"
  | "ANCHOR_HISTORICAL"
  | "INVALID_INPUT"

export type PublicAuditRef = Opaque<string, "PublicAuditRef">
export type PublicAnchorRef = Opaque<string, "PublicAnchorRef">
export type PublicRedactionManifestRef = Opaque<string, "PublicRedactionManifestRef">

export type PublicAnchorHistoryEntry = ClientServerOnlyGuards & {
  readonly state: "ANCHORED" | "FAILED" | "SUBMISSION_UNKNOWN"
  readonly ref: PublicAnchorRef
  readonly historical: true
}

export type DisclosedValue<T> =
  | (ClientServerOnlyGuards & {
      readonly disclosure: "INCLUDED"
      readonly value: T | null
      readonly maskedDisplay?: never
      readonly valueDigest?: never
    })
  | (ClientServerOnlyGuards & {
      readonly disclosure: "OMITTED"
      readonly value?: never
      readonly maskedDisplay?: never
      readonly valueDigest?: never
    })
  | (ClientServerOnlyGuards & {
      readonly disclosure: "MASKED"
      readonly maskedDisplay: string
      readonly value?: never
      readonly valueDigest?: never
    })
  | (ClientServerOnlyGuards & {
      readonly disclosure: "COMMIT_ONLY"
      readonly valueDigest: ProofDigest
      readonly value?: never
      readonly maskedDisplay?: never
    })

export type F1eAggregateClientDto = ClientServerOnlyGuards & {
  readonly kind: "F1E_AGGREGATE_CLIENT"
  readonly status: PublicAggregateStatus
  readonly reasonCodes: readonly ClientReasonCode[]
  readonly auditRef: DisclosedValue<PublicAuditRef>
  readonly anchorCurrentRef: DisclosedValue<PublicAnchorRef>
  readonly anchorHistory: readonly PublicAnchorHistoryEntry[]
  readonly manifestRef: PublicRedactionManifestRef
  readonly manifestDigest: RedactionManifestDigestRef
}

