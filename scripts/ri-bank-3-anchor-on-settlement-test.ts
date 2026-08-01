// RI-BANK-3 Stage 2 -- anchor-on-settlement-confirmation test
//
// Proves the fix for RI-BANK-1 B1-03 / RI-BANK-2's [GAP CONHECIDO]:
// anchorDecision never fired for real trading because TradingAdapter
// always dispatches provisionally, and until this patch nothing fired the
// anchor later either, when settlement confirmation actually landed.
//
// Zero network calls, zero real transactions: frameworkIntents.anchorDecision
// is monkey-patched with a spy for every scenario in this file (never the
// real ethers/fetch implementation). frameworkSettlementRegistry and
// frameworkIntents are the REAL singletons from lib/agent-framework/singletons
// (same pattern as scripts/phase-2e2f-settlement-replay-test.ts) -- this
// exercises the real updateDecisionReportFromSettlement listener wiring,
// not a reimplementation of it.

import type { SettlementRecord } from "../lib/agent-framework/settlement-registry"
import type { DecisionReport } from "../lib/agent-framework/decision-report"
import {
  frameworkSettlementRegistry,
  frameworkIntents,
  replaySettlementForCorrelationId,
  flushPendingSettlementReplays,
} from "../lib/agent-framework/singletons"

// ── Helpers (mirrors scripts/phase-2e2f-settlement-replay-test.ts) ────────

function makeReport(id: string, correlationId: string, overrides?: Partial<DecisionReport>): DecisionReport {
  return {
    id,
    intentId: correlationId,
    agentId: "test-agent",
    action: "BUY",
    params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" },
    createdAt: Date.now(),
    execution: {
      success: true,
      profit: 0,
      gasCost: 0.005,
      durationMs: 100,
      adapter: "TradingAdapter",
      correlationId,
      intentId: correlationId,
      proposalId: `proposal_${correlationId}`,
      decisionReportId: id,
      dispatchStatus: "dispatched",
      settlementStatus: "dispatched",
      isProvisional: true,
    },
    onChainStatus: "skipped", // exact state TradingAdapter's provisional dispatch leaves behind (RI-BANK-1 B1-03)
    ...overrides,
  }
}

function fakeTxHashFor(correlationId: string): string {
  const hex = Buffer.from(correlationId).toString("hex").padEnd(64, "0").slice(0, 64)
  return `0x${hex}`
}

function makeSettlementRecord(correlationId: string, overrides?: Partial<SettlementRecord>): SettlementRecord {
  const ts = Date.now()
  return {
    settlementId: `settlement_${correlationId}_${ts}_${Math.random().toString(36).slice(2, 8)}`,
    correlationId,
    intentId: correlationId,
    proposalId: `proposal_${correlationId}`,
    decisionReportId: `decision_${correlationId}`,
    adapter: "trading",
    status: "confirmed",
    txHash: fakeTxHashFor(correlationId), // unique per scenario -- avoids byTxHash index collisions across scenarios sharing the singleton registry
    receiptStatus: 1,
    blockNumber: 99999,
    gasUsed: "21000",
    fromToken: "USDC",
    toToken: "cirBTC",
    amountIn: "10000000",
    actualAmountOut: "9900000",
    canonicalSettlement: true,
    synthetic: false,
    source: "corretor",
    timestamp: ts,
    ...overrides,
  }
}

function seedIntent(correlationId: string, reportOverrides?: Partial<DecisionReport>): void {
  frameworkIntents.publish({
    id: correlationId, agentId: "test-agent", action: "BUY",
    params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" },
    confidence: 80, timestamp: Date.now(),
  })
  frameworkIntents.setDecisionReport(correlationId, makeReport(`decision_${correlationId}`, correlationId, reportOverrides))
}

/** Spy that replaces frameworkIntents.anchorDecision -- never ethers, never
 *  fetch. `impl` lets each scenario control success/failure per call. */
