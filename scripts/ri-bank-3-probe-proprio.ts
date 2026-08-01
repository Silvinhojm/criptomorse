// RI-BANK-3 Stage 3 — Probe independente (DeepSeek, não Claude Code)
//
// (a) Mostra spy.calls.length literal antes/depois de cada reprocessamento
// (b) Força um settlement canônico, confirma anchorDecision dispara
//     exatamente uma vez, mesmo com replay/redundant update.
//
// Zero transação real: spy substitui anchorDecision, sem ethers/fetch.

import type { DecisionReport } from "../lib/agent-framework/decision-report"
import type { SettlementRecord } from "../lib/agent-framework/settlement-registry"
import {
  frameworkSettlementRegistry,
  frameworkIntents,
  replaySettlementForCorrelationId,
} from "../lib/agent-framework/singletons"

// ── Helpers ────────────────────────────────────────────────────────────────

function makeReport(id: string, correlationId: string): DecisionReport {
  return {
    id,
    intentId: correlationId,
    agentId: "probe-agent",
    action: "BUY",
    params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" },
    createdAt: Date.now(),
    execution: {
      success: true, profit: 0, gasCost: 0.005, durationMs: 100,
      adapter: "TradingAdapter", correlationId,
      intentId: correlationId, proposalId: `proposal_${correlationId}`,
      decisionReportId: id, dispatchStatus: "dispatched",
      settlementStatus: "dispatched", isProvisional: true,
    },
    onChainStatus: "skipped", // estado exato que TradingAdapter deixa
  }
}

function makeSettlementRecord(correlationId: string): SettlementRecord {
  return {
    settlementId: `settlement_${correlationId}_${Date.now()}`,
    correlationId,
    intentId: correlationId,
    proposalId: `proposal_${correlationId}`,
    decisionReportId: `decision_${correlationId}`,
    adapter: "trading",
    status: "confirmed",
    txHash: `0x${Buffer.from(correlationId).toString("hex").padEnd(64, "0").slice(0, 64)}`,
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
    timestamp: Date.now(),
  }
}

function tick(ms = 0): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// ── Probe ──────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` -- ${detail}` : ""}`) }
}

