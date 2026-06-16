// lib/trading-nanopayments.ts
// Trading automatico multi-par com votacao entre agentes,
// gerenciamento de posicoes (trailing stop), e relatorio do contador

import { realSwap, NETWORKS, TRADING_PAIRS, GAS_COST_ESTIMATE, type NetworkKey, type TokenSymbol, type SwapResult } from "./real-swap-executor";
import { getCircuitBreakerState, blockIfPanicked, recordTradeResult } from "./circuit-breaker";
import { saveTradeHistory, loadTradeHistory } from "./persistence";
import { positionManager, type OpenPosition } from "./position-manager";
import { accountant, type TradeReport } from "./accountant";
import { agentVoting, type AgentVote } from "./agent-voting";

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
  profitPercent: number;
  txHash?: string;
  explorerUrl?: string;
  agentName: string;
  route?: string;
  networkKey: NetworkKey;
}

export interface AgentStrategy {
  name: string;
  strategy: "best_pair" | "momentum" | "arbitrage" | "scalping" | "btc_eth" | "position_holder" | "nim";
  maxAmount: number;
  minProfitThreshold: number;
  description: string;
  maxOpenPositions: number;
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

const STABLES = new Set(["USDC", "USDT", "DAI", "EURC"]);

let priceCache: { price: number; timestamp: number; token: string }[] = [];

async function getTokenPrice(token: TokenSymbol): Promise<number> {
  const cached = priceCache.find(p => p.token === token);
  if (cached && Date.now() - cached.timestamp < 60000) return cached.price;

  const coinIds: Record<string, string> = {
    WETH: "ethereum", WMATIC: "matic-network", ARB: "arbitrum",
    WBTC: "bitcoin", USDC: "usd-coin", EURC: "eurc",
  };
  const coinId = coinIds[token];
  if (!coinId) return 1.0;

  try {
    const res = await fetch(`/api/price?ids=${coinId}`);
    if (!res.ok) return priceCache.find(p => p.token === token)?.price ?? 1.0;
    const data = await res.json();
    const price = data[coinId] ?? 1.0;
    if (price > 0) {
      priceCache.push({ price, timestamp: Date.now(), token });
    }
    return price;
  } catch {
    return priceCache.find(p => p.token === token)?.price ?? 1.0;
  }
}

class TradingNanopaymentSystem {
  private orders: TradeOrder[] = [];
  private isInitialized = false;
  private currentNetwork: NetworkKey = "arc";
  private walletAddress = "";
  private positionMonitorInterval: ReturnType<typeof setInterval> | null = null;

  private agents: AgentStrategy[] = [
    {
      name: "QuantumTrader",
      strategy: "best_pair",
      maxAmount: 10,
      minProfitThreshold: 0.01,
      description: "Escolhe o melhor par via LI.FI findBestPair",
      maxOpenPositions: 2,
    },
    {
      name: "ArbitrageHunter",
      strategy: "arbitrage",
      maxAmount: 5,
      minProfitThreshold: 0.02,
      description: "Arbitragem entre stablecoins com maior spread",
      maxOpenPositions: 1,
    },
    {
      name: "ScalpingBot",
      strategy: "scalping",
      maxAmount: 2,
      minProfitThreshold: 0.005,
      description: "Micro trades em pares estaveis de alta liquidez",
      maxOpenPositions: 3,
    },
    {
      name: "MarketMaker",
      strategy: "position_holder",
      maxAmount: 8,
      minProfitThreshold: 0.01,
      description: "Abre posicoes em tokens volatil (WETH/WBTC) com trailing stop",
      maxOpenPositions: 2,
    },
    {
      name: "BTCTrader",
      strategy: "btc_eth",
      maxAmount: 15,
      minProfitThreshold: 0.02,
      description: "Trading BTC/ETH com analise de spread e momentum",
      maxOpenPositions: 1,
    },
    {
      name: "NVIDIAgent",
      strategy: "nim",
      maxAmount: 10,
      minProfitThreshold: 0.01,
      description: "LLM-powered agent via NVIDIA NIM (Nemotron-3)",
      maxOpenPositions: 2,
    },
  ];

  async initialize(walletAddress: string, networkKey: NetworkKey, privateKey?: string): Promise<boolean> {
    try {
      this.walletAddress = walletAddress;
      this.currentNetwork = networkKey;
      this.orders = (await loadTradeHistory()).filter((o: any) => o.agentName);

      const ok = await realSwap.initialize(privateKey || walletAddress, networkKey, !privateKey);
      if (ok) {
        this.isInitialized = true;
        const net = NETWORKS[networkKey];
        console.log(`TradingSystem: ${net.name} | ${walletAddress} | ${net.isTestnet ? "TESTNET" : "MAINNET"}`);
      }

      // Iniciar monitoramento de posicoes a cada 15s
      this._startPositionMonitor();

      return ok;
    } catch (err) {
      console.error("Erro ao inicializar TradingSystem:", err);
      return false;
    }
  }