function spyAnchorDecision(impl?: (id: string, report: DecisionReport) => { txHash: string; blockNumber: number; hash: string } | null) {
  const calls: Array<{ id: string; report: DecisionReport }> = []
  const original = frameworkIntents.anchorDecision
  frameworkIntents.anchorDecision = async (id: string, report: DecisionReport) => {
    calls.push({ id, report })
    return impl ? impl(id, report) : { txHash: "0xFAKE_TX_NEVER_BROADCAST", blockNumber: 1, hash: "0xFAKE_HASH_NEVER_BROADCAST" }
  }
  return { calls, restore: () => { frameworkIntents.anchorDecision = original } }
}

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Verdict tracking ────────────────────────────────────────────────────

let passed = 0
let failed = 0

function assert(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`  ❌ ${name}${detail ? ` -- ${detail}` : ""}`)
  }
}

async function run(): Promise<void> {
  // ================================================================
  // Scenario A -- [CORRETUDE] Settlement confirmation triggers the
  // anchor exactly once, and persists onChainHash/onChainTx/onChainStatus.
  //
  // This is the direct fix for the gap coordinator-trading.test.ts
  // documents as [GAP CONHECIDO]: "anchorDecision must NEVER be called
  // when the executor reports isProvisional:true" at DISPATCH time. That
  // dispatch-time gap is real and intentionally left in place (dispatch
  // has no settlement proof yet) -- what was missing is this: nothing
  // fired the anchor LATER either, when the SettlementRecord actually
  // confirms canonically. This scenario proves it now does.
  // ================================================================
  {
    const corrId = "ri_bank_3_scenario_A"
    seedIntent(corrId)
    const spy = spyAnchorDecision()
    try {
      frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrId))
      await tick()

      assert("A1 anchorDecision called exactly once on canonical confirmation", spy.calls.length === 1, `got ${spy.calls.length}`)
      assert("A2 anchor call used the correct intent id", spy.calls[0]?.id === corrId, `got ${spy.calls[0]?.id}`)

      const report = frameworkIntents.getRecord(corrId)?.decisionReport
      assert("A3 onChainStatus is 'confirmed' after anchor resolves", report?.onChainStatus === "confirmed", `got ${report?.onChainStatus}`)
      assert("A4 onChainHash persisted", report?.onChainHash === "0xFAKE_HASH_NEVER_BROADCAST", `got ${report?.onChainHash}`)
      assert("A5 onChainTx persisted", report?.onChainTx === "0xFAKE_TX_NEVER_BROADCAST", `got ${report?.onChainTx}`)
      assert("A6 execution fields from settlement still applied (not clobbered by the anchor write)", report?.execution?.canonicalSettlement === true)
    } finally {
      spy.restore()
    }
  }

  // ================================================================
  // Scenario B -- [CORRETUDE] Idempotency under replay: the SAME
  // canonical settlement reprocessed via replaySettlementForCorrelationId
  // must NOT anchor twice.
  // ================================================================
  {
    const corrId = "ri_bank_3_scenario_B"
    seedIntent(corrId)
    const spy = spyAnchorDecision()
    try {
      const record = makeSettlementRecord(corrId)
      frameworkSettlementRegistry.registerPending(record)
      await tick()
      assert("B1 first confirmation anchors once", spy.calls.length === 1, `got ${spy.calls.length}`)

      // Force reprocessing of the exact same settlement record -- this is
      // the scenario the mandate calls out explicitly: the replay/reconciliation
      // queue can and does reprocess records (see phase-2e2f-settlement-replay-test.ts).
      replaySettlementForCorrelationId(corrId)
      await tick()
      assert("B2 replaying the same record does not anchor a second time", spy.calls.length === 1, `got ${spy.calls.length}`)

      // Also force it through the registry directly (recordUpdate with an
      // enriched-but-still-canonical update for the same settlement).
      frameworkSettlementRegistry.recordUpdate({ correlationId: corrId, adapter: "trading", status: "confirmed", canonicalSettlement: true, txHash: record.txHash, blockNumber: record.blockNumber })
      await tick()
      assert("B3 a redundant confirmed update for the same settlement does not anchor a second time", spy.calls.length === 1, `got ${spy.calls.length}`)

      const report = frameworkIntents.getRecord(corrId)?.decisionReport
      assert("B4 report still shows exactly one anchor's worth of proof", report?.onChainStatus === "confirmed" && report.onChainHash === "0xFAKE_HASH_NEVER_BROADCAST")
    } finally {
      spy.restore()
    }
  }

  // ================================================================
  // Scenario C -- [CORRETUDE] Idempotency under queued replay
  // (settlement arrives before the DecisionReport is saved, gets queued,
  // then flushed -- and a second flush of the same queue must not
  // double-anchor).
  // ================================================================
  {
    const corrId = "ri_bank_3_scenario_C"
    const record = makeSettlementRecord(corrId)
    const spy = spyAnchorDecision()
    try {
      // Settlement arrives BEFORE the DecisionReport exists -> queued for replay.
      frameworkSettlementRegistry.registerPending(record)
      await tick()
      assert("C1 no anchor before the DecisionReport exists", spy.calls.length === 0, `got ${spy.calls.length}`)

      seedIntent(corrId)
      const flushed = flushPendingSettlementReplays()
      await tick()
      assert("C2 flush found and processed the queued entry", flushed === 1, `got ${flushed}`)
      assert("C3 anchor fires exactly once once the report exists", spy.calls.length === 1, `got ${spy.calls.length}`)

      // Nothing left queued, but call flush again anyway to prove it's a no-op.
      const flushedAgain = flushPendingSettlementReplays()
      await tick()
      assert("C4 second flush has nothing to do", flushedAgain === 0, `got ${flushedAgain}`)
      assert("C5 second flush did not anchor again", spy.calls.length === 1, `got ${spy.calls.length}`)
    } finally {
      spy.restore()
    }
  }

  // ================================================================
  // Scenario D -- [CORRETUDE] Failed anchor leaves onChainStatus
  // recoverable (not stuck at "confirmed" or silently lost) --
  // guard must allow a LATER real confirmation to still try.
  // ================================================================
  {
    const corrId = "ri_bank_3_scenario_D"
    seedIntent(corrId)
    const spy = spyAnchorDecision(() => null) // simulate anchor failure (network down)
    try {
      frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrId))
      await tick()
      assert("D1 anchor was attempted", spy.calls.length === 1, `got ${spy.calls.length}`)

      const report = frameworkIntents.getRecord(corrId)?.decisionReport
      assert("D2 onChainStatus is 'pending' (attempted, not yet proven) after a failed attempt", report?.onChainStatus === "pending", `got ${report?.onChainStatus}`)
      assert("D3 onChainHash/onChainTx are NOT set on a failed attempt", !report?.onChainHash && !report?.onChainTx)
    } finally {
      spy.restore()
    }
  }

  // ================================================================
  // Scenario E -- [CORRETUDE] Non-canonical settlement (submitted, not
  // yet confirmed) does NOT anchor -- only genuinely canonical
  // confirmation should trigger it.
  // ================================================================
  {
    const corrId = "ri_bank_3_scenario_E"
    seedIntent(corrId)
    const spy = spyAnchorDecision()
    try {
      frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrId, { status: "submitted", canonicalSettlement: false }))
      await tick()
      assert("E1 a merely-submitted settlement does not anchor", spy.calls.length === 0, `got ${spy.calls.length}`)
    } finally {
      spy.restore()
    }
  }

  // ================================================================
  // Scenario F -- [CORRETUDE] Synthetic settlement does NOT anchor,
  // even if status says "confirmed" -- canonicalSettlement is the gate,
  // not status alone.
  // ================================================================
  {
    const corrId = "ri_bank_3_scenario_F"
    seedIntent(corrId)
    const spy = spyAnchorDecision()
    try {
      frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrId, { synthetic: true, canonicalSettlement: true, txHash: "0x0000000000000000000000000000000000000000000000000000000000000000" }))
      await tick()
      assert("F1 a synthetic settlement never anchors regardless of canonicalSettlement flag", spy.calls.length === 0, `got ${spy.calls.length}`)
    } finally {
      spy.restore()
    }
  }

  // ================================================================
  // Scenario G -- [RISCO RESIDUAL ACEITO -- Q2, documentado, NAO
  // corrigido nesta etapa] retryPendingProofs / anchorDecision's
  // pendingProofs retry map is only drained from Coordinator.runCycle
  // (coordinator.ts:903-908). docs/INCIDENTES-TECNICOS.md already
  // documents that frameworkIntents.configure()/runCycle() is never
  // called in production. This means: the settlement-triggered anchor
  // added in this mandate DOES fire independently of runCycle (it's
  // wired directly into the settlement listener, not into the cycle),
  // but if that anchor attempt itself fails (Scenario D), the RETRY of
  // that failed attempt still depends on runCycle, which is not
  // currently invoked. This scenario does not retry anything -- it only
  // documents, with an executable assertion, that pendingProofs is a
  // real Map that accumulates entries requiring runCycle to drain, so
  // this residual risk is verifiable rather than asserted from memory.
  // ================================================================
  {
    const corrId = "ri_bank_3_scenario_G_residual_q2"
    seedIntent(corrId)
    const pendingBefore = frameworkIntents.getPendingCount()
    // No spy here, deliberately: this scenario needs the REAL anchorDecision
    // (onchain-intent-publisher.ts) so its own pendingProofs.set() side
    // effect (line ~205-206) actually runs. Still zero network risk: no
    // PRIVATE_KEY is configured in this process (onChainEnabled stays
    // false), so it falls to the browser-delegation branch, which
    // fetch()es a relative URL with no server behind it in this test
    // process -- that fails fast and is caught internally, never a real
    // transaction, never a real HTTP call that reaches anywhere.
    frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrId))
    await tick(20)
    const pendingAfter = frameworkIntents.getPendingCount()
    assert("G1 [Q2 residual] a failed settlement-triggered anchor DOES land in pendingProofs, same as a failed dispatch-time anchor", pendingAfter === pendingBefore + 1, `before=${pendingBefore} after=${pendingAfter}`)
    // Cleanup: this scenario deliberately leaves a real pendingProofs entry
    // to prove G1 -- remove it so later scenarios (H/I/J) that assert exact
    // retryPendingProofs() counts aren't sharing the singleton map with it.
    ;(frameworkIntents as any).pendingProofs.delete(corrId)
  }
}

