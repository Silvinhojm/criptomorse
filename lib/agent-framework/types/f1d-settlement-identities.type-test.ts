import type { ChainId, ExecutionAttemptId, NonceReservationId, ReplacementLineageId } from "./f1c-execution-attempts"
import type {
  AssetIdentity,
  BlockchainDomainProfileId,
  BlockchainDomainProfileVersion,
  BlockchainSettlementKeyInput,
  NonBlockchainDomainProfileId,
  NonBlockchainDomainProfileVersion,
  NonBlockchainSettlementKeyInput,
  NonChainIdentity,
  ReconciliationRevision,
  SettlementDomainId,
  SettlementRevision,
} from "./f1d-settlement-identities"

type Assert<Condition extends true> = Condition
type IsAssignable<From, To> = [From] extends [To] ? true : false
type Not<Value extends boolean> = Value extends true ? false : true

type _SettlementRevisionNotReconciliationRevision = Assert<Not<IsAssignable<SettlementRevision, ReconciliationRevision>>>
type _ReconciliationRevisionNotSettlementRevision = Assert<Not<IsAssignable<ReconciliationRevision, SettlementRevision>>>
type _SymbolNotAssetIdentity = Assert<Not<IsAssignable<string, AssetIdentity>>>

declare const domainId: SettlementDomainId
declare const blockchainProfileId: BlockchainDomainProfileId
declare const blockchainProfileVersion: BlockchainDomainProfileVersion
declare const nonBlockchainProfileId: NonBlockchainDomainProfileId
declare const nonBlockchainProfileVersion: NonBlockchainDomainProfileVersion
declare const chainId: ChainId
declare const nonChainIdentity: NonChainIdentity
declare const executionAttemptId: ExecutionAttemptId
declare const nonceReservationId: NonceReservationId
declare const replacementLineageId: ReplacementLineageId

const blockchainKey: BlockchainSettlementKeyInput = {
  domainProfileKind: "BLOCKCHAIN", domainProfileId: blockchainProfileId,
  domainProfileVersion: blockchainProfileVersion, domainId, chainId,
  executionAttemptId, nonceReservationId, replacementLineageId,
}
const nonBlockchainKey: NonBlockchainSettlementKeyInput = {
  domainProfileKind: "NON_BLOCKCHAIN", domainProfileId: nonBlockchainProfileId,
  domainProfileVersion: nonBlockchainProfileVersion, domainId, chainId: null,
  nonChainIdentity, executionAttemptId, nonceReservationId, replacementLineageId,
}

// @ts-expect-error blockchain requires ChainId
const blockchainWithoutChain: BlockchainSettlementKeyInput = { domainProfileKind: "BLOCKCHAIN", domainProfileId: blockchainProfileId, domainProfileVersion: blockchainProfileVersion, domainId, executionAttemptId, nonceReservationId, replacementLineageId }
// @ts-expect-error blockchain prohibits non-chain identity
const blockchainWithNonChain: BlockchainSettlementKeyInput = { ...blockchainKey, nonChainIdentity }
// @ts-expect-error non-blockchain requires null chainId
const nonBlockchainWithChain: NonBlockchainSettlementKeyInput = { ...nonBlockchainKey, chainId }
// @ts-expect-error non-blockchain requires identity
const nonBlockchainWithoutIdentity: NonBlockchainSettlementKeyInput = { domainProfileKind: "NON_BLOCKCHAIN", domainProfileId: nonBlockchainProfileId, domainProfileVersion: nonBlockchainProfileVersion, domainId, chainId: null, executionAttemptId, nonceReservationId, replacementLineageId }
// @ts-expect-error profile version is mandatory
const blockchainWithoutProfileVersion: BlockchainSettlementKeyInput = { domainProfileKind: "BLOCKCHAIN", domainProfileId: blockchainProfileId, domainId, chainId, executionAttemptId, nonceReservationId, replacementLineageId }

export type F1dSettlementIdentityTypeTests =
  | _SettlementRevisionNotReconciliationRevision
  | _ReconciliationRevisionNotSettlementRevision
  | _SymbolNotAssetIdentity
