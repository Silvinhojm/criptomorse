import type { F1dHandoffEligibility } from "./f1d-handoff"
import type { EvidenceRef, ProofDigest } from "./f1d-settlement-identities"
import type {
  AnchorConfirmationProof,
  AnchorFailureEvidence,
  AnchorSubmissionUnknownEvidence,
} from "./f1e-anchor-contracts"
import type {
  AnchorRequestRef,
  AuditCreationRequestId,
  AuditEvidenceRef,
} from "./f1e-identities"
import type {
  AggregateProjectionDigest,
  AggregateProjectionDigestDescriptor,
  AggregateProjectionDigestRef,
  InvariantId,
} from "./f1e-digest-contracts"
import {
  canonicalizeControlledValue,
} from "./f1e-canonicalization"
import type {
  AggregateProjectionDigestVerificationResult,
  RegisteredDomainSeparator,
} from "./f1e-digests"
import {
  digestCanonicalBytesForDescriptor,
  hashAlgorithmDescriptorsEqual,
} from "./f1e-digests"

export type OperationalReadinessAxis =
  | { readonly state: "RECOVERY_REQUIRED"; readonly reasons: readonly EvidenceRef[] }
  | { readonly state: "DISPUTED"; readonly reasons: readonly EvidenceRef[] }
  | { readonly state: "INCOMPLETE"; readonly reasons: readonly EvidenceRef[] }
  | { readonly state: "READY"; readonly handoff: F1dHandoffEligibility }

export type AuditLifecycleAxis =
  | { readonly state: "NOT_RECORDED" }
  | { readonly state: "RECORDING"; readonly creationRequestId: AuditCreationRequestId }
  | { readonly state: "RECORDED"; readonly ref: AuditEvidenceRef }
  | { readonly state: "DISPUTED"; readonly ref: AuditEvidenceRef; readonly disputeRef: EvidenceRef }
  | { readonly state: "CORRECTED"; readonly current: AuditEvidenceRef; readonly predecessor: AuditEvidenceRef }

export type AnchorCurrentLifecycleAxis =
  | { readonly state: "NOT_ELIGIBLE" }
  | { readonly state: "ELIGIBLE"; readonly proofDigest: ProofDigest }
  | {
      readonly state: "REQUESTED" | "SUBMITTED" | "SUBMISSION_UNKNOWN" | "ANCHORED" | "FAILED" | "SUPERSEDED"
      readonly requestRef: AnchorRequestRef
    }

export type AnchorHistoricalDirectAnchoredEntry = {
  readonly historicalState: "ANCHORED"
  readonly requestRef: AnchorRequestRef
  readonly confirmation: AnchorConfirmationProof
  readonly supersededBy: AnchorRequestRef | null
  readonly remainsHistoricalCommitment: true
  readonly provesEconomicTruth: false
  readonly failure?: never
  readonly unknown?: never
  readonly lateResolution?: never
  readonly lateEvidenceRefs?: never
}

export type AnchorHistoricalDirectFailedEntry = {
  readonly historicalState: "FAILED"
  readonly requestRef: AnchorRequestRef
  readonly failure: AnchorFailureEvidence
  readonly supersededBy: AnchorRequestRef | null
  readonly confirmation?: never
  readonly unknown?: never
  readonly lateResolution?: never
  readonly lateEvidenceRefs?: never
  readonly remainsHistoricalCommitment?: never
  readonly provesEconomicTruth?: never
}

export type AnchorHistoricalUnknownUnresolvedEntry = {
  readonly historicalState: "SUBMISSION_UNKNOWN"
  readonly requestRef: AnchorRequestRef
  readonly unknown: AnchorSubmissionUnknownEvidence
  readonly lateResolution: "UNRESOLVED"
  readonly lateEvidenceRefs: readonly EvidenceRef[]
  readonly confirmation?: never
  readonly failure?: never
  readonly supersededBy?: never
  readonly remainsHistoricalCommitment?: never
  readonly provesEconomicTruth?: never
}

