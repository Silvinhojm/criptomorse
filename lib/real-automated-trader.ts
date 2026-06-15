// lib/real-automated-trader.ts
// Robo de trading REAL - estrategia baseada em spread USDC/EURC
// Cada trade executa swap real via LI.FI e confirma na blockchain

import { realSwap, isStable, type NetworkKey, type TokenSymbol } from "./real-swap-executor";
import { blockIfPanicked } from "./circuit-breaker";
import { saveTradeHistory, loadTradeHistory, saveTraderState, loadTraderState } from "./persistence";
import { positionManager } from "./position-manager";
import { feeMonetization } from "./fee-monetization";
import { transactionMemos } from "./transaction-memos";
import { arcMicroTrader } from "./arc-micro-trader";
import { ethers } from "ethers";

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

    if (best && (isStable(best.pair.to) && isStable(best.pair.from))) {
      this.log(`Melhor par: ${best.pair.label} | lucro esperado: $${best.expectedProfit.toFixed(4)} via ${best.route}`);
      const result = await this._executeSwap(best.pair.from, best.pair.to, adjustedTrade.netAmount);
      const profit = (result.profit ?? 0) - adjustedTrade.fee;
      if (result.success) {
        this.log(`Trade concluido! Lucro: $${profit.toFixed(4)} (fee: $${adjustedTrade.fee.toFixed(4)})`);
        const memo = transactionMemos.createTradeMemo(id, 'RealTrader', { pair: best.pair.label, fee: adjustedTrade.fee.toFixed(4) });
        this.log(`📝 Memo: ${memo.hex.slice(0, 30)}...`);
      } else { this.log(`Trade falhou: ${result.message}`); }
      this.totalProfit += profit;
      this.lastAction = `${best.pair.from}->${best.pair.to} $${adjustedTrade.netAmount}`;
      const record: TradeRecord = { id, action: "BUY", fromToken: result.fromToken, toToken: result.toToken, fromAmount: adjustedTrade.netAmount, toAmount: result.toAmount, profit, txHash: result.txHash, explorerUrl: result.explorerUrl, message: `${result.message} | fee: $${adjustedTrade.fee.toFixed(4)}`, timestamp, confirmed: result.confirmed };
      this.tradeHistory.push(record); this._persist(); this.onTradeCallback?.(record);
      return record;
    }

    if (best && !isStable(best.pair.to)) {
      this.log(`Par volatil: ${best.pair.label} — comprando e abrindo posicao`);
      const result = await this._executeSwap(best.pair.from, best.pair.to, adjustedTrade.netAmount);
      if (result.success) {
        const volatileToken = best.pair.to;
        const paidToken = best.pair.from;
        const currentPrice = await positionManager.fetchTokenPrice(volatileToken);
        positionManager.openPosition(this.networkKey, volatileToken, paidToken, result.toAmount, tradeAmount, currentPrice);
        this.log(`Posicao ${volatileToken} aberta: ${result.toAmount.toFixed(6)} @ $${currentPrice.toFixed(2)} (trailing stop ativo)`);
      }
      const profit = 0;
      this.totalProfit += profit;
      this.lastAction = `BUY $${tradeAmount} ${best.pair.to} (posicao)`;
      const record: TradeRecord = { id, action: "BUY", fromToken: result.fromToken, toToken: result.toToken, fromAmount: tradeAmount, toAmount: result.toAmount, profit, txHash: result.txHash, explorerUrl: result.explorerUrl, message: result.message, timestamp, confirmed: result.confirmed ?? false };
      this.tradeHistory.push(record); this._persist(); this.onTradeCallback?.(record);
      return record;
    }

    if (best && !isStable(best.pair.from) && isStable(best.pair.to)) {
      this.log(`Fechando posicao: ${best.pair.from}→${best.pair.to}`);
      const result = await this._executeSwap(best.pair.from, best.pair.to, tradeAmount);
      const profit = result.profit ?? 0;
      if (result.success) {
        this.log(`Posicao fechada! Lucro: $${profit.toFixed(4)}`);
        const pos = positionManager.getOpenPositions().find(p => p.boughtToken === best.pair.from && p.status === "open");
        if (pos) {
          const currentPrice = await positionManager.fetchTokenPrice(best.pair.from);
          positionManager.closePosition(pos.id, currentPrice);
        }
      }
      this.totalProfit += profit;
      this.lastAction = `CLOSE ${best.pair.from}→${best.pair.to}`;
      const record: TradeRecord = { id, action: "SELL", fromToken: result.fromToken, toToken: result.toToken, fromAmount: tradeAmount, toAmount: result.toAmount, profit, txHash: result.txHash, explorerUrl: result.explorerUrl, message: result.message, timestamp, confirmed: result.confirmed ?? false };
      this.tradeHistory.push(record); this._persist(); this.onTradeCallback?.(record);
      return record;
    }

    // Nenhum par viavel — fallback
    this.log(`Nenhum par com lucro viavel encontrado`);
    const stables = ["USDC", "USDT", "DAI", "EURC"] as TokenSymbol[];
    let bought = false;
    for (const stable of stables) {
      const bal = realSwap.getBalance(stable);
      const amount = Math.min(tradeAmount, bal * 0.95);
      if (amount < 1) continue;
      this.log(`Fallback: ${stable}→WETH ($${amount.toFixed(2)}, trailing stop)`);
      const result = await this._executeSwap(stable, "WETH", amount);
      if (!result.success) continue;
      const wethPrice = await positionManager.fetchTokenPrice("WETH");
      positionManager.openPosition(this.networkKey, "WETH", stable, result.toAmount, amount, wethPrice);
      this.log(`Posicao WETH aberta: ${result.toAmount.toFixed(6)} @ $${wethPrice.toFixed(2)}`);
      const record: TradeRecord = { id, action: "BUY", fromToken: result.fromToken, toToken: result.toToken, fromAmount: amount, toAmount: result.toAmount, profit: 0, txHash: result.txHash, explorerUrl: result.explorerUrl, message: `WETH position @ $${wethPrice.toFixed(2)}`, timestamp, confirmed: result.confirmed ?? false };
      this.tradeHistory.push(record); this._persist(); this.onTradeCallback?.(record);
      bought = true;
      break;
    }
    if (!bought) {
      this.lastAction = "HOLD (sem pares)";
      return this._holdRecord(id, "Nenhum par viavel", timestamp);
    }
    this.lastAction = "BUY WETH (trailing stop)";
    return this.tradeHistory[this.tradeHistory.length - 1];
  }

  private async _persist() {
    if (!this.persistEnabled) return;
    await saveTradeHistory(this.tradeHistory);
    await saveTraderState({ totalProfit: this.totalProfit, lastAction: this.lastAction });
  }

  private async _executeSwap(from: string, to: string, amount: number): Promise<any> {
    if (this.autoSignMode) {
      this.log(`🔄 Enviando swap via servidor: ${from}→${to} $${amount}`);
      try {
        const res = await fetch("/api/swap/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromToken: from, toToken: to, amountUsd: amount, network: this.networkKey }),
        });
        const data = await res.json();
        if (!res.ok) {
          this.log(`❌ Servidor: ${data.error || "erro"}`);
          return { success: false, message: data.error || "Erro no servidor", fromAmount: amount, toAmount: 0, profit: 0, txHash: "", explorerUrl: "", confirmed: false };
        }
        this.log(`✅ Servidor: ${data.message || "swap concluido"} | TX: ${data.txHash?.slice(0, 10)}...`);
        return {
          success: true, txHash: data.txHash, explorerUrl: data.explorerUrl,
          fromToken: data.fromToken || from, toToken: data.toToken || to,
          fromAmount: amount, toAmount: data.toAmount ?? 0, confirmed: true,
          profit: data.profit ?? 0, message: data.message || "Swap via servidor",
        };
      } catch (err: any) {
        this.log(`❌ Erro ao chamar servidor: ${err.message}`);
        return { success: false, message: err.message, fromAmount: amount, toAmount: 0, profit: 0, txHash: "", explorerUrl: "", confirmed: false };
      }
    }
    return realSwap.executeSwap(from as any, to as any, amount, (m: string) => this.log(m));
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

    const result = await arcMicroTrader.executeMicroTrade("USDC", "EURC", tradeAmount, `auto_micro_${id}`);
    this.totalProfit += result.profit;

    if (result.success && result.profit > 0) {
      const memoPreview = result.memoHex ? `📝 memo:${result.memoHex.slice(0, 20)}...` : '';
      this.log(`✅ Micro-trade lucro: $${result.profit.toFixed(6)} | gas: $${result.gasUsed.toFixed(4)} | ${memoPreview}`);
    } else {
      this.log(`❌ Micro-trade falhou: ${result.message}`);
    }

    const record: TradeRecord = {
      id, action: result.success ? "BUY" : "HOLD",
      fromToken: "USDC", toToken: "EURC",
      fromAmount: tradeAmount, toAmount: tradeAmount + result.profit,
      profit: result.profit, txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      message: `micro: $${result.profit.toFixed(6)} | gas $${result.gasUsed.toFixed(4)}`,
      timestamp, confirmed: result.confirmed,
    };

    this.tradeHistory.push(record);
    this._persist();
    this.onTradeCallback?.(record);
    return record;
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
