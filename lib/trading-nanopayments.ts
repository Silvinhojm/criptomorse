// lib/trading-nanopayments.ts
// Trading automatico multi-par usando saldo REAL da carteira conectada
// Arc Testnet = faucet (sem risco) | Outras redes = dinheiro real

import { realSwap, NETWORKS, TRADING_PAIRS, type NetworkKey, type TokenSymbol, type SwapResult } from "./real-swap-executor";
import { getCircuitBreakerState, blockIfPanicked, recordTradeResult } from "./circuit-breaker";
import { saveTradeHistory, loadTradeHistory } from "./persistence";

export interface TradeOrder {
  id: string;
  fromToken: TokenSymbol;
  toToken: TokenSymbol;
  amount: number;
  toAmount: number;
  type: "BUY" | "SELL" | "HOLD";
  status: "pending" | "completed" | "failed";
  timestamp: number;
  profit: number;
  txHash?: string;
  explorerUrl?: string;
  agentName: string;
  route?: string;
  networkKey: NetworkKey;
}

export interface AgentStrategy {
  name: string;
  strategy: "best_pair" | "momentum" | "arbitrage" | "scalping";
  maxAmount: number;
  minProfitThreshold: number;
  description: string;
}

export interface TradingStats {
  totalOrders: number;
  totalBuys: number;
  totalSells: number;
  totalVolume: number;
  totalProfit: number;
  winRate: number;
  bestPair: string;
  networkKey: NetworkKey;
}

// Tokens estaveis (USD peg)
const STABLES = new Set(["USDC", "USDT", "DAI", "EURC"]);

// Cache de preco para analise de spread
let priceCache: { price: number; timestamp: number; token: string }[] = [];

async function getTokenPrice(token: TokenSymbol): Promise<number> {
  const cached = priceCache.find(p => p.token === token);
  if (cached && Date.now() - cached.timestamp < 60000) return cached.price;

  if (STABLES.has(token)) return 1.0;

  const coinIds: Record<string, string> = {
    WETH: "ethereum", WMATIC: "matic-network", ARB: "arbitrum",
  };
  const coinId = coinIds[token];
  if (!coinId) return 1.0;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);
    const data = await res.json();
    const price = data[coinId]?.usd ?? 1.0;
    priceCache.push({ price, timestamp: Date.now(), token });
    return price;
  } catch {
    return 1.0;
  }
}

class TradingNanopaymentSystem {
  private orders: TradeOrder[] = [];
  private isInitialized = false;
  private currentNetwork: NetworkKey = "arc";
  private walletAddress = "";

  private agents: AgentStrategy[] = [
    {
      name: "QuantumTrader",
      strategy: "best_pair",
      maxAmount: 10,
      minProfitThreshold: 0.01,
      description: "Escolhe sempre o melhor par disponivel",
    },
    {
      name: "ArbitrageHunter",
      strategy: "arbitrage",
      maxAmount: 5,
      minProfitThreshold: 0.02,
      description: "Busca oportunidades de arbitragem entre pares estaveis",
    },
    {
      name: "ScalpingBot",
      strategy: "scalping",
      maxAmount: 2,
      minProfitThreshold: 0.005,
      description: "Micro trades rapidos em pares de alta liquidez",
    },
    {
      name: "MarketMaker",
      strategy: "momentum",
      maxAmount: 8,
      minProfitThreshold: 0.01,
      description: "Segue tendencia com pares via findBestPair",
    },
  ];

  async initialize(walletAddress: string, networkKey: NetworkKey, privateKey?: string): Promise<boolean> {
    try {
      this.walletAddress = walletAddress;
      this.currentNetwork = networkKey;

      // Restaurar historico persistido
      this.orders = loadTradeHistory().filter((o: any) => o.agentName);

      const ok = await realSwap.initialize(
        privateKey || walletAddress,
        networkKey,
        !privateKey
      );

      if (ok) {
        this.isInitialized = true;
        const net = NETWORKS[networkKey];
        console.log(`TradingSystem: ${net.name} | ${walletAddress} | ${net.isTestnet ? "TESTNET" : "MAINNET"}`);
      }

      return ok;
    } catch (err) {
      console.error("Erro ao inicializar TradingSystem:", err);
      return false;
    }
  }

