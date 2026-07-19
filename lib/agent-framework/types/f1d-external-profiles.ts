import type { ChainId } from "./f1c-execution-attempts"
import type {
  AmountValue,
  DomainProfileVersion,
  EvidenceRef,
  ProofDigest,
  SignedAmountValue,
  SettlementDomainId,
} from "./f1d-settlement-identities"
import type {
  AllocationMethodVersion,
  BatchId,
  CompleteEffectProof,
  EffectComponentId,
  MemberSetDigest,
  ReconciliationConclusionReference,
  RoundingRuleVersion,
  UndisputedSettlementReference,
} from "./f1d-reconciliation"

declare const profileBrand: unique symbol
type ProfileOpaque<Name extends string> = string & { readonly [profileBrand]: Name }

export type ExternalOperationId = ProfileOpaque<"ExternalOperationId">
export type CrossChainLegId = ProfileOpaque<"CrossChainLegId">
export type CctpV1LegacyProtocolVersion = ProfileOpaque<"CctpV1LegacyProtocolVersion">
export type CctpV2ProtocolVersion = ProfileOpaque<"CctpV2ProtocolVersion">
export type ExternalCrossChainProtocolId = ProfileOpaque<"ExternalCrossChainProtocolId">
export type ExternalCrossChainProtocolVersion = ProfileOpaque<"ExternalCrossChainProtocolVersion">
export type CctpV1LegacyProtocolDescriptorDigest = ProfileOpaque<"CctpV1LegacyProtocolDescriptorDigest">
export type CctpV2ProtocolDescriptorDigest = ProfileOpaque<"CctpV2ProtocolDescriptorDigest">
export type ExternalCrossChainProtocolDescriptorDigest = ProfileOpaque<"ExternalCrossChainProtocolDescriptorDigest">
export type MicropaymentId = ProfileOpaque<"MicropaymentId">
export type NanopaymentAuthorizationId = ProfileOpaque<"NanopaymentAuthorizationId">
export type WalletIdentity = ProfileOpaque<"WalletIdentity">
export type OutstandingLiabilityId = ProfileOpaque<"OutstandingLiabilityId">

export type CctpV1LegacyProtocolDescriptor = { readonly protocol: "CCTP"; readonly protocolGeneration: "V1_LEGACY"; readonly protocolVersion: CctpV1LegacyProtocolVersion; readonly externalProtocolId?: never }
export type CctpV2ProtocolDescriptor = { readonly protocol: "CCTP"; readonly protocolGeneration: "V2"; readonly protocolVersion: CctpV2ProtocolVersion; readonly externalProtocolId?: never }
export type ExternalCrossChainProtocolDescriptor = { readonly protocol: "VERSIONED_CROSS_CHAIN_PROTOCOL"; readonly protocolGeneration: "EXTERNAL_VERSIONED"; readonly protocolVersion: ExternalCrossChainProtocolVersion; readonly externalProtocolId: ExternalCrossChainProtocolId }
export type CrossChainProtocolDescriptor = CctpV1LegacyProtocolDescriptor | CctpV2ProtocolDescriptor | ExternalCrossChainProtocolDescriptor