async function runRetryPropagationTests(): Promise<void> {
  // ================================================================
  // Scenario H -- [CORRETUDE] retryPendingProofs item 2 fix: a
  // successful retry must persist onChainHash/onChainTx/onChainStatus
  // into the DecisionReport. Before this patch, a successful retry only
  // removed the entry from pendingProofs and incremented the counter --
  // the proof itself was silently discarded, so a DecisionReport that
  // failed its first anchor attempt and succeeded on retry would show
  // onChainStatus stuck at whatever it was before the retry, forever,
  // even though a real anchor transaction existed on-chain.
  // ================================================================
  {
    const corrId = "ri_bank_3_scenario_H_retry_propagation"
    seedIntent(corrId, { onChainStatus: "pending" }) // state left behind by a prior failed attempt

    // Directly seed pendingProofs -- this is the exact internal state a
    // failed anchorDecision() call leaves behind (onchain-intent-publisher.ts:205-206).
    // Runtime access only (TS privacy is compile-time); no production code
    // path is bypassed, this only sets up the pre-condition.
    const report = frameworkIntents.getRecord(corrId)!.decisionReport!
    ;(frameworkIntents as any).pendingProofs.set(corrId, { report, retries: 2 })

    const spy = spyAnchorDecision(() => ({ txHash: "0xRETRY_TX_NEVER_BROADCAST", blockNumber: 42, hash: "0xRETRY_HASH_NEVER_BROADCAST" }))
    try {
      const resolved = await frameworkIntents.retryPendingProofs()
      assert("H1 retryPendingProofs reports 1 resolved", resolved === 1, `got ${resolved}`)
      assert("H2 the pending entry was removed", frameworkIntents.getPendingCount() === 0 || !(frameworkIntents as any).pendingProofs.has(corrId))

      const updated = frameworkIntents.getRecord(corrId)?.decisionReport
      assert("H3 [FIX] onChainStatus is 'confirmed' after a successful retry (was previously never updated)", updated?.onChainStatus === "confirmed", `got ${updated?.onChainStatus}`)
      assert("H4 [FIX] onChainHash persisted from the retry result", updated?.onChainHash === "0xRETRY_HASH_NEVER_BROADCAST", `got ${updated?.onChainHash}`)
      assert("H5 [FIX] onChainTx persisted from the retry result", updated?.onChainTx === "0xRETRY_TX_NEVER_BROADCAST", `got ${updated?.onChainTx}`)
    } finally {
      spy.restore()
      ;(frameworkIntents as any).pendingProofs.delete(corrId)
    }
  }

  // ================================================================
  // Scenario I -- [CORRETUDE] retryPendingProofs re-reads the LATEST
  // report instead of the stale snapshot captured when the entry was
  // queued -- proves later enrichment (e.g. a settlement update that
  // landed while the proof was pending) is not clobbered by the retry.
  // ================================================================
  {
    const corrId = "ri_bank_3_scenario_I_retry_freshness"
    seedIntent(corrId, { onChainStatus: "pending" })
    const staleReport = frameworkIntents.getRecord(corrId)!.decisionReport!
    ;(frameworkIntents as any).pendingProofs.set(corrId, { report: staleReport, retries: 0 })

    // Simulate enrichment landing AFTER the entry was queued but BEFORE
    // the retry runs (e.g. a slippageBps/balanceDeltas update).
    frameworkIntents.setDecisionReport(corrId, {
      ...staleReport,
      execution: { ...staleReport.execution!, slippageBps: 12 },
    })

    const spy = spyAnchorDecision(() => ({ txHash: "0xFRESH_TX", blockNumber: 7, hash: "0xFRESH_HASH" }))
    try {
      await frameworkIntents.retryPendingProofs()
      const updated = frameworkIntents.getRecord(corrId)?.decisionReport
      assert("I1 retry propagation preserves later enrichment instead of overwriting with the stale snapshot", updated?.execution?.slippageBps === 12, `got ${updated?.execution?.slippageBps}`)
      assert("I2 retry propagation still applies the anchor proof on top of the fresh report", updated?.onChainHash === "0xFRESH_HASH")
    } finally {
      spy.restore()
      ;(frameworkIntents as any).pendingProofs.delete(corrId)
    }
  }

  // ================================================================
  // Scenario J -- [CORRETUDE contrast] a retry that still fails must NOT
  // touch onChainHash/onChainTx/onChainStatus -- only success propagates.
  // ================================================================
  {
    const corrId = "ri_bank_3_scenario_J_retry_still_failing"
    seedIntent(corrId, { onChainStatus: "pending" })
    const report = frameworkIntents.getRecord(corrId)!.decisionReport!
    ;(frameworkIntents as any).pendingProofs.set(corrId, { report, retries: 0 })

    const spy = spyAnchorDecision(() => null)
    try {
      const resolved = await frameworkIntents.retryPendingProofs()
      assert("J1 retryPendingProofs reports 0 resolved on continued failure", resolved === 0, `got ${resolved}`)
      const updated = frameworkIntents.getRecord(corrId)?.decisionReport
      assert("J2 onChainStatus unchanged ('pending') when the retry itself still fails", updated?.onChainStatus === "pending", `got ${updated?.onChainStatus}`)
      assert("J3 onChainHash still unset", !updated?.onChainHash)
    } finally {
      spy.restore()
      ;(frameworkIntents as any).pendingProofs.delete(corrId)
    }
  }
}

async function main(): Promise<void> {
  await run()
  await runRetryPropagationTests()

  console.log("")
  console.log("=".repeat(70))
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  console.log("=".repeat(70))

  if (failed > 0) {
    process.exitCode = 1
    return
  }
  console.log("ALL_RI_BANK_3_ANCHOR_ON_SETTLEMENT_ASSERTIONS_PASSED=YES")
}

main()
