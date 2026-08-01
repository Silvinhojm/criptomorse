// RI-BANK-4 Stage 2 — ri-bank-4-stage2-security.test.ts
//
// Covers the 3 things required of this stage's tests:
//   1. the cron endpoint's auth logic rejects requests with no/wrong secret
//      (and rejects everything when CRON_SECRET isn't configured at all —
//      no hardcoded fallback);
//   2. the circuit breaker gate blocks when panic is active, read fresh
//      from disk (not a stale in-memory copy);
//   3. zero real transaction: proven structurally by reading
//      app/api/cron/trigger/route.ts's own source and asserting it imports
//      none of the real trading modules. A behavioral test cannot prove a
//      negative like "never calls a real swap" for a function that isn't
//      wired to any trading path in the first place — this stage's
//      endpoint has no trading call at all (see its own top-of-file
//      comment), so the structural check is the correct proof, same
//      approach as lib/pregao-wiring-structural.test.ts already uses in
//      this repo for a similar "call graph fact" claim.
//
// Run directly with: npx tsx lib/security/ri-bank-4-stage2-security.test.ts

import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { isValidCronRequest, isValidCircuitBreakerSyncRequest } from "./cron-auth"
import { timingSafeEqualStrings } from "./timing-safe-compare"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const REPO_ROOT = join(__dirname, "..", "..")
const CB_FILE = join(REPO_ROOT, ".data", "circuit-breaker-state.json")

