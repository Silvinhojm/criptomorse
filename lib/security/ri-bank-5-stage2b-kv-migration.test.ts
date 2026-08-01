// RI-BANK-5 Stage 2B — ri-bank-5-stage2b-kv-migration.test.ts
//
// Tests the actual Upstash Redis migration against the REAL dev database
// (KV_REST_API_URL/TOKEN from .env.local — no mock, per this stage's
// mandate: "REAL_REDIS_TESTS=YES (banco de dev, não mock)"). Every block
// that touches the shared dev Redis backs up whatever was already there
// under the same key (real local `next dev` usage now also talks to this
// same database, per RI-BANK-5 Stage 2A D2) and restores it in a
// `finally`, so this test never leaves the dev database in a different
// state than it found it, and never corrupts a real local session's
// circuit breaker / open positions.
//
// Run directly with: npx tsx lib/security/ri-bank-5-stage2b-kv-migration.test.ts

import { isValidPositionsSyncRequest } from "./cron-auth"
import { readFileSync } from "node:fs"
import { join } from "node:path"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const REPO_ROOT = join(__dirname, "..", "..")

export async function runRiBank5Stage2bKvMigrationTests(): Promise<void> {
  const { isKvConfigured, getRedis, circuitBreakerKvKey, positionsKvKey, kvEnvNamespace } = await import("../kv")

  expect(isKvConfigured(), "KV_REST_API_URL/TOKEN must be present in this environment (.env.local) for these tests to exercise the real database, not a hypothetical path")
  expect(kvEnvNamespace() === "local", `expected the 'local' namespace when VERCEL_ENV isn't set (this test runs via npx tsx, outside Vercel), got '${kvEnvNamespace()}'`)

  const redis = getRedis()
  const cbKey = circuitBreakerKvKey()
  const posKey = positionsKvKey()

  // ================================================================
  // [CORRETUDE] isValidPositionsSyncRequest — dedicated secret, independent
  // from the circuit breaker sync route's secret (RI-BANK-5 Stage 2A
  // decision 5: "segredo próprio", not shared).
  // ================================================================
  {
    const saved = process.env.NEXT_PUBLIC_POSITIONS_SYNC_SECRET
    delete process.env.NEXT_PUBLIC_POSITIONS_SYNC_SECRET
    try {
      expect(isValidPositionsSyncRequest("Bearer anything") === false, "with no secret configured, every request must be rejected")
    } finally {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_POSITIONS_SYNC_SECRET
      else process.env.NEXT_PUBLIC_POSITIONS_SYNC_SECRET = saved
    }

    const saved2 = process.env.NEXT_PUBLIC_POSITIONS_SYNC_SECRET
    process.env.NEXT_PUBLIC_POSITIONS_SYNC_SECRET = "positions-secret-test-789"
    try {
      expect(isValidPositionsSyncRequest(null) === false, "missing header rejected")
      expect(isValidPositionsSyncRequest("Bearer wrong") === false, "wrong secret rejected")
      expect(isValidPositionsSyncRequest("Bearer positions-secret-test-789") === true, "correct secret accepted")
      expect(isValidPositionsSyncRequest("Bearer sync-secret-test-456") === false, "the circuit-breaker sync route's secret value must not double as a valid positions-sync secret")
    } finally {
      if (saved2 === undefined) delete process.env.NEXT_PUBLIC_POSITIONS_SYNC_SECRET
      else process.env.NEXT_PUBLIC_POSITIONS_SYNC_SECRET = saved2
    }
  }

  // ================================================================
  // [CORRETUDE, REAL REDIS] cbCounterOp("incr", ...) is genuinely atomic
  // against the real dev database — two sequential increments accumulate
  // correctly (HINCRBY/HINCRBYFLOAT), proving the Hash+HINCRBY design
  // actually reaches Redis, not just a local simulation of it.
  // ================================================================
  {
    const hadBefore = (await redis.hlen(cbKey)) > 0
    const backup = hadBefore ? await redis.hgetall<Record<string, unknown>>(cbKey) : null
    try {
      await redis.del(cbKey)
      const { cbCounterOp } = await import("../persistence")

      const r1 = await cbCounterOp("incr", { consecutiveLosses: 1, totalLoss: 1.5 })
      expect(r1?.consecutiveLosses === 1, `first increment: consecutiveLosses must be 1, got ${r1?.consecutiveLosses}`)
      expect(r1?.totalLoss === 1.5, `first increment: totalLoss must be 1.5, got ${r1?.totalLoss}`)

      const r2 = await cbCounterOp("incr", { consecutiveLosses: 1, totalLoss: 2.25 })
      expect(r2?.consecutiveLosses === 2, `second increment: consecutiveLosses must accumulate to 2 (real Redis HINCRBY), got ${r2?.consecutiveLosses}`)
      expect(r2?.totalLoss === 3.75, `second increment: totalLoss must accumulate to 3.75 (real Redis HINCRBYFLOAT), got ${r2?.totalLoss}`)

      const r3 = await cbCounterOp("set", { consecutiveLosses: 0 })
      expect(r3?.consecutiveLosses === 0, `"set" mode must absolutely overwrite, not add — got ${r3?.consecutiveLosses}`)

      // Direct read from Redis (bypassing our own wrapper) as an
      // independent check that the values really landed in the hash.
      // @upstash/redis's automatic deserialization inconsistently
      // auto-converts individual hash values (confirmed during this
      // stage's implementation — see lib/kv.ts's getRedis() comment), so
      // compare loosely (Number(...)) rather than assuming a raw string.
      const raw = await redis.hgetall<Record<string, unknown>>(cbKey)
      expect(Number(raw?.consecutiveLosses) === 0, `raw Redis hash field 'consecutiveLosses' must be 0 after the reset, got ${JSON.stringify(raw?.consecutiveLosses)}`)
      expect(Number(raw?.totalLoss) === 3.75, `raw Redis hash field 'totalLoss' must be 3.75, got ${JSON.stringify(raw?.totalLoss)}`)
    } finally {
      await redis.del(cbKey)
      if (backup && Object.keys(backup).length > 0) await redis.hset(cbKey, backup)
    }
  }

  // ================================================================
  // [CORRETUDE, REAL REDIS] field-ownership rule actually prevents the
  // clobber race this design exists to avoid: an HINCRBY-managed counter
  // must NOT be overwritten by a later wholesale saveCircuitBreakerState()
  // call carrying a stale local value for that same field.
  // ================================================================
  {
    const hadBefore = (await redis.hlen(cbKey)) > 0
    const backup = hadBefore ? await redis.hgetall<Record<string, unknown>>(cbKey) : null
    try {
      await redis.del(cbKey)
      const { cbCounterOp, saveCircuitBreakerState } = await import("../persistence")

      await cbCounterOp("incr", { consecutiveLosses: 5 })
      // Simulate an instance with a STALE local view calling the wholesale
      // save with consecutiveLosses:1 (what IT thinks the value is) —
      // saveCircuitBreakerState must not touch that field at all.
      const staleLocalState: any = {
        isPanicActive: false, panicReason: null, panicTimestamp: null,
        consecutiveLosses: 1, maxLossesBeforePanic: 5, totalLoss: 0, totalProfit: 0,
        maxDrawdownPercent: 10, isTestnet: false, peakNetEquity: 0, routeHealth: {},
      }
      await saveCircuitBreakerState(staleLocalState)

      const raw = await redis.hgetall<Record<string, unknown>>(cbKey)
      expect(Number(raw?.consecutiveLosses) === 5, `saveCircuitBreakerState must NOT clobber the HINCRBY-managed consecutiveLosses field — expected it to stay 5 (the real Redis-side count), got ${JSON.stringify(raw?.consecutiveLosses)}. If this fails, the field-ownership split between cbCounterOp and saveCircuitBreakerState has regressed.`)
      expect(Number(raw?.maxLossesBeforePanic) === 5, "saveCircuitBreakerState must still write the absolute fields it does own")
    } finally {
      await redis.del(cbKey)
      if (backup && Object.keys(backup).length > 0) await redis.hset(cbKey, backup)
    }
  }

  // ================================================================
  // [CORRETUDE, REAL REDIS] loadCircuitBreakerStateFresh round-trips a
  // full saved state, including routeHealth (JSON sub-field).
  // ================================================================
  {
    const hadBefore = (await redis.hlen(cbKey)) > 0
    const backup = hadBefore ? await redis.hgetall<Record<string, unknown>>(cbKey) : null
    try {
      await redis.del(cbKey)
      const { saveCircuitBreakerState, loadCircuitBreakerStateFresh } = await import("../persistence")
      const fallback: any = {
        isPanicActive: false, panicReason: null, panicTimestamp: null,
        consecutiveLosses: 0, maxLossesBeforePanic: 5, totalLoss: 0, totalProfit: 0,
        maxDrawdownPercent: 10, isTestnet: false, peakNetEquity: 0, routeHealth: {},
      }
      const toSave = {
        ...fallback,
        isPanicActive: true,
        panicReason: "real redis round-trip test",
        panicTimestamp: "2026-07-30T00:00:00.000Z",
        peakNetEquity: 123.45,
        routeHealth: { "LI.FI": { consecutiveErrors: 2, cooldownUntil: 999999 } },
      }
      const ok = await saveCircuitBreakerState(toSave)
      expect(ok === true, "saveCircuitBreakerState against real Redis must report success")

      const loaded = await loadCircuitBreakerStateFresh(fallback)
      expect(loaded.isPanicActive === true, "loaded.isPanicActive must round-trip as true")
      expect(loaded.panicReason === "real redis round-trip test", "loaded.panicReason must round-trip")
      expect(loaded.peakNetEquity === 123.45, `loaded.peakNetEquity must round-trip as a number, got ${loaded.peakNetEquity} (${typeof loaded.peakNetEquity})`)
      expect(loaded.routeHealth["LI.FI"]?.consecutiveErrors === 2, "loaded.routeHealth must round-trip through JSON serialization inside the hash field")
    } finally {
      await redis.del(cbKey)
      if (backup && Object.keys(backup).length > 0) await redis.hset(cbKey, backup)
    }
  }

  // ================================================================
  // [CORRETUDE, REAL REDIS] positions: save two open positions, load them
  // back, then close one (deleteIds) and confirm HDEL actually removed it
  // — proving closed positions don't pile up as stale Hash fields forever.
  // ================================================================
  {
    const hadBefore = (await redis.hlen(posKey)) > 0
    const backup = hadBefore ? await redis.hgetall<Record<string, unknown>>(posKey) : null
    try {
      await redis.del(posKey)
      const { savePositionsState, loadPositionsState } = await import("../persistence")

      const posA = { id: "pos_test_a", networkKey: "polygon", status: "open", amountBought: 1 }
      const posB = { id: "pos_test_b", networkKey: "polygon", status: "open", amountBought: 2 }
      const saved = await savePositionsState({ pos_test_a: posA, pos_test_b: posB })
      expect(saved === true, "savePositionsState against real Redis must report success")

      const loaded = await loadPositionsState()
      expect(loaded.pos_test_a?.amountBought === 1, "loaded position A must round-trip")
      expect(loaded.pos_test_b?.amountBought === 2, "loaded position B must round-trip")

      // Now "close" pos_test_a: it leaves the open set and is explicitly deleted.
      const saved2 = await savePositionsState({ pos_test_b: posB }, ["pos_test_a"])
      expect(saved2 === true, "savePositionsState with deleteIds must report success")

      const loaded2 = await loadPositionsState()
      expect(loaded2.pos_test_a === undefined, "closed position must be actually removed from the Redis hash (HDEL), not just omitted from future writes")
      expect(loaded2.pos_test_b?.amountBought === 2, "the still-open position must remain untouched")
    } finally {
      await redis.del(posKey)
      if (backup && Object.keys(backup).length > 0) await redis.hset(posKey, backup)
    }
  }

  // ================================================================
  // [STRUCTURAL] app/api/positions/state/route.ts — POST authenticated
  // from its very first version (RI-BANK-5 Stage 2A decision 5), GET not.
  // ================================================================
  {
    const src = readFileSync(join(REPO_ROOT, "app", "api", "positions", "state", "route.ts"), "utf-8")
    expect(src.includes("isValidPositionsSyncRequest"), "positions sync route must use isValidPositionsSyncRequest")
    const getFnMatch = src.match(/export async function GET\(\)\s*\{[\s\S]*?\n\}/)
    expect(!!getFnMatch, "must find the GET function body")
    expect(!getFnMatch![0].includes("isValidPositionsSyncRequest"), "GET handler body must not call the auth check — unauthenticated by design (read-only)")
    const postFnMatch = src.match(/export async function POST\([\s\S]*?\n\}/)
    expect(!!postFnMatch, "must find the POST function body")
    expect(postFnMatch![0].includes("isValidPositionsSyncRequest"), "POST handler body must call the auth check")
  }

  console.log("ALL_RI_BANK_5_STAGE2B_KV_MIGRATION_ASSERTIONS_PASSED=YES")
}

runRiBank5Stage2bKvMigrationTests().then(() => {
  process.exit(0)
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