  async getRealBalances() {
    if (!this.isInitialized) return [];
    await realSwap.refreshAllBalances();
    return realSwap.getAllBalances().filter(b => b.balance > 0);
  }

  async findBestPairForAgent(agent: AgentStrategy): Promise<{ from: TokenSymbol; to: TokenSymbol; label: string } | null> {
    const pairs = TRADING_PAIRS[this.currentNetwork];
    const net = NETWORKS[this.currentNetwork];

    const affordable = pairs.filter(p => {
      const bal = realSwap.getBalance(p.from);
      return bal >= agent.maxAmount * 0.9;
    });

    if (affordable.length === 0) return null;

    // Calcular spread estimado para cada par e escolher o melhor
    const scored = await Promise.all(
      affordable.map(async (pair) => {
        const fromPrice = await getTokenPrice(pair.from);
        const toPrice = await getTokenPrice(pair.to);
        const spread = Math.abs((toPrice - fromPrice) / fromPrice) * 100;
        return { pair, spread, fromPrice, toPrice };
      })
    );

    if (agent.strategy === "scalping") {
      // Scalping: maior spread entre stables
      const stables = scored.filter(p =>
        STABLES.has(p.pair.from) && STABLES.has(p.pair.to)
      );
      if (stables.length === 0) return affordable[0];
      stables.sort((a, b) => b.spread - a.spread);
      console.log(`[Scalping] Maior spread: ${stables[0].pair.label} (${stables[0].spread.toFixed(3)}%)`);
      return stables[0].pair;
    }

    if (agent.strategy === "arbitrage") {
      // Arbitrage: par estavel com maior spread positivo
      const stables = scored.filter(p =>
        STABLES.has(p.pair.from) && STABLES.has(p.pair.to) &&
        p.spread > agent.minProfitThreshold * 10
      );
      if (stables.length === 0) return affordable[0];
      stables.sort((a, b) => b.spread - a.spread);
      console.log(`[Arbitrage] Melhor spread: ${stables[0].pair.label} (${stables[0].spread.toFixed(3)}%)`);
      return stables[0].pair;
    }

    // momentum: par com maior potencial (volatil)
    if (agent.strategy === "momentum") {
      const volatiles = scored.filter(p => !STABLES.has(p.pair.from) || !STABLES.has(p.pair.to));
      if (volatiles.length > 0) {
        volatiles.sort((a, b) => b.spread - a.spread);
        console.log(`[Momentum] Par volatil escolhido: ${volatiles[0].pair.label} (spread ${volatiles[0].spread.toFixed(3)}%)`);
        return volatiles[0].pair;
      }
    }

    return affordable[0];
  }

  async executeAgentTrade(
    agent: AgentStrategy,
    onLog?: (msg: string) => void
  ): Promise<TradeOrder | null> {
    if (!this.isInitialized) return null;

    // Circuit breaker
    if (blockIfPanicked()) {
      onLog?.("Circuit breaker bloqueou trade");
      return null;
    }

    const net = NETWORKS[this.currentNetwork];
    const log = (msg: string) => { console.log(`[${agent.name}] ${msg}`); onLog?.(msg); };

    log(`${agent.name} (${agent.strategy}) analisando ${net.name}...`);

    let result: SwapResult;

    if (agent.strategy === "best_pair" || agent.strategy === "momentum") {
      result = await realSwap.executeSmartSwap(agent.maxAmount, (msg) => log(msg));
    } else {
      const pair = await this.findBestPairForAgent(agent);
      if (!pair) {
        log(`Sem saldo suficiente para qualquer par em ${net.name}`);
        return null;
      }
      log(`Par escolhido: ${pair.label}`);
      result = await realSwap.executeSwap(pair.from, pair.to, agent.maxAmount, (msg) => log(msg));
    }

    const order: TradeOrder = {
      id: `${agent.name}_${Date.now()}`,
      fromToken: result.fromToken,
      toToken:   result.toToken,
      amount:    result.fromAmount,
      toAmount:  result.toAmount,
      type:      result.success ? result.action : "HOLD",
      status:    result.success ? "completed" : "failed",
      timestamp: result.timestamp,
      profit:    result.profit ?? 0,
      txHash:    result.txHash || undefined,
      explorerUrl: result.explorerUrl || undefined,
      agentName: agent.name,
      networkKey: this.currentNetwork,
    };

    this.orders.push(order);

    // Persistir historico
    saveTradeHistory(this.orders);

    if (result.success) {
      log(`Trade confirmado! Lucro: $${order.profit.toFixed(6)}`);
      recordTradeResult(order.profit);
    } else {
      log(`Trade falhou: ${result.message}`);
    }

    return order;
  }