export async function runRiBank4Stage2SecurityTests(): Promise<void> {
  // ================================================================
  // [CORRETUDE] timingSafeEqualStrings
  // ================================================================
  {
    expect(timingSafeEqualStrings("abc", "abc") === true, "identical strings must compare equal")
    expect(timingSafeEqualStrings("abc", "abd") === false, "different strings of same length must not compare equal")
    expect(timingSafeEqualStrings("abc", "abcd") === false, "different-length strings must not compare equal (and must not throw)")
    expect(timingSafeEqualStrings("", "") === true, "two empty strings must compare equal")
  }

  // ================================================================
  // [CORRETUDE] isValidCronRequest — no CRON_SECRET configured
  // ================================================================
  {
    const saved = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    try {
      expect(isValidCronRequest("Bearer anything") === false, "with no CRON_SECRET set, every request must be rejected, even a well-formed header")
      expect(isValidCronRequest(null) === false, "with no CRON_SECRET set, a null header must be rejected")
      expect(isValidCronRequest("") === false, "with no CRON_SECRET set, an empty header must be rejected")
    } finally {
      if (saved === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = saved
    }
  }

  // ================================================================
  // [CORRETUDE] isValidCronRequest — CRON_SECRET configured
  // ================================================================
  {
    const saved = process.env.CRON_SECRET
    process.env.CRON_SECRET = "test-secret-value-123"
    try {
      expect(isValidCronRequest(null) === false, "missing Authorization header must be rejected")
      expect(isValidCronRequest("") === false, "empty Authorization header must be rejected")
      expect(isValidCronRequest("Bearer wrong-secret") === false, "wrong secret must be rejected")
      expect(isValidCronRequest("test-secret-value-123") === false, "header missing the 'Bearer ' prefix must be rejected")
      expect(isValidCronRequest("Bearer test-secret-value-123") === true, "correct 'Bearer <secret>' header must be accepted")
    } finally {
      if (saved === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = saved
    }
  }

  // ================================================================
  // [CORRETUDE] isValidCircuitBreakerSyncRequest — residual-risk fix:
  // POST /api/circuit-breaker/state used to accept any request, letting
  // anyone who found the URL disarm the panic flag server-side. Same
  // no-fallback / timing-safe shape as isValidCronRequest, but reads a
  // separate env var so the two endpoints' secrets are independent.
  // ================================================================
  {
    const saved = process.env.NEXT_PUBLIC_CIRCUIT_BREAKER_SYNC_SECRET
    delete process.env.NEXT_PUBLIC_CIRCUIT_BREAKER_SYNC_SECRET
    try {
      expect(isValidCircuitBreakerSyncRequest("Bearer anything") === false, "with no NEXT_PUBLIC_CIRCUIT_BREAKER_SYNC_SECRET set, every request must be rejected, even a well-formed header")
      expect(isValidCircuitBreakerSyncRequest(null) === false, "with no secret configured, a null header must be rejected")
    } finally {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_CIRCUIT_BREAKER_SYNC_SECRET
      else process.env.NEXT_PUBLIC_CIRCUIT_BREAKER_SYNC_SECRET = saved
    }

    const saved2 = process.env.NEXT_PUBLIC_CIRCUIT_BREAKER_SYNC_SECRET
    process.env.NEXT_PUBLIC_CIRCUIT_BREAKER_SYNC_SECRET = "sync-secret-test-456"
    try {
      expect(isValidCircuitBreakerSyncRequest(null) === false, "missing Authorization header must be rejected")
      expect(isValidCircuitBreakerSyncRequest("Bearer wrong-secret") === false, "wrong secret must be rejected")
      expect(isValidCircuitBreakerSyncRequest("sync-secret-test-456") === false, "header missing the 'Bearer ' prefix must be rejected")
      expect(isValidCircuitBreakerSyncRequest("Bearer sync-secret-test-456") === true, "correct 'Bearer <secret>' header must be accepted")
      // Confirms the two endpoints' secrets are independent env vars — a
      // CRON_SECRET value must not also work here.
      expect(isValidCircuitBreakerSyncRequest("Bearer test-secret-value-123") === false, "the cron endpoint's secret value must not double as a valid circuit-breaker-sync secret")
    } finally {
      if (saved2 === undefined) delete process.env.NEXT_PUBLIC_CIRCUIT_BREAKER_SYNC_SECRET
      else process.env.NEXT_PUBLIC_CIRCUIT_BREAKER_SYNC_SECRET = saved2
    }
  }

  // ================================================================
  // [CORRETUDE] circuit breaker state persists to the .data/ fs FALLBACK
  // and is readable back fresh — proves the RI-BANK-4 D6 gap (server-side
  // process blind to panic set elsewhere) stays closed for the
  // disk-persistence fallback path specifically (used when Upstash isn't
  // configured — RI-BANK-5 Stage 2A D3). The real Redis path (the primary
  // path now that Upstash is provisioned) is covered separately in
  // lib/security/ri-bank-5-stage2b-kv-migration.test.ts, against the real
  // dev database, not this fs-only test. KV_REST_API_URL/TOKEN are
  // deliberately unset for the duration of this block so isKvConfigured()
  // is false and the fallback path actually runs, regardless of whether
  // this machine has Upstash env vars configured.
  // ================================================================
  {
    const hadFileBefore = existsSync(CB_FILE)
    const backup = hadFileBefore ? readFileSync(CB_FILE, "utf-8") : null
    const savedUrl = process.env.KV_REST_API_URL
    const savedToken = process.env.KV_REST_API_TOKEN
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    try {
      // Force a clean, known starting point.
      if (existsSync(CB_FILE)) rmSync(CB_FILE)

      const { saveCircuitBreakerState, loadCircuitBreakerStateFresh } = await import("../persistence")
      const fallbackState = {
        isPanicActive: false, panicReason: null, panicTimestamp: null,
        consecutiveLosses: 0, maxLossesBeforePanic: 5, totalLoss: 0, totalProfit: 0,
        maxDrawdownPercent: 10, isTestnet: false, peakNetEquity: 0, routeHealth: {},
      }

      const before = await loadCircuitBreakerStateFresh(fallbackState)
      expect(before.isPanicActive === false, "with no file on disk, load must return the fallback (isPanicActive:false)")

      const testState = { ...fallbackState, isPanicActive: true, panicReason: "test drawdown", panicTimestamp: "2026-07-29T00:00:00.000Z" }
      const saved = await saveCircuitBreakerState(testState as any)
      expect(saved === true, "saveCircuitBreakerState must report success when writing to the fs fallback")
      expect(existsSync(CB_FILE), "saveCircuitBreakerState must have written .data/circuit-breaker-state.json server-side")

      const after = await loadCircuitBreakerStateFresh(fallbackState)
      expect(after.isPanicActive === true, "a fresh load after save must see isPanicActive:true — this is the exact cross-process visibility the D6 gap was missing")
      expect(after.panicReason === "test drawdown", "loaded state must round-trip the panic reason")
    } finally {
      if (savedUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = savedUrl
      if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = savedToken
      if (backup !== null) writeFileSync(CB_FILE, backup, "utf-8")
      else if (existsSync(CB_FILE)) rmSync(CB_FILE)
    }
  }

  // ================================================================
  // [STRUCTURAL] app/api/cron/trigger/route.ts calls zero real trading
  // functions — proves "zero real transaction" the same way
  // pregao-wiring-structural.test.ts proves call-graph facts: by reading
  // the actual source, not by mocking and hoping nothing slips through.
  // ================================================================
  {
    const routeSrc = readFileSync(join(REPO_ROOT, "app", "api", "cron", "trigger", "route.ts"), "utf-8")
    const forbidden = [
      "executarCicloAgentes(", "executarCicloPregueiros(", "executarPacotes(",
      "runCycle(", "retryPendingProofs(", "realSwap.", "corretor.executar(",
      "frameworkCoordinator.", "submitProposal(",
    ]
    // Only look at real code, not this file's own explanatory comment that
    // (by necessity) names these same symbols — strip // and /* */ comments
    // before checking, same distinction the existing structural test
    // (pregao-wiring-structural.test.ts) makes via its own filtering.
    const codeOnly = routeSrc
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
    for (const symbol of forbidden) {
      expect(!codeOnly.includes(symbol), `app/api/cron/trigger/route.ts must not call '${symbol}' — this stage's endpoint has no real trading call wired in yet (Camada 2 is a pending decision, not part of this stage)`)
    }
    expect(routeSrc.includes("isValidCronRequest"), "route must gate on isValidCronRequest")
    expect(routeSrc.includes("getCircuitBreakerStateFresh"), "route must check the fresh (disk-read) circuit breaker state, not a possibly-stale in-memory copy")
  }

  // ================================================================
  // [CORRETUDE] app/api/panic/route.ts no longer has a hardcoded fallback
  // secret — structural check on the actual source, since the whole point
  // of the bug was "the value is visible to anyone reading this file".
  // ================================================================
  {
    const panicSrc = readFileSync(join(REPO_ROOT, "app", "api", "panic", "route.ts"), "utf-8")
    const panicCodeOnly = panicSrc
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
    expect(!panicCodeOnly.includes("arcflow-master-key-2024"), "the hardcoded default panic key must be fully removed from executable code (a comment documenting the old bug for context is fine, a live fallback value is not)")
    expect(!/ADMIN_PANIC_KEY\s*=\s*process\.env\.ADMIN_PANIC_KEY\s*\|\|/.test(panicCodeOnly), "ADMIN_PANIC_KEY must not have any '|| <default>' fallback expression")
    expect(panicCodeOnly.includes("timingSafeEqualStrings"), "panic route must use the timing-safe comparison, per RI-BANK-4 D5")
  }

  // ================================================================
  // [CORRETUDE] app/api/circuit-breaker/state/route.ts, real handlers: GET
  // works with zero authentication; POST is rejected with no header and
  // with the wrong secret (and nothing is persisted in either rejected
  // case); POST with the correct secret succeeds and actually persists.
  // Calls the real exported GET/POST functions with real Request objects
  // — not a mock of the auth check.
  // ================================================================
  {
    // RI-BANK-5 Stage 2B — this environment has KV_REST_API_URL/TOKEN
    // configured (.env.local), so the route's real persistence backend is
    // now Redis, not the .data/ fs fallback this block originally checked
    // for. Rather than assume which backend is active, this now verifies
    // persistence via the route's OWN response body
    // (getCircuitBreakerStateFresh(), returned by both GET and POST) —
    // correct regardless of whether Redis or fs is backing it. The real
    // Redis key is still backed up/restored, same care as
    // ri-bank-5-stage2b-kv-migration.test.ts.
    const hadFileBefore = existsSync(CB_FILE)
    const fileBackup = hadFileBefore ? readFileSync(CB_FILE, "utf-8") : null
    const { isKvConfigured, getRedis, circuitBreakerKvKey } = await import("../kv")
    const kvKey = circuitBreakerKvKey()
    const kvHadBefore = isKvConfigured() && (await getRedis().hlen(kvKey)) > 0
    const kvBackup = kvHadBefore ? await getRedis().hgetall<Record<string, unknown>>(kvKey) : null
    const savedSecret = process.env.NEXT_PUBLIC_CIRCUIT_BREAKER_SYNC_SECRET
    process.env.NEXT_PUBLIC_CIRCUIT_BREAKER_SYNC_SECRET = "sync-secret-test-456"
    try {
      if (existsSync(CB_FILE)) rmSync(CB_FILE)
      if (isKvConfigured()) await getRedis().del(kvKey)
      const { GET, POST } = await import("../../app/api/circuit-breaker/state/route")

      const getRes = await GET()
      expect(getRes.status === 200, `GET must succeed with zero authentication, got status ${getRes.status}`)

      const noAuthReq = new Request("http://localhost/api/circuit-breaker/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isPanicActive: true, panicReason: "attacker-forged-no-header" }),
      })
      const noAuthRes = await POST(noAuthReq)
      expect(noAuthRes.status === 401, `POST with no Authorization header must be rejected with 401, got ${noAuthRes.status}`)
      const afterRejected1 = await (await GET()).json()
      expect(afterRejected1.isPanicActive !== true, "a POST rejected for missing auth must not have persisted anything")

      const wrongAuthReq = new Request("http://localhost/api/circuit-breaker/state", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer wrong-secret" },
        body: JSON.stringify({ isPanicActive: true, panicReason: "attacker-forged-wrong-secret" }),
      })
      const wrongAuthRes = await POST(wrongAuthReq)
      expect(wrongAuthRes.status === 401, `POST with the wrong secret must be rejected with 401, got ${wrongAuthRes.status}`)
      const afterRejected2 = await (await GET()).json()
      expect(afterRejected2.isPanicActive !== true, "a POST rejected for wrong secret must not have persisted anything")

      const okReq = new Request("http://localhost/api/circuit-breaker/state", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer sync-secret-test-456" },
        body: JSON.stringify({ isPanicActive: true, panicReason: "legit-test-panic" }),
      })
      const okRes = await POST(okReq)
      expect(okRes.status === 200, `POST with the correct secret must succeed, got ${okRes.status}`)
      const persisted = await okRes.json()
      expect(persisted.isPanicActive === true, "the authenticated POST's own payload must be what got persisted")
      expect(persisted.panicReason === "legit-test-panic", "the authenticated POST's own payload must be what got persisted")
    } finally {
      if (savedSecret === undefined) delete process.env.NEXT_PUBLIC_CIRCUIT_BREAKER_SYNC_SECRET
      else process.env.NEXT_PUBLIC_CIRCUIT_BREAKER_SYNC_SECRET = savedSecret
      if (fileBackup !== null) writeFileSync(CB_FILE, fileBackup, "utf-8")
      else if (existsSync(CB_FILE)) rmSync(CB_FILE)
      if (isKvConfigured()) {
        await getRedis().del(kvKey)
        if (kvBackup && Object.keys(kvBackup).length > 0) await getRedis().hset(kvKey, kvBackup)
      }
    }
  }

  // ================================================================
  // [STRUCTURAL] the sync route's GET handler body must not call the auth
  // check — confirms "GET stays unauthenticated" as a source-level fact,
  // not just today's test behavior.
  // ================================================================
  {
    const syncRouteSrc = readFileSync(join(REPO_ROOT, "app", "api", "circuit-breaker", "state", "route.ts"), "utf-8")
    expect(syncRouteSrc.includes("isValidCircuitBreakerSyncRequest"), "sync route must use isValidCircuitBreakerSyncRequest somewhere (on POST)")
    const getFnMatch = syncRouteSrc.match(/export async function GET\(\)\s*\{[\s\S]*?\n\}/)
    expect(!!getFnMatch, "must find the GET function body in the sync route source")
    expect(!getFnMatch![0].includes("isValidCircuitBreakerSyncRequest"), "GET handler body must not call the auth check — it must remain unauthenticated by design")
  }

  console.log("ALL_RI_BANK_4_STAGE2_SECURITY_ASSERTIONS_PASSED=YES")
}

runRiBank4Stage2SecurityTests().then(() => {
  process.exit(0)
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
