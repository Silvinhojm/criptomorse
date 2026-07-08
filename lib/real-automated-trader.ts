// lib/real-automated-trader.ts
// Robo de trading REAL - estrategia baseada em spread USDC/EURC
// Cada trade executa swap real via LI.FI e confirma na blockchain

import { realSwap, isStable, type NetworkKey, type TokenSymbol } from "./real-swap-executor";
import { blockIfPanicked } from "./circuit-breaker";
import { saveTradeHistory, loadTradeHistory, saveTraderState, loadTraderState } from "./persistence";
import { feeMonetization } from "./fee-monetization";
import { transactionMemos } from "./transaction-memos";
import { arcMicroTrader } from "./arc-micro-trader";
import { ethers } from "ethers";
import { submeterSinalAoCoordinator } from "./pregão";

export interface TradeRecord {
  id: string;
  action: "BUY" | "SELL" | "HOLD";
  fromToken?: string;
  toToken?: string;
  fromAmount: number;
  toAmount: number;
  profit: number;
  txHash: string;
  explorerUrl: string;
  message: string;
  timestamp: number;
  confirmed: boolean;
  networkKey?: string;
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
  private onTradeCallbacks: Array<(trade: TradeRecord) => void> = [];
  private onLogCallbacks: Array<(msg: string) => void> = [];
  private autoSignMode = false;

  setAutoSignMode(enabled: boolean) {
    this.autoSignMode = enabled;
  }

  async initialize(
    account: string,
    networkKey: NetworkKey,
    externalSigner?: ethers.Signer
  ): Promise<boolean> {
    this.networkKey = networkKey;

    const saved = await loadTraderState();
    if (saved) {
      this.totalProfit = saved.totalProfit;
      this.lastAction = saved.lastAction;
    }
    this.tradeHistory = await loadTradeHistory();

    if (this.autoSignMode) {
      // Modo auto-sign via servidor — RealSwapExecutor em modo read-only (só saldos)
      this.initialized = await realSwap.initialize(account, networkKey, true);
      if (this.initialized) this.log(`🔑 Modo auto-sign via servidor (chave no .env)`);
      return this.initialized;
    }

    let ok: boolean;
    if (externalSigner) {
      ok = await realSwap.initializeWithSigner(account, networkKey, externalSigner);
    } else {
      ok = await realSwap.initialize(account, networkKey, true);
    }
    this.initialized = ok;
    return ok;
  }

  onTrade(cb: (trade: TradeRecord) => void) {
    this.onTradeCallbacks.push(cb);
    return () => { this.onTradeCallbacks = this.onTradeCallbacks.filter(c => c !== cb) };
  }

  onLog(cb: (msg: string) => void) {
    this.onLogCallbacks.push(cb);
    return () => { this.onLogCallbacks = this.onLogCallbacks.filter(c => c !== cb) };
  }

  private log(msg: string) {
    console.log(msg);
    for (const cb of this.onLogCallbacks) cb(msg);
  }

  private notifyTrade(record: TradeRecord) {
    for (const cb of this.onTradeCallbacks) cb(record);
  }

  async getBalances(): Promise<{ usdc: number; eurc: number }> {
    const [usdc, eurc] = await Promise.all([
      realSwap.getBalance("USDC"),
      realSwap.getBalance("EURC"),
    ]);
    return { usdc, eurc };
  }

  async runTradingCycle(tradeAmount: number = 5): Promise<TradeRecord> {
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

    await realSwap.refreshAllBalances();
    const balances = realSwap.getAllBalances().filter(b => b.balance > 0);
    this.log(`Saldos: ${balances.map(b => `${b.symbol}:$${b.balance.toFixed(2)}`).join(" | ") || "vazio"}`);

    this.log(`Buscando melhor par via LI.FI...`);

    const best = await realSwap.findBestPair(tradeAmount);

    const adjustedTrade = feeMonetization.calculateFee(`${best?.pair.from || 'USDC'}_${best?.pair.to || 'EURC'}`, best?.toAmount ?? tradeAmount);
    this.log(`Fee: $${adjustedTrade.fee.toFixed(4)} | Net: $${adjustedTrade.netAmount.toFixed(4)}`);

    const isTestnet = realSwap.isTestnet();
    if (best && (isStable(best.pair.to) && isStable(best.pair.from))) {
      this.log(`Melhor par: ${best.pair.label} | lucro esperado: $${best.expectedProfit.toFixed(4)} via ${best.route}`);
      this.lastAction = `${best.pair.from}->${best.pair.to} $${adjustedTrade.netAmount}`;
      if (!isTestnet) transactionMemos.createTradeMemo(id, 'RealTrader', { pair: best.pair.label, fee: adjustedTrade.fee.toFixed(4) });
      return this._submitPendingTrade(id, "BUY", best.pair.from, best.pair.to, adjustedTrade.netAmount, timestamp, `Coordinator proposal submitted | fee: $${adjustedTrade.fee.toFixed(4)}`);
    }

    if (best && !isStable(best.pair.to)) {
      this.log(`Par volatil: ${best.pair.label} — comprando e abrindo posicao`);
      this.lastAction = `BUY $${tradeAmount} ${best.pair.to} (posicao)`;
      return this._submitPendingTrade(id, "BUY", best.pair.from, best.pair.to, adjustedTrade.netAmount, timestamp, "Coordinator proposal submitted for volatile position entry");
    }

    if (best && !isStable(best.pair.from) && isStable(best.pair.to)) {
      this.log(`Fechando posicao: ${best.pair.from}→${best.pair.to}`);
      this.lastAction = `CLOSE ${best.pair.from}→${best.pair.to}`;
      return this._submitPendingTrade(id, "SELL", best.pair.from, best.pair.to, tradeAmount, timestamp, "Coordinator proposal submitted for position close");
    }

    // Nenhum par viavel — fallback
    this.log(`Nenhum par com lucro viavel encontrado`);
    const volatileTargets = ["WETH", "WBTC", "WMATIC", "ARB"] as TokenSymbol[];
    const availableVolatile = volatileTargets.filter(t => realSwap.hasToken(t));
    if (availableVolatile.length === 0) {
      this.log(`Nenhum token volatil disponivel na rede ${this.networkKey} para fallback`);
      this.lastAction = "HOLD (sem volatil)";
      return this._holdRecord(id, "Nenhum token volatil configurado na rede", timestamp);
    }
    const stables = ["USDC", "USDT", "DAI", "EURC"] as TokenSymbol[];
    let bought = false;
    for (const target of availableVolatile) {
      for (const stable of stables) {
        const bal = realSwap.getBalance(stable);
        const amount = Math.min(tradeAmount, bal * 0.95);
        if (amount < 1) continue;
        this.log(`Fallback: ${stable}→${target} ($${amount.toFixed(2)}, trailing stop)`);
        const record = await this._submitPendingTrade(id, "BUY", stable, target, amount, timestamp, "Coordinator proposal submitted for fallback position entry");
        bought = true;
        return record;
      }
      if (bought) break;
    }
    if (!bought) {
      this.lastAction = "HOLD (sem pares)";
      return this._holdRecord(id, "Nenhum par viavel", timestamp);
    }
    this.lastAction = `BUY ${availableVolatile[0]} (trailing stop)`;
    return this.tradeHistory[this.tradeHistory.length - 1];
  }

