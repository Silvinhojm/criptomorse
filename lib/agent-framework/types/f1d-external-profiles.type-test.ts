import type {
  CctpV1LegacyCrossChainOperationSnapshot,
  CctpV1LegacyProtocolDescriptor,
  CctpV1LegacyProtocolVersion,
  CctpV2CrossChainOperationSnapshot,
  CctpV2ProtocolDescriptor,
  CctpV2ProtocolVersion,
  ExternalCrossChainProtocolDescriptor,
  ExternalCrossChainProtocolVersion,
  OutstandingLiability,
  UnifiedBalanceOperationSnapshot,
} from "./f1d-external-profiles"

type Assert<Condition extends true> = Condition
type IsAssignable<From, To> = [From] extends [To] ? true : false
type Not<Value extends boolean> = Value extends true ? false : true

type _V1NotV2 = Assert<Not<IsAssignable<CctpV1LegacyProtocolVersion, CctpV2ProtocolVersion>>>
type _V2NotV1 = Assert<Not<IsAssignable<CctpV2ProtocolVersion, CctpV1LegacyProtocolVersion>>>
type _ExternalNotCctp = Assert<Not<IsAssignable<ExternalCrossChainProtocolVersion, CctpV2ProtocolVersion>>>
type _V1AlwaysHistorical = Assert<IsAssignable<CctpV1LegacyCrossChainOperationSnapshot["operationAdmission"], "HISTORICAL_RECORD_ONLY">>
type _SourceOnlyNotComplete = Assert<Not<IsAssignable<Extract<CctpV2CrossChainOperationSnapshot, { classification: "INCOMPLETE" }>, Extract<CctpV2CrossChainOperationSnapshot, { classification: "COMPLETE" }>>>>
type _AvailabilityNotDelivery = Assert<Not<IsAssignable<Extract<UnifiedBalanceOperationSnapshot, { stage: "BALANCE_AVAILABLE" }>, Extract<UnifiedBalanceOperationSnapshot, { stage: "DESTINATION_DELIVERED" }>>>>
type _AdvanceNotClosed = Assert<IsAssignable<Extract<OutstandingLiability, { stage: "FUNDED_ADVANCE" }>["accountingClosed"], false>>

declare const v1Descriptor: CctpV1LegacyProtocolDescriptor
declare const v2Descriptor: CctpV2ProtocolDescriptor
declare const externalDescriptor: ExternalCrossChainProtocolDescriptor
declare const v1Snapshot: CctpV1LegacyCrossChainOperationSnapshot
declare const v2Snapshot: CctpV2CrossChainOperationSnapshot

const validV1Historical: CctpV1LegacyCrossChainOperationSnapshot = v1Snapshot
const validV2: CctpV2CrossChainOperationSnapshot = v2Snapshot
// @ts-expect-error V1 descriptor cannot be V2
const invalidV1AsV2: CctpV2ProtocolDescriptor = v1Descriptor
// @ts-expect-error V2 descriptor cannot be V1
const invalidV2AsV1: CctpV1LegacyProtocolDescriptor = v2Descriptor
// @ts-expect-error external descriptor is not CCTP
const invalidExternalAsCctp: CctpV2ProtocolDescriptor = externalDescriptor
// @ts-expect-error V1 operation cannot claim current admission
const invalidV1Admission: CctpV1LegacyCrossChainOperationSnapshot = { ...v1Snapshot, operationAdmission: "CURRENT_PROFILE_POLICY" }
// @ts-expect-error a V1 operation cannot be assigned to V2
const invalidCrossGeneration: CctpV2CrossChainOperationSnapshot = v1Snapshot

export type F1dExternalProfileTypeTests =
  | _V1NotV2 | _V2NotV1 | _ExternalNotCctp | _V1AlwaysHistorical
  | _SourceOnlyNotComplete | _AvailabilityNotDelivery | _AdvanceNotClosed
