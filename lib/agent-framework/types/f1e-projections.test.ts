import type { EvidenceRef, ProofDigest } from "./f1d-settlement-identities"
import { projectAggregate } from "./f1e-projections"
import type { AggregateProjectionInput, AnchorHistoricalEntry } from "./f1e-projections"

function expect(condition: boolean, message: string): void { if (!condition) throw new Error(message) }
const evidence = "evidence" as EvidenceRef
const history = { entries: [] as readonly AnchorHistoricalEntry[], historyDigest: "history" as ProofDigest, appendOnly: true as const }
const digest = "input" as ProofDigest

function input(overrides: Pick<AggregateProjectionInput, "operational" | "audit" | "anchorCurrent">): AggregateProjectionInput {
  return { ...overrides, anchorHistory: history, internalReasonEvidenceRefs: [evidence], inputDigest: digest }
}

export function runProjectionTests(): void {
  const recovery = projectAggregate(input({ operational: { state: "RECOVERY_REQUIRED", reasons: [evidence] }, audit: { state: "NOT_RECORDED" }, anchorCurrent: { state: "NOT_ELIGIBLE" } }))
  expect(recovery.kind === "PROJECTED" && recovery.projection.kind === "RECOVERY_REQUIRED", "recovery precedence")
  const disputed = projectAggregate(input({ operational: { state: "DISPUTED", reasons: [evidence] }, audit: { state: "NOT_RECORDED" }, anchorCurrent: { state: "NOT_ELIGIBLE" } }))
  expect(disputed.kind === "PROJECTED" && disputed.projection.kind === "DISPUTED" && disputed.projection.disputeSource === "OPERATIONAL", "operational dispute")
  const auditDisputed = projectAggregate(input({ operational: { state: "INCOMPLETE", reasons: [evidence] }, audit: { state: "DISPUTED", ref: auditRef(), disputeRef: evidence }, anchorCurrent: { state: "NOT_ELIGIBLE" } }))
  expect(auditDisputed.kind === "PROJECTED" && auditDisputed.projection.kind === "DISPUTED" && auditDisputed.projection.disputeSource === "AUDIT", "audit dispute")
  const bothDisputed = projectAggregate(input({ operational: { state: "DISPUTED", reasons: [evidence] }, audit: { state: "DISPUTED", ref: auditRef(), disputeRef: evidence }, anchorCurrent: { state: "NOT_ELIGIBLE" } }))
  expect(bothDisputed.kind === "PROJECTED" && bothDisputed.projection.kind === "DISPUTED" && bothDisputed.projection.disputeSource === "BOTH", "both dispute")
  const incomplete = projectAggregate(input({ operational: { state: "INCOMPLETE", reasons: [evidence] }, audit: { state: "NOT_RECORDED" }, anchorCurrent: { state: "NOT_ELIGIBLE" } }))
  expect(incomplete.kind === "PROJECTED" && incomplete.projection.kind === "INCOMPLETE", "incomplete precedence")
  const anchorCannotElevate = projectAggregate(input({ operational: { state: "INCOMPLETE", reasons: [evidence] }, audit: { state: "RECORDED", ref: auditRef() }, anchorCurrent: { state: "ANCHORED", requestRef: anchorRef() } }))
  expect(anchorCannotElevate.kind === "PROJECTED" && anchorCannotElevate.projection.kind === "INCOMPLETE", "anchor does not elevate")
  const impossible = projectAggregate(input({ operational: { state: "INCOMPLETE", reasons: [evidence] }, audit: { state: "NOT_RECORDED" }, anchorCurrent: { state: "ELIGIBLE", proofDigest: digest } }))
  expect(impossible.kind === "INVALID_INPUT_FAIL_CLOSED" && impossible.reason === "ANCHOR_WITHOUT_AUDIT", "fail closed")
  const ready = projectAggregate(input({ operational: { state: "READY", handoff: handoffStub() }, audit: { state: "NOT_RECORDED" }, anchorCurrent: { state: "NOT_ELIGIBLE" } }))
  expect(ready.kind === "PROJECTED" && ready.projection.kind === "READY_UNRECORDED", "ready unrecorded")
  const audited = projectAggregate(input({ operational: { state: "READY", handoff: handoffStub() }, audit: { state: "RECORDED", ref: auditRef() }, anchorCurrent: { state: "ELIGIBLE", proofDigest: digest } }))
  expect(audited.kind === "PROJECTED" && audited.projection.kind === "AUDITED", "audited")
}

function handoffStub(): Extract<AggregateProjectionInput["operational"], { state: "READY" }>["handoff"] {
  return { kind: "F1D_HANDOFF_ELIGIBILITY" } as Extract<AggregateProjectionInput["operational"], { state: "READY" }>["handoff"]
}

function algorithm() {
  return { algorithmId: "SHA-256", algorithmVersion: "1", digestEncoding: "LOWERCASE_HEX" as const, domainSeparatorId: "D", domainSeparatorVersion: "1" }
}
function auditRef() {
  return {
    kind: "AUDIT_EVIDENCE_REF" as const,
    auditEvidenceId: "audit-id",
    auditRevision: "1",
    commitment: {
      kind: "AUDIT_EVIDENCE_COMMITMENT_DIGEST_REF" as const,
      digest: "commitment",
      algorithm: algorithm(),
      envelopeSchemaVersion: "1",
      canonicalPayload: { kind: "CANONICAL_PAYLOAD_DIGEST_REF" as const, digest: "canonical", algorithm: algorithm(), schemaVersion: "1", canonicalizationProfileVersion: "1" },
    },
  } as Extract<AggregateProjectionInput["audit"], { state: "RECORDED" }>["ref"]
}
function anchorRef() {
  return {
    kind: "ANCHOR_REQUEST_REF" as const,
    anchorRequestId: "anchor-id",
    anchorRevision: "1",
    artifact: {
      kind: "ANCHOR_ARTIFACT_DIGEST_DESCRIPTOR" as const,
      digest: "artifact",
      algorithm: algorithm(),
      artifactSchemaVersion: "1",
      targetProfile: { profileId: "profile", profileVersion: "1", network: "network", chainId: null },
      evidenceCommitment: auditRef().commitment,
    },
  } as Extract<AggregateProjectionInput["anchorCurrent"], { requestRef: object }>["requestRef"]
}

runProjectionTests()