  private async _persist() {
    if (!this.persistEnabled) return;
    if (this.tradeHistory.length > 500) this.tradeHistory = this.tradeHistory.slice(-500);
    await saveTradeHistory(this.tradeHistory);
    await saveTraderState({ totalProfit: this.totalProfit, lastAction: this.lastAction });
  }

  private async _submitPendingTrade(
    id: string,
    action: "BUY" | "SELL",
    from: string,
    to: string,
    amount: number,
    timestamp: number,
    message: string,
  ): Promise<TradeRecord> {
    const accepted = await submeterSinalAoCoordinator({
      pregueiro: "RealAutomatedTrader",
      rede: this.networkKey,
      par: `${from}→${to}`,
      confianca: 70,
      timestamp,
      fromToken: from,
      toToken: to,
      amountUsd: amount,
      direcao: action === "SELL" ? "sell" : "buy",
    })

    const record: TradeRecord = {
      id,
      action: accepted ? action : "HOLD",
      fromToken: from,
      toToken: to,
      fromAmount: amount,
      toAmount: 0,
      profit: 0,
      txHash: "",
      explorerUrl: "",
      message: accepted ? `PENDING - ${message}` : "Coordinator rejected proposal",
      timestamp,
      confirmed: false,
      networkKey: this.networkKey,
    };
    this.tradeHistory.push(record);
    this._persist();
    this.notifyTrade(record);
    return record;
  }

  startAutomatedTrading(intervalSeconds = 30, tradeAmount = 5) {
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
      networkKey: this.networkKey,
    };
  }

  async runMicroTradeCycle(tradeAmount: number = 2): Promise<TradeRecord> {
    const timestamp = Date.now();
    const id = `micro_${timestamp}`;

    if (!this.initialized) {
      return this._holdRecord(id, "Nao inicializado", timestamp);
    }

    if (blockIfPanicked()) {
      return this._holdRecord(id, "Circuit breaker", timestamp);
    }

    const profitCheck = arcMicroTrader.isMicroTradeProfitable(tradeAmount, 10);
    if (!profitCheck.profitable) {
      this.log(`Micro-trade: ${profitCheck.reason}`);
      return this._holdRecord(id, profitCheck.reason, timestamp);
    }

    return this._submitPendingTrade(
      id,
      "BUY",
      "USDC",
      "EURC",
      tradeAmount,
      timestamp,
      `Coordinator proposal submitted for micro-trade | expected ${profitCheck.reason}`,
    );
  }

  async startMicroTrading(intervalSeconds = 15, tradeAmount = 2) {
    if (this.isRunning) return;
    this.isRunning = true;
    const cfg = arcMicroTrader.getConfig();
    this.log(`\n🤖 MICRO-TRADING ARC INICIADO - $${tradeAmount} a cada ${intervalSeconds}s`);
    this.log(`⚡ Gas: ~$${cfg.gasBuffer.toFixed(4)} USDC | Batch: ${cfg.batchEnabled ? 'ON' : 'OFF'} | Memo: ${cfg.memoEnabled ? 'ON' : 'OFF'}`);

    this.runMicroTradeCycle(tradeAmount);

    this.intervalId = setInterval(() => {
      if (!this.isRunning) return;
      this.runMicroTradeCycle(tradeAmount);
    }, intervalSeconds * 1000);
  }

  getBatchStats() {
    const trades = this.tradeHistory.filter(t => t.id.startsWith('micro_'));
    const microWins = trades.filter(t => t.profit > 0).length;
    return {
      totalMicroTrades: trades.length,
      microWins,
      microWinRate: trades.length > 0 ? ((microWins / trades.length) * 100).toFixed(1) : '0.0',
      totalMicroProfit: trades.reduce((s, t) => s + t.profit, 0).toFixed(6),
      avgGas: trades.length > 0 ? (trades.reduce((s, t) => s + parseFloat(t.message.split('gas $')[1] || '0'), 0) / trades.length).toFixed(4) : '0',
    };
  }
}

export const realAutomatedTrader = new RealAutomatedTrader();