type CctpV1Leg = { readonly legId: CrossChainLegId; readonly protocolGeneration: "V1_LEGACY"; readonly protocolVersion: CctpV1LegacyProtocolVersion; readonly protocolDescriptorDigest: CctpV1LegacyProtocolDescriptorDigest; readonly domainId: SettlementDomainId; readonly chainId: ChainId; readonly role: "SOURCE_BURN" | "MESSAGE_ATTESTATION" | "DESTINATION_MINT"; readonly amount: AmountValue | null; readonly settlementRef: UndisputedSettlementReference | null; readonly evidenceRefs: readonly EvidenceRef[] }
type CctpV2Leg = { readonly legId: CrossChainLegId; readonly protocolGeneration: "V2"; readonly protocolVersion: CctpV2ProtocolVersion; readonly protocolDescriptorDigest: CctpV2ProtocolDescriptorDigest; readonly domainId: SettlementDomainId; readonly chainId: ChainId; readonly role: "SOURCE_BURN" | "MESSAGE_ATTESTATION" | "DESTINATION_MINT"; readonly amount: AmountValue | null; readonly settlementRef: UndisputedSettlementReference | null; readonly evidenceRefs: readonly EvidenceRef[] }
type ExternalLeg = { readonly legId: CrossChainLegId; readonly protocolGeneration: "EXTERNAL_VERSIONED"; readonly protocolVersion: ExternalCrossChainProtocolVersion; readonly protocolDescriptorDigest: ExternalCrossChainProtocolDescriptorDigest; readonly domainId: SettlementDomainId; readonly chainId: ChainId; readonly role: "SOURCE" | "MESSAGE_OR_ATTESTATION" | "DESTINATION"; readonly amount: AmountValue | null; readonly settlementRef: UndisputedSettlementReference | null; readonly evidenceRefs: readonly EvidenceRef[] }

export type CctpV1LegacyCrossChainOperationSnapshot =
  | { readonly classification: "INCOMPLETE"; readonly operationAdmission: "HISTORICAL_RECORD_ONLY"; readonly operationId: ExternalOperationId; readonly descriptor: CctpV1LegacyProtocolDescriptor; readonly protocolDescriptorDigest: CctpV1LegacyProtocolDescriptorDigest; readonly sourceLeg: CctpV1Leg; readonly messageOrAttestationLeg: CctpV1Leg | null; readonly destinationLeg: CctpV1Leg | null; readonly missingRoles: readonly ("MESSAGE_ATTESTATION" | "DESTINATION_MINT")[]; readonly endToEndSettlementRef?: never }
  | { readonly classification: "COMPLETE"; readonly operationAdmission: "HISTORICAL_RECORD_ONLY"; readonly operationId: ExternalOperationId; readonly descriptor: CctpV1LegacyProtocolDescriptor; readonly protocolDescriptorDigest: CctpV1LegacyProtocolDescriptorDigest; readonly sourceLeg: CctpV1Leg; readonly messageOrAttestationLeg: CctpV1Leg; readonly destinationLeg: CctpV1Leg; readonly missingRoles: readonly []; readonly endToEndSettlementRef: UndisputedSettlementReference }
  | { readonly classification: "DISPUTED"; readonly operationAdmission: "HISTORICAL_RECORD_ONLY"; readonly operationId: ExternalOperationId; readonly descriptor: CctpV1LegacyProtocolDescriptor; readonly protocolDescriptorDigest: CctpV1LegacyProtocolDescriptorDigest; readonly sourceLeg: CctpV1Leg; readonly messageOrAttestationLeg: CctpV1Leg | null; readonly destinationLeg: CctpV1Leg | null; readonly missingRoles: readonly ("MESSAGE_ATTESTATION" | "DESTINATION_MINT")[]; readonly disputeRef: EvidenceRef; readonly endToEndSettlementRef?: never }
