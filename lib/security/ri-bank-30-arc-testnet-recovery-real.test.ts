import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Redis } from "@upstash/redis"
import { Contract, JsonRpcProvider, Wallet, formatEther, keccak256, toUtf8Bytes } from "ethers"
import { Audit } from "../agent-framework/audit"
import { RedisDecisionEvidenceStore } from "../agent-framework/decision-evidence-store-redis"
import type { DecisionReport } from "../agent-framework/decision-report"
import { IntentPublisher } from "../agent-framework/intent-publisher"
import { RedisOnChainProofOutbox } from "../agent-framework/onchain-proof-outbox-redis"
import type { OnChainProofOutboxItem } from "../agent-framework/onchain-proof-outbox"
import { OnChainProofReconciler, type ConfirmedOnChainProof } from "../agent-framework/onchain-proof-reconciler"
import { OnChainProofRecoveryService, type OnChainProofBroadcaster } from "../agent-framework/onchain-proof-recovery"
import {
  auditEvidenceIndexKvKey,
  auditEvidenceKvKey,
  decisionReportEvidenceIndexKvKey,
  decisionReportEvidenceKvKey,
  onChainProofOutboxPrefix,
} from "../kv"

const ROOT = resolve(__dirname, "..", "..")
const MAIN_ROOT = resolve(ROOT, "..")
const TEST_ENV = resolve(MAIN_ROOT, ".env.test.local")
const RUN_ENV = resolve(ROOT, ".env.ri-bank-30.local")
const ABI = [
  "function anchor(bytes32 _hash,string _metadataURI) returns (uint256)",
  "function totalReports() view returns (uint256)",
]
const OFFICIAL_ARC_TESTNET_RPC = "https://rpc.testnet.arc.io"
const OFFICIAL_ARC_TESTNET_RPC_BLOCKDAEMON = "https://rpc.blockdaemon.testnet.arc.io"
const OFFICIAL_ARC_TESTNET_RPC_DRPC = "https://rpc.drpc.testnet.arc.io"
const OFFICIAL_ARC_TESTNET_RPC_QUICKNODE = "https://rpc.quicknode.testnet.arc.io"
const FORBIDDEN_WALLETS = new Set([
  "0x77f5c3a1079b86ef8490e7c5ec1f9bcfbaae5894",
  "0xfa033d062d6ab8d49d611f5644d46f5380737dda",
  "0xad42458a2e98e62453f4b54fa6e7511e0a303b6f",
])

type Config = {
  redisUrl: string
  redisToken: string
  privateKey: string
  walletAddress: string
  rpcUrl: string
  chainId: number
  anchorAddress: string
  namespace: string
}

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function readEnvFile(path: string): Record<string, string> {
  return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/).flatMap(line => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    return match ? [[match[1], match[2]]] : []
  }))
}

function loadConfig(): Config {
  const test = readEnvFile(TEST_ENV)
  const run = readEnvFile(RUN_ENV)
  expect(test.ARCFLOW_TEST_REDIS_URL && test.ARCFLOW_TEST_REDIS_TOKEN, "dedicated test Redis credentials missing")
  expect(run.RI_BANK_30_ENVIRONMENT === "test", "RI-BANK-30 environment is not test")
  expect(run.RI_BANK_30_REDIS_PREFIX?.startsWith("arcflow:ri-bank-30:test:"), "unsafe Redis prefix")
  const namespace = run.RI_BANK_30_REDIS_PREFIX.slice("arcflow:".length)
  process.env.VERCEL_ENV = namespace
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  const wallet = new Wallet(run.RI_BANK_30_PRIVATE_KEY)
  expect(wallet.address.toLowerCase() === run.RI_BANK_30_WALLET_ADDRESS.toLowerCase(), "wallet/key mismatch")
  expect(!FORBIDDEN_WALLETS.has(wallet.address.toLowerCase()), "wallet is not exclusive")
  expect(Number(run.RI_BANK_30_CHAIN_ID) === 5042002, "wrong chain id")
  return {
    redisUrl: test.ARCFLOW_TEST_REDIS_URL,
    redisToken: test.ARCFLOW_TEST_REDIS_TOKEN,
    privateKey: run.RI_BANK_30_PRIVATE_KEY,
    walletAddress: wallet.address,
    // Current primary endpoint from the official Arc connection reference.
    // The generated env may predate the docs update, so the harness pins the
    // current testnet-only endpoint instead of trusting a stale local value.
    rpcUrl: OFFICIAL_ARC_TESTNET_RPC,
    chainId: Number(run.RI_BANK_30_CHAIN_ID),
    anchorAddress: run.RI_BANK_30_DECISION_ANCHOR_ADDRESS,
    namespace,
  }
}