export type AnchorHistoricalUnknownLateAnchoredEntry = {
  readonly historicalState: "SUBMISSION_UNKNOWN"
  readonly requestRef: AnchorRequestRef
  readonly unknown: AnchorSubmissionUnknownEvidence
  readonly lateResolution: "LATE_ANCHORED"
  readonly confirmation: AnchorConfirmationProof
  readonly lateEvidenceRefs: readonly EvidenceRef[]
  readonly failure?: never
  readonly supersededBy?: never
  readonly remainsHistoricalCommitment?: never
  readonly provesEconomicTruth?: never
}

export type AnchorHistoricalUnknownLateFailedEntry = {
  readonly historicalState: "SUBMISSION_UNKNOWN"
  readonly requestRef: AnchorRequestRef
  readonly unknown: AnchorSubmissionUnknownEvidence
  readonly lateResolution: "LATE_FAILED"
  readonly failure: AnchorFailureEvidence
  readonly lateEvidenceRefs: readonly EvidenceRef[]
  readonly confirmation?: never
  readonly supersededBy?: never
  readonly remainsHistoricalCommitment?: never
  readonly provesEconomicTruth?: never
}

export type AnchorHistoricalEntry =
  | AnchorHistoricalDirectAnchoredEntry
  | AnchorHistoricalDirectFailedEntry
  | AnchorHistoricalUnknownUnresolvedEntry
  | AnchorHistoricalUnknownLateAnchoredEntry
  | AnchorHistoricalUnknownLateFailedEntry

export type AnchorHistoryProjection = {
  readonly entries: readonly AnchorHistoricalEntry[]
  readonly historyDigest: ProofDigest
  readonly appendOnly: true
}

export type AggregateDominantStatus =
  | "RECOVERY_REQUIRED"
  | "DISPUTED"
  | "INCOMPLETE"
  | "READY_UNRECORDED"
  | "AUDITED"

export type AggregateDisputeSource = "OPERATIONAL" | "AUDIT" | "BOTH"

type AggregateBase = {
  readonly operational: OperationalReadinessAxis
  readonly audit: AuditLifecycleAxis
  readonly anchorCurrent: AnchorCurrentLifecycleAxis
  readonly anchorHistory: AnchorHistoryProjection
  readonly internalReasonEvidenceRefs: readonly EvidenceRef[]
}

export type F1eAggregateInternalProjection =
  | (AggregateBase & {
      readonly kind: "RECOVERY_REQUIRED"
      readonly operational: Extract<OperationalReadinessAxis, { state: "RECOVERY_REQUIRED" }>
      readonly disputeSource: null
    })
  | (AggregateBase & {
      readonly kind: "DISPUTED"
      readonly operational: Extract<OperationalReadinessAxis, { state: "DISPUTED" }>
      readonly audit: Exclude<AuditLifecycleAxis, { state: "DISPUTED" }>
      readonly disputeSource: "OPERATIONAL"
    })
  | (AggregateBase & {
      readonly kind: "DISPUTED"
      readonly operational: Exclude<OperationalReadinessAxis, { state: "RECOVERY_REQUIRED" | "DISPUTED" }>
      readonly audit: Extract<AuditLifecycleAxis, { state: "DISPUTED" }>
      readonly disputeSource: "AUDIT"
    })
  | (AggregateBase & {
      readonly kind: "DISPUTED"
      readonly operational: Extract<OperationalReadinessAxis, { state: "DISPUTED" }>
      readonly audit: Extract<AuditLifecycleAxis, { state: "DISPUTED" }>
      readonly disputeSource: "BOTH"
    })
  | (AggregateBase & {
      readonly kind: "INCOMPLETE"
      readonly operational: Extract<OperationalReadinessAxis, { state: "INCOMPLETE" }>
      readonly audit: Exclude<AuditLifecycleAxis, { state: "DISPUTED" }>
      readonly disputeSource: null
    })
  | (AggregateBase & {
      readonly kind: "READY_UNRECORDED"
      readonly operational: Extract<OperationalReadinessAxis, { state: "READY" }>
      readonly audit: Extract<AuditLifecycleAxis, { state: "NOT_RECORDED" | "RECORDING" }>
      readonly anchorCurrent: Extract<AnchorCurrentLifecycleAxis, { state: "NOT_ELIGIBLE" }>
      readonly disputeSource: null
    })
  | (AggregateBase & {
      readonly kind: "AUDITED"
      readonly operational: Extract<OperationalReadinessAxis, { state: "READY" }>
      readonly audit: Extract<AuditLifecycleAxis, { state: "RECORDED" | "CORRECTED" }>
      readonly disputeSource: null
    })

