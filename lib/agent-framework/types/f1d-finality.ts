import type { ChainId, TransactionAttemptId, TransactionHash } from "./f1c-execution-attempts"
import type {
  BlockchainDomainProfileId,
  BlockchainDomainProfileVersion,
  DomainEvidenceDigest,
  SettlementDomainId,
} from "./f1d-settlement-identities"
import type { SettlementObservationId } from "./f1d-settlement-observations"

declare const finalityBrand: unique symbol
type FinalityOpaque<Base, Name extends string> = Base & { readonly [finalityBrand]: Name }

export type FinalityPolicyVersion = FinalityOpaque<string, "FinalityPolicyVersion">
export type CanonicalityPolicyVersion = FinalityOpaque<string, "CanonicalityPolicyVersion">
export type CanonicalBlockReference = FinalityOpaque<string, "CanonicalBlockReference">
export type CanonicalBlockIdentity = FinalityOpaque<string, "CanonicalBlockIdentity">
export type CanonicalLineageSnapshotDigest = FinalityOpaque<string, "CanonicalLineageSnapshotDigest">
export type FinalityProofId = FinalityOpaque<string, "FinalityProofId">
export type SettlementProofId = FinalityOpaque<string, "SettlementProofId">
export type ConfirmationCount = FinalityOpaque<number, "ConfirmationCount">
export type FinalityRequirementDigest = FinalityOpaque<string, "FinalityRequirementDigest">
export type RequirementNormalizationDigest = FinalityOpaque<string, "RequirementNormalizationDigest">
export type ArcDomainProfileVersion = FinalityOpaque<string, "ArcDomainProfileVersion">
export type ProbabilisticDomainProfileId = FinalityOpaque<string, "ProbabilisticDomainProfileId">
export type ProbabilisticDomainProfileVersion = FinalityOpaque<string, "ProbabilisticDomainProfileVersion">
export type FinalizedTagRequirement = FinalityOpaque<string, "FinalizedTagRequirement">
export type ExternalAcceptanceProfileId = FinalityOpaque<string, "ExternalAcceptanceProfileId">
export type ExternalAcceptanceProfileVersion = FinalityOpaque<string, "ExternalAcceptanceProfileVersion">
export type ExternalAuthorityClass = FinalityOpaque<string, "ExternalAuthorityClass">

export type PersistedDeterministicCommitRequirement = {
  readonly mode: "DETERMINISTIC_COMMIT"
  readonly policyVersion: FinalityPolicyVersion
  readonly requiredCommitProofKind: string
}
export type PersistedProbabilisticConfirmationRequirement = {
  readonly mode: "PROBABILISTIC_CONFIRMATIONS"
  readonly policyVersion: FinalityPolicyVersion
  readonly minimumConfirmations: ConfirmationCount
  readonly finalizedTagRequirement: string | null
}
export type PersistedExternalAcceptanceRequirement = {
  readonly mode: "EXTERNAL_ACCEPTANCE"
  readonly policyVersion: FinalityPolicyVersion
  readonly requiredAuthorityClass: ExternalAuthorityClass
  readonly acceptanceRuleDigest: DomainEvidenceDigest
}
export type FinalityRequirement =
  | PersistedDeterministicCommitRequirement
  | PersistedProbabilisticConfirmationRequirement
  | PersistedExternalAcceptanceRequirement

export type DeterministicCommitRequirement = {
  readonly mode: "DETERMINISTIC_COMMIT"
  readonly domainProfileKind: "BLOCKCHAIN"
  readonly domainProfileId: "ARC_DETERMINISTIC_FINALITY"
  readonly domainProfileVersion: ArcDomainProfileVersion
  readonly policyVersion: FinalityPolicyVersion
  readonly requiredCommitProofKind: "ARC_COMMIT_CERTIFICATE"
}
export type ProbabilisticConfirmationRequirement = {
  readonly mode: "PROBABILISTIC_CONFIRMATIONS"
  readonly domainProfileKind: "BLOCKCHAIN"
  readonly domainProfileId: ProbabilisticDomainProfileId
  readonly domainProfileVersion: ProbabilisticDomainProfileVersion
  readonly policyVersion: FinalityPolicyVersion
  readonly minimumConfirmations: ConfirmationCount
  readonly finalizedTagRequirement: FinalizedTagRequirement | null
}
export type BlockchainRequestTimeFinalityRequirement =
  | DeterministicCommitRequirement
  | ProbabilisticConfirmationRequirement

