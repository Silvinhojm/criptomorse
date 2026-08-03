import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Audit } from "../agent-framework/audit"
import { IntentPublisher } from "../agent-framework/intent-publisher"
import type { DecisionReport } from "../agent-framework/decision-report"
import { MemoryDecisionEvidenceStore } from "../agent-framework/decision-evidence-store"
import { OnChainProofReconciler } from "../agent-framework/onchain-proof-reconciler"
import { MemoryOnChainProofOutbox } from "../agent-framework/onchain-proof-outbox"
import { OnChainProofRecoveryService, type OnChainProofBroadcaster } from "../agent-framework/onchain-proof-recovery"
import { Coordinator } from "../agent-framework/coordinator"

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function createEvidence(store: MemoryDecisionEvidenceStore, suffix: string) {
  const intentId = `intent-${suffix}`
  const entry = Audit.createEntry({
    agentId: "agent", action: "trade",
    proposal: { id: `proposal-${suffix}`, agentId: "agent", action: "trade", params: {}, confidence: 80, timestamp: 1 },
    result: { success: true, action: "trade", profit: 1 },
    approved: true, confidence: 80, voters: 2, onChainStatus: "pending",
  })
  const report: DecisionReport = {
    id: `report-${suffix}`, intentId, agentId: "agent", action: "trade", params: {},
    auditId: entry.id, auditStatus: "recorded", onChainStatus: "pending", createdAt: 1,
  }
  expect((await store.saveAuditEntry(entry)).saved, "audit seed must persist")
  expect((await store.saveDecisionReport(intentId, report)).saved, "report seed must persist")
  return { intentId, entry, report }
}