export type AggregateProjectionInput = AggregateBase & {
  readonly inputDigest: ProofDigest
}

export type AggregateProjectionResult =
  | { readonly kind: "PROJECTED"; readonly projection: F1eAggregateInternalProjection }
  | {
      readonly kind: "INVALID_INPUT_FAIL_CLOSED"
      readonly reason: "ANCHOR_WITHOUT_AUDIT" | "NEW_REQUEST_FROM_DISPUTED_AUDIT" | "CURRENT_HISTORY_CONFLICT" | "IMPOSSIBLE_AXIS_COMBINATION"
      readonly inputDigest: ProofDigest
    }

function hasCurrentRequest(anchor: AnchorCurrentLifecycleAxis): anchor is Extract<AnchorCurrentLifecycleAxis, { requestRef: AnchorRequestRef }> {
  return "requestRef" in anchor
}

function requestIdentity(ref: AnchorRequestRef): string {
  return `${String(ref.anchorRequestId)}\u0000${String(ref.anchorRevision)}`
}

export function projectAggregate(input: AggregateProjectionInput): AggregateProjectionResult {
  if ((input.audit.state === "NOT_RECORDED" || input.audit.state === "RECORDING") && input.anchorCurrent.state !== "NOT_ELIGIBLE") {
    return { kind: "INVALID_INPUT_FAIL_CLOSED", reason: "ANCHOR_WITHOUT_AUDIT", inputDigest: input.inputDigest }
  }
  if (input.audit.state === "DISPUTED" && input.anchorCurrent.state !== "NOT_ELIGIBLE") {
    return { kind: "INVALID_INPUT_FAIL_CLOSED", reason: "NEW_REQUEST_FROM_DISPUTED_AUDIT", inputDigest: input.inputDigest }
  }
  if (hasCurrentRequest(input.anchorCurrent)) {
    const currentIdentity = requestIdentity(input.anchorCurrent.requestRef)
    if (input.anchorHistory.entries.some((entry) => requestIdentity(entry.requestRef) === currentIdentity)) {
      return { kind: "INVALID_INPUT_FAIL_CLOSED", reason: "CURRENT_HISTORY_CONFLICT", inputDigest: input.inputDigest }
    }
  }
  const base = {
    operational: input.operational,
    audit: input.audit,
    anchorCurrent: input.anchorCurrent,
    anchorHistory: input.anchorHistory,
    internalReasonEvidenceRefs: input.internalReasonEvidenceRefs,
  }
  if (input.operational.state === "RECOVERY_REQUIRED") {
    return { kind: "PROJECTED", projection: { ...base, kind: "RECOVERY_REQUIRED", operational: input.operational, disputeSource: null } }
  }
  if (input.operational.state === "DISPUTED") {
    if (input.audit.state === "DISPUTED") {
      return { kind: "PROJECTED", projection: { ...base, kind: "DISPUTED", operational: input.operational, audit: input.audit, disputeSource: "BOTH" } }
    }
    return { kind: "PROJECTED", projection: { ...base, kind: "DISPUTED", operational: input.operational, audit: input.audit, disputeSource: "OPERATIONAL" } }
  }
  if (input.audit.state === "DISPUTED") {
    return { kind: "PROJECTED", projection: { ...base, kind: "DISPUTED", operational: input.operational, audit: input.audit, disputeSource: "AUDIT" } }
  }
  if (input.operational.state === "INCOMPLETE") {
    return { kind: "PROJECTED", projection: { ...base, kind: "INCOMPLETE", operational: input.operational, audit: input.audit, disputeSource: null } }
  }
  if ((input.audit.state === "NOT_RECORDED" || input.audit.state === "RECORDING") && input.anchorCurrent.state === "NOT_ELIGIBLE") {
    return { kind: "PROJECTED", projection: { ...base, kind: "READY_UNRECORDED", operational: input.operational, audit: input.audit, anchorCurrent: input.anchorCurrent, disputeSource: null } }
  }
  if (input.audit.state === "RECORDED" || input.audit.state === "CORRECTED") {
    return { kind: "PROJECTED", projection: { ...base, kind: "AUDITED", operational: input.operational, audit: input.audit, disputeSource: null } }
  }
  return { kind: "INVALID_INPUT_FAIL_CLOSED", reason: "IMPOSSIBLE_AXIS_COMBINATION", inputDigest: input.inputDigest }
}

