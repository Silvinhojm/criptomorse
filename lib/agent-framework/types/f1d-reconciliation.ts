import type { ExecutionAttemptId } from "./f1c-execution-attempts"
import type {
  AmountValue,
  CanonicalEffectIdentity,
  DomainEvidenceDigest,
  EvidenceRef,
  ProofDigest,
  ReconciliationId,
  ReconciliationInputSnapshotDigest,
  ReconciliationKey,
  ReconciliationKeyInput,
  ReconciliationMethodVersion,
  ReconciliationRevision,
  SignedAmountValue,
  SettlementId,
  SettlementRevision,
} from "./f1d-settlement-identities"
import type {
  ExecutionAttemptIdentitySnapshot,
  SettledSettlement,
  SettlementProof,
} from "./f1d-settlement"

declare const reconciliationBrand: unique symbol
type ReconciliationOpaque<Name extends string> = string & { readonly [reconciliationBrand]: Name }

export type EffectId = ReconciliationOpaque<"EffectId">
export type EffectComponentId = ReconciliationOpaque<"EffectComponentId">
export type BatchId = ReconciliationOpaque<"BatchId">
export type MemberSetDigest = ReconciliationOpaque<"MemberSetDigest">
export type CompletenessPolicyVersion = ReconciliationOpaque<"CompletenessPolicyVersion">
export type AllocationMethodVersion = ReconciliationOpaque<"AllocationMethodVersion">
export type RoundingRuleVersion = ReconciliationOpaque<"RoundingRuleVersion">
export type FeeComponentId = ReconciliationOpaque<"FeeComponentId">
export type RefundComponentId = ReconciliationOpaque<"RefundComponentId">
export type LiabilityId = ReconciliationOpaque<"LiabilityId">
export type ReconciledAt = ReconciliationOpaque<"ReconciledAt">
export type ReconciliationConclusionDigest = ReconciliationOpaque<"ReconciliationConclusionDigest">

export type UndisputedSettlementReference = {
  readonly kind: "UNDISPUTED_SETTLEMENT_REFERENCE"
  readonly settlementId: SettlementId
  readonly settlementRevision: SettlementRevision
  readonly settlementProofDigest: DomainEvidenceDigest
  readonly disputeRef: null
  readonly authorityMode: "AUTHORITATIVE"
}

export type EffectComponentSnapshot =
  | { readonly status: "APPLIED"; readonly effectId: EffectId; readonly batchId: BatchId | null; readonly componentId: EffectComponentId; readonly finalAmount: AmountValue; readonly evidenceRefs: readonly EvidenceRef[]; readonly settlementRef: UndisputedSettlementReference; readonly disputeRef?: never }
  | { readonly status: "REVERTED"; readonly effectId: EffectId; readonly batchId: BatchId | null; readonly componentId: EffectComponentId; readonly attemptedAmount: AmountValue; readonly evidenceRefs: readonly EvidenceRef[]; readonly settlementRef: UndisputedSettlementReference; readonly disputeRef?: never }
  | { readonly status: "NOT_APPLIED" | "UNKNOWN"; readonly effectId: EffectId; readonly batchId: BatchId | null; readonly componentId: EffectComponentId; readonly expectedAmount: AmountValue; readonly evidenceRefs: readonly EvidenceRef[]; readonly settlementRef: UndisputedSettlementReference | null; readonly disputeRef?: never }
  | { readonly status: "DISPUTED"; readonly effectId: EffectId; readonly batchId: BatchId | null; readonly componentId: EffectComponentId; readonly claimedAmount: AmountValue | null; readonly evidenceRefs: readonly EvidenceRef[]; readonly settlementRef: UndisputedSettlementReference | null; readonly disputeRef: EvidenceRef }

type CompletenessBase = {
  readonly effectId: EffectId
  readonly batchId: BatchId | null
  readonly expectedMemberSetDigest: MemberSetDigest
  readonly observedMemberSetDigest: MemberSetDigest
  readonly completenessPolicyVersion: CompletenessPolicyVersion
  readonly includedComponentIds: readonly EffectComponentId[]
  readonly allocatedTotal: AmountValue
  readonly expectedTotal: AmountValue
  readonly residual: SignedAmountValue
  readonly allocationMethodVersion: AllocationMethodVersion
  readonly roundingRuleVersion: RoundingRuleVersion
  readonly proofDigest: ProofDigest
  readonly settlementRef: UndisputedSettlementReference
}
export type EffectCompletenessProof =
  | (CompletenessBase & { readonly classification: "COMPLETE"; readonly missingComponentIds: readonly []; readonly disputedComponentIds: readonly []; readonly definitiveEligible: true; readonly disputeRef?: never })
  | (CompletenessBase & { readonly classification: "INCOMPLETE"; readonly missingComponentIds: readonly EffectComponentId[]; readonly disputedComponentIds: readonly []; readonly definitiveEligible: false; readonly disputeRef?: never })
  | (CompletenessBase & { readonly classification: "DISPUTED"; readonly missingComponentIds: readonly EffectComponentId[]; readonly disputedComponentIds: readonly EffectComponentId[]; readonly definitiveEligible: false; readonly disputeRef: EvidenceRef })
