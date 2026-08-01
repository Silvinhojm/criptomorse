import type { CircuitBreakerState } from "./circuit-breaker"

const TRADE_HISTORY_KEY = "arcflow_trade_history";
const TRADER_STATE_KEY = "arcflow_trader_state";
const CIRCUIT_BREAKER_KEY = "arcflow_circuit_breaker";
// Same localStorage key position-manager.ts already used directly before
// this migration — kept identical so existing browser localStorage data
// isn't silently orphaned under a new key name.
const POSITIONS_KEY = "arcflow_open_positions";

// RI-BANK-5 Stage 2B — circuit breaker + positions are now persisted to
// Upstash Redis server-side (RI-BANK-5 Stage 1 found the previous `.data/`
// fs approach unlikely to survive Vercel's real serverless filesystem
// restrictions outside `/tmp`). The `.data/` fs helpers below are now a
// FALLBACK, used only when the Upstash env vars aren't configured
// (RI-BANK-5 Stage 2A D3) — e.g. a contributor's local clone without
// `.env.local` pulled, or the test suite run offline. Every fallback use is
// logged loudly (console.warn), never silent, per Stage 2A D5.
function circuitBreakerFilePath(): string {
  // require() instead of a static import keeps this file importable from
  // browser bundles that never call these fs-only branches.
  const path = require("path") as typeof import("path")
  return path.join(process.cwd(), ".data", "circuit-breaker-state.json")
}

function positionsFilePath(): string {
  const path = require("path") as typeof import("path")
  return path.join(process.cwd(), ".data", "positions-state.json")
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    const fs = require("fs") as typeof import("fs")
    if (!fs.existsSync(filePath)) return fallback
    const raw = fs.readFileSync(filePath, "utf-8")
    return raw ? JSON.parse(raw) : fallback
  } catch (e) {
    console.error(`[persistence] fs read failed for ${filePath}:`, (e as Error).message)
    return fallback
  }
}

function writeJsonFile(filePath: string, value: any): boolean {
  try {
    const fs = require("fs") as typeof import("fs")
    const path = require("path") as typeof import("path")
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8")
    return true
  } catch (e) {
    console.error(`[persistence] fs write failed for ${filePath}:`, (e as Error).message)
    return false
  }
}

// ─── Upstash Redis — circuit breaker ──────────────────────────────────────
//
// Field ownership rule (RI-BANK-5 Stage 2B), to avoid two different write
// paths clobbering each other's updates to the same Redis hash:
//   - "delta" fields (consecutiveLosses, totalLoss, totalProfit) are ONLY
//     ever written via cbCounterOp() below (HINCRBY/HINCRBYFLOAT for
//     increments, or an explicit absolute HSET for the reset case) — never
//     as part of the wholesale saveCircuitBreakerState() write.
//   - every other field (isPanicActive, panicReason, panicTimestamp,
//     maxLossesBeforePanic, maxDrawdownPercent, isTestnet, peakNetEquity,
//     routeHealth) is written wholesale by saveCircuitBreakerState().
// This is what makes the Hash+HINCRBY design actually atomic for the
// counters that decide whether panic triggers, instead of just moving the
// same "read whole object, modify, write whole object back" race from a
// file to a Redis key.
const CB_DELTA_FIELDS = ["consecutiveLosses", "totalLoss", "totalProfit"] as const
type CbDeltaField = (typeof CB_DELTA_FIELDS)[number]
const CB_ABSOLUTE_FIELDS = [
  "isPanicActive", "panicReason", "panicTimestamp", "maxLossesBeforePanic",
  "maxDrawdownPercent", "isTestnet", "peakNetEquity", "routeHealth",
] as const

function serializeAbsoluteCbFields(state: CircuitBreakerState): Record<string, string> {
  return {
    isPanicActive: String(state.isPanicActive),
    panicReason: state.panicReason ?? "",
    panicTimestamp: state.panicTimestamp ?? "",
    maxLossesBeforePanic: String(state.maxLossesBeforePanic),
    maxDrawdownPercent: String(state.maxDrawdownPercent),
    isTestnet: String(state.isTestnet),
    peakNetEquity: String(state.peakNetEquity),
    routeHealth: JSON.stringify(state.routeHealth ?? {}),
  }
}