function createRedis(config: Config): Redis {
  return new Redis({ url: config.redisUrl, token: config.redisToken })
}

function scenarioIds(name: string) {
  return { intentId: `ri30-${name}-intent`, reportId: `ri30-${name}-report`, auditId: `ri30-${name}-audit` }
}

async function seedScenario(config: Config, name: string) {
  const redis = createRedis(config)
  const store = new RedisDecisionEvidenceStore(redis)
  const outbox = new RedisOnChainProofOutbox(redis)
  const ids = scenarioIds(name)
  const createdAt = Date.now()
  const audit = Audit.createEntry({
    agentId: "ri-bank-30-test-agent", action: "anchor-test-evidence",
    proposal: { id: `proposal-${name}`, agentId: "ri-bank-30-test-agent", action: "anchor-test-evidence", params: { testOnly: true }, confidence: 100, timestamp: createdAt },
    result: { success: true, action: "anchor-test-evidence", profit: 0, gasCost: 0 },
    approved: true, confidence: 100, voters: 1, onChainStatus: "pending", tags: ["ri-bank-30", name],
  })
  audit.id = ids.auditId
  const report: DecisionReport = {
    id: ids.reportId, intentId: ids.intentId, agentId: "ri-bank-30-test-agent",
    action: "anchor-test-evidence", params: { testOnly: true, scenario: name }, auditId: ids.auditId,
    auditStatus: "recorded", onChainStatus: "pending", createdAt,
  }
  const compactPayload = JSON.stringify({ mandate: "RI-BANK-30", scenario: name, intentId: ids.intentId, timestamp: createdAt })
  const decisionHash = keccak256(toUtf8Bytes(compactPayload))
  expect((await store.saveAuditEntry(audit)).saved, `${name}: audit seed failed`)
  expect((await store.saveDecisionReport(ids.intentId, report)).saved, `${name}: report seed failed`)
  await outbox.enqueue({ intentId: ids.intentId, decisionReportId: ids.reportId, auditId: ids.auditId,
    decisionHash, compactPayload, nextAttemptAt: 0 })
  return { redis, store, outbox, ids, report, audit, decisionHash, compactPayload }
}

function createReconciler(store: RedisDecisionEvidenceStore, label: string) {
  return new OnChainProofReconciler(new IntentPublisher(label), new Audit(label), store)
}

class RealArcBroadcaster implements OnChainProofBroadcaster {
  readonly provider: JsonRpcProvider
  readonly wallet: Wallet
  readonly contract: Contract
  constructor(private readonly config: Config) {
    this.provider = new JsonRpcProvider(config.rpcUrl, { chainId: config.chainId, name: "arc-testnet" }, { staticNetwork: true })
    this.wallet = new Wallet(config.privateKey, this.provider)
    this.contract = new Contract(config.anchorAddress, ABI, this.wallet)
  }
  async findKnownProof(): Promise<ConfirmedOnChainProof | null> { return null }
  async broadcast(item: OnChainProofOutboxItem, persistKnownProof: (proof: ConfirmedOnChainProof) => Promise<void>): Promise<ConfirmedOnChainProof> {
    const tx = await this.contract.anchor(item.decisionHash, item.compactPayload)
    const receipt = await tx.wait()
    expect(receipt?.status === 1, "Arc Testnet transaction reverted")
    const proof = { hash: item.decisionHash, txHash: tx.hash, blockNumber: Number(receipt.blockNumber) }
    await persistKnownProof(proof)
    return proof
  }
}

