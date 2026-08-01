// RI-BANK-2 Stage 2 — trading-adapter.test.ts
//
// Zero network calls, zero real transactions: TradingAdapter is exercised
// with a hand-written fake `executeTrade` callback -- never the real
// `(signal) => pregao.injetarSinal(signal)` wiring used in production
// (see lib/pregão.ts). This isolates the adapter completely from
// pregão.ts/corretor.ts/real-swap-executor.ts.

import { TradingAdapter, type TradeDispatchResult, type TradeSignal } from "./trading-adapter"
import type { AgentProposal } from "./IAgent"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function makeProposal(overrides?: Partial<AgentProposal>): AgentProposal {
  return {
    id: "prop_1",
    agentId: "agent_1",
    action: "BUY",
    params: { fromToken: "USDC", toToken: "WETH", rede: "polygon", riskBox: "A" },
    confidence: 80,
    timestamp: Date.now(),
    ...overrides,
  }
}

export async function runTradingAdapterTests(): Promise<void> {
  // [CORRETUDE] Successful dispatch is always reported as provisional --
  // this is the executable proof behind the RI-BANK-1 B1-03 finding: the
  // Coordinator's "success" at this layer is dispatch-acceptance, never
  // on-chain confirmation.
  {
    let receivedSignal: TradeSignal | undefined
    const adapter = new TradingAdapter((signal) => {
      receivedSignal = signal
      return { accepted: true, orderCreated: true, ordemId: "ordem_1" }
    })

    const result = await adapter.execute(makeProposal())

    expect(result.success === true, "successful dispatch must report success:true")
    expect(result.isProvisional === true, "successful dispatch must ALWAYS report isProvisional:true")
    expect(result.dispatchStatus === "dispatched", "dispatchStatus must be 'dispatched'")
    expect(result.settlementStatus === "dispatched", "settlementStatus must be 'dispatched'")
    expect(result.ordemId === "ordem_1", "ordemId from the dispatch callback must be propagated")
    expect(receivedSignal?.fromToken === "USDC" && receivedSignal?.toToken === "WETH", "signal must carry the proposal's token pair")
  }

  // [CORRETUDE] Callback signals rejection via accepted:false
  {
    const adapter = new TradingAdapter(() => ({ accepted: false, reason: "Pregão rejected dispatch: network mismatch" }))
    const result = await adapter.execute(makeProposal())

    expect(result.success === false, "rejected dispatch must report success:false")
    expect(result.dispatchStatus === "failed", "dispatchStatus must be 'failed'")
    expect(result.settlementStatus === "failed", "settlementStatus must be 'failed'")
    expect(result.isProvisional === false, "rejected dispatch must not be marked provisional")
    expect(result.errorMsg === "Pregão rejected dispatch: network mismatch", "rejection reason must be propagated verbatim")
  }

  // [CORRETUDE] Callback signals rejection via orderCreated:false (accepted true but no order)
  {
    const adapter = new TradingAdapter(() => ({ accepted: true, orderCreated: false, ordemId: "ordem_2" }))
    const result = await adapter.execute(makeProposal())

    expect(result.success === false, "orderCreated:false must report success:false")
    expect(result.dispatchStatus === "failed", "dispatchStatus must be 'failed'")
    expect(result.ordemId === "ordem_2", "ordemId must still be surfaced even on rejection")
  }

  // [CORRETUDE] Callback throws -- execute() must not propagate/crash
  {
    const adapter = new TradingAdapter(() => {
      throw new Error("simulated callback failure")
    })
    const result = await adapter.execute(makeProposal())

    expect(result.success === false, "a thrown callback must not crash execute(), must resolve success:false")
    expect(result.dispatchStatus === "failed", "dispatchStatus must be 'failed' after a thrown callback")
    expect(result.isProvisional === false, "a caught exception must not be marked provisional")
    expect((result.errorMsg ?? "").includes("simulated callback failure"), "the original error message must be surfaced")
  }

  // [CORRETUDE] canExecute() rejects proposals missing required routing params
  {
    const adapter = new TradingAdapter(() => ({ accepted: true, orderCreated: true }))

    const missingTokens = adapter.canExecute(makeProposal({ params: { rede: "polygon", riskBox: "A" } }))
    expect(missingTokens.allowed === false, "canExecute must reject a proposal missing fromToken/toToken")

    const missingRede = adapter.canExecute(makeProposal({ params: { fromToken: "USDC", toToken: "WETH", riskBox: "A" } }))
    expect(missingRede.allowed === false, "canExecute must reject a proposal missing rede")

    const missingRiskBox = adapter.canExecute(makeProposal({ params: { fromToken: "USDC", toToken: "WETH", rede: "polygon" } }))
    expect(missingRiskBox.allowed === false, "canExecute must reject a proposal missing riskBox")

    const valid = adapter.canExecute(makeProposal())
    expect(valid.allowed === true, "canExecute must accept a proposal with fromToken/toToken/rede/riskBox present")
  }

  console.log("ALL_TRADING_ADAPTER_ASSERTIONS_PASSED=YES")
}

runTradingAdapterTests()
