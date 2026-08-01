import type {
  ClientReasonCode,
  DisclosedValue,
  F1eAggregateClientDto,
  PublicAnchorHistoryEntry,
  PublicAnchorRef,
  PublicAuditRef,
  PublicRedactionManifestRef,
} from "./f1e-client-dto"
import type { RedactionManifestDigestRef } from "./f1e-digest-contracts"
import type {
  AggregateProjectionResult,
  F1eAggregateInternalProjection,
} from "./f1e-projections"

export type ClientMapperDisclosure = {
  readonly auditRef: DisclosedValue<PublicAuditRef>
  readonly anchorCurrentRef: DisclosedValue<PublicAnchorRef>
  readonly anchorHistory: readonly PublicAnchorHistoryEntry[]
  readonly manifestRef: PublicRedactionManifestRef
  readonly manifestDigest: RedactionManifestDigestRef
}

function reasonsForProjection(projection: F1eAggregateInternalProjection): readonly ClientReasonCode[] {
  if (projection.kind === "RECOVERY_REQUIRED") return ["UPSTREAM_RECOVERY"]
  if (projection.kind === "DISPUTED") {
    if (projection.disputeSource === "AUDIT") return ["AUDIT_DISPUTE"]
    if (projection.disputeSource === "BOTH") return ["UPSTREAM_DISPUTE", "AUDIT_DISPUTE"]
    return ["UPSTREAM_DISPUTE"]
  }
  if (projection.kind === "INCOMPLETE") return ["INCOMPLETE_EVIDENCE"]
  if (projection.kind === "READY_UNRECORDED") return ["AUDIT_PENDING"]
  const reasons: ClientReasonCode[] = ["AUDITED"]
  if (projection.anchorCurrent.state === "SUBMISSION_UNKNOWN") reasons.push("ANCHOR_UNKNOWN")
  if (projection.anchorHistory.entries.length > 0) reasons.push("ANCHOR_HISTORICAL")
  return reasons
}

/** Server-only allowlist mapper. It is intentionally absent from f1e-client.ts. */
export function redactToClientDto(
  result: AggregateProjectionResult,
  disclosure: ClientMapperDisclosure,
): F1eAggregateClientDto {
  if (result.kind === "INVALID_INPUT_FAIL_CLOSED") {
    return {
      kind: "F1E_AGGREGATE_CLIENT",
      status: "INVALID_FAIL_CLOSED",
      reasonCodes: ["INVALID_INPUT"],
      auditRef: disclosure.auditRef,
      anchorCurrentRef: disclosure.anchorCurrentRef,
      anchorHistory: disclosure.anchorHistory,
      manifestRef: disclosure.manifestRef,
      manifestDigest: disclosure.manifestDigest,
    }
  }
  return {
    kind: "F1E_AGGREGATE_CLIENT",
    status: result.projection.kind,
    reasonCodes: reasonsForProjection(result.projection),
    auditRef: disclosure.auditRef,
    anchorCurrentRef: disclosure.anchorCurrentRef,
    anchorHistory: disclosure.anchorHistory,
    manifestRef: disclosure.manifestRef,
    manifestDigest: disclosure.manifestDigest,
  }
}

