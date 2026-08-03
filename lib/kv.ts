import { Redis } from "@upstash/redis"

// RI-BANK-5 Stage 2B — shared Upstash Redis client + key namespace helpers.
// `Redis.fromEnv()` reads UPSTASH_REDIS_REST_URL/TOKEN, falling back to
// KV_REST_API_URL/KV_REST_API_TOKEN (confirmed by reading the published
// @upstash/redis source during RI-BANK-5 Stage 2A) — exactly the names the
// Vercel×Upstash Marketplace integration injects, so no extra env var
// mapping is needed. `fromEnv()` itself does not throw when the vars are
// missing (it only console.warns and returns a client with undefined
// url/token) — isKvConfigured() below is the real check callers must use.
let client: Redis | null = null

export function isKvConfigured(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}

export function getRedis(): Redis {
  // Default automaticDeserialization (true) is what correctly turns
  // HGETALL's raw flat [field, value, field, value, ...] wire reply into a
  // keyed object — confirmed by direct probing (RI-BANK-5 Stage 2B) that
  // disabling it changes hgetall's return shape entirely (a flat array,
  // not a Record). The tradeoff: with it on, individual hash field values
  // get inconsistently auto-converted per-value (e.g. "0" -> number 0,
  // "true" -> boolean true, a JSON-object string -> a parsed object, but
  // some decimal strings like "3.75" are left as strings) — so
  // parseCbHash() in lib/persistence.ts is written defensively to accept
  // either the raw string or the already-converted type for every field,
  // rather than assuming one or the other.
  if (!client) client = Redis.fromEnv()
  return client
}

// RI-BANK-5 Stage 2A D2 — the Upstash resource is connected to all 3 Vercel
// environments (production/preview/development), so they share one
// physical database. VERCEL_ENV (injected by Vercel; undefined when
// running outside Vercel, e.g. `npx tsx` locally) namespaces every key so
// local/test runs can never read or clobber production state.
export function kvEnvNamespace(): string {
  return process.env.VERCEL_ENV || "local"
}

export function circuitBreakerKvKey(): string {
  return `arcflow:${kvEnvNamespace()}:circuit-breaker:state`
}

export function positionsKvKey(): string {
  return `arcflow:${kvEnvNamespace()}:positions:open`
}

// RI-BANK-11 Trilha B — orçamento de trading por janela de tempo,
// server-side (Redis), para que um cron (sem localStorage de navegador)
// consiga ler/checar o mesmo estado que a UI.
export function tradingBudgetKvKey(): string {
  return `arcflow:${kvEnvNamespace()}:trading-budget:state`
}

// RI-BANK-13 — modelo de duas caixas de risco (Caixa A/Principal, Caixa
// B/Lucro Reinvestido). O valor legado em JSON é migrado atomicamente para
// Hash; deltas e configurações passam pelo script Lua de risk-boxes-redis.ts.
export function riskBoxesKvKey(): string {
  return `arcflow:${kvEnvNamespace()}:risk-boxes:state`
}
