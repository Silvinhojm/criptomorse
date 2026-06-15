// lib/real-automated-trader.ts
// Robo de trading REAL - estrategia baseada em spread USDC/EURC
// Cada trade executa swap real via LI.FI e confirma na blockchain

import { realSwap, NETWORKS, type SwapResult, type NetworkKey } from "./real-swap-executor";
import { blockIfPanicked } from "./circuit-breaker";
import { saveTradeHistory, loadTradeHistory, saveTraderState, loadTraderState } from "./persistence";
import { pairScanner, type ScannedPair } from "./pair-scanner";
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

  private _trySwap(
    fromToken: string,
    toToken: string,
    amount: number,
  ): Promise<SwapResult | null> {
    return realSwap.executeSwap(fromToken, toToken, amount, (m) => this.log(m))
      .then(r => r.success ? r : null)
      .catch(() => null);
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

    // Escanear pares disponiveis na LI.FI para esta rede
    const net = NETWORKS[this.networkKey];
    this.log(`Escaneando pares LI.FI em ${net.name} (chain ${net.chainId})...`);
    const scanned = await pairScanner.scanPairs(net.chainId, 20);
    this.log(`${scanned.length} pares encontrados`);

    if (scanned.length === 0) {
      this.lastAction = "HOLD (sem pares)";
      return this._holdRecord(id, "Nenhum par encontrado na LI.FI", timestamp);
    }

    // Mostrar top 5 pares
    scanned.slice(0, 5).forEach(p => {
      this.log(`  ${p.fromSymbol}→${p.toSymbol} (${p.type}) spread ${p.spread.toFixed(3)}%`);
    });

    // Encontrar o melhor par viavel com saldo
    let chosen: ScannedPair | undefined;
    for (const pair of scanned) {
      if (pair.type === "stable_stable" && pair.spread < 0.3) continue; // spread muito baixo
      const fromBal = await realSwap.getBalance(pair.fromSymbol);
      if (fromBal >= tradeAmount) {
        chosen = pair;
        break;
      }
    }

    if (!chosen) {
      // Tentar qualquer par que tenha saldo, mesmo com spread baixo
      for (const pair of scanned) {
        const fromBal = await realSwap.getBalance(pair.fromSymbol);
        if (fromBal >= tradeAmount) {
          chosen = pair;
          break;
        }
      }
    }

    if (!chosen) {
      this.log(`HOLD - sem saldo para nenhum par`);
      this.lastAction = "HOLD (sem saldo)";
      return this._holdRecord(id, "Sem saldo para pares disponiveis", timestamp);
    }

    this.log(`Par escolhido: ${chosen.fromSymbol}→${chosen.toSymbol} (spread ${chosen.spread.toFixed(3)}%)`);
    const action: "BUY" | "SELL" = "BUY";
    const fromToken = chosen.fromSymbol;
    const toToken = chosen.toSymbol;

    const result = await this._trySwap(fromToken, toToken, tradeAmount);

    let profit = 0;
    if (result && result.success && result.confirmed) {
      profit = result.profit ?? 0;
      this.log(`Lucro: $${profit.toFixed(4)}`);
    } else {
      this.log(`Trade falhou, tentando proximo par viavel...`);
      // Tentar segundo par
      for (const pair of scanned) {
        if (pair.fromSymbol === chosen.fromSymbol && pair.toSymbol === chosen.toSymbol) continue;
        const fromBal = await realSwap.getBalance(pair.fromSymbol);
        if (fromBal >= tradeAmount) {
          this.log(`Fallback: ${pair.fromSymbol}→${pair.toSymbol}...`);
          const r2 = await this._trySwap(pair.fromSymbol, pair.toSymbol, tradeAmount);
          if (r2 && r2.success && r2.confirmed) {
            profit = r2.profit ?? 0;
            break;
          }
        }
      }
    }

    this.totalProfit += profit;
    this.lastAction = `${action} $${tradeAmount} -> ${result?.txHash?.slice(0, 8) || "..."}`;

    const record: TradeRecord = {
      id,
      action,
      fromAmount: tradeAmount,
      toAmount: result?.toAmount ?? 0,
      profit,
      txHash: result?.txHash ?? "",
      explorerUrl: result?.explorerUrl ?? "",
      message: result?.message ?? "",
      timestamp,
      confirmed: result?.confirmed ?? false,
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
