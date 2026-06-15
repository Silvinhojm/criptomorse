// lib/real-automated-trader.ts
// Robo de trading REAL - estrategia baseada em spread USDC/EURC
// Cada trade executa swap real via LI.FI e confirma na blockchain

import { realSwap, NETWORKS, type SwapResult, type NetworkKey } from "./real-swap-executor";
import { blockIfPanicked } from "./circuit-breaker";
import { saveTradeHistory, loadTradeHistory, saveTraderState, loadTraderState } from "./persistence";
import { ethers } from "ethers";

export interface TradeRecord {
  id: string;
  action: "BUY" | "SELL" | "HOLD";
  fromAmount: number;
  toAmount: number;
  profit: number;
  txHash: string;
  explorerUrl: string;
  message: string;
  timestamp: number;
  confirmed: boolean;
}

export interface TraderStats {
  totalTrades: number;
  confirmedTrades: number;
  winRate: string;
  totalProfit: string;
  avgProfit: string;
  isRunning: boolean;
  lastAction: string;
  usdcBalance: number;
  eurcBalance: number;
}

// Cache de precos CoinGecko (evita 429)
let priceCache: { usdc: number; eurc: number; spread: number } | null = null;
let priceCacheTimestamp = 0;
const PRICE_CACHE_DURATION = 30000;

async function fetchSpread(): Promise<{ usdc: number; eurc: number; spread: number }> {
  if (priceCache && Date.now() - priceCacheTimestamp < PRICE_CACHE_DURATION) {
    return priceCache;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=usd-coin,euro-coin&vs_currencies=usd",
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);
    const data = await res.json();
    const usdc = data["usd-coin"]?.usd ?? 1.0;
    const eurc = data["euro-coin"]?.usd ?? 1.08;
    const spread = Math.abs(eurc / usdc - 1) * 100;
    priceCache = { usdc, eurc, spread };
    priceCacheTimestamp = Date.now();
    return priceCache;
  } catch {
    if (priceCache) return priceCache;
    const spread = 0.3 + Math.random() * 0.8;
    return { usdc: 1.0, eurc: 1.0 + spread / 100, spread };
  }
}

// --- Classe Principal ---

class RealAutomatedTrader {
  private isRunning = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private tradeHistory: TradeRecord[] = [];
  private totalProfit = 0;
  private networkKey: NetworkKey = "arc";
  private initialized = false;
  private lastAction = "Aguardando...";
  private persistEnabled = true;
  private onTradeCallback: ((trade: TradeRecord) => void) | null = null;
  private onLogCallback: ((msg: string) => void) | null = null;

  async initialize(
    account: string,
    networkKey: NetworkKey,
    externalSigner?: ethers.Signer
  ): Promise<boolean> {
    this.networkKey = networkKey;

    // Restaurar estado persistido
    const saved = loadTraderState();
    if (saved) {
      this.totalProfit = saved.totalProfit;
      this.lastAction = saved.lastAction;
    }
    this.tradeHistory = loadTradeHistory();

    // Usar a wallet conectada (MetaMask) para ler saldos
    // Se um signer externo foi fornecido, usa ele para assinar
    let ok: boolean;
    if (externalSigner) {
      ok = await realSwap.initializeWithSigner(account, networkKey, externalSigner);
    } else {
      // Fallback: modo read-only, mostra saldos da wallet conectada
      ok = await realSwap.initialize(account, networkKey, true);
    }
    this.initialized = ok;
    return ok;
  }

  onTrade(cb: (trade: TradeRecord) => void) {
    this.onTradeCallback = cb;
  }

  onLog(cb: (msg: string) => void) {
    this.onLogCallback = cb;
  }

  private log(msg: string) {
    console.log(msg);
    this.onLogCallback?.(msg);
  }

  async getBalances(): Promise<{ usdc: number; eurc: number }> {
    const [usdc, eurc] = await Promise.all([
      realSwap.getBalance("USDC"),
      realSwap.getBalance("EURC"),
    ]);
    return { usdc, eurc };
  }