export type CctpV2CrossChainOperationSnapshot =
  | { readonly classification: "INCOMPLETE"; readonly operationAdmission: "CURRENT_PROFILE_POLICY"; readonly operationId: ExternalOperationId; readonly descriptor: CctpV2ProtocolDescriptor; readonly protocolDescriptorDigest: CctpV2ProtocolDescriptorDigest; readonly sourceLeg: CctpV2Leg; readonly messageOrAttestationLeg: CctpV2Leg | null; readonly destinationLeg: CctpV2Leg | null; readonly missingRoles: readonly ("MESSAGE_ATTESTATION" | "DESTINATION_MINT")[]; readonly endToEndSettlementRef?: never }
  | { readonly classification: "COMPLETE"; readonly operationAdmission: "CURRENT_PROFILE_POLICY"; readonly operationId: ExternalOperationId; readonly descriptor: CctpV2ProtocolDescriptor; readonly protocolDescriptorDigest: CctpV2ProtocolDescriptorDigest; readonly sourceLeg: CctpV2Leg; readonly messageOrAttestationLeg: CctpV2Leg; readonly destinationLeg: CctpV2Leg; readonly missingRoles: readonly []; readonly endToEndSettlementRef: UndisputedSettlementReference }
  | { readonly classification: "DISPUTED"; readonly operationAdmission: "CURRENT_PROFILE_POLICY"; readonly operationId: ExternalOperationId; readonly descriptor: CctpV2ProtocolDescriptor; readonly protocolDescriptorDigest: CctpV2ProtocolDescriptorDigest; readonly sourceLeg: CctpV2Leg; readonly messageOrAttestationLeg: CctpV2Leg | null; readonly destinationLeg: CctpV2Leg | null; readonly missingRoles: readonly ("MESSAGE_ATTESTATION" | "DESTINATION_MINT")[]; readonly disputeRef: EvidenceRef; readonly endToEndSettlementRef?: never }
export type ExternalCrossChainOperationSnapshot =
  | { readonly classification: "INCOMPLETE"; readonly operationAdmission: "CURRENT_PROFILE_POLICY"; readonly operationId: ExternalOperationId; readonly descriptor: ExternalCrossChainProtocolDescriptor; readonly protocolDescriptorDigest: ExternalCrossChainProtocolDescriptorDigest; readonly sourceLeg: ExternalLeg; readonly messageOrAttestationLeg: ExternalLeg | null; readonly destinationLeg: ExternalLeg | null; readonly missingRoles: readonly ("MESSAGE_OR_ATTESTATION" | "DESTINATION")[]; readonly endToEndSettlementRef?: never }
  | { readonly classification: "COMPLETE"; readonly operationAdmission: "CURRENT_PROFILE_POLICY"; readonly operationId: ExternalOperationId; readonly descriptor: ExternalCrossChainProtocolDescriptor; readonly protocolDescriptorDigest: ExternalCrossChainProtocolDescriptorDigest; readonly sourceLeg: ExternalLeg; readonly messageOrAttestationLeg: ExternalLeg; readonly destinationLeg: ExternalLeg; readonly missingRoles: readonly []; readonly endToEndSettlementRef: UndisputedSettlementReference }
  | { readonly classification: "DISPUTED"; readonly operationAdmission: "CURRENT_PROFILE_POLICY"; readonly operationId: ExternalOperationId; readonly descriptor: ExternalCrossChainProtocolDescriptor; readonly protocolDescriptorDigest: ExternalCrossChainProtocolDescriptorDigest; readonly sourceLeg: ExternalLeg; readonly messageOrAttestationLeg: ExternalLeg | null; readonly destinationLeg: ExternalLeg | null; readonly missingRoles: readonly ("MESSAGE_OR_ATTESTATION" | "DESTINATION")[]; readonly disputeRef: EvidenceRef; readonly endToEndSettlementRef?: never }
export type CrossChainOperationSnapshot = CctpV1LegacyCrossChainOperationSnapshot | CctpV2CrossChainOperationSnapshot | ExternalCrossChainOperationSnapshot

export type NanopaymentAuthorizationReference = { readonly micropaymentId: MicropaymentId; readonly authorizationId: NanopaymentAuthorizationId; readonly authorizationDigest: ProofDigest; readonly payerWallet: WalletIdentity; readonly payeeWallet: WalletIdentity; readonly amount: AmountValue; readonly profileVersion: DomainProfileVersion; readonly evidenceRef: EvidenceRef; readonly individualTransactionHash?: never }
export type BatchCorrelation = { readonly batchId: BatchId; readonly memberSetDigest: MemberSetDigest; readonly authorizations: readonly NanopaymentAuthorizationReference[]; readonly componentIds: readonly EffectComponentId[]; readonly allocationMethodVersion: AllocationMethodVersion; readonly roundingRuleVersion: RoundingRuleVersion; readonly residual: SignedAmountValue; readonly completenessProof: CompleteEffectProof; readonly individualTransactionHashes?: never }