export type CompleteEffectProof = Extract<EffectCompletenessProof, { classification: "COMPLETE" }>

type FeeBase = { readonly feeComponentId: FeeComponentId; readonly relatedComponentId: EffectComponentId; readonly amount: AmountValue; readonly payerRef: EvidenceRef; readonly collectorRef: EvidenceRef | null; readonly roundingRuleVersion: RoundingRuleVersion; readonly evidenceRefs: readonly EvidenceRef[] }
export type FeeComponent =
  | (FeeBase & { readonly stage: "OBSERVED_FEE"; readonly settlementRef?: never; readonly reconciliationBinding?: never; readonly disputeRef?: never; readonly accountingConsumable: false })
  | (FeeBase & { readonly stage: "FINAL_FEE"; readonly settlementRef: UndisputedSettlementReference; readonly reconciliationBinding?: never; readonly disputeRef?: never; readonly accountingConsumable: false })
  | (FeeBase & { readonly stage: "RECONCILED_FEE"; readonly settlementRef: UndisputedSettlementReference; readonly reconciliationBinding: ReconciliationBinding; readonly disputeRef?: never; readonly accountingConsumable: true })
  | (FeeBase & { readonly stage: "DISPUTED_FEE"; readonly settlementRef: UndisputedSettlementReference | null; readonly reconciliationBinding: ReconciliationBinding | null; readonly disputeRef: EvidenceRef; readonly accountingConsumable: false })
export type ReconciledFee = Extract<FeeComponent, { stage: "RECONCILED_FEE" }>

type RefundBase = { readonly refundComponentId: RefundComponentId; readonly relatedComponentId: EffectComponentId; readonly originalDebitAmount: AmountValue; readonly refundAmount: AmountValue; readonly beneficiaryRef: EvidenceRef; readonly evidenceRefs: readonly EvidenceRef[]; readonly roundingRuleVersion: RoundingRuleVersion }
export type RefundComponent =
  | (RefundBase & { readonly stage: "OBSERVED_REFUND"; readonly settlementRef?: never; readonly reconciliationBinding?: never; readonly disputeRef?: never; readonly accountingConsumable: false })
  | (RefundBase & { readonly stage: "FINAL_REFUND"; readonly settlementRef: UndisputedSettlementReference; readonly reconciliationBinding?: never; readonly disputeRef?: never; readonly accountingConsumable: false })
  | (RefundBase & { readonly stage: "RECONCILED_REFUND"; readonly settlementRef: UndisputedSettlementReference; readonly reconciliationBinding: ReconciliationBinding; readonly disputeRef?: never; readonly accountingConsumable: true })
  | (RefundBase & { readonly stage: "DISPUTED_REFUND"; readonly settlementRef: UndisputedSettlementReference | null; readonly reconciliationBinding: ReconciliationBinding | null; readonly disputeRef: EvidenceRef; readonly accountingConsumable: false })
export type ReconciledRefund = Extract<RefundComponent, { stage: "RECONCILED_REFUND" }>

export type ReconciliationBinding = { readonly reconciliationId: ReconciliationId; readonly reconciliationRevision: ReconciliationRevision; readonly reconciliationMethodVersion: ReconciliationMethodVersion; readonly inputSnapshotDigest: ReconciliationInputSnapshotDigest }
export type SlippageResult =
  | { readonly classification: "NO_SLIPPAGE" | "FAVORABLE_SLIPPAGE" | "ADVERSE_SLIPPAGE"; readonly quotedInput: AmountValue; readonly quotedOutput: AmountValue; readonly actualInput: AmountValue; readonly actualOutput: AmountValue; readonly outputDelta: SignedAmountValue; readonly direction: "EXACT" | "OUTPUT_ABOVE_QUOTE" | "OUTPUT_BELOW_QUOTE"; readonly basisPointsMagnitude: number & { readonly [reconciliationBrand]: "BasisPointsMagnitude" }; readonly methodVersion: ReconciliationMethodVersion; readonly evidenceRefs: readonly EvidenceRef[]; readonly reconciliationBinding: ReconciliationBinding; readonly accountingConsumable: true }
  | { readonly classification: "DISPUTED_SLIPPAGE"; readonly quotedInput: AmountValue; readonly quotedOutput: AmountValue; readonly actualInput: AmountValue | null; readonly actualOutput: AmountValue | null; readonly outputDelta: null; readonly direction: "UNRESOLVED"; readonly basisPointsMagnitude: null; readonly methodVersion: ReconciliationMethodVersion; readonly evidenceRefs: readonly EvidenceRef[]; readonly reconciliationBinding: ReconciliationBinding | null; readonly disputeRef: EvidenceRef; readonly accountingConsumable: false }

