import type { ChainId, TransactionAttemptId, TransactionHash } from "./f1c-execution-attempts"
import type {
  DomainEvidenceDigest,
  EvidenceRef,
  SettlementDomainId,
  SettlementKey,
} from "./f1d-settlement-identities"

declare const observationBrand: unique symbol
type ObservationNominal<Name extends string> = string & { readonly [observationBrand]: Name }

export type SettlementObservationId = ObservationNominal<"SettlementObservationId">
export type SettlementObservationSequence = ObservationNominal<"SettlementObservationSequence">
export type SettlementObservationRevision = ObservationNominal<"SettlementObservationRevision">
export type ObservationObservedAt = ObservationNominal<"ObservationObservedAt">
export type SettlementObserverId = ObservationNominal<"SettlementObserverId">
export type ObservedBlockIdentity = ObservationNominal<"ObservedBlockIdentity">
export type DomainBlockSequence = ObservationNominal<"DomainBlockSequence">
export type EvidenceProfileVersion = ObservationNominal<"EvidenceProfileVersion">
export type AuthorityMode = "SHADOW" | "AUTHORITATIVE"

export type ObservedBlockReference = {
  readonly domainId: SettlementDomainId
  readonly chainId: ChainId | null
  readonly blockIdentity: ObservedBlockIdentity
  readonly blockNumberOrSequence: DomainBlockSequence
  readonly blockHashOrDigest: DomainEvidenceDigest
}

export type ReceiptObservationData = {
  readonly observationKind: "RECEIPT_OBSERVATION"
  readonly transactionAttemptId: TransactionAttemptId
  readonly transactionHash: TransactionHash
  readonly rawReceiptDigest: DomainEvidenceDigest
  readonly reportedOutcome: "SUCCESS" | "REVERTED"
  readonly blockReference: ObservedBlockReference
  readonly sourceProfileVersion: EvidenceProfileVersion
  readonly canonicalityProven: false
  readonly finalityProven: false
}

export type BlockObservationData = {
  readonly observationKind: "BLOCK_OBSERVATION"
  readonly blockReference: ObservedBlockReference
  readonly sourceProfileVersion: EvidenceProfileVersion
  readonly evidenceRef: EvidenceRef
  readonly canonicalityClaimed: false
  readonly finalityClaimed: false
}

export type ReorgObservation = {
  readonly observationKind: "PROBABILISTIC_REORG_OBSERVATION"
  readonly removedBlock: ObservedBlockReference
  readonly replacementBlock: ObservedBlockReference | null
  readonly affectedTransactionAttemptIds: readonly TransactionAttemptId[]
  readonly evidenceRefs: readonly EvidenceRef[]
  readonly postDeterministicCommit: false
}

export type ExternalConflictEvidence = {
  readonly observationKind: "EXTERNAL_CONFLICT"
  readonly conflictCode: "OUTSIDE_LINEAGE" | "RECEIPT_MISMATCH" | "BLOCK_MISMATCH" | "POLICY_MISMATCH"
  readonly conflictingTransactionHash: TransactionHash | null
  readonly evidenceRefs: readonly EvidenceRef[]
  readonly evidenceDigest: DomainEvidenceDigest
}

type ObservationBase = {
  readonly observationId: SettlementObservationId
  readonly settlementKey: SettlementKey
  readonly sequence: SettlementObservationSequence
  readonly observationRevision: SettlementObservationRevision
  readonly authorityMode: AuthorityMode
  readonly observerId: SettlementObserverId
  readonly observedAt: ObservationObservedAt
  readonly evidenceDigest: DomainEvidenceDigest
  readonly declaresSettlement: false
  readonly settlementProof?: never
}

export type SettlementObservation =
  | (ObservationBase & { readonly kind: "SUBMISSION"; readonly submissionEvidenceRef: EvidenceRef })
  | (ObservationBase & { readonly kind: "RECEIPT"; readonly receipt: ReceiptObservationData })
  | (ObservationBase & { readonly kind: "BLOCK"; readonly block: BlockObservationData })
  | (ObservationBase & { readonly kind: "REORG"; readonly reorg: ReorgObservation })
  | (ObservationBase & { readonly kind: "EXTERNAL_CONFLICT"; readonly conflict: ExternalConflictEvidence })

export type AuthoritativeEvidenceBinding = {
  readonly authorityMode: "AUTHORITATIVE"
  readonly evidenceRefs: readonly EvidenceRef[]
  readonly evidenceDigest: DomainEvidenceDigest
}

export type ShadowEvidenceBinding = {
  readonly authorityMode: "SHADOW"
  readonly evidenceRefs: readonly EvidenceRef[]
  readonly evidenceDigest: DomainEvidenceDigest
  readonly maySatisfyAuthorityProof: false
}
