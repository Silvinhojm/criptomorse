import type { KnowledgeReport, KnowledgeRequest } from "../../agent-framework/knowledge-types"
import type { CoordinatorKnowledgeResolver } from "../../agent-framework/coordinator-dependencies"

/**
 * Builds a KnowledgeReport that is structurally and textually marked as
 * fictional: every entry in `sources` is false (no real data source was
 * consulted), and `reason`/`warnings` state SIMULATED in plain text.
 *
 * This is the shape embedded directly into an education AgentProposal's
 * `params.knowledgeReport` (see education-proposal.ts) so Coordinator takes
 * its "provided report" path -- this is the mechanism actually exercised in
 * the Stage 3 end-to-end test, not EducationKnowledgeResolver.query() below.
 */
export function buildSimulatedKnowledgeReport(): KnowledgeReport {
  return {
    canTrade: true,
    reason: "SIMULATED_EDUCATION_SCENARIO — dado fictício, não é preço de mercado real",
    liquidity: 0,
    gasScore: 0,
    routeScore: 0,
    marketScore: 0,
    riskScore: 0,
    expectedValue: 0,
    confidenceModifier: 0,
    warnings: ["SIMULATED_DATA: cenário educacional fictício, nenhuma fonte de mercado real foi consultada"],
    recommendations: [],
    sources: { liquidity: false, route: false, gas: false, price: false, history: false, reputation: false },
    timestamp: Date.now(),
  }
}

/**
 * Satisfies Coordinator's required `deps.knowledge` constructor dependency.
 * Never wired into the real frameworkKnowledge/frameworkCoordinator
 * singletons -- only ever backs an education-only Coordinator instance
 * (see education-coordinator.ts).
 *
 * NOTE (see Stage 3 report, finding on knowledge classification): with the
 * current proposal shape used by this domain (action="HOLD" so Coordinator
 * classifies it NON_ECONOMIC, with a report already provided via
 * params.knowledgeReport), Coordinator's `_resolveKnowledge` takes the
 * "provided report" branch and never calls `query()` below. This class
 * exists to satisfy the constructor type requirement and as a defensive
 * fallback, not as the primary simulated-data path.
 */
export class EducationKnowledgeResolver implements CoordinatorKnowledgeResolver {
  async query(_request: KnowledgeRequest): Promise<KnowledgeReport> {
    return buildSimulatedKnowledgeReport()
  }
}