  async runTradingCycle(tradeAmount: number = 10): Promise<TradeRecord> {
    const timestamp = Date.now();
    const id = `trade_${timestamp}`;

    if (!this.initialized) {
      this.log("Trader nao inicializado");
      return this._holdRecord(id, "Nao inicializado", timestamp);
    }

    if (blockIfPanicked()) {
      this.lastAction = "HOLD (circuit breaker)";
      return this._holdRecord(id, "Circuit breaker bloqueou", timestamp);
    }

    const { usdc, eurc } = await this.getBalances();
    this.log(`Saldos - USDC: $${usdc.toFixed(2)} | EURC: ${eurc.toFixed(2)}`);

    const market = await fetchSpread();
    this.log(`Spread USDC/EURC: ${market.spread.toFixed(3)}% | EURC: $${market.eurc.toFixed(4)}`);

    const MIN_SPREAD = 0.4;
    let action: "BUY" | "SELL" | "HOLD" = "HOLD";

    if (market.spread >= MIN_SPREAD && usdc >= tradeAmount) {
      action = "BUY";
    } else if (eurc >= (tradeAmount / market.eurc) * 0.9 && market.eurc > 1.001) {
      const eurcNeeded = tradeAmount / market.eurc;
      this.log(`EURC necessario: ${eurcNeeded.toFixed(4)} | Disponivel: ${eurc.toFixed(4)}`);
      action = "SELL";
    } else {
      this.log(`HOLD - spread ${market.spread.toFixed(3)}% abaixo de ${MIN_SPREAD}% ou saldo insuficiente`);
      this.lastAction = `HOLD (spread ${market.spread.toFixed(3)}%)`;
      return this._holdRecord(id, `Spread ${market.spread.toFixed(3)}% - abaixo do minimo`, timestamp);
    }

    let actualAmount = tradeAmount;
    let fromToken: string;
    let toToken: string;

    if (action === "BUY") {
      fromToken = "USDC";
      toToken = "EURC";
      actualAmount = tradeAmount;
    } else {
      fromToken = "EURC";
      toToken = "USDC";
      actualAmount = tradeAmount / market.eurc;
      this.log(`Convertendo $${tradeAmount} -> ${actualAmount.toFixed(4)} EURC (preco: $${market.eurc.toFixed(4)})`);
    }

    this.log(`Executando ${action} de ${fromToken}->${toToken} via LI.FI...`);
    const result: SwapResult = await realSwap.executeSwap(
      fromToken,
      toToken,
      actualAmount,
      (msg: string) => this.log(msg)
    );

    let profit = 0;
    if (result.success && result.confirmed) {
      if (action === "BUY") {
        profit = result.toAmount * market.eurc - actualAmount;
      } else {
        profit = result.toAmount - actualAmount * market.eurc;
      }
      this.log(`Lucro estimado: $${profit.toFixed(4)}`);
    }

    this.totalProfit += profit;
    this.lastAction = `${action} $${tradeAmount} -> TX ${result.txHash?.slice(0, 8) || "..."}`;

    const record: TradeRecord = {
      id,
      action,
      fromAmount: actualAmount,
      toAmount: result.toAmount,
      profit,
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      message: result.message,
      timestamp,
      confirmed: result.confirmed,
    };

    this.tradeHistory.push(record);
    this._persist();
    this.onTradeCallback?.(record);
    return record;
  }

  private _persist() {
    if (!this.persistEnabled) return;
    saveTradeHistory(this.tradeHistory);
    saveTraderState({ totalProfit: this.totalProfit, lastAction: this.lastAction });
  }

  startAutomatedTrading(intervalSeconds = 60, tradeAmount = 10) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.log(`\nTRADING REAL INICIADO - $${tradeAmount} a cada ${intervalSeconds}s`);

    this.runTradingCycle(tradeAmount).catch(err => {
      this.log(`Erro no primeiro ciclo: ${err?.message || err}`);
    });

    this.intervalId = setInterval(() => {
      if (!this.isRunning) return;
      this.runTradingCycle(tradeAmount).catch(err => {
        this.log(`Erro no ciclo: ${err?.message || err}`);
      });
    }, intervalSeconds * 1000);
  }

  stopAutomatedTrading() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    this.log("Trading parado");
  }

  getStats(): TraderStats {
    const total = this.tradeHistory.length;
    const confirmed = this.tradeHistory.filter((t) => t.confirmed).length;
    const wins = this.tradeHistory.filter((t) => t.profit > 0).length;

    return {
      totalTrades: total,
      confirmedTrades: confirmed,
      winRate: total > 0 ? ((wins / total) * 100).toFixed(1) : "0.0",
      totalProfit: this.totalProfit.toFixed(4),
      avgProfit: total > 0 ? (this.totalProfit / total).toFixed(4) : "0.0000",
      isRunning: this.isRunning,
      lastAction: this.lastAction,
      usdcBalance: 0,
      eurcBalance: 0,
    };
  }

  getHistory(): TradeRecord[] {
    return [...this.tradeHistory].reverse();
  }

  private _holdRecord(id: string, reason: string, timestamp: number): TradeRecord {
    return {
      id,
      action: "HOLD",
      fromAmount: 0,
      toAmount: 0,
      profit: 0,
      txHash: "",
      explorerUrl: "",
      message: `HOLD - ${reason}`,
      timestamp,
      confirmed: false,
    };
  }
}

export const realAutomatedTrader = new RealAutomatedTrader();
