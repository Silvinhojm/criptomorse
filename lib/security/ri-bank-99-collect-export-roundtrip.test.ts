// RI-BANK-99 — ri-bank-99-collect-export-roundtrip.test.ts
//
// Regression test for the collect → export round-trip: a write made by the
// collect path (appendObservation, the same function the
// ri-bank-99-collect-observation route calls) must be read back by the
// export path (readObservations, the same function the
// ri-bank-99-export-observations route calls) using the SAME Redis
// configuration (KV_REST_API_URL/TOKEN via lib/kv.ts getRedis()).
//
// Runs against the real dev database (.env.local), isolated in the "local"
// namespace (no VERCEL_ENV when run via npx tsx), so it can never touch
// production data. Backs up and restores the key in `finally`, exactly
// like ri-bank-5-stage2b-kv-migration.test.ts.
//
// Run directly with: npx tsx lib/security/ri-bank-99-collect-export-roundtrip.test.ts

import { readFileSync } from "node:fs"
import { join } from "node:path"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const REPO_ROOT = join(__dirname, "..", "..")

export async function runRiBank99CollectExportRoundtripTests(): Promise<void> {
  const { isKvConfigured, getRedis, kvEnvNamespace } = await import("../kv")
  const { appendObservation, readObservations, riBank99ObservationsKvKey } = await import("../ri-bank-99-collector")

  // [CONFIG SHARED] both routes must resolve Redis through the same
  // configuration gate — this is the "divergência de variáveis" regression
  // guard: if export ever starts reading a different env var (e.g. a raw
  // REDIS_URL or a different key name), these assertions break.
  expect(isKvConfigured(), "KV_REST_API_URL/TOKEN must be present in .env.local (same pre-requisite both routes check)")
  expect(kvEnvNamespace() === "local", `expected 'local' namespace when VERCEL_ENV isn't set (npx tsx outside Vercel), got '${kvEnvNamespace()}'`)

  const redis = getRedis()
  const key = riBank99ObservationsKvKey()

  // [STRUCTURAL] the two routes must import the SAME collector module —
  // that's what guarantees the same Redis connection + same KV key name.
  for (const rel of [
    "app/api/internal/ri-bank-99-collect-observation/route.ts",
    "app/api/internal/ri-bank-99-export-observations/route.ts",
  ]) {
    const src = readFileSync(join(REPO_ROOT, rel), "utf-8")
    expect(src.includes('from "@/lib/ri-bank-99-collector"'), `${rel} must import from @/lib/ri-bank-99-collector`)
    expect(src.includes("getRedis("), `${rel} must use getRedis() (same connection as the other route)`)
  }

  // [ROUND-TRIP, REAL REDIS] a write via the collect path is read back by
  // the export path, same config. Uses the "local" namespace — production
  // data is never touched.
  const hadBefore = (await redis.llen(key)) > 0
  const backup = hadBefore ? await redis.lrange(key, 0, -1) : null
  try {
    await redis.del(key)

    const obs = {
      ts: "2026-08-07T21:00:00.000Z",
      idx: 0,
      pool: { reserveUsdc: 100, reserveEurc: 75, poolEurFor7Usdc: 5, poolPriceUsdcPerEur: 1.3 },
      lifi: { ok: true, status: 200, tool: "fly", lifiEurFor7Usdc: 5.2, lifiPriceUsdPerEur: 1.15 },
      fx: { usdPerEur: 1.15 },
      poolFxGapPct: 13.04,
      lifiFxGapPct: 0,
    }
    const len = await appendObservation(redis, obs)
    expect(len === 1, `after one appendObservation the list must have length 1, got ${len}`)

    const read = await readObservations(redis)
    expect(read.length === 1, `readObservations must return exactly 1 entry, got ${read.length}`)
    expect(read[0].ts === obs.ts, `read[0].ts must round-trip (${obs.ts}), got ${read[0].ts}`)
    expect(read[0].pool.poolPriceUsdcPerEur === 1.3, "read[0].pool.poolPriceUsdcPerEur must round-trip")
    expect(read[0].lifi.lifiEurFor7Usdc === 5.2, "read[0].lifi.lifiEurFor7Usdc must round-trip")
    expect(read[0].fx.usdPerEur === 1.15, "read[0].fx.usdPerEur must round-trip")
  } finally {
    await redis.del(key)
    if (backup && backup.length > 0) await redis.rpush(key, ...backup)
  }

  console.log("ALL_RI_BANK_99_COLLECT_EXPORT_ROUNDTRIP_ASSERTIONS_PASSED=YES")
}

runRiBank99CollectExportRoundtripTests().then(() => {
  process.exit(0)
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
