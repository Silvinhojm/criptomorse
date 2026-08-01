import type { IAgent, AgentIdentity, AgentProposal, AgentVote } from "../../agent-framework/IAgent"

/**
 * Represents the player's own decision as a framework "agent" vote. This is
 * not an autonomous decision-maker -- the decision was already made by the
 * human via the app UI before the proposal was ever submitted; this class
 * exists only so that decision can be formalized inside the Coordinator's
 * Voting stage, which requires registered IAgent votes.
 */
export class EducationPlayerAgent implements IAgent {
  readonly agentId: string

  constructor(agentId: string) {
    this.agentId = agentId
  }

  getIdentity(): AgentIdentity {
    return { agentId: this.agentId, name: "Education Player", version: "1", level: 1, canExecuteSolo: true, maxAmountUSD: 0 }
  }

  propose(_ctx: Record<string, unknown>): AgentProposal | null {
    return null
  }

  vote(proposal: AgentProposal): AgentVote {
    return { agentId: this.agentId, proposalId: proposal.id, approved: true, confidence: 100, reason: "Player decision already made via app UI", timestamp: Date.now() }
  }

  onFeedback(): void {}
}

/**
 * Structural workaround, not a design choice -- see Stage 3 report.
 * `Coordinator.MIN_AGREEING_AGENTS` is a hardcoded class constant equal to
 * 2 (lib/agent-framework/coordinator.ts), not configurable via
 * CoordinatorConfig. A single registered agent can never satisfy
 * `approved.length >= 2` in Voting.resolve(), so a second agent that
 * mirrors the player's own vote is registered alongside
 * EducationPlayerAgent purely to satisfy this framework-level minimum. It
 * exercises no independent judgment of its own.
 */
export class EducationConfirmationAgent implements IAgent {
  readonly agentId: string

  constructor(agentId: string) {
    this.agentId = agentId
  }

  getIdentity(): AgentIdentity {
    return { agentId: this.agentId, name: "Education Confirmation (structural, mirrors player vote)", version: "1", level: 1, canExecuteSolo: false, maxAmountUSD: 0 }
  }

  propose(_ctx: Record<string, unknown>): AgentProposal | null {
    return null
  }

  vote(proposal: AgentProposal): AgentVote {
    return { agentId: this.agentId, proposalId: proposal.id, approved: true, confidence: 100, reason: "Mirrors player decision -- satisfies Coordinator.MIN_AGREEING_AGENTS=2, no independent judgment", timestamp: Date.now() }
  }

  onFeedback(): void {}
}