// `hash` values can arrive as plain strings OR already-converted
// number/boolean/object — @upstash/redis's automatic (de)serialization
// inconsistently auto-converts individual hash field values (confirmed by
// direct probing during RI-BANK-5 Stage 2B: "0" -> number 0, "true" ->
// boolean true, a JSON-object string -> a parsed object, while some
// decimal strings are left as-is) — every helper below accepts either
// form rather than assuming one.
function parseCbHash(hash: Record<string, unknown> | null, fallback: CircuitBreakerState): CircuitBreakerState {
  if (!hash || Object.keys(hash).length === 0) return fallback
  const num = (v: unknown, d: number) => (v === undefined || v === "" ? d : Number(v as any))
  const bool = (v: unknown, d: boolean) => (v === undefined ? d : v === true || v === "true")
  const str = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v))
  let routeHealth = fallback.routeHealth
  try {
    if (hash.routeHealth) routeHealth = typeof hash.routeHealth === "string" ? JSON.parse(hash.routeHealth) : (hash.routeHealth as any)
  } catch { /* keep fallback.routeHealth if corrupted */ }
  return {
    isPanicActive: bool(hash.isPanicActive, fallback.isPanicActive),
    panicReason: str(hash.panicReason),
    panicTimestamp: str(hash.panicTimestamp),
    consecutiveLosses: num(hash.consecutiveLosses, fallback.consecutiveLosses),
    maxLossesBeforePanic: num(hash.maxLossesBeforePanic, fallback.maxLossesBeforePanic),
    totalLoss: num(hash.totalLoss, fallback.totalLoss),
    totalProfit: num(hash.totalProfit, fallback.totalProfit),
    maxDrawdownPercent: num(hash.maxDrawdownPercent, fallback.maxDrawdownPercent),
    isTestnet: bool(hash.isTestnet, fallback.isTestnet),
    peakNetEquity: num(hash.peakNetEquity, fallback.peakNetEquity),
    routeHealth,
  }
}

// Atomically applies a delta (increment) to one or more of the 3
// counter fields, or (mode:"set") absolutely resets them — used by
// activatePanic (partial reset)/resumeFromPanic/resetCircuitBreaker (full
// reset). Returns the Redis-authoritative resulting values so the caller
// can reconcile its in-memory copy with what every other instance will
// see, not just this process's local guess. Returns null (never throws)
// when KV isn't configured or the write fails — callers fall back to
// computing the value locally themselves, same as before this migration,
// and the failure is always logged first.
export async function cbCounterOp(
  mode: "incr" | "set",
  values: Partial<Record<CbDeltaField, number>>,
): Promise<Partial<Record<CbDeltaField, number>> | null> {
  if (typeof window !== "undefined") return null // never called client-side
  const { isKvConfigured, getRedis, circuitBreakerKvKey } = await import("./kv")
  if (!isKvConfigured()) return null // caller uses its fs/local fallback path instead
  try {
    const redis = getRedis()
    const key = circuitBreakerKvKey()
    const result: Partial<Record<CbDeltaField, number>> = {}
    for (const field of Object.keys(values) as CbDeltaField[]) {
      const delta = values[field]
      if (delta === undefined) continue
      if (mode === "set") {
        await redis.hset(key, { [field]: String(delta) })
        result[field] = delta
      } else if (field === "consecutiveLosses") {
        result[field] = await redis.hincrby(key, field, delta)
      } else {
        result[field] = await redis.hincrbyfloat(key, field, delta)
      }
    }
    return result
  } catch (e) {
    console.error(`[circuit-breaker] Redis counter op ("${mode}") failed:`, (e as Error).message)
    return null
  }
}

async function apiCall(url: string, method: string, body?: any, extraHeaders?: Record<string, string>): Promise<any> {
  try {
    const opts: RequestInit = { method, headers: { "Content-Type": "application/json", ...extraHeaders } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`API ${res.status}`);
    return await res.json();
  } catch { return null; }
}

function getLocal<T>(key: string, fallback: T): T {
  try {
    if (typeof window === "undefined") return fallback
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch { return fallback; }
}

function setLocal(key: string, value: any): void {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore */ }
}

function isRealTrade(record: any): boolean {
  return record.txHash && typeof record.txHash === "string" && record.txHash.startsWith("0x")
}

export async function saveTradeHistory(history: any[]): Promise<void> {
  const merged = [...getLocal<any[]>(TRADE_HISTORY_KEY, []), ...history];
  const unique = merged.filter(
    (item, idx, self) => idx === self.findIndex(t => t.id === item.id)
  ).slice(-500);
  // Só persiste trades com txHash real (0x...) — descarta simulações testnet
  const realOnly = unique.filter(isRealTrade)
  setLocal(TRADE_HISTORY_KEY, realOnly);
  for (const record of history) {
    if (isRealTrade(record)) await apiCall("/api/trades", "POST", record);
  }
}

