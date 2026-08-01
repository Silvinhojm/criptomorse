// RI-BANK-2 Stage 2 — pregao-corretor-dispatch.test.ts
//
// Mock boundary: `realSwap` is a singleton object exported from
// real-swap-executor.ts (`export const realSwap = new RealSwapExecutor()`)
// -- not constructor-injectable into corretor.ts/escriturario.ts, both of
// which import it directly. The only safe way to exercise this path
// without a real transaction is to temporarily monkey-patch the methods
// on that singleton for the duration of this file, then restore the
// originals -- exactly the boundary identified in the RI-BANK-2 Stage 1
// design (section 6).
//
// pregão.injetarSinal/registrarSinalInterno themselves never touch
// realSwap at all (confirmed by reading pregão.ts) -- those cases below
// need no stub.

import { pregão } from "./pregão"
import { corretor } from "./corretor"
import { escriturário } from "./escriturario"
import { realSwap } from "./real-swap-executor"
import type { OkSignal, OrdemExecucao } from "./pregão"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function makeSignal(pregueiro: string, overrides?: Partial<OkSignal>): OkSignal {
  return {
    pregueiro,
    rede: "arc",
    par: "WETH→USDC",
    confianca: 80,
    timestamp: Date.now(),
    fromToken: "WETH",
    toToken: "USDC",
    amountUsd: 10,
    ...overrides,
  }
}

/** Saves the real realSwap methods this file may stub, and returns a
 *  restorer. Every test block that stubs realSwap MUST call this and
 *  invoke the returned restorer in a finally block -- never leave a stub
 *  installed past its own test block. */
function stubRealSwap(overrides: Partial<typeof realSwap>): () => void {
  const saved: Record<string, unknown> = {}
  for (const key of Object.keys(overrides) as (keyof typeof realSwap)[]) {
    saved[key as string] = (realSwap as any)[key]
    ;(realSwap as any)[key] = (overrides as any)[key]
  }
  return () => {
    for (const key of Object.keys(saved)) {
      ;(realSwap as any)[key] = saved[key]
    }
  }
}