export type CanonicalReceiptEvidence = {
  readonly proofKind: "CANONICAL_RECEIPT_EVIDENCE"
  readonly domainId: SettlementDomainId
  readonly chainId: ChainId
  readonly transactionAttemptId: TransactionAttemptId
  readonly transactionHash: TransactionHash
  readonly receiptDigest: DomainEvidenceDigest
  readonly canonicalBlockRef: CanonicalBlockReference
  readonly lineageSnapshotDigest: CanonicalLineageSnapshotDigest
  readonly authorityMode: "AUTHORITATIVE"
}
export type CanonicalBlockEvidence = {
  readonly proofKind: "CANONICAL_BLOCK_EVIDENCE"
  readonly domainId: SettlementDomainId
  readonly chainId: ChainId
  readonly blockIdentity: CanonicalBlockIdentity
  readonly canonicalBlockRef: CanonicalBlockReference
  readonly blockEvidenceDigest: DomainEvidenceDigest
  readonly canonicalityPolicyVersion: CanonicalityPolicyVersion
  readonly authorityMode: "AUTHORITATIVE"
}
export type DeterministicCommitFinalityProof = {
  readonly proofKind: "DETERMINISTIC_COMMIT_FINALITY_PROOF"
  readonly finalityProofId: FinalityProofId
  readonly domainId: SettlementDomainId
  readonly chainId: ChainId
  readonly blockIdentity: CanonicalBlockIdentity
  readonly canonicalBlockRef: CanonicalBlockReference
  readonly transactionAttemptId: TransactionAttemptId
  readonly transactionHash: TransactionHash
  readonly receiptDigest: DomainEvidenceDigest
  readonly lineageSnapshotDigest: CanonicalLineageSnapshotDigest
  readonly policyVersion: FinalityPolicyVersion
  readonly commitCertificateDigest: DomainEvidenceDigest
  readonly evidenceRefs: readonly SettlementObservationId[]
  readonly authorityMode: "AUTHORITATIVE"
}
export type ProbabilisticFinalityProof = {
  readonly proofKind: "PROBABILISTIC_FINALITY_PROOF"
  readonly finalityProofId: FinalityProofId
  readonly domainId: SettlementDomainId
  readonly chainId: ChainId
  readonly blockIdentity: CanonicalBlockIdentity
  readonly canonicalBlockRef: CanonicalBlockReference
  readonly transactionAttemptId: TransactionAttemptId
  readonly transactionHash: TransactionHash
  readonly receiptDigest: DomainEvidenceDigest
  readonly lineageSnapshotDigest: CanonicalLineageSnapshotDigest
  readonly policyVersion: FinalityPolicyVersion
  readonly observedConfirmations: ConfirmationCount
  readonly finalizedTagEvidenceDigest: DomainEvidenceDigest | null
  readonly evidenceRefs: readonly SettlementObservationId[]
  readonly authorityMode: "AUTHORITATIVE"
}

export type HistoricalFinalityRequirementEnvelope =
  | { readonly envelopeKind: "HISTORICAL_FINALITY_REQUIREMENT"; readonly mode: "DETERMINISTIC_COMMIT"; readonly domainProfileKind: "BLOCKCHAIN"; readonly domainProfileId: "ARC_DETERMINISTIC_FINALITY"; readonly domainProfileVersion: ArcDomainProfileVersion; readonly requirement: PersistedDeterministicCommitRequirement; readonly requirementDigest: FinalityRequirementDigest }
  | { readonly envelopeKind: "HISTORICAL_FINALITY_REQUIREMENT"; readonly mode: "PROBABILISTIC_CONFIRMATIONS"; readonly domainProfileKind: "BLOCKCHAIN"; readonly domainProfileId: ProbabilisticDomainProfileId; readonly domainProfileVersion: ProbabilisticDomainProfileVersion; readonly requirement: PersistedProbabilisticConfirmationRequirement; readonly requirementDigest: FinalityRequirementDigest }
  | { readonly envelopeKind: "HISTORICAL_FINALITY_REQUIREMENT"; readonly mode: "EXTERNAL_ACCEPTANCE"; readonly domainProfileKind: "NON_BLOCKCHAIN"; readonly domainProfileId: ExternalAcceptanceProfileId; readonly domainProfileVersion: ExternalAcceptanceProfileVersion; readonly requirement: PersistedExternalAcceptanceRequirement; readonly requirementDigest: FinalityRequirementDigest }

export type FinalityRequirementNormalization =
  | { readonly normalizationKind: "DETERMINISTIC_REQUEST_TO_HISTORICAL_ENVELOPE"; readonly requestRequirement: DeterministicCommitRequirement; readonly historicalEnvelope: Extract<HistoricalFinalityRequirementEnvelope, { mode: "DETERMINISTIC_COMMIT" }>; readonly preservedPolicyVersion: FinalityPolicyVersion; readonly preservedProfileVersion: ArcDomainProfileVersion; readonly preservedRequirementDigest: FinalityRequirementDigest; readonly normalizationDigest: RequirementNormalizationDigest }
  | { readonly normalizationKind: "PROBABILISTIC_REQUEST_TO_HISTORICAL_ENVELOPE"; readonly requestRequirement: ProbabilisticConfirmationRequirement; readonly historicalEnvelope: Extract<HistoricalFinalityRequirementEnvelope, { mode: "PROBABILISTIC_CONFIRMATIONS" }>; readonly preservedPolicyVersion: FinalityPolicyVersion; readonly preservedProfileVersion: ProbabilisticDomainProfileVersion; readonly preservedRequirementDigest: FinalityRequirementDigest; readonly normalizationDigest: RequirementNormalizationDigest }

export type FinalityRequirementNormalizer = (requirement: BlockchainRequestTimeFinalityRequirement) => FinalityRequirementNormalization

export type FinalityProfileIdentity = {
  readonly profileId: BlockchainDomainProfileId
  readonly profileVersion: BlockchainDomainProfileVersion
}