export async function createAggregateProjectionDigestRef(
  projection: F1eAggregateInternalProjection,
  descriptor: AggregateProjectionDigestDescriptor,
  separator: RegisteredDomainSeparator,
): Promise<AggregateProjectionDigestRef | null> {
  try {
    const computed = await digestCanonicalBytesForDescriptor(
      canonicalizeControlledValue(projection),
      String(descriptor.schemaVersion),
      descriptor.algorithm,
      separator,
    )
    if (computed.kind !== "DIGEST_COMPUTED") return null
    return {
      kind: "AGGREGATE_PROJECTION_DIGEST_REF",
      digest: computed.lowercaseHex as AggregateProjectionDigest,
      descriptor,
    }
  } catch {
    return null
  }
}

function descriptorsEqual(
  left: AggregateProjectionDigestDescriptor,
  right: AggregateProjectionDigestDescriptor,
): boolean {
  return left.kind === right.kind
    && hashAlgorithmDescriptorsEqual(left.algorithm, right.algorithm)
    && String(left.schemaVersion) === String(right.schemaVersion)
    && String(left.canonicalizationProfileVersion) === String(right.canonicalizationProfileVersion)
    && left.payloadKind === right.payloadKind
}

export async function verifyAggregateProjectionDigest(
  projection: F1eAggregateInternalProjection,
  expected: AggregateProjectionDigestRef,
  descriptor: AggregateProjectionDigestDescriptor,
  separator: RegisteredDomainSeparator,
): Promise<AggregateProjectionDigestVerificationResult> {
  if (!descriptorsEqual(expected.descriptor, descriptor)) {
    return {
      kind: "DIGEST_DESCRIPTOR_MISMATCH",
      domain: "AGGREGATE_PROJECTION",
      reason: "DESCRIPTOR_MISMATCH",
      expectedDescriptor: expected.descriptor,
      actualDescriptor: descriptor,
    }
  }
  try {
    const computed = await digestCanonicalBytesForDescriptor(
      canonicalizeControlledValue(projection),
      String(descriptor.schemaVersion),
      descriptor.algorithm,
      separator,
    )
    if (computed.kind === "DIGEST_UNSUPPORTED") return { kind: "DIGEST_UNSUPPORTED", domain: "AGGREGATE_PROJECTION", reason: computed.reason }
    if (computed.kind === "DIGEST_INPUT_REJECTED") return { kind: "DIGEST_INPUT_REJECTED", domain: "AGGREGATE_PROJECTION", reason: computed.reason }
    const actualDigest = computed.lowercaseHex as AggregateProjectionDigest
    if (computed.lowercaseHex !== String(expected.digest)) {
      return {
        kind: "DIGEST_VALUE_MISMATCH",
        domain: "AGGREGATE_PROJECTION",
        reason: "DIGEST_VALUE_MISMATCH",
        descriptor,
        expectedDigest: expected.digest,
        actualDigest,
      }
    }
    return { kind: "DIGEST_MATCH", domain: "AGGREGATE_PROJECTION", descriptor, digest: expected.digest }
  } catch {
    return {
      kind: "DIGEST_INTERNAL_INVARIANT_VIOLATION",
      domain: "AGGREGATE_PROJECTION",
      reason: "INTERNAL_INVARIANT_VIOLATION",
      invariantId: "AGGREGATE_PROJECTION_ENCODING_FAILED" as InvariantId,
    }
  }
}