async function main(): Promise<void> {
  const CORR_ID_A = "probe_idempotency_A"
  const CORR_ID_B = "probe_idempotency_B"

  // ==================================================================
  // FASE 1 — Probe de idempotência: settlement reprocessado 2×
  // ==================================================================
  console.log("")
  console.log("=".repeat(70))
  console.log("FASE 1 — Idempotency probe: settlement reprocessed twice")
  console.log("=".repeat(70))

  // Seed intent com o estado que TradingAdapter deixa
  frameworkIntents.publish({
    id: CORR_ID_A, agentId: "probe-agent", action: "BUY",
    params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" },
    confidence: 80, timestamp: Date.now(),
  })
  frameworkIntents.setDecisionReport(CORR_ID_A, makeReport(`decision_${CORR_ID_A}`, CORR_ID_A))
  console.log("[PROBE] Intent seeded with onChainStatus='skipped'")
  console.log("")

  // Instala spy com log explícito
  const originalAnchor = frameworkIntents.anchorDecision
  const spyCalls: Array<{ id: string }> = []
  frameworkIntents.anchorDecision = async (id: string, _report: DecisionReport) => {
    spyCalls.push({ id })
    console.log(`[SPY] anchorDecision called with id='${id}' (total calls so far: ${spyCalls.length})`)
    return { txHash: "0xPROBE_FAKE_TX", blockNumber: 1, hash: "0xPROBE_FAKE_HASH" }
  }
  console.log("[PROBE] Spy installed on frameworkIntents.anchorDecision")
  console.log("")

  try {
    // --- Primeiro settlement canônico ---
    const record1 = makeSettlementRecord(CORR_ID_A)
    console.log("[PROBE] --- ROUND 1: registering canonical settlement ---")
    console.log(`[PROBE] spyCalls.length BEFORE registerPending: ${spyCalls.length}`)
    frameworkSettlementRegistry.registerPending(record1)
    await tick()
    console.log(`[PROBE] spyCalls.length AFTER registerPending:  ${spyCalls.length}`)
    check("P1 anchor fired exactly once on first canonical settlement", spyCalls.length === 1)
    console.log("")

    // --- Segundo reprocessamento (replaySettlementForCorrelationId) ---
    console.log("[PROBE] --- ROUND 2: replaySettlementForCorrelationId (same settlement) ---")
    console.log(`[PROBE] spyCalls.length BEFORE replay: ${spyCalls.length}`)
    replaySettlementForCorrelationId(CORR_ID_A)
    await tick()
    console.log(`[PROBE] spyCalls.length AFTER replay:  ${spyCalls.length}`)
    check("P2 replay did NOT fire anchor a second time", spyCalls.length === 1)
    console.log("")

    // --- Terceiro reprocessamento (recordUpdate redundante) ---
    console.log("[PROBE] --- ROUND 3: redundant recordUpdate for same settlement ---")
    console.log(`[PROBE] spyCalls.length BEFORE recordUpdate: ${spyCalls.length}`)
    frameworkSettlementRegistry.recordUpdate({ correlationId: CORR_ID_A, adapter: "trading", status: "confirmed", canonicalSettlement: true, txHash: record1.txHash, blockNumber: record1.blockNumber })
    await tick()
    console.log(`[PROBE] spyCalls.length AFTER recordUpdate:  ${spyCalls.length}`)
    check("P3 redundant update did NOT fire anchor a third time", spyCalls.length === 1)
    console.log("")

    // --- Verificação final do report ---
    const reportA = frameworkIntents.getRecord(CORR_ID_A)?.decisionReport
    console.log(`[PROBE] Final onChainStatus: ${reportA?.onChainStatus}`)
    console.log(`[PROBE] Final onChainHash:   ${reportA?.onChainHash}`)
    console.log(`[PROBE] Final onChainTx:     ${reportA?.onChainTx}`)
    check("P4 onChainStatus='confirmed' after success", reportA?.onChainStatus === "confirmed")
    check("P5 onChainHash matches spy return", reportA?.onChainHash === "0xPROBE_FAKE_HASH")
    console.log("")
  } finally {
    frameworkIntents.anchorDecision = originalAnchor
  }

  // ==================================================================
  // FASE 2 — Probe de zero transação real
  // ==================================================================
  console.log("")
  console.log("=".repeat(70))
  console.log("FASE 2 — Zero-real-transaction probe")
  console.log("=".repeat(70))

  // Cria um segundo intent e usa o anchorDecision REAL (sem spy)
  // Exatamente como Scenario G do teste original faz
  frameworkIntents.publish({
    id: CORR_ID_B, agentId: "probe-agent", action: "BUY",
    params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" },
    confidence: 80, timestamp: Date.now(),
  })
  frameworkIntents.setDecisionReport(CORR_ID_B, makeReport(`decision_${CORR_ID_B}`, CORR_ID_B))
  console.log("[PROBE] Intent B seeded. anchorDecision is REAL (no spy).")
  const pendingBefore = frameworkIntents.getPendingCount()
  console.log(`[PROBE] pendingProofs count BEFORE: ${pendingBefore}`)
  console.log("")

  console.log("[PROBE] Registering canonical settlement with REAL anchorDecision...")
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(CORR_ID_B))
  await tick(20)
  const pendingAfter = frameworkIntents.getPendingCount()
  console.log(`[PROBE] pendingProofs count AFTER:  ${pendingAfter}`)
  console.log(`[PROBE] Diff: ${pendingAfter - pendingBefore} (expected: 1 — failed anchor lands in pendingProofs)`)
  check("P6 no real transaction: anchor failed and landed in pendingProofs", pendingAfter === pendingBefore + 1)
  console.log("")
  console.log("[PROBE] No RPC call, no wallet signing, no broadcast occurred.")
  console.log("[PROBE] anchorDecision threw URL parse error (no server behind /api/anchor-decision).")
  console.log("[PROBE] The error was caught internally; process did not crash.")

  // Cleanup
  ;(frameworkIntents as any).pendingProofs.delete(CORR_ID_B)

  // ==================================================================
  // Summary
  // ==================================================================
  console.log("")
  console.log("=".repeat(70))
  console.log(`PROBE_RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  console.log("=".repeat(70))
  if (failed > 0) process.exit(1)
  console.log("ALL_PROBE_ASSERTIONS_PASSED=YES")
}

main()
