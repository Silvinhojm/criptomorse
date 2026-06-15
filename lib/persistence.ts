// lib/persistence.ts
// Persistencia de dados de trading em localStorage

const TRADE_HISTORY_KEY = "arcflow_trade_history";
const TRADER_STATE_KEY = "arcflow_trader_state";

export function saveTradeHistory(history: any[]): void {
  try {
    const existing = loadTradeHistory();
    const merged = [...existing, ...history];
    const unique = merged.filter(
      (item, index, self) => index === self.findIndex(t => t.id === item.id)
    );
    localStorage.setItem(TRADE_HISTORY_KEY, JSON.stringify(unique.slice(-500)));
  } catch {
    console.warn("Nao foi possivel salvar historico no localStorage");
  }
}

export function loadTradeHistory(): any[] {
  try {
    const data = localStorage.getItem(TRADE_HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveTraderState(state: { totalProfit: number; lastAction: string }): void {
  try {
    localStorage.setItem(TRADER_STATE_KEY, JSON.stringify(state));
  } catch {
    // ignorar
  }
}

export function loadTraderState(): { totalProfit: number; lastAction: string } | null {
  try {
    const data = localStorage.getItem(TRADER_STATE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function clearPersistence(): void {
  try {
    localStorage.removeItem(TRADE_HISTORY_KEY);
    localStorage.removeItem(TRADER_STATE_KEY);
  } catch {
    // ignorar
  }
}
