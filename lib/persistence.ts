const TRADE_HISTORY_KEY = "arcflow_trade_history";
const TRADER_STATE_KEY = "arcflow_trader_state";

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
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch { return fallback; }
}

function setLocal(key: string, value: any): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

export async function saveTradeHistory(history: any[]): Promise<void> {
  const merged = [...getLocal<any[]>(TRADE_HISTORY_KEY, []), ...history];
  const unique = merged.filter(
    (item, idx, self) => idx === self.findIndex(t => t.id === item.id)
  ).slice(-500);
  setLocal(TRADE_HISTORY_KEY, unique);
  if (history.length > 0) {
    for (const record of history) {
      if (record.txHash) await apiCall("/api/trades", "POST", record);
    }
  }
}

export async function loadTradeHistory(): Promise<any[]> {
  const local = getLocal<any[]>(TRADE_HISTORY_KEY, []);
  const server = await apiCall("/api/trades", "GET");
  if (!server || !Array.isArray(server) || server.length === 0) return local;
  const merged = [...server, ...local];
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
  } catch { /* ignore */ }
}