async function run(): Promise<void> {
  // Cold invocation: separate empty caches hydrate exclusively from the store.
  const store = new MemoryDecisionEvidenceStore()
  const seeded = await createEvidence(store, "cold")
  const coldIntents = new IntentPublisher("cold-reader")
  const coldAudit = new Audit("cold-reader")
  const coldReconciler = new OnChainProofReconciler(coldIntents, coldAudit, store)
  const proof = { hash: "0xhash29", txHash: "0xtx29", blockNumber: 29 }
  const coldResult = await coldReconciler.reconcileConfirmedProof(seeded.intentId, proof)
  expect(coldResult.reconciled, "cold invocation must reconcile")
  expect(coldIntents.getRecord(seeded.intentId)?.decisionReport?.onChainTx === proof.txHash, "cold report cache not hydrated")
  expect(coldAudit.getById(seeded.entry.id)?.onChainTx === proof.txHash, "cold audit cache not hydrated")
  expect((await store.getDecisionReport(seeded.intentId))?.report.onChainStatus === "confirmed", "durable report not confirmed")
  expect((await store.getAuditEntry(seeded.entry.id))?.entry.onChainStatus === "confirmed", "durable audit not confirmed")

  // Canonical Coordinator path awaits both prospective durable writes.
  const coordinatorStore = new MemoryDecisionEvidenceStore()
  const coordinatorIntents = new IntentPublisher("coordinator")
  const coordinatorAudit = new Audit("coordinator")
  const coordinator = new Coordinator(
    { name: "ri-bank-29", audit: coordinatorAudit, intentPublisher: coordinatorIntents, evidenceStore: coordinatorStore },
    {
      reputation: { getScore: () => 50 },
      knowledge: { query: async () => ({
        canTrade: true, liquidity: 100, gasScore: 100, routeScore: 100, marketScore: 100,
        riskScore: 100, expectedValue: 1, confidenceModifier: 1, warnings: [], recommendations: [],
        sources: { liquidity: true, route: true, gas: true, price: true, history: true, reputation: true }, timestamp: 1,
      }) },
      settlementRegistry: { registerPending: record => record },
      settlementReplay: { replayForCorrelationId: () => {} },
    },
  )
  const coordinatorIntentId = "intent_prospective_1"
  await coordinator.submitProposal({
    id: "proposal-prospective", agentId: "prospective", action: "BUY",
    params: { fromToken: "USDC", toToken: "EURC", rede: "arc", amountUsd: 1 }, confidence: 80, timestamp: 1,
  })
  const coordinatorDurableReport = await coordinatorStore.getDecisionReport(coordinatorIntentId)
  expect(coordinatorDurableReport?.report.auditStatus === "recorded", "Coordinator must durably persist final report")
  const coordinatorAuditId = coordinatorAudit.getRecent(1)[0]?.id
  expect(coordinatorAuditId && await coordinatorStore.getAuditEntry(coordinatorAuditId), "Coordinator must durably persist audit")

  // Two cold instances, same proof: atomic update + idempotency, no corruption.
  const concurrentStore = new MemoryDecisionEvidenceStore()
  const concurrentSeed = await createEvidence(concurrentStore, "concurrent")
  const reconcilerA = new OnChainProofReconciler(new IntentPublisher("a"), new Audit("a"), concurrentStore)
  const reconcilerB = new OnChainProofReconciler(new IntentPublisher("b"), new Audit("b"), concurrentStore)
  const [resultA, resultB] = await Promise.all([
    reconcilerA.reconcileConfirmedProof(concurrentSeed.intentId, proof),
    reconcilerB.reconcileConfirmedProof(concurrentSeed.intentId, proof),
  ])
  expect(resultA.reconciled && resultB.reconciled, "concurrent identical proof must be safe")
  const reportConcurrent = await concurrentStore.getDecisionReport(concurrentSeed.intentId)
  const auditConcurrent = await concurrentStore.getAuditEntry(concurrentSeed.entry.id)
  expect(reportConcurrent?.report.onChainTx === proof.txHash && auditConcurrent?.entry.onChainTx === proof.txHash,
    "concurrent stores must remain aligned")
  await concurrentStore.saveDecisionReport(concurrentSeed.intentId, concurrentSeed.report)
  await concurrentStore.saveAuditEntry(concurrentSeed.entry)
  expect((await concurrentStore.getDecisionReport(concurrentSeed.intentId))?.report.onChainStatus === "confirmed",
    "stale full report write must not downgrade confirmed proof")
  expect((await concurrentStore.getAuditEntry(concurrentSeed.entry.id))?.entry.onChainStatus === "confirmed",
    "stale full audit write must not downgrade confirmed proof")

  // Conflicting proof cannot overwrite an already confirmed canonical proof.
  const conflict = await reconcilerB.reconcileConfirmedProof(concurrentSeed.intentId, {
    hash: "0xdifferent", txHash: "0xdifferent", blockNumber: 30,
  })
  expect(!conflict.reconciled && conflict.error === "confirmed_proof_conflict", "conflicting proof must be rejected")

  // B1: no Redis evidence means observable terminal legacy status, no ACK.
  const legacyIntents = new IntentPublisher("legacy")
  const legacyAudit = new Audit("legacy")
  const legacyReconciler = new OnChainProofReconciler(legacyIntents, legacyAudit, new MemoryDecisionEvidenceStore())
  const legacyOutbox = new MemoryOnChainProofOutbox()
  await legacyOutbox.enqueue({
    intentId: "legacy-intent", decisionReportId: "legacy-report", auditId: "legacy-audit",
    decisionHash: "0xlegacy", compactPayload: "{}", txHash: "0xknown", blockNumber: 1, nextAttemptAt: 0,
  })
  const neverBroadcast: OnChainProofBroadcaster = {
    async findKnownProof() { throw new Error("must_not_lookup") },
    async broadcast() { throw new Error("must_not_broadcast") },
  }
  const legacyRun = await new OnChainProofRecoveryService(legacyOutbox, legacyReconciler, neverBroadcast).runOnce(1, "legacy-worker")
  expect(legacyRun.status === "legacy_evidence_missing", "legacy item must be classified")
  expect((await legacyOutbox.get("legacy-intent"))?.status === "legacy_evidence_missing", "legacy item must remain observable")

  // Existing synchronous facade consumers still work unchanged.
  const facadeIntents = new IntentPublisher("facade")
  let notifications = 0
  facadeIntents.subscribe(() => { notifications++ })
  await facadeIntents.publish({ id: "facade-intent", agentId: "agent", action: "trade", params: {}, confidence: 1, timestamp: 1 })
  expect(facadeIntents.setDecisionReport("facade-intent", seeded.report), "sync facade write regressed")
  expect(facadeIntents.list().length === 1 && notifications === 2, "dashboard list/subscribe contract regressed")
  const facadeAudit = new Audit("facade")
  facadeAudit.record(seeded.entry)
  expect(facadeAudit.getRecent(1).length === 1 && facadeAudit.getReport(0).totalActions === 1, "audit dashboard contract regressed")

  const root = join(__dirname, "..", "..")
  const redisSource = readFileSync(join(root, "lib", "agent-framework", "decision-evidence-store-redis.ts"), "utf8")
  const coordinatorSource = readFileSync(join(root, "lib", "agent-framework", "coordinator.ts"), "utf8")
  expect(redisSource.includes("current ~= tonumber(ARGV[1])"), "Redis writes must use version CAS")
  expect(redisSource.includes("redis.call('HSET', KEYS[1]") && redisSource.includes("redis.call('HSET', KEYS[2]"),
    "proof reconciliation must update report and audit in one Lua script")
  expect(coordinatorSource.includes("await this._persistDecisionReport"), "Coordinator must await durable report")
  expect(coordinatorSource.includes("await this._persistAuditEntry"), "Coordinator must await durable audit")
  console.log("ALL_RI_BANK_29_DECISION_EVIDENCE_ASSERTIONS_PASSED=YES")
}

run().catch(error => { console.error(error); process.exitCode = 1 })