export async function loadTradeHistory(): Promise<any[]> {
  const local = getLocal<any[]>(TRADE_HISTORY_KEY, []).filter(isRealTrade);
  const server = await apiCall("/api/trades", "GET");
  if (!server || !Array.isArray(server) || server.length === 0) return local;
  const merged = [...server.filter(isRealTrade), ...local];
  const unique = merged.filter(
    (item, idx, self) => idx === self.findIndex(t => t.id === item.id || t.txHash === item.txHash)
  );
  setLocal(TRADE_HISTORY_KEY, unique.slice(-500));
  return unique;
}

export async function saveTraderState(state: { totalProfit: number; lastAction: string }): Promise<void> {
  setLocal(TRADER_STATE_KEY, state);
  await apiCall("/api/state", "POST", state);
}

export async function loadTraderState(): Promise<{ totalProfit: number; lastAction: string } | null> {
  const local = getLocal<{ totalProfit: number; lastAction: string } | null>(TRADER_STATE_KEY, null);
  const server = await apiCall("/api/state", "GET");
  if (server) {
    setLocal(TRADER_STATE_KEY, server);
    return server;
  }
  return local;
}

export function clearPersistence(): void {
  try {
    localStorage.removeItem(TRADE_HISTORY_KEY);
    localStorage.removeItem(TRADER_STATE_KEY);
    localStorage.removeItem(CIRCUIT_BREAKER_KEY);
  } catch { /* ignore */ }
}

// Writes the ABSOLUTE (non-delta) fields of the circuit breaker state.
// Never touches consecutiveLosses/totalLoss/totalProfit — those are owned
// exclusively by cbCounterOp() (see the field-ownership rule above this
// file). Returns false (never throws) on failure, always logged loudly
// first — RI-BANK-5 Stage 2A D5 ("never swallow a write failure silently").
export async function saveCircuitBreakerState(state: CircuitBreakerState): Promise<boolean> {
  if (typeof window === "undefined") {
    const { isKvConfigured, getRedis, circuitBreakerKvKey } = await import("./kv")
    if (isKvConfigured()) {
      try {
        await getRedis().hset(circuitBreakerKvKey(), serializeAbsoluteCbFields(state))
        return true
      } catch (e) {
        console.error("[circuit-breaker] Redis write failed (saveCircuitBreakerState):", (e as Error).message)
        return false
      }
    }
    console.warn("[circuit-breaker] Upstash não configurado (KV_REST_API_URL/TOKEN ausentes) — usando fallback de disco .data/. NÃO confiável como persistência cross-instance em produção real (ver RI-BANK-5 Estágio 1).")
    return writeJsonFile(circuitBreakerFilePath(), state)
  }
  // Browser call (dashboard, automatic panic from a trade loss, etc.):
  // keep localStorage for same-tab reads, and best-effort mirror to the
  // server via the sync route so a server-side check (the cron endpoint)
  // isn't blind to a panic triggered entirely client-side.
  setLocal(CIRCUIT_BREAKER_KEY, state);
  // POST is authenticated (RI-BANK-4 Stage 2 residual-risk fix) — see
  // lib/security/cron-auth.ts's isValidCircuitBreakerSyncRequest for why
  // this secret must be NEXT_PUBLIC_ (readable by this client code) and
  // therefore weaker than CRON_SECRET. If the env var isn't configured,
  // this header is simply absent and the server rejects the sync (fails
  // closed, same as the rest of this best-effort mirror already did on any
  // other failure).
  const syncSecret = (typeof process !== "undefined" ? (process.env as any).NEXT_PUBLIC_CIRCUIT_BREAKER_SYNC_SECRET : undefined) as string | undefined;
  const res = await apiCall(
    "/api/circuit-breaker/state",
    "POST",
    state,
    syncSecret ? { Authorization: `Bearer ${syncSecret}` } : undefined,
  );
  if (res === null) console.warn("[circuit-breaker] client->server sync POST failed or was rejected (best-effort mirror, see lib/persistence.ts saveCircuitBreakerState)")
  return res !== null;
}

// SYNC — used only for the client-side module-level initial value in
// lib/circuit-breaker.ts. Server-side, Redis reads are always async, so
// this simply returns the fallback there; getCircuitBreakerStateFresh()
// (async) is what actually populates the real value from Redis/fs.
export function loadCircuitBreakerStateInitial<T>(fallback: T): T {
  if (typeof window === "undefined") return fallback
  return getLocal(CIRCUIT_BREAKER_KEY, fallback);
}

