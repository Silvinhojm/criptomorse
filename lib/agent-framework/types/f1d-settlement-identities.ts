import type {
  ChainId,
  ExecutionAttemptId,
  NonceReservationId,
  ReplacementLineageId,
} from "./f1c-execution-attempts"

declare const f1dNominalBrand: unique symbol
type Nominal<Name extends string> = { readonly [f1dNominalBrand]: Name }
type Opaque<Base, Name extends string> = Base & Nominal<Name>

export type SettlementDomainId = Opaque<string, "SettlementDomainId">
export type BlockchainDomainProfileId = Opaque<string, "BlockchainDomainProfileId">
export type BlockchainDomainProfileVersion = Opaque<string, "BlockchainDomainProfileVersion">
export type NonBlockchainDomainProfileId = Opaque<string, "NonBlockchainDomainProfileId">
export type NonBlockchainDomainProfileVersion = Opaque<string, "NonBlockchainDomainProfileVersion">
export type NonChainIdentity = Opaque<string, "NonChainIdentity">
export type SettlementKey = Opaque<string, "SettlementKey">
export type SettlementKeyDigest = Opaque<string, "SettlementKeyDigest">
export type SettlementId = Opaque<string, "SettlementId">
export type SettlementRevision = Opaque<string, "SettlementRevision">
export type ReconciliationId = Opaque<string, "ReconciliationId">
export type ReconciliationRevision = Opaque<string, "ReconciliationRevision">
export type ReconciliationMethodVersion = Opaque<string, "ReconciliationMethodVersion">
export type ReconciliationInputSnapshotDigest = Opaque<string, "ReconciliationInputSnapshotDigest">
export type ReconciliationKey = Opaque<string, "ReconciliationKey">
export type CanonicalEffectIdentity = Opaque<string, "CanonicalEffectIdentity">
export type DomainEvidenceDigest = Opaque<string, "DomainEvidenceDigest">
export type EvidenceRef = Opaque<string, "EvidenceRef">
export type ProofDigest = Opaque<string, "ProofDigest">
export type AssetIdentity = Opaque<string, "AssetIdentity">
export type AssetRepresentationId = Opaque<string, "AssetRepresentationId">
export type AssetInterfaceProfileVersion = Opaque<string, "AssetInterfaceProfileVersion">
export type AssetUnit = Opaque<string, "AssetUnit">
export type AssetDecimals = Opaque<number, "AssetDecimals">
export type AtomicAmount = Opaque<string, "AtomicAmount">
export type SignedAtomicAmount = Opaque<string, "SignedAtomicAmount">
export type DomainProfileVersion = Opaque<string, "DomainProfileVersion">

export type BlockchainSettlementKeyInput = {
  readonly domainProfileKind: "BLOCKCHAIN"
  readonly domainProfileId: BlockchainDomainProfileId
  readonly domainProfileVersion: BlockchainDomainProfileVersion
  readonly domainId: SettlementDomainId
  readonly chainId: ChainId
  readonly nonChainIdentity?: never
  readonly executionAttemptId: ExecutionAttemptId
  readonly nonceReservationId: NonceReservationId
  readonly replacementLineageId: ReplacementLineageId
}

export type NonBlockchainSettlementKeyInput = {
  readonly domainProfileKind: "NON_BLOCKCHAIN"
  readonly domainProfileId: NonBlockchainDomainProfileId
  readonly domainProfileVersion: NonBlockchainDomainProfileVersion
  readonly domainId: SettlementDomainId
  readonly chainId: null
  readonly nonChainIdentity: NonChainIdentity
  readonly executionAttemptId: ExecutionAttemptId
  readonly nonceReservationId: NonceReservationId
  readonly replacementLineageId: ReplacementLineageId
}

export type SettlementKeyInput = BlockchainSettlementKeyInput | NonBlockchainSettlementKeyInput

export type AssetRepresentation = {
  readonly assetIdentity: AssetIdentity
  readonly representation: AssetRepresentationId
  readonly interfaceProfile: AssetInterfaceProfileVersion
  readonly unit: AssetUnit
  readonly decimals: AssetDecimals
  readonly sourceEvidenceRef: EvidenceRef
  readonly profileVersion: DomainProfileVersion
}

export type AmountValue = {
  readonly atomicAmount: AtomicAmount
  readonly asset: AssetRepresentation
}

export type SignedAmountValue = {
  readonly signedAtomicAmount: SignedAtomicAmount
  readonly asset: AssetRepresentation
}

export type ReconciliationKeyInput = {
  readonly settlementId: SettlementId
  readonly settlementRevision: SettlementRevision
  readonly canonicalEffectIdentity: CanonicalEffectIdentity
  readonly reconciliationMethodVersion: ReconciliationMethodVersion
  readonly inputSnapshotDigest: ReconciliationInputSnapshotDigest
}

export type F1dStorageGuarantee = {
  readonly kind: "FUTURE_STORAGE_CONTRACT"
  readonly typesProvideAtomicity: false
  readonly typesProvideDurability: false
  readonly typesProvideConsensus: false
}
