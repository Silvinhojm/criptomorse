// lib/automated-trader.ts - CORRIGIDO
// Sistema de trading automático integrado com agentes e nanopagamentos

import { nanopaymentSystem } from "./nanopayment-system";
import { quantumAgent, technicalAgent } from "./multi-agent-system";
import { marketAgent } from "./market-agent";
import { volumeAgent } from "./volume-agent";
import newsAgent from "./news-agent";
import { votingSystem, AgentVote } from "./voting-system";
import { realBalance } from "./real-balance-integration";
import { quantumWaveTrader, QuantumPair } from "./quantum-wave";

export interface TradeSignal {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reason: string;
  agentsVotes: AgentVote[];
  expectedProfit: number;
  collapsedPair?: QuantumPair;
}

export interface TradeResult {
  success: boolean;
  profit: number;
  txHash?: string;
  message: string;
  timestamp: number;
}

class AutomatedTrader {
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private tradeHistory: TradeResult[] = [];
  private totalProfit: number = 0;
  private userAddress: string = '';
  private tradeAmount: number = 3;

  initialize(userAddress: string) {
    this.userAddress = userAddress;
    console.log(`🤖 Automated Trader inicializado para: ${userAddress}`);
  }

  async collectAgentSignals(): Promise<TradeSignal> {
    const payments = [];

    console.log("🌊 Computador quântico: broadcast do valor investido na rede...");

    const wave = quantumWaveTrader.broadcastIntent(this.tradeAmount);

    let marketData: any;
    try {
      const res = await fetch('/api/market-data', { signal: AbortSignal.timeout(5000) });
      if (res.ok) marketData = await res.json();
    } catch { /* fallback sem dados */ }

    const agentConsensus = new Map<string, { pair: QuantumPair; confidence: number }[]>();

    for (const pair of wave.pairs) {
      let agentVotes: { pair: QuantumPair; confidence: number }[] = [];

      try {
        await nanopaymentSystem.makePayment('RealTrader', 'QuantumAgent', 0.02, 'Onda quântica');
        const qOpinion = quantumAgent.decide(pair.amplitude);
        if (qOpinion.action !== 'hold') {
          agentVotes.push({ pair, confidence: qOpinion.confidence });
        }
        payments.push('QuantumAgent');
      } catch {}

      try {
        await nanopaymentSystem.makePayment('RealTrader', 'TechnicalAgent', 0.008, 'Onda técnica');
        const indicators = technicalAgent.calculateIndicators([pair.amplitude, pair.volatility, pair.momentum]);
        const indArray = Object.values(indicators).map((v: any) => typeof v === 'string' ? (v === 'up' ? 1 : -1) : (v as number));
        const tOpinion = technicalAgent.decide(indArray, pair.amplitude);
        if (tOpinion.action !== 'hold') {
          agentVotes.push({ pair, confidence: tOpinion.confidence });
        }
        payments.push('TechnicalAgent');
      } catch {}

      if (agentVotes.length > 0) {
        const key = `🌌 Quantum:${pair.label}`;
        agentConsensus.set(key, agentVotes);
      }
    }

    for (const pair of wave.pairs.slice(0, Math.ceil(wave.pairs.length * 0.3))) {
      let agentVotes: { pair: QuantumPair; confidence: number }[] = [];

      try {
        await nanopaymentSystem.makePayment('RealTrader', 'NewsAgent', 0.005, 'Onda notícias');
        const nDecision = await newsAgent.decide(marketData);
        if (nDecision.action !== 'hold') {
          agentVotes.push({ pair, confidence: nDecision.confidence });
        }
        payments.push('NewsAgent');
      } catch {}

      try {
        await nanopaymentSystem.makePayment('RealTrader', 'MarketAgent', 0.01, 'Onda mercado');
        await marketAgent.updateMarketInsights(marketData);
        const mOpinion = marketAgent.getAdvice();
        if (mOpinion.action !== 'hold') {
          agentVotes.push({ pair, confidence: mOpinion.confidence });
        }
        payments.push('MarketAgent');
      } catch {}

      try {
        await nanopaymentSystem.makePayment('RealTrader', 'VolumeAgent', 0.007, 'Onda volume');
        await volumeAgent.refreshFromMarket(marketData);
        const vAnalysis = volumeAgent.analyzeVolume(1000000, 2, 5);
        if (vAnalysis.action !== 'hold') {
          agentVotes.push({ pair, confidence: vAnalysis.confidence });
        }
        payments.push('VolumeAgent');
      } catch {}

      if (agentVotes.length > 0) {
        const key = `📰 News+Market+Volume:${pair.label}`;
        agentConsensus.set(key, agentVotes);
      }
    }

    const result = quantumWaveTrader.collapseWave(wave, agentConsensus);

    if (!result) {
      console.log('🌀 Nenhuma possibilidade colapsou — HOLD');
      return {
        action: 'HOLD',
        confidence: 0,
        reason: 'Nenhum par atingiu consenso entre os agentes',
        agentsVotes: [],
        expectedProfit: 0,
      };
    }

    const { collapsed, confidence } = result;
    console.log(`🎯 Onda colapsada para: ${collapsed.label} (${collapsed.network}) — ${confidence}% confiança`);
    console.log(`💸 Pagamentos: ${payments.join(', ')}`);

    const votes: AgentVote[] = [
      {
        agentName: 'QuantumWave',
        action: collapsed.momentum > 0 ? 'buy' : 'sell',
        confidence,
        weight: 1,
        color: '#a78bfa',
        icon: '🌌',
      },
    ];

    return {
      action: collapsed.momentum > 0 ? 'BUY' : 'SELL',
      confidence,
      reason: `🌊 Onda quântica colapsou para ${collapsed.label} (${collapsed.network}) — ${confidence}%`,
      agentsVotes: votes,
      expectedProfit: (confidence / 100) * 0.5,
      collapsedPair: collapsed,
    };
  }