async function withRpcBackoff<T>(operation: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 6; attempt++) {
    try { return await operation() } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      console.log(`RPC_BACKOFF=${JSON.stringify({ label, attempt, error: message.slice(0, 180) })}`)
      if (attempt < 6) await new Promise(resolvePromise => setTimeout(resolvePromise, attempt * 2_000))
    }
  }
  throw lastError
}

async function evidenceSnapshot(store: RedisDecisionEvidenceStore, outbox: RedisOnChainProofOutbox, name: string) {
  const ids = scenarioIds(name)
  const [report, audit, item] = await Promise.all([
    store.getDecisionReport(ids.intentId), store.getAuditEntry(ids.auditId), outbox.get(ids.intentId),
  ])
  return {
    reportVersion: report?.version, reportStatus: report?.report.onChainStatus, reportTx: report?.report.onChainTx,
    auditVersion: audit?.version, auditStatus: audit?.entry.onChainStatus, auditTx: audit?.entry.onChainTx,
    outboxStatus: item?.status, attempts: item?.attempts, lastError: item?.lastError,
    txHash: item?.txHash, blockNumber: item?.blockNumber,
  }
}

async function runE1(config: Config) {
  const seeded = await seedScenario(config, "e1-happy")
  const before = await evidenceSnapshot(seeded.store, seeded.outbox, "e1-happy")
  const contract = new Contract(config.anchorAddress, ABI,
    new JsonRpcProvider(config.rpcUrl, { chainId: config.chainId, name: "arc-testnet" }, { staticNetwork: true }))
  const totalBefore = Number(await withRpcBackoff(() => contract.totalReports(), "e1-total-before"))
  const result = await new OnChainProofRecoveryService(
    seeded.outbox, createReconciler(seeded.store, "e1-cold"), new RealArcBroadcaster(config),
  ).runOnce(Date.now(), "ri30-e1-worker")
  const after = await evidenceSnapshot(seeded.store, seeded.outbox, "e1-happy")
  const totalAfter = Number(await withRpcBackoff(() => contract.totalReports(), "e1-total-after"))
  console.log("E1_ATTEMPT=" + JSON.stringify({ result, before, after, totalBefore, totalAfter }))
  expect(result.status === "confirmed", "E1 did not confirm")
  expect(after.reportStatus === "confirmed" && after.auditStatus === "confirmed" && after.outboxStatus === "confirmed", "E1 stores not aligned")
  expect(totalAfter === totalBefore + 1, "E1 anchor count did not increment exactly once")
  console.log("E1=" + JSON.stringify({ before, after, totalBefore, totalAfter }))
  return after.txHash!
}

async function runE2(config: Config) {
  const seeded = await seedScenario(config, "e2-rpc")
  const failing: OnChainProofBroadcaster = {
    async findKnownProof() { return null },
    async broadcast() {
      const unavailable = new JsonRpcProvider("http://127.0.0.1:1", { chainId: config.chainId, name: "forced-rpc-failure" }, { staticNetwork: true })
      await unavailable.getBlockNumber()
      throw new Error("forced_rpc_failure_did_not_fail")
    },
  }
  const first = await new OnChainProofRecoveryService(
    seeded.outbox, createReconciler(seeded.store, "e2-first"), failing,
  ).runOnce(Date.now(), "ri30-e2-worker-1")
  const afterFailure = await evidenceSnapshot(seeded.store, seeded.outbox, "e2-rpc")
  expect(first.status === "retry_scheduled" && afterFailure.outboxStatus === "retry_wait", "E2 retry was not scheduled")
  const second = await new OnChainProofRecoveryService(
    seeded.outbox, createReconciler(seeded.store, "e2-second-cold"),
    new RealArcBroadcaster({ ...config, rpcUrl: OFFICIAL_ARC_TESTNET_RPC_BLOCKDAEMON }),
  ).runOnce(Date.now() + 120_000, "ri30-e2-worker-2")
  const after = await evidenceSnapshot(seeded.store, seeded.outbox, "e2-rpc")
  console.log("E2_ATTEMPT=" + JSON.stringify({ first, second, afterFailure, after }))
  expect(second.status === "confirmed" && after.attempts === 2, "E2 retry did not recover")
  console.log("E2=" + JSON.stringify({ afterFailure, after }))
  return after.txHash!
}