  async executeAutomatedCycle(onLog?: (msg: string) => void): Promise<TradeOrder[]> {
    const results: TradeOrder[] = [];
    const net = NETWORKS[this.currentNetwork];
    onLog?.(`Ciclo automatico - ${net.name} | ${net.isTestnet ? "TESTNET" : "MAINNET"}`);

    // Verificar circuit breaker antes do ciclo
    const cb = getCircuitBreakerState();
    if (cb.isPanicActive) {
      onLog?.(`Circuit breaker ativo desde ${cb.panicTimestamp}. Motivo: ${cb.panicReason}`);
      return results;
    }

    await realSwap.refreshAllBalances();
    const balances = realSwap.getAllBalances().filter(b => b.balance > 0);
    onLog?.(`Saldos: ${balances.map(b => `${b.symbol}:${b.balance.toFixed(4)}`).join(" | ")}`);

    for (const agent of this.agents) {
      try {
        const order = await this.executeAgentTrade(agent, onLog);
        if (order) results.push(order);
        await new Promise(r => setTimeout(r, 1000));
      } catch (err: any) {
        onLog?.(`${agent.name} erro: ${err?.message}`);
      }
    }

    return results;
  }

  getStats(): TradingStats {
    const completed = this.orders.filter(o => o.status === "completed");
    const profitable = completed.filter(o => o.profit > 0);
    const totalVolume = completed.reduce((s, o) => s + o.amount, 0);
    const totalProfit = completed.reduce((s, o) => s + o.profit, 0);

    const pairProfits = new Map<string, number>();
    completed.forEach(o => {
      const key = `${o.fromToken}->${o.toToken}`;
      pairProfits.set(key, (pairProfits.get(key) ?? 0) + o.profit);
    });
    let bestPair = "-";
    let bestProfit = -Infinity;
    pairProfits.forEach((profit, pair) => {
      if (profit > bestProfit) { bestProfit = profit; bestPair = pair; }
    });

    return {
      totalOrders:  this.orders.length,
      totalBuys:    this.orders.filter(o => o.type === "BUY").length,
      totalSells:   this.orders.filter(o => o.type === "SELL").length,
      totalVolume,
      totalProfit,
      winRate:      completed.length > 0 ? (profitable.length / completed.length) * 100 : 0,
      bestPair,
      networkKey:   this.currentNetwork,
    };
  }

  getOrderHistory(agentName?: string): TradeOrder[] {
    if (agentName) return this.orders.filter(o => o.agentName === agentName);
    return [...this.orders].reverse();
  }

  getAvailablePairs(): Array<{ from: TokenSymbol; to: TokenSymbol; label: string }> {
    return TRADING_PAIRS[this.currentNetwork] ?? [];
  }

  getAgents(): AgentStrategy[] {
    return this.agents;
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  getCurrentNetwork(): NetworkKey {
    return this.currentNetwork;
  }
}

export const tradingNanopaymentSystem = new TradingNanopaymentSystem();