  async executeTrade(signal: TradeSignal, tradeAmount: number = 3): Promise<TradeResult> {
    if (signal.action === 'HOLD') {
      return {
        success: true,
        profit: 0,
        message: `HOLD: ${signal.reason}`,
        timestamp: Date.now()
      };
    }

    const pairInfo = signal.collapsedPair
      ? `${signal.collapsedPair.label} (${signal.collapsedPair.network})`
      : 'USDC→par';

    console.log(`🌊 Executando ordem colapsada: ${pairInfo}`);

    const currentBalance = await realBalance.getRealUSDCBalance(this.userAddress);
    console.log(`💰 Saldo atual: $${currentBalance.toFixed(4)}`);
    
    if (currentBalance < tradeAmount) {
      console.log(`❌ Saldo insuficiente: $${currentBalance.toFixed(4)} < $${tradeAmount}`);
      return {
        success: false,
        profit: 0,
        message: `Saldo insuficiente: $${currentBalance.toFixed(4)}. Necessário: $${tradeAmount}`,
        timestamp: Date.now()
      };
    }

    const isWin = Math.random() < (signal.confidence / 100);
    const profit = isWin ? tradeAmount * 0.005 : -tradeAmount * 0.002;
    
    console.log(`🌀 Onda ${signal.action} | ${isWin ? '✅ GANHOU' : '❌ PERDEU'} | Lucro: $${profit.toFixed(4)}`);

    if (profit > 0) {
      const agentProfit = profit * 0.3;
      signal.agentsVotes.forEach(vote => {
        nanopaymentSystem.addCredits(vote.agentName, agentProfit / signal.agentsVotes.length);
      });
      nanopaymentSystem.addCredits('RealTrader', profit * 0.7);
    }

    this.totalProfit += profit;
    this.tradeHistory.push({
      success: true,
      profit,
      message: `🌊 ${signal.action} ${pairInfo}: ${signal.confidence}%`,
      timestamp: Date.now()
    });

    return {
      success: true,
      profit,
      message: `🌊 ${pairInfo} ${signal.action} — ${signal.confidence}%`,
      timestamp: Date.now()
    };
  }

  async runTradingCycle(tradeAmount: number = 3): Promise<TradeResult> {
    this.tradeAmount = tradeAmount;
    console.log("\n🌀 Iniciando ciclo quântico de trading...");
    const signal = await this.collectAgentSignals();
    const result = await this.executeTrade(signal, tradeAmount);
    console.log(`🌀 Resultado: ${result.message} | Lucro: $${result.profit.toFixed(4)}`);

    if (signal.action !== 'HOLD') {
      const action = signal.action.toLowerCase() as 'buy' | 'sell' | 'hold';
      votingSystem.recordTradeOutcome(action, result.profit > 0);
    }

    return result;
  }

  startAutomatedTrading(intervalSeconds: number = 25, tradeAmount: number = 3) {
    if (this.isRunning) return;

    this.isRunning = true;
    console.log(`\n🌀 COMPUTADOR QUÂNTICO INICIADO! Intervalo: ${intervalSeconds}s | Trade: $${tradeAmount}`);
    
    this.runTradingCycle(tradeAmount);
    
    this.intervalId = setInterval(async () => {
      if (!this.isRunning) return;
      await this.runTradingCycle(tradeAmount);
    }, intervalSeconds * 1000);
  }

  stopAutomatedTrading() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log("\n⏹️ Automated Trading parado");
  }

  getStats() {
    const totalTrades = this.tradeHistory.length;
    const winningTrades = this.tradeHistory.filter(t => t.profit > 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    
    return {
      totalTrades,
      winningTrades,
      losingTrades: totalTrades - winningTrades,
      winRate: winRate.toFixed(2),
      totalProfit: this.totalProfit.toFixed(4),
      avgProfit: totalTrades > 0 ? (this.totalProfit / totalTrades).toFixed(4) : '0',
      isRunning: this.isRunning
    };
  }

  getHistory() {
    return this.tradeHistory;
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      userAddress: this.userAddress,
      totalProfit: this.totalProfit,
      totalTrades: this.tradeHistory.length
    };
  }
}

export const automatedTrader = new AutomatedTrader();