import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Audit } from "../agent-framework/audit"
import { IntentPublisher } from "../agent-framework/intent-publisher"
import type { DecisionReport } from "../agent-framework/decision-report"
import { OnChainProofReconciler } from "../agent-framework/onchain-proof-reconciler"
import { MemoryOnChainProofOutbox } from "../agent-framework/onchain-proof-outbox"
import { OnChainProofRecoveryService, type OnChainProofBroadcaster } from "../agent-framework/onchain-proof-recovery"

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function fixture() {
  const intents = new IntentPublisher("ri-bank-28")
  const intentId = await intents.publish({ id: "intent-28", agentId: "agent", action: "trade", params: {}, confidence: 90, timestamp: 1 })
  const audit = new Audit("ri-bank-28")
  const auditEntry = Audit.createEntry({
    agentId: "agent", action: "trade",
    proposal: { id: "proposal-28", agentId: "agent", action: "trade", params: {}, confidence: 90, timestamp: 1 },
    result: { success: true, action: "trade", profit: 1, gasCost: 0 },
    approved: true, confidence: 90, voters: 2, onChainStatus: "pending",
  })
  audit.record(auditEntry)
  const report: DecisionReport = {
    id: "report-28", intentId, agentId: "agent", action: "trade", params: {},
    auditId: auditEntry.id, onChainStatus: "pending", createdAt: 1,
  }
  intents.setDecisionReport(intentId, report)
  return { intents, intentId, audit, auditEntry, report, reconciler: new OnChainProofReconciler(intents, audit) }
}

const failureBroadcaster: OnChainProofBroadcaster = {
  async findKnownProof() { return null },
  async broadcast() { throw new Error("simulated_failure") },
}

async function run(): Promise<void> {
  // E4: one reconciler updates and verifies both stores; duplicate is idempotent.
  const first = await fixture()
  const proof = { hash: "0xhash", txHash: "0xtx", blockNumber: 28 }
  const reconciled = first.reconciler.reconcileConfirmedProof(first.intentId, proof)
  expect(reconciled.reconciled && !reconciled.idempotent, "first reconciliation must write")
  expect(first.intents.getRecord(first.intentId)?.decisionReport?.onChainTx === "0xtx", "report not confirmed")
  expect(first.audit.getById(first.auditEntry.id)?.onChainTx === "0xtx", "audit not confirmed")
  const duplicate = first.reconciler.reconcileConfirmedProof(first.intentId, proof)
  expect(duplicate.reconciled && duplicate.idempotent, "duplicate reconciliation must be idempotent")

  const serviceSuccess = await fixture()
  const successOutbox = new MemoryOnChainProofOutbox()
  await successOutbox.enqueue({ intentId: serviceSuccess.intentId, decisionReportId: serviceSuccess.report.id,
    auditId: serviceSuccess.auditEntry.id, decisionHash: proof.hash, compactPayload: "{}", nextAttemptAt: 0 })
  const successBroadcaster: OnChainProofBroadcaster = {
    async findKnownProof() { return null },
    async broadcast(_item, persistKnownProof) {
      await persistKnownProof(proof)
      return proof
    },
  }
  const successResult = await new OnChainProofRecoveryService(successOutbox, serviceSuccess.reconciler, successBroadcaster).runOnce(1, "success-worker")
  expect(successResult.status === "confirmed", "successful service run must confirm")
  expect((await successOutbox.get(serviceSuccess.intentId))?.status === "confirmed", "ACK must follow verified reconciliation")

  // Atomic behavior: audit failure causes report compensation.
  const atomic = await fixture()
  const brokenAudit = { getById: atomic.audit.getById.bind(atomic.audit), updateEntry: () => false }
  const brokenReconciler = new OnChainProofReconciler(atomic.intents, brokenAudit)
  expect(!brokenReconciler.reconcileConfirmedProof(atomic.intentId, proof).reconciled, "audit failure must fail reconciliation")
  expect(atomic.intents.getRecord(atomic.intentId)?.decisionReport?.onChainStatus === "pending", "report must roll back")

  // Concurrent workers cannot claim the same item or lose the attempts increment.
  const concurrent = await fixture()
  const concurrentOutbox = new MemoryOnChainProofOutbox()
  await concurrentOutbox.enqueue({ intentId: concurrent.intentId, decisionReportId: concurrent.report.id,
    auditId: concurrent.auditEntry.id, decisionHash: "0xhash", compactPayload: "{}", nextAttemptAt: 0 })
  const concurrentService = new OnChainProofRecoveryService(concurrentOutbox, concurrent.reconciler, failureBroadcaster)
  const results = await Promise.all([concurrentService.runOnce(1, "worker-a"), concurrentService.runOnce(1, "worker-b")])
  expect(results.filter(result => result.status === "retry_scheduled").length === 1, "only one worker may claim")
  expect((await concurrentOutbox.get(concurrent.intentId))?.attempts === 1, "attempt increment must be atomic")

  // Exhaustion remains observable and marks both evidence stores failed.
  const exhausted = await fixture()
  const exhaustedOutbox = new MemoryOnChainProofOutbox()
  await exhaustedOutbox.enqueue({ intentId: exhausted.intentId, decisionReportId: exhausted.report.id,
    auditId: exhausted.auditEntry.id, decisionHash: "0xhash", compactPayload: "{}", nextAttemptAt: 0 })
  const exhaustedService = new OnChainProofRecoveryService(exhaustedOutbox, exhausted.reconciler, failureBroadcaster, 2)
  await exhaustedService.runOnce(1, "worker-1")
  await exhaustedService.runOnce(31_000, "worker-2")
  expect((await exhaustedOutbox.get(exhausted.intentId))?.status === "dead_letter", "exhausted item must be retained")
  expect(exhausted.intents.getRecord(exhausted.intentId)?.decisionReport?.onChainStatus === "failed", "report must be failed")
  expect(exhausted.audit.getById(exhausted.auditEntry.id)?.onChainStatus === "failed", "audit must be failed")

  const route = readFileSync(join(__dirname, "..", "..", "app", "api", "onchain-proof-recovery", "route.ts"), "utf8")
  for (const forbidden of ["submitProposal(", "runCycle(", "anchorDecision(", "ethers", "PRIVATE_KEY", "kms:Sign"]) {
    expect(!route.includes(forbidden), `route contains forbidden execution path: ${forbidden}`)
  }
  expect(route.includes("ONCHAIN_PROOF_RECOVERY_JOB_ENABLED"), "route must be inactive by default")
  expect(route.includes("DisabledOnChainProofBroadcaster"), "route must not have a real broadcaster")
  console.log("ALL_RI_BANK_28_ONCHAIN_PROOF_RECOVERY_ASSERTIONS_PASSED=YES")
}

run().catch(error => { console.error(error); process.exitCode = 1 })