  private _startPositionMonitor() {
    if (this.positionMonitorInterval) clearInterval(this.positionMonitorInterval);
    this.positionMonitorInterval = setInterval(async () => {
      await this._checkPositions();
    }, 15000);
  }

  private async _checkPositions() {
    const positions = positionManager.getOpenPositions();
    for (const pos of positions) {
      try {
        const price = await positionManager.fetchTokenPrice(pos.boughtToken);
        const decision = positionManager.updatePrice(pos.id, price);

        if (decision === "close") {
          console.log(`Fechando posicao ${pos.boughtToken} automaticamente...`);
          // Vender o token volatil de volta para USDC
          const result = await realSwap.executeSwap(
            pos.boughtToken as TokenSymbol,
            "USDC",
            pos.amountBought,
          );

          if (result.success) {
            positionManager.closePosition(pos.id, price);
            const profit = (price - pos.entryPrice) * pos.amountBought;
            accountant.addReport({
              id: `close_${pos.id}`,
              agentName: "PositionManager",
              action: "sell",
              fromToken: pos.boughtToken,
              toToken: "USDC",
              amount: pos.amountBought,
              toAmount: result.toAmount,
              profit,
              profitPercent: pos.currentProfitPercent,
              entryPrice: pos.entryPrice,
              exitPrice: price,
              status: "completed",
              duration: Date.now() - pos.entryTimestamp,
              timestamp: Date.now(),
              networkKey: pos.networkKey,
            });
          }
        }
      } catch (err) {
        console.warn(`Erro no monitoramento de ${pos.boughtToken}:`, err);
      }
    }
  }

  async getRealBalances() {
    if (!this.isInitialized) return [];
    await realSwap.refreshAllBalances();
    return realSwap.getAllBalances().filter(b => b.balance > 0);
  }

  async findBestPairForAgent(agent: AgentStrategy): Promise<{ from: TokenSymbol; to: TokenSymbol; label: string } | null> {
    const pairs = TRADING_PAIRS[this.currentNetwork];
    const affordable = pairs.filter(p => {
      const bal = realSwap.getBalance(p.from);
      return bal >= agent.maxAmount * 0.9;
    });
    if (affordable.length === 0) return null;

    const scored = await Promise.all(
      affordable.map(async (pair) => {
        const fromPrice = await getTokenPrice(pair.from);
        const toPrice = await getTokenPrice(pair.to);
        const spread = Math.abs((toPrice - fromPrice) / fromPrice) * 100;
        return { pair, spread, fromPrice, toPrice };
      })
    );

    if (agent.strategy === "scalping") {
      const stables = scored.filter(p => STABLES.has(p.pair.from) && STABLES.has(p.pair.to));
      if (stables.length === 0) return affordable[0];
      stables.sort((a, b) => b.spread - a.spread);
      return stables[0].pair;
    }

    if (agent.strategy === "arbitrage") {
      const stables = scored.filter(p =>
        STABLES.has(p.pair.from) && STABLES.has(p.pair.to) &&
        p.spread > agent.minProfitThreshold * 10
      );
      if (stables.length === 0) return affordable[0];
      stables.sort((a, b) => b.spread - a.spread);
      return stables[0].pair;
    }

    if (agent.strategy === "btc_eth") {
      const btcEth = scored.filter(p =>
        (p.pair.from === "WBTC" && p.pair.to === "WETH") ||
        (p.pair.from === "WETH" && p.pair.to === "WBTC")
      );
      if (btcEth.length > 0) return btcEth[0].pair;
      const btcUsdc = scored.filter(p => p.pair.from === "WBTC" || p.pair.to === "WBTC");
      if (btcUsdc.length > 0) return btcUsdc[0].pair;
    }

    if (agent.strategy === "position_holder") {
      const volatilePairs = scored.filter(p => !STABLES.has(p.pair.from) || !STABLES.has(p.pair.to));
      if (volatilePairs.length > 0) {
        volatilePairs.sort((a, b) => b.spread - a.spread);
        return volatilePairs[0].pair;
      }
    }

    if (agent.strategy === "nim") {
      scored.sort((a, b) => b.spread - a.spread);
      return scored[0]?.pair ?? affordable[0];
    }

    return affordable[0];
  }