export async function runPregaoCorretorDispatchTests(): Promise<void> {
  // ================================================================
  // [CORRETUDE] pregão.injetarSinal: 3 converging pregueiro signals for the
  // same pair/network create an order with status "preparando". No
  // realSwap stub needed -- injetarSinal/registrarSinalInterno never
  // touch realSwap (confirmed by reading pregão.ts).
  // ================================================================
  let createdOrderId: string | undefined
  {
    const before = pregão.getOrdensAtivas().length

    const r1 = pregão.injetarSinal(makeSignal("test-pregueiro-alpha"))
    expect(r1.orderCreated !== true, `1st signal alone must not yet create an order (threshold not reached): ${JSON.stringify(r1)}`)

    const r2 = pregão.injetarSinal(makeSignal("test-pregueiro-beta"))
    expect(r2.orderCreated !== true, `2nd signal alone must not yet create an order: ${JSON.stringify(r2)}`)

    const r3 = pregão.injetarSinal(makeSignal("test-pregueiro-gamma"))
    expect(r3.accepted === true && r3.orderCreated === true, `3rd converging signal must create an order (okPregueiros.length>=3 threshold): ${r3.reason}`)
    expect(!!r3.ordemId, "orderCreated:true must come with an ordemId")

    createdOrderId = r3.ordemId
    const ativas = pregão.getOrdensAtivas()
    expect(ativas.length === before + 1, "exactly one new active order must exist")
    const created = ativas.find((o) => o.id === createdOrderId)
    expect(created?.status === "preparando", `new order must start with status "preparando", got ${created?.status}`)
    expect(created?.fromToken === "WETH" && created?.toToken === "USDC", "order must carry the signaled token pair")

    console.log("[NOTE] A single Coordinator-approved BUY/SELL proposal -> single TradingAdapter.execute() -> single injetarSinal() call does NOT by itself create an order on the default 'Agentes'/'Pregueiros' paths -- pregão.ts runs its own internal signal-aggregation consensus (2-3 converging signals, or a verified/promoted/grid/hybrid shortcut), separate from and in addition to the Coordinator's own 2-agent voting. This is an architectural observation surfaced while writing this test, not something RI-BANK-2 was scoped to fix or analyze further.")
  }

  // ================================================================
  // [CORRETUDE] pregão.injetarSinal: duplicate active order for the same
  // fromToken/toToken/rede is rejected immediately (checked before the
  // 3-signal threshold logic even runs).
  // ================================================================
  {
    const dup = pregão.injetarSinal(makeSignal("test-pregueiro-delta"))
    expect(dup.accepted === false, "a signal for an already-active pair/network must be rejected")
    expect((dup.reason ?? "").includes("duplicate active order"), `rejection reason must mention duplicate active order, got: ${dup.reason}`)
  }

  // ================================================================
  // [CORRETUDE] pregão.injetarSinal: network mismatch against the
  // currently active network is rejected.
  // ================================================================
  {
    pregão.setRedeAtiva("polygon")
    try {
      const mismatch = pregão.injetarSinal(makeSignal("test-pregueiro-epsilon", { rede: "arc", par: "cirBTC→USDC", fromToken: "cirBTC", toToken: "USDC" }))
      expect(mismatch.accepted === false, "a signal for a network different from the active network must be rejected")
      expect((mismatch.reason ?? "").includes("network mismatch"), `rejection reason must mention network mismatch, got: ${mismatch.reason}`)
    } finally {
      pregão.setRedeAtiva("") // restore to "no active network" so it doesn't affect later test files in the same process
    }
  }

  // ================================================================
  // [CORRETUDE] corretor.executar, with realSwap.executeSwap stubbed at
  // the exact network boundary -- proves the dispatch->corretor->(stub)
  // realSwap->pregão wiring works end-to-end inside this process without
  // ever calling ethers/fetch. Reuses the real order created above.
  // ================================================================
  {
    expect(!!createdOrderId, "prerequisite: an order must have been created by the first test block")
    const ordem = pregão.getTodasOrdens().find((o) => o.id === createdOrderId) as OrdemExecucao
    expect(!!ordem, "the created order must still be findable in pregão's own order list")

    const FAKE_TX_HASH = "0xFAKE_TX_NEVER_BROADCAST_" + "a".repeat(40)
    let executeSwapCallCount = 0

    const restore = stubRealSwap({
      getNetworkKey: () => "arc",
      switchNetwork: async () => {},
      executeSwap: async (_from: any, _to: any, _amount: any, logCb?: (msg: string) => void, _ordemId?: string) => {
        executeSwapCallCount++
        logCb?.("[STUB] realSwap.executeSwap called -- no ethers, no fetch, no network")
        return {
          success: true,
          txHash: FAKE_TX_HASH,
          explorerUrl: "https://example.invalid/tx/fake",
          fromAmount: 10,
          toAmount: 9.99,
          profit: -0.01, // small testnet-fee-sized loss, matches the isTestnetSwap bucket -> no scoring/circuit-breaker side effects
          confirmed: true,
          synthetic: false,
          canonicalSettlement: true,
        }
      },
    } as any)

    try {
      await corretor.executar(ordem, 10)
    } finally {
      restore()
    }

    expect(executeSwapCallCount === 1, `the stubbed executeSwap must have been called exactly once, got ${executeSwapCallCount}`)

    const finalOrdem = pregão.getTodasOrdens().find((o) => o.id === createdOrderId)
    expect(finalOrdem?.status === "concluido", `order must reach status "concluido" via the stub, got ${finalOrdem?.status}`)
    expect(finalOrdem?.resultado?.txHash === FAKE_TX_HASH, "order's resultado.txHash must be exactly the fabricated stub value -- proof no real transaction hash was ever produced")
  }

  // ================================================================
  // [GAP CONHECIDO] escriturário.prepararOrdem on mainnet (!isTestnet)
  // does NOT call corretor.executar synchronously -- it schedules a 120s
  // setTimeout batch handoff and returns, leaving the order in "pronto".
  // Documents current behavior (RI-BANK-1 B1-01/B1-04); NOT the desired
  // end state. Does not wait out the real 120s timeout (would make the
  // suite slow) -- only asserts the synchronous, immediately-observable
  // part of the claim.
  // ================================================================
  {
    pregão.setRedeAtiva("")
    const r1 = pregão.injetarSinal(makeSignal("test-mainnet-a", { rede: "polygon", par: "WETH→USDC" }))
    const r2 = pregão.injetarSinal(makeSignal("test-mainnet-b", { rede: "polygon", par: "WETH→USDC" }))
    const r3 = pregão.injetarSinal(makeSignal("test-mainnet-c", { rede: "polygon", par: "WETH→USDC" }))
    expect(r3.orderCreated === true, `precondition: a mainnet order must be created to run this test, got: ${r3.reason}`)
    const mainnetOrdem = pregão.getTodasOrdens().find((o) => o.id === r3.ordemId) as OrdemExecucao
    expect(!!mainnetOrdem, "mainnet order must be findable")

    let executeSwapCallCount = 0
    const restore = stubRealSwap({
      getNetworkKey: () => "polygon",
      switchNetwork: async () => {},
      refreshAllBalances: async () => {},
      getBalance: () => 1000, // healthy stub balance -- avoids the zero-balance fallback branches (positionManager/unifiedBalance/caixa), which are out of scope for this specific gap test
    } as any)
    // executeSwap is deliberately left as the REAL method here -- if this
    // gap test is wrong and prepararOrdem DID call corretor.executar
    // synchronously on mainnet, the real (un-stubbed) executeSwap would
    // attempt a real network call. That would be a bug this test is
    // designed to catch, not a scenario to protect ourselves from by
    // stubbing it away. We instead prove the call never happens with a
    // call-count spy wrapped around the real method.
    const realExecuteSwap = realSwap.executeSwap.bind(realSwap)
    ;(realSwap as any).executeSwap = async (...args: unknown[]) => {
      executeSwapCallCount++
      throw new Error("[TEST GUARD] realSwap.executeSwap must NEVER be reached on the mainnet prepararOrdem path within this synchronous test -- if you see this error, the gap documented in RI-BANK-1 B1-01/B1-04 has changed and this test needs to be revisited, not silently patched around.")
    }

    try {
      await escriturário.prepararOrdem(mainnetOrdem)
    } finally {
      ;(realSwap as any).executeSwap = realExecuteSwap
      restore()
    }

    expect(executeSwapCallCount === 0, `[GAP] realSwap.executeSwap must not be called synchronously on the mainnet path, got ${executeSwapCallCount} call(s)`)
    const afterOrdem = pregão.getTodasOrdens().find((o) => o.id === r3.ordemId)
    expect(afterOrdem?.status === "pronto", `[GAP] mainnet order must be left in status "pronto" immediately after prepararOrdem returns (waiting for the external batch mechanism), got ${afterOrdem?.status}`)
  }

  console.log("ALL_PREGAO_CORRETOR_DISPATCH_ASSERTIONS_PASSED=YES")
}

runPregaoCorretorDispatchTests().then(() => {
  // The mainnet gap test above causes escriturário.prepararOrdem to
  // schedule a real 120s setTimeout (the batch-handoff timeout being
  // documented, not exercised). Node would otherwise keep this process
  // alive for the full 120s waiting on that timer. Exiting explicitly
  // once all assertions have already passed is safe -- the timer's only
  // effect if left to fire would be to mark an order this test no longer
  // inspects as "falhou".
  process.exit(0)
})
