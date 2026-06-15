// lib/real-automated-trader.ts
// Robo de trading REAL - estrategia baseada em spread USDC/EURC
// Cada trade executa swap real via LI.FI e confirma na blockchain

import { realSwap, type NetworkKey } from "./real-swap-executor";
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

    // Mostrar saldos disponiveis
    await realSwap.refreshAllBalances();
    const balances = realSwap.getAllBalances().filter(b => b.balance > 0);
    this.log(`Saldos: ${balances.map(b => `${b.symbol}:$${b.balance.toFixed(2)}`).join(" | ") || "vazio"}`);

    // Usar findBestPair do RealSwapExecutor que ja testa todos os pares
    // da config contra LI.FI e retorna o mais lucrativo
    this.log(`Buscando melhor par via LI.FI...`);
    const best = await realSwap.findBestPair(tradeAmount);

    if (!best) {
      this.log(`Nenhum par com lucro viavel encontrado`);
      // Fallback: tentar USDC->WETH diretamente (entrar em posicao volatil)
      const usdcBal = realSwap.getBalance("USDC");
      if (usdcBal >= tradeAmount) {
        this.log(`Fallback: USDC->WETH (entrada em posicao volatil)`);
        const result = await realSwap.executeSwap("USDC", "WETH", tradeAmount, (m) => this.log(m));
        if (result.success) {
          const profit = result.profit ?? 0;
          this.totalProfit += profit;
          this.lastAction = `BUY $${tradeAmount} USDC->WETH`;
          const record: TradeRecord = { id, action: "BUY", fromAmount: tradeAmount, toAmount: result.toAmount, profit, txHash: result.txHash, explorerUrl: result.explorerUrl, message: result.message, timestamp, confirmed: result.confirmed };
          this.tradeHistory.push(record); this._persist(); this.onTradeCallback?.(record);
          return record;
        }
      }
      this.lastAction = "HOLD (sem pares)";
      return this._holdRecord(id, "Nenhum par viavel", timestamp);
    }

    this.log(`Melhor par: ${best.pair.label} | lucro esperado: $${best.expectedProfit.toFixed(4)} via ${best.route}`);
    const result = await realSwap.executeSwap(best.pair.from, best.pair.to, tradeAmount, (m) => this.log(m));

    const profit = result.profit ?? 0;
    if (result.success) {
      this.log(`Trade concluido! Lucro: $${profit.toFixed(4)}`);
    } else {
      this.log(`Trade falhou: ${result.message}`);
    }

    this.totalProfit += profit;
    this.lastAction = `${best.pair.from}->${best.pair.to} $${tradeAmount}`;

    const record: TradeRecord = {
      id, action: "BUY", fromAmount: tradeAmount, toAmount: result.toAmount, profit,
      txHash: result.txHash, explorerUrl: result.explorerUrl, message: result.message,
      timestamp, confirmed: result.confirmed,
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