  async executeAgentTrade(
    agent: AgentStrategy,
    onLog?: (msg: string) => void
  ): Promise<TradeOrder | null> {
    if (!this.isInitialized) return null;
    if (blockIfPanicked()) { onLog?.("Circuit breaker bloqueou"); return null; }

    const net = NETWORKS[this.currentNetwork];
    const log = (msg: string) => { console.log(`[${agent.name}] ${msg}`); onLog?.(msg); };

    log(`${agent.name} (${agent.strategy}) analisando ${net.name}...`);

    // Verificar limite de posicoes abertas
    const openPositions = positionManager.getOpenPositions().length;
    if (openPositions >= agent.maxOpenPositions) {
      log(`Limite de ${agent.maxOpenPositions} posicoes abertas atingido`);
      return null;
    }

    let result: SwapResult;
    let chosenPair: { from: TokenSymbol; to: TokenSymbol; label: string } | null = null;

    if (agent.strategy === "best_pair") {
      result = await realSwap.executeSmartSwap(agent.maxAmount, (msg) => log(msg));
    } else {
      const pair = await this.findBestPairForAgent(agent);
      if (!pair) { log(`Sem saldo para pares`); return null; }
      chosenPair = pair;
      log(`Par escolhido: ${pair.label}`);
      result = await realSwap.executeSwap(pair.from, pair.to, agent.maxAmount, (msg) => log(msg));
    }

    const actionType: "BUY" | "SELL" | "HOLD" = result.success ? result.action : "HOLD";

    const order: TradeOrder = {
      id: `${agent.name}_${Date.now()}`,
      fromToken: result.fromToken,
      toToken: result.toToken,
      amount: result.fromAmount,
      toAmount: result.toAmount,
      type: actionType,
      status: result.success ? "completed" : "failed",
      timestamp: result.timestamp,
      profit: result.profit ?? 0,
      profitPercent: result.fromAmount > 0 ? ((result.profit ?? 0) / result.fromAmount) * 100 : 0,
      txHash: result.txHash || undefined,
      explorerUrl: result.explorerUrl || undefined,
      agentName: agent.name,
      networkKey: this.currentNetwork,
    };
    this.orders.push(order);
    await saveTradeHistory(this.orders);

    // Registrar no contador
    const entryPrice = result.fromAmount > 0 ? result.fromAmount / result.toAmount : 1;
    const reportAction: "buy" | "sell" | "hold" = actionType === "BUY" ? "buy" : actionType === "SELL" ? "sell" : "hold";
    accountant.addReport({
      id: order.id,
      agentName: agent.name,
      action: reportAction,
      fromToken: result.fromToken,
      toToken: result.toToken,
      amount: result.fromAmount,
      toAmount: result.toAmount,
      profit: result.profit ?? 0,
      profitPercent: order.profitPercent,
      entryPrice,
      exitPrice: result.toAmount > 0 ? result.toAmount / result.fromAmount : 1,
      status: result.success ? "completed" : "failed",
      duration: 0,
      timestamp: Date.now(),
      networkKey: this.currentNetwork,
    });

    // Se comprou token volatil, abrir posicao com trailing stop
    if (result.success && chosenPair && !STABLES.has(chosenPair.to) && STABLES.has(chosenPair.from)) {
      const boughtPrice = await getTokenPrice(chosenPair.to);
      positionManager.openPosition(
        this.currentNetwork,
        chosenPair.to,
        chosenPair.from,
        result.toAmount,
        result.fromAmount,
        boughtPrice
      );
      log(`Posicao aberta: ${result.toAmount.toFixed(6)} ${chosenPair.to} @ $${boughtPrice.toFixed(4)}`);
    }

    if (result.success) {
      log(`Trade confirmado! Lucro: $${(result.profit ?? 0).toFixed(6)}`);
      recordTradeResult(result.profit ?? 0);
    } else {
      log(`Trade falhou: ${result.message}`);
    }

    return order;
  }

