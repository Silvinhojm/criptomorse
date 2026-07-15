import type { KnowledgeReport, KnowledgeRequest } from "./knowledge-types"
import type { SettlementRecord } from "./settlement-registry"

export interface CoordinatorReputationReader {
  getScore(agentId: string): number
}

export interface CoordinatorKnowledgeResolver {
  query(request: KnowledgeRequest): Promise<KnowledgeReport>
}

export interface CoordinatorSettlementRegistry {
  registerPending(record: SettlementRecord): SettlementRecord
}

export interface CoordinatorSettlementReplay {
  replayForCorrelationId(correlationId: string): void
}

export interface CoordinatorDecisionDependencies {
  reputation: CoordinatorReputationReader
  knowledge: CoordinatorKnowledgeResolver
  settlementRegistry: CoordinatorSettlementRegistry
  settlementReplay: CoordinatorSettlementReplay
}
