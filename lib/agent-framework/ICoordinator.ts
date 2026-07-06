import type { IAgent, AgentProposal } from "./IAgent"
import type { IExecutor, ExecutionResult } from "./IExecutor"
import type { ISafetyGuard } from "./ISafetyGuard"
import type { IAudit } from "./IAudit"

export interface ConsensusResult {
  approved: boolean
  action: string
  confidence: number
  agentVotes: { agentId: string; approved: boolean; confidence: number; reason: string }[]
  tiebreaker: string
  reason: string
}

export interface CycleReport {
  cycleId: number
  proposalsSubmitted: number
  consensusReached: number
  executionsDispatched: number
  errors: number
  timestamp: number
}

export interface SubmissionResult {
  consensus: ConsensusResult
  executionResult?: ExecutionResult
}

export interface ICoordinator {
  readonly name: string
  registerAgent(agent: IAgent): void
  unregisterAgent(agentId: string): void
  getAgents(): IAgent[]
  submitProposal(proposal: AgentProposal): Promise<SubmissionResult>
  runCycle(): Promise<CycleReport>
  getExecutor(): IExecutor | null
  getSafetyGuard(): ISafetyGuard | null
  getAudit(): IAudit | null
}