async function runCrashChild(config: Config): Promise<never> {
  const seeded = await seedScenario(config, "e3-crash")
  const broadcaster = new RealArcBroadcaster({ ...config, rpcUrl: OFFICIAL_ARC_TESTNET_RPC_DRPC })
  const crashBroadcaster: OnChainProofBroadcaster = {
    findKnownProof: broadcaster.findKnownProof.bind(broadcaster),
    async broadcast(item, persistKnownProof) {
      const tx = await broadcaster.contract.anchor(item.decisionHash, item.compactPayload)
      const receipt = await tx.wait()
      expect(receipt?.status === 1, "E3 transaction reverted")
      const proof = { hash: item.decisionHash, txHash: tx.hash, blockNumber: Number(receipt.blockNumber) }
      await persistKnownProof(proof)
      console.log("E3_CHILD_PERSISTED=" + JSON.stringify({ txHash: proof.txHash, blockNumber: proof.blockNumber }))
      process.exit(77)
    },
  }
  await new OnChainProofRecoveryService(
    seeded.outbox, createReconciler(seeded.store, "e3-child"), crashBroadcaster,
  ).runOnce(Date.now(), "ri30-e3-crashed-worker")
  throw new Error("E3 child did not terminate")
}

async function spawnCrashChild(): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, __filename, "--e3-crash-child"], {
      cwd: ROOT, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.on("data", chunk => { output += String(chunk) })
    child.stderr.on("data", chunk => { output += String(chunk) })
    child.on("error", reject)
    child.on("exit", code => resolvePromise({ code, output }))
  })
}

async function runE3(config: Config) {
  const child = await spawnCrashChild()
  expect(child.code === 77, `E3 child exit was ${child.code}`)
  const redis = createRedis(config)
  const store = new RedisDecisionEvidenceStore(redis)
  const outbox = new RedisOnChainProofOutbox(redis)
  const afterCrash = await evidenceSnapshot(store, outbox, "e3-crash")
  expect(afterCrash.outboxStatus === "reconciliation_pending" && afterCrash.txHash, "E3 known proof not durable before crash")
  const service = new OnChainProofRecoveryService(outbox, createReconciler(store, "e3-new-process"), {
    async findKnownProof() { throw new Error("E3 must not search after durable tx") },
    async broadcast() { throw new Error("E3 must not rebroadcast") },
  })
  const deadline = Date.now() + 75_000
  let result = await service.runOnce(Date.now(), "ri30-e3-new-worker")
  while (result.status === "idle" && Date.now() < deadline) {
    await new Promise(resolvePromise => setTimeout(resolvePromise, 2_000))
    result = await service.runOnce(Date.now(), "ri30-e3-new-worker")
  }
  const after = await evidenceSnapshot(store, outbox, "e3-crash")
  console.log("E3_ATTEMPT=" + JSON.stringify({ childExit: child.code, afterCrash, after, finalRunStatus: result.status }))
  expect(result.status === "confirmed" && after.outboxStatus === "confirmed", "E3 cold process did not resume after lease expiry")
  expect(after.txHash === afterCrash.txHash, "E3 changed the known transaction")
  console.log("E3=" + JSON.stringify({ childExit: child.code, afterCrash, after }))
  return after.txHash!
}