export type ReconciliationInputSnapshot = {
  readonly settlementId: SettlementId
  readonly settlementRevision: SettlementRevision
  readonly settlementProofDigest: DomainEvidenceDigest
  readonly canonicalEffectIdentity: CanonicalEffectIdentity
  readonly components: readonly EffectComponentSnapshot[]
  readonly fees: readonly FeeComponent[]
  readonly refunds: readonly RefundComponent[]
  readonly slippage: SlippageResult | null
  readonly completeness: EffectCompletenessProof
  readonly methodVersion: ReconciliationMethodVersion
  readonly inputSnapshotDigest: ReconciliationInputSnapshotDigest
  readonly liveLookupPermittedDuringReplay: false
}

export type ReconciliationEligibilityProof = {
  readonly proofKind: "RECONCILIATION_ELIGIBILITY_PROOF"
  readonly executionAttemptId: ExecutionAttemptId
  readonly settlementId: SettlementId
  readonly settlementRevision: SettlementRevision
  readonly settlementProofDigest: DomainEvidenceDigest
  readonly settlementUndisputed: true
  readonly effectCompleteness: CompleteEffectProof
  readonly authorityMode: "AUTHORITATIVE"
  readonly eligibilityProofDigest: ProofDigest
  readonly createsExecutionAuthority: false
  readonly createsSubmissionAuthority: false
  readonly createsEconomicEffectAuthority: false
}

export type DefinitiveReconciliationResult = {
  readonly classification: "DEFINITIVE"
  readonly reconciliationId: ReconciliationId
  readonly reconciliationRevision: ReconciliationRevision
  readonly reconciliationMethodVersion: ReconciliationMethodVersion
  readonly inputSnapshotDigest: ReconciliationInputSnapshotDigest
  readonly fees: readonly ReconciledFee[]
  readonly refunds: readonly ReconciledRefund[]
  readonly slippage: Exclude<SlippageResult, { classification: "DISPUTED_SLIPPAGE" }> | null
  readonly componentCompleteness: CompleteEffectProof
  readonly deltas: readonly SignedAmountValue[]
  readonly outstandingLiabilityIds: readonly LiabilityId[]
  readonly reconciledAt: ReconciledAt
  readonly accountingConsumable: true
}
export type ProvisionalReconciliationResult = { readonly classification: "PROVISIONAL"; readonly blockers: readonly EvidenceRef[]; readonly accountingConsumable: false; readonly reconciledAt?: never }

export type ReconciliationConclusionReference = { readonly reconciliationId: ReconciliationId; readonly reconciliationRevision: ReconciliationRevision; readonly conclusionDigest: ReconciliationConclusionDigest; readonly accountingConsumable: true }
export type ReconciliationConclusion = { readonly kind: "RECONCILIATION_CONCLUSION"; readonly reference: ReconciliationConclusionReference; readonly settlement: UndisputedSettlementReference; readonly result: DefinitiveReconciliationResult; readonly disputeRef: null }

export type ReconciliationPendingExecutionAttempt = ExecutionAttemptIdentitySnapshot & { readonly state: "RECONCILIATION_PENDING"; readonly priorState: "SETTLED"; readonly settlement: SettledSettlement; readonly settlementProof: SettlementProof; readonly reconciliationEligibility: ReconciliationEligibilityProof; readonly reconciliationConclusion?: never; readonly reconciliationResult?: never }
export type ReconciledExecutionAttempt = ExecutionAttemptIdentitySnapshot & { readonly state: "RECONCILED"; readonly priorState: "RECONCILIATION_PENDING"; readonly settlement: SettledSettlement; readonly settlementProof: SettlementProof; readonly reconciliationEligibility: ReconciliationEligibilityProof; readonly reconciliationConclusion: ReconciliationConclusion; readonly reconciliationResult: DefinitiveReconciliationResult }

export type ReconciliationRecord =
  | { readonly state: "NOT_READY"; readonly blockers: readonly EvidenceRef[]; readonly result?: never }
  | { readonly state: "READY" | "IN_PROGRESS"; readonly key: ReconciliationKey; readonly keyInput: ReconciliationKeyInput; readonly snapshot: ReconciliationInputSnapshot; readonly result?: never }
  | { readonly state: "RECONCILED"; readonly key: ReconciliationKey; readonly result: DefinitiveReconciliationResult }
  | { readonly state: "DISPUTED"; readonly key: ReconciliationKey; readonly predecessor: ReconciliationConclusionReference; readonly accountingBlocked: true; readonly result?: never }
  | { readonly state: "CORRECTED"; readonly key: ReconciliationKey; readonly predecessor: ReconciliationConclusionReference; readonly result: DefinitiveReconciliationResult }