  async executeAutomatedCycle(onLog?: (msg: string) => void): Promise<TradeOrder[]> {
    const results: TradeOrder[] = [];
    const net = NETWORKS[this.currentNetwork];
    onLog?.(`Ciclo automatico - ${net.name} | ${net.isTestnet ? "TESTNET" : "MAINNET"}`);

    const cb = getCircuitBreakerState();
    if (cb.isPanicActive) {
      onLog?.(`Circuit breaker ativo: ${cb.panicReason}`);
      return results;
    }

    // Mostrar ranking dos agentes
    const ranking = accountant.getRanking();
    if (ranking.length > 0) {
      onLog?.("Ranking dos agentes:");
      ranking.slice(0, 5).forEach((r, i) => {
        onLog?.(`  #${i + 1} ${r.agentName}: ${r.winRate.toFixed(1)}% acertos (score: ${r.score.toFixed(0)})`);
      });
    }

    await realSwap.refreshAllBalances();
    const balances = realSwap.getAllBalances().filter(b => b.balance > 0);
    onLog?.(`Saldos: ${balances.map(b => `${b.symbol}:${b.balance.toFixed(4)}`).join(" | ")}`);

    // Mostrar posicoes abertas
    const positions = positionManager.getOpenPositions();
    if (positions.length > 0) {
      onLog?.(`Posicoes abertas: ${positions.length}`);
      positions.forEach(p => {
        onLog?.(`  ${p.boughtToken}: ${p.currentProfitPercent.toFixed(2)}% (pico: ${p.peakProfitPercent.toFixed(2)}%)`);
      });
    }

    // Votacao entre agentes
    agentVoting.clearVotes();
    const agentVotes = await Promise.all(
      this.agents.map(async (agent) => {
        try {
          const pair = await this.findBestPairForAgent(agent);
          if (!pair) return null;
          const fromPrice = await getTokenPrice(pair.from);
          const toPrice = await getTokenPrice(pair.to);

          if (agent.strategy === "nim") {
            const marketData = await fetch('/api/market-data').then(r => r.json()).catch(() => ({}));
            const prices = { [pair.from]: fromPrice, [pair.to]: toPrice };
            const nimRes = await fetch('/api/nim', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'nvidia/nemotron-3-nano-30b-a3b',
                messages: [
                  {
                    role: 'system',
                    content: `You are a crypto trading AI. Analyze market data and respond with JSON: {"action":"buy|sell|hold","confidence":0-100,"reasoning":"..."}`,
                  },
                  {
                    role: 'user',
                    content: JSON.stringify({ pair: pair.label, prices, spread: Math.abs((toPrice - fromPrice) / fromPrice) * 100, marketData }),
                  },
                ],
                temperature: 0.3,
                max_tokens: 256,
              }),
            });
            if (!nimRes.ok) throw new Error('NIM API error');
            const nimData = await nimRes.json();
            const text = nimData.choices?.[0]?.message?.content ?? '{}';
            const parsed = JSON.parse(text.replace(/```(?:json)?\s*/g, '').trim());
            const action = parsed.action === 'sell' ? 'sell' : parsed.action === 'buy' ? 'buy' : 'hold';
            const confidence = Math.min(95, Math.max(10, parsed.confidence ?? 50));
            return { agentName: agent.name, action, confidence, reason: `NIM: ${parsed.reasoning ?? 'LLM decision'}` } as AgentVote;
          }

          const spread = Math.abs(toPrice - fromPrice);
          const isStablePair = ['USDC', 'EURC', 'USDT', 'DAI'].includes(pair.from) && ['USDC', 'EURC', 'USDT', 'DAI'].includes(pair.to);
          // Para stable-stable: sempre tentar buy (arbitragem de spread), confiança baseada no spread
          const action = isStablePair && spread < 0.001 ? "buy" : toPrice > fromPrice ? "buy" : toPrice < fromPrice ? "sell" : "buy";
          const confidence = Math.min(85, Math.max(30, spread * 5000 + 30));
          return { agentName: agent.name, action, confidence, reason: `${pair.label} spread ${spread.toFixed(4)}%` } as AgentVote;
        } catch { return null; }
      })
    );

    agentVotes.filter(Boolean).forEach(v => agentVoting.registerVote(v!));
    const voteResult = agentVoting.resolve();
    onLog?.(`Votacao: ${voteResult.action} (${voteResult.confidence.toFixed(0)}% confianca, ${voteResult.votes.length} votos, desempate: ${voteResult.tiebreaker || "nenhum"})`);

    if (!voteResult.approved) {
      onLog?.(`Votacao reprovou o trade: ${voteResult.reason}`);
      return results;
    }

    // Executar trades dos agentes aprovados
    for (const agent of this.agents) {
      try {
        // Sair se voto foi hold
        if (voteResult.action === "hold") { onLog?.("Votacao decidiu HOLD, nenhum trade executado"); break; }

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
      totalOrders: this.orders.length,
      totalBuys: this.orders.filter(o => o.type === "BUY").length,
      totalSells: this.orders.filter(o => o.type === "SELL").length,
      totalVolume,
      totalProfit,
      winRate: completed.length > 0 ? (profitable.length / completed.length) * 100 : 0,
      bestPair,
      networkKey: this.currentNetwork,
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

  getOpenPositions(): OpenPosition[] {
    return positionManager.getOpenPositions();
  }

  getAgentRanking() {
    return accountant.getRanking();
  }

  getAccountantStats() {
    return accountant.getStats();
  }

  getAccountantReports(limit = 50) {
    return accountant.getReports(limit);
  }

  destroy() {
    if (this.positionMonitorInterval) {
      clearInterval(this.positionMonitorInterval);
      this.positionMonitorInterval = null;
    }
  }
}

export const tradingNanopaymentSystem = new TradingNanopaymentSystem();
