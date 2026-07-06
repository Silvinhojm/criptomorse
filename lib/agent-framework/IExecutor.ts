import type { AgentProposal } from "./IAgent"

export interface ExecutionResult {
  success: boolean
  action: string
  txHash?: string
  explorerUrl?: string
  profit?: number
  errorMsg?: string
  gasCost?: number
  details?: Record<string, unknown>
}

export interface IExecutor {
  readonly name: string
  canExecute(proposal: AgentProposal): { allowed: boolean; reason: string }
  execute(proposal: AgentProposal): Promise<ExecutionResult>
  estimateCost(proposal: AgentProposal): number
}