// ASYNC — the real cross-instance-fresh read, from Redis (or the fs
// fallback when Upstash isn't configured). Used by
// getCircuitBreakerStateFresh(), which is what the cron endpoint and any
// other code needing a guaranteed-current answer must call.
export async function loadCircuitBreakerStateFresh(fallback: CircuitBreakerState): Promise<CircuitBreakerState> {
  const { isKvConfigured, getRedis, circuitBreakerKvKey } = await import("./kv")
  if (isKvConfigured()) {
    try {
      const hash = await getRedis().hgetall<Record<string, unknown>>(circuitBreakerKvKey())
      return parseCbHash(hash, fallback)
    } catch (e) {
      console.error("[circuit-breaker] Redis read failed (loadCircuitBreakerStateFresh):", (e as Error).message)
      return fallback
    }
  }
  console.warn("[circuit-breaker] Upstash não configurado — lendo fallback de disco .data/ (loadCircuitBreakerStateFresh)")
  return readJsonFile(circuitBreakerFilePath(), fallback)
}

// ─── Upstash Redis — posições abertas (Hash: field = position.id) ────────

// `deleteIds` — positions that are no longer open (closed/stopped) and
// must be removed from the Redis Hash, not just left out of `positions`.
// Without this, closed positions would silently pile up as stale fields
// in the Hash forever (HSET only adds/overwrites fields, it never removes
// ones you stop sending).
export async function savePositionsState(positions: Record<string, any>, deleteIds: string[] = []): Promise<boolean> {
  if (typeof window === "undefined") {
    const { isKvConfigured, getRedis, positionsKvKey } = await import("./kv")
    if (isKvConfigured()) {
      try {
        const key = positionsKvKey()
        const redis = getRedis()
        const entries = Object.entries(positions)
        if (entries.length > 0) {
          await redis.hset(key, Object.fromEntries(entries.map(([id, pos]) => [id, JSON.stringify(pos)])))
        }
        if (deleteIds.length > 0) {
          await redis.hdel(key, ...deleteIds)
        }
        return true
      } catch (e) {
        console.error("[position-manager] Redis write failed (savePositionsState):", (e as Error).message)
        return false
      }
    }
    console.warn("[position-manager] Upstash não configurado — usando fallback de disco .data/ (savePositionsState). NÃO confiável cross-instance em produção real.")
    // fs fallback stores the open set only — a full overwrite already
    // implies "anything not in here is gone", so no separate delete step.
    return writeJsonFile(positionsFilePath(), positions)
  }
  setLocal(POSITIONS_KEY, positions)
  const syncSecret = (typeof process !== "undefined" ? (process.env as any).NEXT_PUBLIC_POSITIONS_SYNC_SECRET : undefined) as string | undefined;
  const res = await apiCall(
    "/api/positions/state",
    "POST",
    { positions, deleteIds },
    syncSecret ? { Authorization: `Bearer ${syncSecret}` } : undefined,
  );
  if (res === null) console.warn("[position-manager] client->server sync POST failed or was rejected (best-effort mirror)")
  return res !== null;
}

export async function loadPositionsState(): Promise<Record<string, any>> {
  if (typeof window === "undefined") {
    const { isKvConfigured, getRedis, positionsKvKey } = await import("./kv")
    if (isKvConfigured()) {
      try {
        const hash = await getRedis().hgetall<Record<string, unknown>>(positionsKvKey())
        if (!hash) return {}
        const out: Record<string, any> = {}
        for (const [id, raw] of Object.entries(hash)) {
          // Each position was written via JSON.stringify — but
          // @upstash/redis's automatic deserialization may have already
          // parsed a JSON-object string back into a real object (same
          // caveat as parseCbHash above), so accept either form.
          try { out[id] = typeof raw === "string" ? JSON.parse(raw) : raw } catch { /* skip corrupted entry, don't crash the whole load */ }
        }
        return out
      } catch (e) {
        console.error("[position-manager] Redis read failed (loadPositionsState):", (e as Error).message)
        return {}
      }
    }
    console.warn("[position-manager] Upstash não configurado — lendo fallback de disco .data/ (loadPositionsState)")
    return readJsonFile(positionsFilePath(), {})
  }
  return getLocal(POSITIONS_KEY, {});
}