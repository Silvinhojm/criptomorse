// lib/real-automated-trader.ts
// Robô de trading REAL — estratégia baseada em spread USDC/EURC
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

// ─── Preços simulados de mercado (em produção, use Chainlink ou CoinGecko) ───

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

// ─── Classe Principal ─────────────────────────────────────────────────────────

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
  private cycleInProgress = false;
  private sellCooldownUntil = 0;
  private consecutiveSellFailures = 0;

  // ─── Setup ──────────────────────────────────────────────────────────────────

   async initialize(
    privateKey: string,
    networkKey: keyof typeof NETWORKS = "arc"
  ): Promise<boolean> {
    this.privateKey = privateKey;
    this.networkKey = networkKey;
    console.log(`🔑 RealAutomatedTrader.initialize() called with network: ${networkKey}`);
    const ok = await realSwap.initialize(privateKey, networkKey);
    console.log(`✅ realSwap.initialize() result: ${ok}`);
    this.initialized = ok;
    return ok;
  }

  /** Mudar de rede sem reinicializar */
  switchNetwork(networkKey: keyof typeof NETWORKS): void {
    this.networkKey = networkKey;
    realSwap.switchNetwork(networkKey);
    this.log(`🔄 Trader mudou para: ${NETWORKS[networkKey].name}`);
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

  // ─── Saldos ──────────────────────────────────────────────────────────────────

  async getBalances(): Promise<{ usdc: number; eurc: number }> {
    console.log(`💾 getBalances() chamado - rede atual: ${this.networkKey}`);
    const [usdc, eurc] = await Promise.all([
      realSwap.getBalance("USDC"),
      realSwap.getBalance("EURC"),
    ]);
    console.log(`💰 getBalances() resultado - USDC: ${usdc}, EURC: ${eurc}`);
    return { usdc, eurc };
  }

  // ─── Ciclo de Trading ─────────────────────────────────────────────────────────

  async runTradingCycle(tradeAmount: number = 10): Promise<TradeRecord> {
    if (this.cycleInProgress) {
      this.log("⏭️ Ciclo anterior ainda em execução — aguardando confirmação on-chain");
      return this._holdRecord(
        `trade_skip_${Date.now()}`,
        "Ciclo anterior em andamento",
        Date.now()
      );
    }

    this.cycleInProgress = true;
    try {
      return await this._runTradingCycle(tradeAmount);
    } finally {
      this.cycleInProgress = false;
    }
  }

  private async _runTradingCycle(tradeAmount: number = 10): Promise<TradeRecord> {
    const timestamp = Date.now();
    const id = `trade_${timestamp}`;

    if (!this.initialized) {
      this.log("❌ Trader não inicializado");
      return this._holdRecord(id, "Não inicializado", timestamp);
    }

    // 1. Ler saldos reais
    const { usdc, eurc } = await this.getBalances();
    this.log(`💰 Saldos — USDC: $${usdc.toFixed(2)} | EURC: €${eurc.toFixed(2)}`);

    // 2. Buscar spread de mercado
    const market = await fetchSpread();
    this.log(
      `📊 Spread USDC/EURC: ${market.spread.toFixed(3)}% | EURC: $${market.eurc.toFixed(4)}`
    );

    const MIN_SPREAD = 0.4;
    const MAX_EURC_ACCUMULATION = tradeAmount * 3;
    let action: "BUY" | "SELL" | "HOLD" = "HOLD";

    // Prioridade 1: rebalancear EURC acumulado
    if (eurc >= tradeAmount * 0.9 && (usdc < tradeAmount || eurc >= MAX_EURC_ACCUMULATION)) {
      action = "SELL";
    }
    // Prioridade 2: BUY só se ainda há espaço para EURC
    else if (
      market.spread >= MIN_SPREAD &&
      usdc >= tradeAmount &&
      eurc < MAX_EURC_ACCUMULATION
    ) {
      action = "BUY";
    }
    // Prioridade 3: SELL se spread favorável e tem EURC
    else if (eurc >= tradeAmount * 0.9 && market.spread >= MIN_SPREAD) {
      action = "SELL";
    } else {
      this.log(
        `⏸️ HOLD — spread ${market.spread.toFixed(3)}% ou saldo insuficiente (USDC $${usdc.toFixed(2)}, EURC €${eurc.toFixed(2)})`
      );
      this.lastAction = `HOLD (spread ${market.spread.toFixed(3)}%)`;
      return this._holdRecord(
        id,
        `Spread ${market.spread.toFixed(3)}% — abaixo do mínimo ou saldo insuficiente`,
        timestamp
      );
    }

    if (action === "SELL" && Date.now() < this.sellCooldownUntil) {
      const mins = Math.ceil((this.sellCooldownUntil - Date.now()) / 60000);
      this.log(`⏸️ SELL em cooldown (${mins}min) — LI.FI sem rota viável (price impact alto)`);
      this.lastAction = `HOLD (cooldown SELL ${mins}min)`;
      return this._holdRecord(id, "SELL em cooldown — price impact alto no LI.FI", timestamp);
    }

    // 4. Executar swap REAL
    this.log(`🚀 Executando ${action} de $${tradeAmount} via LI.FI...`);
    const result: SwapResult = await realSwap.executeSwap(action, tradeAmount, (msg) =>
      this.log(msg)
    );

    if (action === "SELL") {
      if (result.success && result.confirmed) {
        this.consecutiveSellFailures = 0;
      } else {
        this.consecutiveSellFailures++;
        if (this.consecutiveSellFailures >= 2) {
          this.sellCooldownUntil = Date.now() + 5 * 60 * 1000;
          this.log(
            "⏸️ Pausando SELL por 5min — use Bridge/Swap manual (Jumper) ou aguarde liquidez"
          );
        }
      }
    }

    // 5. Calcular lucro real
    let profit = 0;
    if (result.success && result.confirmed && result.toAmount > 0) {
      if (action === "BUY") {
        // Compramos EURC: lucro = (EURC recebido * preço) - USDC gasto
        profit = parseFloat((result.toAmount * market.eurc - tradeAmount).toFixed(4));
      } else {
        // Vendemos EURC: lucro = USDC recebido - custo em USD
        profit = parseFloat((result.toAmount - tradeAmount).toFixed(4));
      }
      profit = isNaN(profit) ? 0 : profit;
    }

    this.totalProfit += profit;
    this.lastAction = `${action} $${tradeAmount} → TX ${result.txHash.slice(0, 8)}...`;

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

  // ─── Controle ─────────────────────────────────────────────────────────────────

  startAutomatedTrading(intervalSeconds = 60, tradeAmount = 10) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.sellCooldownUntil = 0;
    this.consecutiveSellFailures = 0;
    this.log(`\n🤖 TRADING REAL INICIADO — $${tradeAmount} a cada ${intervalSeconds}s`);

    void this.runTradingCycle(tradeAmount);

    this.intervalId = setInterval(() => {
      if (!this.isRunning) return;
      void this.runTradingCycle(tradeAmount);
    }, intervalSeconds * 1000);
  }

  stopAutomatedTrading() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    this.log("⏹️ Trading parado");
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
      message: `⏸️ HOLD — ${reason}`,
      timestamp,
      confirmed: false,
    };
  }
}

export const realAutomatedTrader = new RealAutomatedTrader();