export type UnifiedBalanceOperationSnapshot =
  | { readonly stage: "FUNDED_OR_DEPOSITED"; readonly operationId: ExternalOperationId; readonly profileVersion: DomainProfileVersion; readonly fundingRef: EvidenceRef; readonly availabilityRef?: never; readonly authorizationRef?: never; readonly providerAcceptanceRef?: never; readonly deliveryRef?: never; readonly withdrawalRef?: never; readonly reconciliationRef?: never }
  | { readonly stage: "BALANCE_AVAILABLE"; readonly operationId: ExternalOperationId; readonly profileVersion: DomainProfileVersion; readonly fundingRef: EvidenceRef; readonly availabilityRef: EvidenceRef; readonly authorizationRef?: never; readonly providerAcceptanceRef?: never; readonly deliveryRef?: never; readonly withdrawalRef?: never; readonly reconciliationRef?: never }
  | { readonly stage: "SPEND_AUTHORIZED"; readonly operationId: ExternalOperationId; readonly profileVersion: DomainProfileVersion; readonly fundingRef: EvidenceRef; readonly availabilityRef: EvidenceRef; readonly authorizationRef: EvidenceRef; readonly providerAcceptanceRef?: never; readonly deliveryRef?: never; readonly withdrawalRef?: never; readonly reconciliationRef?: never }
  | { readonly stage: "PROVIDER_ACCEPTED"; readonly operationId: ExternalOperationId; readonly profileVersion: DomainProfileVersion; readonly fundingRef: EvidenceRef; readonly availabilityRef: EvidenceRef; readonly authorizationRef: EvidenceRef; readonly providerAcceptanceRef: EvidenceRef; readonly deliveryRef?: never; readonly withdrawalRef?: never; readonly reconciliationRef?: never }
  | { readonly stage: "DESTINATION_DELIVERED"; readonly operationId: ExternalOperationId; readonly profileVersion: DomainProfileVersion; readonly fundingRef: EvidenceRef; readonly availabilityRef: EvidenceRef; readonly authorizationRef: EvidenceRef; readonly providerAcceptanceRef: EvidenceRef; readonly deliveryRef: EvidenceRef; readonly withdrawalRef: EvidenceRef | null; readonly reconciliationRef?: never }
  | { readonly stage: "E2E_RECONCILED"; readonly operationId: ExternalOperationId; readonly profileVersion: DomainProfileVersion; readonly fundingRef: EvidenceRef; readonly availabilityRef: EvidenceRef; readonly authorizationRef: EvidenceRef; readonly providerAcceptanceRef: EvidenceRef; readonly deliveryRef: EvidenceRef; readonly withdrawalRef: EvidenceRef | null; readonly reconciliationRef: ReconciliationConclusionReference }

type LiabilityBase = { readonly liabilityId: OutstandingLiabilityId; readonly operationId: ExternalOperationId; readonly principalAdvanced: AmountValue; readonly feesAccrued: AmountValue; readonly outstandingAmount: AmountValue; readonly evidenceRefs: readonly EvidenceRef[] }
export type OutstandingLiability =
  | (LiabilityBase & { readonly stage: "FUNDED_ADVANCE" | "TRADE_SETTLED_UNREPAID"; readonly repaymentEvidenceRef?: never; readonly accountingClosed: false })
  | (LiabilityBase & { readonly stage: "PARTIALLY_REPAID" | "DEFAULTED"; readonly repaymentEvidenceRef: EvidenceRef | null; readonly accountingClosed: false })
  | (LiabilityBase & { readonly stage: "REPAID"; readonly repaymentEvidenceRef: EvidenceRef; readonly accountingClosed: true })
