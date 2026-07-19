import type { PersistedExternalAcceptanceRequirement } from "./f1d-finality"
import type {
  ArcDeterministicSettlementDecisionRequest,
  ProbabilisticSettlementDecisionRequest,
  SettlementRecord,
} from "./f1d-settlement"
import type { SettlementObservation, ShadowEvidenceBinding, AuthoritativeEvidenceBinding } from "./f1d-settlement-observations"

type Assert<Condition extends true> = Condition
type IsAssignable<From, To> = [From] extends [To] ? true : false
type Not<Value extends boolean> = Value extends true ? false : true
type HasRequiredKey<Shape, Key extends keyof Shape> = Record<never, never> extends Pick<Shape, Key> ? false : true

type _ObservationNotSettlement = Assert<Not<IsAssignable<SettlementObservation, SettlementRecord>>>
type _ShadowNotAuthoritative = Assert<Not<IsAssignable<ShadowEvidenceBinding, AuthoritativeEvidenceBinding>>>
type _ExternalNotArc = Assert<Not<IsAssignable<PersistedExternalAcceptanceRequirement, ArcDeterministicSettlementDecisionRequest["finalityRequirement"]>>>
type _ExternalNotProbabilistic = Assert<Not<IsAssignable<PersistedExternalAcceptanceRequirement, ProbabilisticSettlementDecisionRequest["finalityRequirement"]>>>
type _ArcRequiresBlock = Assert<HasRequiredKey<ArcDeterministicSettlementDecisionRequest, "canonicalBlock">>
type _ArcRequiresProof = Assert<HasRequiredKey<ArcDeterministicSettlementDecisionRequest, "finalityProof">>
type _ArcRequiresLineage = Assert<HasRequiredKey<ArcDeterministicSettlementDecisionRequest, "completeLineageSnapshotDigest">>
type _ArcRequiresAuthority = Assert<HasRequiredKey<ArcDeterministicSettlementDecisionRequest, "operationalAuthorityProof">>
type _ProbabilisticStartsConfirmed = Assert<IsAssignable<ProbabilisticSettlementDecisionRequest["fromState"], "CONFIRMED_UNFINALIZED">>

declare const arcRequest: ArcDeterministicSettlementDecisionRequest
declare const probabilisticRequest: ProbabilisticSettlementDecisionRequest
declare const arcWithoutBlock: Omit<ArcDeterministicSettlementDecisionRequest, "canonicalBlock">
declare const arcWithoutProof: Omit<ArcDeterministicSettlementDecisionRequest, "finalityProof">
declare const arcWithoutPolicy: Omit<ArcDeterministicSettlementDecisionRequest, "finalityRequirement">
declare const arcWithoutLineage: Omit<ArcDeterministicSettlementDecisionRequest, "completeLineageSnapshotDigest">
declare const arcWithoutAuthority: Omit<ArcDeterministicSettlementDecisionRequest, "operationalAuthorityProof">

const validArc: ArcDeterministicSettlementDecisionRequest = arcRequest
const validProbabilistic: ProbabilisticSettlementDecisionRequest = probabilisticRequest
// @ts-expect-error Arc requires canonical block
const invalidArcBlock: ArcDeterministicSettlementDecisionRequest = arcWithoutBlock
// @ts-expect-error Arc requires deterministic proof
const invalidArcProof: ArcDeterministicSettlementDecisionRequest = arcWithoutProof
// @ts-expect-error Arc requires policy/profile version through requirement
const invalidArcPolicy: ArcDeterministicSettlementDecisionRequest = arcWithoutPolicy
// @ts-expect-error Arc requires lineage binding
const invalidArcLineage: ArcDeterministicSettlementDecisionRequest = arcWithoutLineage
// @ts-expect-error Arc requires authority binding
const invalidArcAuthority: ArcDeterministicSettlementDecisionRequest = arcWithoutAuthority
// @ts-expect-error probabilistic route cannot start at receipt
const invalidProbabilisticDirect: ProbabilisticSettlementDecisionRequest = { ...probabilisticRequest, fromState: "RECEIPT_OBSERVED" }

export type F1dFinalityTypeTests =
  | _ObservationNotSettlement
  | _ShadowNotAuthoritative
  | _ExternalNotArc
  | _ExternalNotProbabilistic
  | _ArcRequiresBlock
  | _ArcRequiresProof
  | _ArcRequiresLineage
  | _ArcRequiresAuthority
  | _ProbabilisticStartsConfirmed
