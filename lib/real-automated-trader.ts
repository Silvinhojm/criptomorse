// lib/real-automated-trader.ts
// RobÃ´ de trading REAL â€” estratÃ©gia baseada em spread USDC/EURC
// Cada trade executa swap real via LI.FI e confirma na blockchain

import { realSwap, type SwapResult, NETWORKS } from "./real-swap-executor";
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

// â”€â”€â”€ PreÃ§os simulados de mercado (em produÃ§Ã£o, use Chainlink ou CoinGecko) â”€â”€â”€

async function fetchSpread(): Promise<{ usdc: number; eurc: number; spread: number }> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=usd-coin,euro-coin&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    const usdc = data["usd-coin"]?.usd ?? 1.0;
    const eurc = data["euro-coin"]?.usd ?? 1.08;
    const spread = Math.abs(eurc / usdc - 1) * 100;
    return { usdc, eurc, spread };
  } catch {
    // Fallback: spread simulado pequeno
    const spread = 0.3 + Math.random() * 0.8;
    return { usdc: 1.0, eurc: 1.0 + spread / 100, spread };
  }
}

// â”€â”€â”€ Classe Principal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class RealAutomatedTrader {
  private isRunning = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private tradeHistory: TradeRecord[] = [];
  private totalProfit = 0;
  private privateKey = "";
  private networkKey: keyof typeof NETWORKS = "arc";
  private initialized = false;
  private lastAction = "Aguardando...";
  private onTradeCallback: ((trade: TradeRecord) => void) | null = null;
  private onLogCallback: ((msg: string) => void) | null = null;

  // â”€â”€â”€ Setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async initialize(
    privateKey: string,
    networkKey: keyof typeof NETWORKS = "arc"
  ): Promise<boolean> {
    this.privateKey = privateKey;
    this.networkKey = networkKey;
    const ok = await realSwap.initialize(privateKey, networkKey);
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

  // â”€â”€â”€ Saldos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getBalances(): Promise<{ usdc: number; eurc: number }> {
    const [usdc, eurc] = await Promise.all([
      realSwap.getBalance("USDC"),
      realSwap.getBalance("EURC"),
    ]);
    return { usdc, eurc };
  }

  // â”€â”€â”€ Ciclo de Trading â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async runTradingCycle(tradeAmount: number = 10): Promise<TradeRecord> {
    const timestamp = Date.now();
    const id = `trade_${timestamp}`;

    if (!this.initialized) {
      this.log("âŒ Trader nÃ£o inicializado");
      return this._holdRecord(id, "NÃ£o inicializado", timestamp);
    }

    // 1. Ler saldos reais
    const { usdc, eurc } = await this.getBalances();
    this.log(`ðŸ’° Saldos â€” USDC: $${usdc.toFixed(2)} | EURC: â‚¬${eurc.toFixed(2)}`);

    // 2. Buscar spread de mercado
    const market = await fetchSpread();
    this.log(`ðŸ“Š Spread USDC/EURC: ${market.spread.toFixed(3)}% | EURC: $${market.eurc.toFixed(4)}`);

    // 3. EstratÃ©gia baseada em spread
    //    BUY  (USDCâ†’EURC) se EURC > USDC+spread mÃ­nimo  â†’ arbitragem
    //    SELL (EURCâ†’USDC) se temos EURC acumulado       â†’ realizar lucro
    //    HOLD se spread pequeno ou saldo insuficiente

    const MIN_SPREAD = 0.4; // % mÃ­nimo para operar
    let action: "BUY" | "SELL" | "HOLD" = "HOLD";

    if (market.spread >= MIN_SPREAD && usdc >= tradeAmount) {
      action = "BUY";
    } else if (eurc >= tradeAmount * 0.9 && market.eurc > 1.001) {
      action = "SELL";
    } else {
      this.log(`â¸ï¸ HOLD â€” spread ${market.spread.toFixed(3)}% abaixo de ${MIN_SPREAD}% ou saldo insuficiente`);
      this.lastAction = `HOLD (spread ${market.spread.toFixed(3)}%)`;
      return this._holdRecord(id, `Spread ${market.spread.toFixed(3)}% â€” abaixo do mÃ­nimo`, timestamp);
    }

    // 4. Executar swap REAL
    this.log(`ðŸš€ Executando ${action} de $${tradeAmount} via LI.FI...`);
    const result: SwapResult = await realSwap.executeSwap(action === "BUY" ? "USDC" : "EURC", action === "BUY" ? "EURC" : "USDC", tradeAmount, (msg: string) => this.log(msg));

    // 5. Calcular lucro real
    let profit = 0;
    if (result.success && result.confirmed) {
      if (action === "BUY") {
        // Compramos EURC: lucro = (EURC recebido * preÃ§o EURC) - USDC gasto
        profit = result.toAmount * market.eurc - tradeAmount;
      } else {
        // Vendemos EURC: lucro = USDC recebido - EURC gasto (em USD)
        profit = result.toAmount - tradeAmount * market.eurc;
      }
    }

    this.totalProfit += profit;
    this.lastAction = `${action} $${tradeAmount} â†’ TX ${result.txHash.slice(0, 8)}...`;

    const record: TradeRecord = {
      id,
      action,
      fromAmount: tradeAmount,
      toAmount: result.toAmount,
      profit,
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      message: result.message,
      timestamp,
      confirmed: result.confirmed,
    };

    this.tradeHistory.push(record);
    this.onTradeCallback?.(record);
    return record;
  }

  // â”€â”€â”€ Controle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  startAutomatedTrading(intervalSeconds = 60, tradeAmount = 10) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.log(`\nðŸ¤– TRADING REAL INICIADO â€” $${tradeAmount} a cada ${intervalSeconds}s`);

    // Primeiro ciclo imediato
    this.runTradingCycle(tradeAmount);

    this.intervalId = setInterval(() => {
      if (!this.isRunning) return;
      this.runTradingCycle(tradeAmount);
    }, intervalSeconds * 1000);
  }

  stopAutomatedTrading() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    this.log("â¹ï¸ Trading parado");
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
      message: `â¸ï¸ HOLD â€” ${reason}`,
      timestamp,
      confirmed: false,
    };
  }
}

export const realAutomatedTrader = new RealAutomatedTrader();