async function runE4(config: Config) {
  const seeded = await seedScenario(config, "e4-concurrency")
  const countContract = new Contract(config.anchorAddress, ABI,
    new JsonRpcProvider(OFFICIAL_ARC_TESTNET_RPC_BLOCKDAEMON,
      { chainId: config.chainId, name: "arc-testnet" }, { staticNetwork: true }))
  const totalBefore = Number(await withRpcBackoff(() => countContract.totalReports(), "e4-total-before"))
  const outboxA = new RedisOnChainProofOutbox(createRedis(config))
  const outboxB = new RedisOnChainProofOutbox(createRedis(config))
  const storeA = new RedisDecisionEvidenceStore(createRedis(config))
  const storeB = new RedisDecisionEvidenceStore(createRedis(config))
  const [a, b] = await Promise.all([
    new OnChainProofRecoveryService(outboxA, createReconciler(storeA, "e4-a"),
      new RealArcBroadcaster({ ...config, rpcUrl: OFFICIAL_ARC_TESTNET_RPC_QUICKNODE })).runOnce(Date.now(), "ri30-e4-a"),
    new OnChainProofRecoveryService(outboxB, createReconciler(storeB, "e4-b"),
      new RealArcBroadcaster({ ...config, rpcUrl: OFFICIAL_ARC_TESTNET_RPC_QUICKNODE })).runOnce(Date.now(), "ri30-e4-b"),
  ])
  const afterConcurrent = await evidenceSnapshot(seeded.store, seeded.outbox, "e4-concurrency")
  expect([a.status, b.status].filter(status => status === "idle").length === 1, "E4 loser was not idle")
  expect(afterConcurrent.attempts === 1, "E4 duplicated the concurrent claim")

  let retryStatus: string | undefined
  if (![a.status, b.status].includes("confirmed")) {
    expect([a.status, b.status].includes("retry_scheduled"), "E4 winner neither confirmed nor retained for retry")
    const retry = await new OnChainProofRecoveryService(
      seeded.outbox, createReconciler(seeded.store, "e4-retry-cold"),
      new RealArcBroadcaster({ ...config, rpcUrl: OFFICIAL_ARC_TESTNET_RPC_BLOCKDAEMON }),
    ).runOnce(Date.now() + 120_000, "ri30-e4-retry")
    retryStatus = retry.status
  }
  const after = await evidenceSnapshot(seeded.store, seeded.outbox, "e4-concurrency")
  const totalAfter = Number(await withRpcBackoff(() => countContract.totalReports(), "e4-total-after"))
  console.log("E4_ATTEMPT=" + JSON.stringify({ workers: [a, b], afterConcurrent, retryStatus, after, totalBefore, totalAfter }))
  expect(after.outboxStatus === "confirmed", "E4 retained winner did not confirm")
  expect(totalAfter === totalBefore + 1, "E4 did not produce exactly one anchor")
  console.log("E4=" + JSON.stringify({ workers: [a.status, b.status], afterConcurrent, retryStatus, after, totalBefore, totalAfter }))
  return after.txHash!
}

async function runE5(config: Config) {
  const seeded = await seedScenario(config, "e5-exhaustion")
  const failure: OnChainProofBroadcaster = {
    async findKnownProof() { return null },
    async broadcast() { throw new Error("forced_persistent_rpc_failure") },
  }
  const service = new OnChainProofRecoveryService(
    seeded.outbox, createReconciler(seeded.store, "e5-cold"), failure, 3,
  )
  const r1 = await service.runOnce(Date.now(), "ri30-e5-1")
  const r2 = await service.runOnce(Date.now() + 120_000, "ri30-e5-2")
  const r3 = await service.runOnce(Date.now() + 300_000, "ri30-e5-3")
  const after = await evidenceSnapshot(seeded.store, seeded.outbox, "e5-exhaustion")
  expect(r1.status === "retry_scheduled" && r2.status === "retry_scheduled" && r3.status === "dead_letter", "E5 transitions wrong")
  expect(after.attempts === 3 && after.outboxStatus === "dead_letter", "E5 outbox not dead-lettered")
  expect(after.reportStatus === "failed" && after.auditStatus === "failed", "E5 evidence not failed")
  console.log("E5=" + JSON.stringify({ runs: [r1.status, r2.status, r3.status], after }))
}

