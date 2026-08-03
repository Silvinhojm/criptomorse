import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Redis } from "@upstash/redis"
import { RedisOnChainProofOutbox } from "../agent-framework/onchain-proof-outbox-redis"
import { onChainProofOutboxPrefix } from "../kv"

const ROOT = resolve(__dirname, "..", "..")
const TEST_ENV = resolve(ROOT, "..", ".env.test.local")
const RUN_ENV = resolve(ROOT, ".env.ri-bank-30.local")

const VULNERABLE_KNOWN_PROOF_LUA = `
if redis.call('HGET', KEYS[1], 'leaseOwner') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'txHash', ARGV[2], 'blockNumber', ARGV[3], 'status', 'reconciliation_pending')
return 1
`

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function readEnv(path: string): Record<string, string> {
  return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/).flatMap(line => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    return match ? [[match[1], match[2]]] : []
  }))
}

async function scanPrefix(redis: Redis, prefix: string): Promise<string[]> {
  let cursor = 0
  const keys: string[] = []
  do {
    const result = await redis.scan(cursor, { match: `${prefix}*`, count: 100 })
    cursor = Number(result[0])
    keys.push(...result[1])
  } while (cursor !== 0)
  return keys
}

async function run() {
  const test = readEnv(TEST_ENV)
  const runEnv = readEnv(RUN_ENV)
  expect(test.ARCFLOW_TEST_REDIS_URL && test.ARCFLOW_TEST_REDIS_TOKEN, "dedicated Redis credentials missing")
  expect(runEnv.RI_BANK_30_REDIS_PREFIX?.startsWith("arcflow:ri-bank-30:test:"), "unsafe test prefix")
  process.env.VERCEL_ENV = runEnv.RI_BANK_30_REDIS_PREFIX.slice("arcflow:".length)
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN

  const redis = new Redis({ url: test.ARCFLOW_TEST_REDIS_URL, token: test.ARCFLOW_TEST_REDIS_TOKEN })
  const prefix = onChainProofOutboxPrefix()
  expect(prefix === runEnv.RI_BANK_30_REDIS_PREFIX + ":onchain-proof-outbox", "namespace mismatch")
  const dueKey = `${prefix}:due`
  const leaseKey = `${prefix}:global-lease`
  const beforeIntent = `ri31-before-${Date.now()}`
  const afterIntent = `ri31-after-${Date.now()}`
  const metadataIntent = `ri31-metadata-${Date.now()}`
  const itemKey = (intentId: string) => `${prefix}:item:${intentId}`

  try {
    // BEFORE bug 1: the old script persists proof but leaves no due-index member.
    const before = new RedisOnChainProofOutbox(redis)
    await before.enqueue({ intentId: beforeIntent, decisionReportId: "report-before", auditId: "audit-before",
      decisionHash: "0x" + "11".repeat(32), compactPayload: JSON.stringify({ scenario: "before" }), nextAttemptAt: 0 })
    expect(await before.claimDue("before-owner", Date.now()), "before item was not claimed")
    expect(Number(await redis.eval(VULNERABLE_KNOWN_PROOF_LUA, [itemKey(beforeIntent)],
      ["before-owner", "0xbefore", 31])) === 1, "vulnerable proof seed failed")
    expect(await redis.zscore(dueKey, beforeIntent) === null, "vulnerable item unexpectedly remained due")
    await redis.del(leaseKey) // deterministic simulation of the crashed worker's lease expiry
    const invisible = await new RedisOnChainProofOutbox(redis).claimDue("before-new-owner", Date.now() + 120_000)
    expect(invisible === null, "vulnerable item should be invisible after process death")
    console.log("BUG1_BEFORE_REPRODUCED=YES")

    // AFTER bug 1: proof persistence and ZSET reinsertion are one Lua operation.
    const after = new RedisOnChainProofOutbox(redis)
    await after.enqueue({ intentId: afterIntent, decisionReportId: "report-after", auditId: "audit-after",
      decisionHash: "0x" + "22".repeat(32), compactPayload: JSON.stringify({ scenario: "after" }), nextAttemptAt: 0 })
    expect(await after.claimDue("after-owner", Date.now()), "after item was not claimed")
    expect(await after.recordKnownProof(afterIntent, "after-owner", { txHash: "0xafter", blockNumber: 32 }),
      "fixed recordKnownProof failed")
    expect(await redis.zscore(dueKey, afterIntent) !== null, "fixed item missing from due index")
    const cannotSteal = await new RedisOnChainProofOutbox(redis).claimDue("early-owner", Date.now() + 120_000)
    expect(cannotSteal === null, "active lease did not protect the item")
    await redis.del(leaseKey) // deterministic lease expiry after the simulated process death
    const resumed = await new RedisOnChainProofOutbox(redis).claimDue("after-new-owner", Date.now() + 120_000)
    expect(resumed?.intentId === afterIntent, "new instance did not rediscover the fixed item")
    expect(resumed.status === "processing" && resumed.attempts === 2, "resumed item state is wrong")
    expect(resumed.txHash === "0xafter" && resumed.blockNumber === 32, "known proof was not preserved")
    console.log("BUG1_AFTER_FIXED=YES")
    console.log("BUG1_ACTIVE_LEASE_PROTECTED=YES")

    // BEFORE/AFTER bug 2 against actual Upstash automatic deserialization.
    const payloadObject = { mandate: "RI-BANK-31", scenario: "metadata", nested: { ok: true }, count: 31 }
    const payloadJson = JSON.stringify(payloadObject)
    const metadata = new RedisOnChainProofOutbox(redis)
    await metadata.enqueue({ intentId: metadataIntent, decisionReportId: "report-metadata", auditId: "audit-metadata",
      decisionHash: "0x" + "33".repeat(32), compactPayload: payloadJson, nextAttemptAt: 0 })
    const raw = await redis.hgetall<Record<string, unknown>>(itemKey(metadataIntent))
    expect(raw && typeof raw.compactPayload === "object", "Upstash did not reproduce automatic JSON deserialization")
    expect(String(raw.compactPayload) === "[object Object]", "old String() corruption was not reproduced")
    console.log("BUG2_BEFORE_REPRODUCED=YES")
    const normalized = await metadata.get(metadataIntent)
    expect(normalized?.compactPayload !== "[object Object]", "metadata still corrupted")
    expect(JSON.stringify(JSON.parse(normalized!.compactPayload)) === payloadJson, "metadata JSON changed after normalization")
    console.log("BUG2_AFTER_FIXED=YES")
  } finally {
    const keys = await scanPrefix(redis, runEnv.RI_BANK_30_REDIS_PREFIX)
    if (keys.length) await redis.del(...keys)
    const remaining = await scanPrefix(redis, runEnv.RI_BANK_30_REDIS_PREFIX)
    expect(remaining.length === 0, "RI-BANK-31 Redis cleanup incomplete")
    console.log(`RI_BANK_31_REDIS_KEYS_REMOVED=${keys.length}`)
    console.log("RI_BANK_31_REDIS_KEYS_REMAINING=0")
  }
}

run().catch(error => { console.error("RI_BANK_31_FAILED=" + (error instanceof Error ? error.stack : String(error))); process.exitCode = 1 })
