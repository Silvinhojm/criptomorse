import type { KnowledgeReport, KnowledgeRequest } from "./knowledge-types"

export interface CoordinatorReputationReader {
  getScore(agentId: string): number
}

export interface CoordinatorKnowledgeResolver {
  query(request: KnowledgeRequest): Promise<KnowledgeReport>
}

export interface CoordinatorDecisionDependencies {
  reputation: CoordinatorReputationReader
  knowledge: CoordinatorKnowledgeResolver
}