function allTestKeys(names: string[]): string[] {
  const prefix = onChainProofOutboxPrefix()
  const keys = new Set<string>([
    decisionReportEvidenceIndexKvKey(), auditEvidenceIndexKvKey(), `${prefix}:due`, `${prefix}:global-lease`,
  ])
  for (const name of names) {
    const ids = scenarioIds(name)
    keys.add(decisionReportEvidenceKvKey(ids.intentId))
    keys.add(auditEvidenceKvKey(ids.auditId))
    keys.add(`${prefix}:item:${ids.intentId}`)
  }
  return [...keys]
}

async function cleanup(config: Config, names: string[]) {
  const redis = createRedis(config)
  const keys = allTestKeys(names)
  await redis.del(...keys)
  const remaining = await Promise.all(keys.map(key => redis.exists(key)))
  expect(remaining.every(value => Number(value) === 0), "test Redis cleanup incomplete")
  console.log(`E6_CLEANUP_KEYS_REMOVED=${keys.length}`)
}

async function main() {
  const config = loadConfig()
  if (process.argv.includes("--e3-crash-child")) return runCrashChild(config)
  const scenarios = ["e1-happy", "e2-rpc", "e3-crash", "e4-concurrency", "e5-exhaustion"]
  const provider = new JsonRpcProvider(config.rpcUrl, { chainId: config.chainId, name: "arc-testnet" }, { staticNetwork: true })
  const network = await provider.getNetwork()
  const balanceBefore = await withRpcBackoff(() => provider.getBalance(config.walletAddress), "preflight-balance")
  expect(Number(network.chainId) === config.chainId, "RPC is not Arc Testnet")
  expect(balanceBefore > 0n, "exclusive faucet wallet is not funded")
  console.log("E0=" + JSON.stringify({ chainId: Number(network.chainId), wallet: config.walletAddress,
    balanceBefore: formatEther(balanceBefore), namespace: config.namespace, productionVarsLoaded: false, jobActivated: false }))
  const txHashes: string[] = []
  try {
    if (!process.argv.includes("--skip-e1")) {
      txHashes.push(await runE1(config))
      if (process.argv.includes("--only-e1")) return
    }
    if (!process.argv.includes("--skip-e2")) {
      txHashes.push(await runE2(config))
      if (process.argv.includes("--only-e2")) return
    }
    if (!process.argv.includes("--skip-e3")) txHashes.push(await runE3(config))
    if (!process.argv.includes("--skip-e4")) txHashes.push(await runE4(config))
    if (!process.argv.includes("--skip-e5")) await runE5(config)
    const expectedTransactions = (process.argv.includes("--skip-e1") ? 0 : 1) +
      (process.argv.includes("--skip-e2") ? 0 : 1) +
      (process.argv.includes("--skip-e3") ? 0 : 1) +
      (process.argv.includes("--skip-e4") ? 0 : 1)
    expect(new Set(txHashes).size === expectedTransactions, `expected ${expectedTransactions} unique Arc Testnet transactions`)
    const balanceAfter = await withRpcBackoff(() => provider.getBalance(config.walletAddress), "final-balance")
    console.log("FINAL=" + JSON.stringify({ txHashes, balanceAfter: formatEther(balanceAfter), allScenariosPassed: true }))
  } finally {
    await cleanup(config, scenarios)
  }
}

main().catch(error => { console.error("RI_BANK_30_FAILED=" + (error instanceof Error ? error.stack : String(error))); process.exitCode = 1 })
