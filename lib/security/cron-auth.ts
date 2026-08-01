import { timingSafeEqualStrings } from "./timing-safe-compare"

/** Shared "Authorization: Bearer <secret from envVarName>" check. No
 *  hardcoded fallback: if the named env var isn't set, every request is
 *  rejected — never silently allowed. Used by both the cron endpoint and
 *  the circuit breaker sync endpoint below, each with its own env var, so
 *  a leak/misconfiguration of one secret can't be reused against the
 *  other's endpoint. */
export function isValidBearerRequest(authHeader: string | null | undefined, envVarName: string): boolean {
  const secret = process.env[envVarName]
  if (!secret) return false
  if (!authHeader) return false
  return timingSafeEqualStrings(authHeader, `Bearer ${secret}`)
}

/** Vercel Cron (and our own GitHub Actions workflow) send
 *  `Authorization: Bearer <CRON_SECRET>`. Server-only secret — never sent
 *  to the browser. */
export function isValidCronRequest(authHeader: string | null | undefined): boolean {
  return isValidBearerRequest(authHeader, "CRON_SECRET")
}

// RI-BANK-4 Stage 2 (residual-risk fix) — POST /api/circuit-breaker/state
// used to accept any request with no authentication at all: the browser's
// own trading loop can trigger activatePanic() client-side (see
// lib/circuit-breaker.ts), and the only way for that to reach the
// server-side .data file is an HTTP call back to this app, so an
// unauthenticated write endpoint existed to receive it. That let anyone
// who found the URL POST a fake state (e.g. isPanicActive:false) and
// silently disarm the kill switch server-side.
//
// This secret is deliberately DIFFERENT from CRON_SECRET, and — unlike
// CRON_SECRET — it MUST be exposed to the browser (NEXT_PUBLIC_ prefix),
// because the caller is client-side JS running in the operator's own
// browser tab, not a server-to-server call. That makes it a materially
// weaker secret than CRON_SECRET: anyone with browser devtools access to a
// live session of this app can read it out of the bundle/network traffic.
// It is still a real improvement over the previous fully-open endpoint,
// because (a) it is a per-deployment env var, never committed to the
// repository (unlike the old ADMIN_PANIC_KEY default), and (b) it stops
// casual/automated scanning of the open internet from writing to this
// route without ever having loaded the app first. It does NOT stop a
// determined attacker who has already obtained a live page load from this
// deployment. Closing that gap fully would need a real session/auth
// system, which is out of scope for this stage.
export function isValidCircuitBreakerSyncRequest(authHeader: string | null | undefined): boolean {
  return isValidBearerRequest(authHeader, "NEXT_PUBLIC_CIRCUIT_BREAKER_SYNC_SECRET")
}

// RI-BANK-5 Stage 2B — POST /api/positions/state, same threat model and
// same NEXT_PUBLIC_ constraint as isValidCircuitBreakerSyncRequest above
// (client-side trading loop is the caller), but with its OWN dedicated env
// var per RI-BANK-5 Stage 2A decision 5 — a leaked/misconfigured secret for
// one sync route must not also open the other.
export function isValidPositionsSyncRequest(authHeader: string | null | undefined): boolean {
  return isValidBearerRequest(authHeader, "NEXT_PUBLIC_POSITIONS_SYNC_SECRET")
}
