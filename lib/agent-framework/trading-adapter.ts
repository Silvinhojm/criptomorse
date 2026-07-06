import type { AgentProposal } from "./IAgent"
import type { IExecutor, ExecutionResult } from "./IExecutor"

export interface TradeSignal {
  pregueiro: string
  rede: string
  par: string
  confianca: number
  timestamp: number
  fromToken: string
  toToken: string
  amountUsd?: number
  direcao?: "buy" | "sell"
  precoNoPalpite?: number
  poolAddress?: string
  dex?: string
}

export class TradingAdapter implements IExecutor {
  readonly name = "TradingAdapter"
  private executeTrade: (signal: TradeSignal) => void

  constructor(executeTrade: (signal: TradeSignal) => void) {
    this.executeTrade = executeTrade
  }

  canExecute(proposal: AgentProposal): { allowed: boolean; reason: string } {
    if (!proposal.params.fromToken || !proposal.params.toToken) {
      return { allowed: false, reason: "Missing fromToken/toToken in proposal params" }
    }
    if (!proposal.params.rede) {
      return { allowed: false, reason: "Missing rede (network) in proposal params" }
    }
    return { allowed: true, reason: "" }
  }

  async execute(proposal: AgentProposal): Promise<ExecutionResult> {
    try {
      const signal: TradeSignal = {
        pregueiro: proposal.params.pregueiro as string || proposal.agentId,
        rede: proposal.params.rede as string,
        par: proposal.params.par as string,
        confianca: proposal.params.confianca as number || proposal.confidence,
        timestamp: proposal.timestamp,
        fromToken: proposal.params.fromToken as string,
        toToken: proposal.params.toToken as string,
        amountUsd: proposal.params.amountUsd as number | undefined,
        direcao: proposal.params.direcao as "buy" | "sell" | undefined,
        precoNoPalpite: proposal.params.precoNoPalpite as number | undefined,
        poolAddress: proposal.params.poolAddress as string | undefined,
        dex: proposal.params.dex as string | undefined,
      }

      this.executeTrade(signal)

      return {
        success: true,
        action: proposal.action,
        profit: 0,
      }
    } catch (e) {
      return {
        success: false,
        action: proposal.action,
        errorMsg: e instanceof Error ? e.message : String(e),
      }
    }
  }

  estimateCost(_proposal: AgentProposal): number {
    return 0
  }
}
