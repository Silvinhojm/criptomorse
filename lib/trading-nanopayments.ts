// lib/trading-nanopayments.ts
// Trading automático multi-par usando saldo REAL da carteira conectada
// Arc Testnet = faucet (sem risco) | Outras redes = dinheiro real

import { realSwap, NETWORKS, TRADING_PAIRS, type NetworkKey, type TokenSymbol, type SwapResult } from "./real-swap-executor";

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

class TradingNanopaymentSystem {
  private orders: TradeOrder[] = [];
  private isInitialized = false;
  private currentNetwork: NetworkKey = "arc";
  private walletAddress = "";

  // Agentes com estratégias diferentes
  private agents: AgentStrategy[] = [
    {
      name: "QuantumTrader",
      strategy: "best_pair",
      maxAmount: 10,
      minProfitThreshold: 0.0001,
      description: "Escolhe sempre o melhor par disponível",
    },
    {
      name: "ArbitrageHunter",
      strategy: "arbitrage",
      maxAmount: 5,
      minProfitThreshold: 0.0005,
      description: "Busca oportunidades de arbitragem entre pares estáveis",
    },
    {
      name: "ScalpingBot",
      strategy: "scalping",
      maxAmount: 2,
      minProfitThreshold: 0.0001,
      description: "Micro trades rápidos em pares de alta liquidez",
    },
    {
      name: "MarketMaker",
      strategy: "momentum",
      maxAmount: 8,
      minProfitThreshold: 0.0002,
      description: "Segue tendência do mercado com pares voláteis",
    },
  ];

  // ─── Inicialização ─────────────────────────────────────────────────────────
  async initialize(walletAddress: string, networkKey: NetworkKey, privateKey?: string): Promise<boolean> {
    try {
      this.walletAddress = walletAddress;
      this.currentNetwork = networkKey;

      const ok = await realSwap.initialize(
        privateKey || walletAddress,
        networkKey,
        !privateKey
      );

      if (ok) {
        this.isInitialized = true;
        const net = NETWORKS[networkKey];
        console.log(`✅ TradingSystem: ${net.name} | ${walletAddress} | ${net.isTestnet ? "TESTNET (faucet)" : "MAINNET (dinheiro real)"}`);
      }

      return ok;
    } catch (err) {
      console.error("❌ Erro ao inicializar TradingSystem:", err);
      return false;
    }
  }

  // ─── Saldos reais da carteira ──────────────────────────────────────────────
  async getRealBalances() {
    if (!this.isInitialized) return [];
    await realSwap.refreshAllBalances();
    return realSwap.getAllBalances().filter(b => b.balance > 0);
  }

  // ─── Encontrar melhor par para um agente ──────────────────────────────────
  async findBestPairForAgent(agent: AgentStrategy): Promise<{ from: TokenSymbol; to: TokenSymbol; label: string } | null> {
    const pairs = TRADING_PAIRS[this.currentNetwork];
    const net   = NETWORKS[this.currentNetwork];

    // Filtrar pares onde o agente tem saldo suficiente
    const affordable = pairs.filter(p => {
      const bal = realSwap.getBalance(p.from);
      return bal >= agent.maxAmount * 0.9;
    });

    if (affordable.length === 0) return null;

    // Estratégia: retornar par com mais saldo disponível (mais seguro)
    if (agent.strategy === "scalping") {
      // Scalping prefere stablecoins (menor risco)
      const stables = affordable.filter(p =>
        ["USDC", "USDT", "DAI", "EURC"].includes(p.from) &&
        ["USDC", "USDT", "DAI", "EURC"].includes(p.to)
      );
      return stables[0] ?? affordable[0];
    }

    if (agent.strategy === "arbitrage") {
      // Arbitragem prefere pares estáveis com spread
      const stables = affordable.filter(p =>
        ["USDC", "USDT", "DAI", "EURC"].includes(p.from)
      );
      return stables[Math.floor(Math.random() * stables.length)] ?? affordable[0];
    }

    // best_pair e momentum: qualquer par com saldo
    return affordable[Math.floor(Math.random() * affordable.length)];
  }

  // ─── Executar trade de um agente ──────────────────────────────────────────
  async executeAgentTrade(
    agent: AgentStrategy,
    onLog?: (msg: string) => void
  ): Promise<TradeOrder | null> {
    if (!this.isInitialized) return null;

    const net = NETWORKS[this.currentNetwork];
    const log = (msg: string) => { console.log(`[${agent.name}] ${msg}`); onLog?.(msg); };

    log(`🤖 ${agent.name} (${agent.strategy}) analisando ${net.name}...`);

    let result: SwapResult;

    if (agent.strategy === "best_pair") {
      // Usa o sistema inteligente de busca do melhor par
      result = await realSwap.executeSmartSwap(agent.maxAmount, (msg) => log(msg));
    } else {
      const pair = await this.findBestPairForAgent(agent);
      if (!pair) {
        log(`⚠️ Sem saldo suficiente para qualquer par em ${net.name}`);
        return null;
      }
      log(`📊 Par escolhido: ${pair.label}`);
      result = await realSwap.executeSwap(pair.from, pair.to, agent.maxAmount, (msg) => log(msg));
    }

    const order: TradeOrder = {
      id: `${agent.name}_${Date.now()}`,
      fromToken: result.fromToken,
      toToken:   result.toToken,
      amount:    result.fromAmount,
      toAmount:  result.toAmount,
      type:      result.success ? "BUY" : "HOLD",
      status:    result.success ? "completed" : "failed",
      timestamp: result.timestamp,
      profit:    result.profit ?? 0,
      txHash:    result.txHash || undefined,
      explorerUrl: result.explorerUrl || undefined,
      agentName: agent.name,
      networkKey: this.currentNetwork,
    };

    this.orders.push(order);

    if (result.success) {
      log(`✅ Trade confirmado! Lucro: $${order.profit.toFixed(6)}`);
    } else {
      log(`❌ Trade falhou: ${result.message}`);
    }

    return order;
  }

  // ─── Ciclo automático de todos os agentes ─────────────────────────────────
  async executeAutomatedCycle(onLog?: (msg: string) => void): Promise<TradeOrder[]> {
    const results: TradeOrder[] = [];
    const net = NETWORKS[this.currentNetwork];
    onLog?.(`🔄 Ciclo automático — ${net.name} | ${net.isTestnet ? "🧪 TESTNET" : "💰 MAINNET"}`);

    // Atualizar saldos antes do ciclo
    await realSwap.refreshAllBalances();
    const balances = realSwap.getAllBalances().filter(b => b.balance > 0);
    onLog?.(`💼 Saldos: ${balances.map(b => `${b.symbol}:${b.balance.toFixed(4)}`).join(" | ")}`);

    for (const agent of this.agents) {
      try {
        const order = await this.executeAgentTrade(agent, onLog);
        if (order) results.push(order);
        // Pequena pausa entre agentes para não sobrecarregar RPC
        await new Promise(r => setTimeout(r, 1000));
      } catch (err: any) {
        onLog?.(`❌ ${agent.name} erro: ${err?.message}`);
      }
    }

    return results;
  }

  // ─── Estatísticas ──────────────────────────────────────────────────────────
  getStats(): TradingStats {
    const completed = this.orders.filter(o => o.status === "completed");
    const profitable = completed.filter(o => o.profit > 0);
    const totalVolume = completed.reduce((s, o) => s + o.amount, 0);
    const totalProfit = completed.reduce((s, o) => s + o.profit, 0);

    // Par mais lucrativo
    const pairProfits = new Map<string, number>();
    completed.forEach(o => {
      const key = `${o.fromToken}→${o.toToken}`;
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