// RI-BANK-7 Stage 1 — ri-bank-7-panic-button-fix.test.ts
//
// Tests app/api/panic/route.ts (the real route the fixed PanicButton.tsx
// now calls correctly) end-to-end: wrong key rejected, correct key
// succeeds and the resulting circuit breaker state is exactly what a
// client reading the response body (the same shape PanicButton.tsx
// consumes) would see. Runs against the real dev Redis (RI-BANK-5), not a
// mock — the real circuit-breaker key is backed up before and restored
// after, same care as every other test in this track.
//
// ADMIN_PANIC_KEY is captured as a top-level const in route.ts at import
// time, so it must be set BEFORE the route module is imported.
//
// Run directly with: npx tsx --env-file=.env.local lib/security/ri-bank-7-panic-button-fix.test.ts

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

export async function runRiBank7PanicButtonFixTests(): Promise<void> {
  const TEST_KEY = "ri-bank-7-test-admin-key-do-not-use-in-prod"
  const savedKey = process.env.ADMIN_PANIC_KEY
  process.env.ADMIN_PANIC_KEY = TEST_KEY

  const { isKvConfigured, getRedis, circuitBreakerKvKey } = await import("../kv")
  const cbKey = circuitBreakerKvKey()
  const kvHadBefore = isKvConfigured() && (await getRedis().hlen(cbKey)) > 0
  const kvBackup = kvHadBefore ? await getRedis().hgetall<Record<string, unknown>>(cbKey) : null

  try {
    if (isKvConfigured()) await getRedis().del(cbKey)

    const { GET, POST } = await import("../../app/api/panic/route")

    // ================================================================
    // [CORRETUDE] GET is unauthenticated and reflects the real state —
    // same shape the button's `refresh()` reads.
    // ================================================================
    {
      const res = await GET()
      expect(res.status === 200, `GET /api/panic must succeed, got ${res.status}`)
      const body = await res.json()
      expect(body.isPanicActive === false, "initial state must not be in panic")
    }

    // ================================================================
    // [CORRETUDE] POST with no key at all is rejected — this is exactly
    // the bug that made the old PanicButton.tsx a no-op: it sent no body,
    // which must never be treated as authorized.
    // ================================================================
    {
      const req = new Request("http://localhost/api/panic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      const res = await POST(req as any)
      expect(res.status === 401, `POST with no key must be rejected with 401, got ${res.status}`)
      const body = await res.json()
      expect(typeof body.error === "string" && body.error.length > 0, "a rejected request must carry a human-readable error the button can display")
    }

    // ================================================================
    // [CORRETUDE] POST with the WRONG key is rejected, and nothing changed.
    // ================================================================
    {
      const req = new Request("http://localhost/api/panic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "panic", key: "wrong-key-entirely", reason: "attacker" }),
      })
      const res = await POST(req as any)
      expect(res.status === 401, `POST with the wrong key must be rejected with 401, got ${res.status}`)
      const stateAfter = await (await GET()).json()
      expect(stateAfter.isPanicActive === false, "a rejected panic attempt must not have activated anything")
    }

    // ================================================================
    // [CORRETUDE, REAL REDIS] POST with the CORRECT key succeeds, and the
    // response body (what PanicButton.tsx reads into its own state)
    // reflects isPanicActive:true with the reason we sent.
    // ================================================================
    {
      const req = new Request("http://localhost/api/panic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "panic", key: TEST_KEY, reason: "teste RI-BANK-7" }),
      })
      const res = await POST(req as any)
      expect(res.status === 200, `POST with the correct key must succeed, got ${res.status}`)
      const body = await res.json()
      expect(body.success === true, "successful response must carry success:true")
      expect(body.state?.isPanicActive === true, "successful panic response must reflect isPanicActive:true")
      expect(body.state?.panicReason === "teste RI-BANK-7", "successful panic response must carry the reason sent")

      // Independent check straight from Redis (RI-BANK-5's real dev
      // database), not just trusting the route's own response.
      if (isKvConfigured()) {
        const raw = await getRedis().hgetall<Record<string, unknown>>(cbKey)
        expect(raw?.isPanicActive === true || raw?.isPanicActive === "true", `Redis itself must show isPanicActive true, got ${JSON.stringify(raw?.isPanicActive)}`)
      }
    }

    // ================================================================
    // [CORRETUDE] Now that panic is active, executeSwap's own gate
    // (lib/real-swap-executor.ts:999, confirmed in RI-BANK-6 D4) would
    // block any real trade — proven here by reading the ACTUAL current
    // fresh state the same way the cron endpoint does, not re-deriving
    // the logic.
    // ================================================================
    {
      const { getCircuitBreakerStateFresh } = await import("../circuit-breaker")
      const fresh = await getCircuitBreakerStateFresh()
      expect(fresh.isPanicActive === true, "getCircuitBreakerStateFresh (what executeSwap's underlying state ultimately reads) must show panic active after the fix")
    }

    // ================================================================
    // [CORRETUDE] POST "resume" with the correct key deactivates it again.
    // ================================================================
    {
      const req = new Request("http://localhost/api/panic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resume", key: TEST_KEY }),
      })
      const res = await POST(req as any)
      expect(res.status === 200, `POST resume with the correct key must succeed, got ${res.status}`)
      const body = await res.json()
      expect(body.state?.isPanicActive === false, "after resume, isPanicActive must be false")
    }

    // ================================================================
    // [STRUCTURAL] PanicButton.tsx sends action+key in its POST body, and
    // is now actually rendered somewhere (app/page.tsx) — the two things
    // RI-UX-1 found missing.
    // ================================================================
    {
      const { readFileSync } = await import("node:fs")
      const { join } = await import("node:path")
      const repoRoot = join(__dirname, "..", "..")
      const buttonSrc = readFileSync(join(repoRoot, "app", "components", "PanicButton.tsx"), "utf-8")
      expect(buttonSrc.includes('body: JSON.stringify({'), "PanicButton.tsx must send a JSON body")
      expect(buttonSrc.includes("action,") && buttonSrc.includes("key,"), "PanicButton.tsx's POST body must include both action and key")
      expect(buttonSrc.includes("!res.ok"), "PanicButton.tsx must check the response status before deciding anything")
      expect(!/window\.location\.reload\(\)/.test(buttonSrc), "PanicButton.tsx must no longer unconditionally reload the page")

      const pageSrc = readFileSync(join(repoRoot, "app", "page.tsx"), "utf-8")
      expect(pageSrc.includes("<PanicButton"), "app/page.tsx must render <PanicButton /> somewhere")
      expect(pageSrc.includes('import { PanicButton }'), "app/page.tsx must import PanicButton")
    }

    console.log("ALL_RI_BANK_7_PANIC_BUTTON_FIX_ASSERTIONS_PASSED=YES")
  } finally {
    if (isKvConfigured()) {
      await getRedis().del(cbKey)
      if (kvBackup && Object.keys(kvBackup).length > 0) await getRedis().hset(cbKey, kvBackup)
    }
    if (savedKey === undefined) delete process.env.ADMIN_PANIC_KEY
    else process.env.ADMIN_PANIC_KEY = savedKey
  }
}

runRiBank7PanicButtonFixTests().then(() => {
  process.exit(0)
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
