import type { CircuitBreakerState } from "./circuit-breaker"

const TRADE_HISTORY_KEY = "arcflow_trade_history";
const TRADER_STATE_KEY = "arcflow_trader_state";
const CIRCUIT_BREAKER_KEY = "arcflow_circuit_breaker";

function circuitBreakerFilePath(): string {
  const path = require("path") as typeof import("path")
  return path.join(process.cwd(), ".data", "circuit-breaker-state.json")
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

const CB_DELTA_FIELDS = ["consecutiveLosses", "totalLoss", "totalProfit"] as const
type CbDeltaField = (typeof CB_DELTA_FIELDS)[number]

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

export async function cbCounterOp(
  mode: "incr" | "set",
  values: Partial<Record<CbDeltaField, number>>,
): Promise<Partial<Record<CbDeltaField, number>> | null> {
  if (typeof window !== "undefined") return null
  const { isKvConfigured, getRedis, circuitBreakerKvKey } = await import("./kv")
  if (!isKvConfigured()) return null
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

async function apiCall(url: string, method: string, body?: any): Promise<any> {
  try {
    const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
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
    console.warn("[circuit-breaker] Upstash não configurado — usando fallback de disco .data/ (saveCircuitBreakerState)")
    return writeJsonFile(circuitBreakerFilePath(), state)
  }
  setLocal(CIRCUIT_BREAKER_KEY, state)
  return true
}

export function loadCircuitBreakerStateInitial<T>(fallback: T): T {
  if (typeof window === "undefined") return fallback
  return getLocal(CIRCUIT_BREAKER_KEY, fallback)
}

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
