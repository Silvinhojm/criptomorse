import type { AgentProposal } from "../../agent-framework/IAgent"
import type { MissionScenario, PlayerAction, SimulatedWalletState } from "./core/types"
import { buildSimulatedKnowledgeReport } from "./education-knowledge"

/**
 * Builds the AgentProposal submitted to Coordinator.submitProposal() for a
 * mission decision.
 *
 * IMPORTANT, see Stage 3 report: `action` is forced to `"HOLD"`, not a
 * domain-meaningful string. Coordinator._classifyKnowledgeAction() (a
 * private, hardcoded method, out of scope to modify) only recognizes
 * `"BUY"`, `"SELL"` (require fromToken/toToken/network -- exactly the
 * fields this domain structurally forbids) and `"HOLD"`/`"TEST"`
 * (classified NON_ECONOMIC, no token/network required). `"HOLD"` is the
 * only option that lets an education proposal pass Coordinator's
 * knowledge-classification gate without carrying real-asset fields.
 *
 * The actual player decision is preserved, undamaged, in
 * `params.playerAction` -- EducationAdapter reads it from there, never from
 * `proposal.action`. Consequence: `DecisionReport.action` (set directly
 * from `proposal.action` inside Coordinator) will literally read `"HOLD"`
 * for every education decision -- a framework-classification artifact, not
 * a bug, but a real quirk worth knowing when reading a raw DecisionReport.
 *
 * `params.knowledgeReport` carries the simulated, explicitly-marked
 * KnowledgeReport (see education-knowledge.ts). Because the action is
 * NON_ECONOMIC and a report is already provided, Coordinator's
 * `_resolveKnowledge` takes the "provided report" branch -- it neither
 * requires fromToken/toToken/network nor calls the knowledge resolver's
 * `query()`.
 */
export function buildMissionProposal(
  playerAgentId: string,
  scenario: MissionScenario,
  wallet: SimulatedWalletState,
  playerAction: PlayerAction,
  resolvedAt: number,
): AgentProposal {
  return {
    id: `edu_${String(scenario.scenarioId)}_${resolvedAt}`,
    agentId: playerAgentId,
    action: "HOLD",
    params: {
      scenario,
      wallet,
      playerAction,
      resolvedAt,
      knowledgeReport: buildSimulatedKnowledgeReport(),
    },
    confidence: 100,
    timestamp: resolvedAt,
  }
}
