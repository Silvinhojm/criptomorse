// lib/automated-trader.ts - CORRIGIDO
// Sistema de trading automático integrado com agentes e nanopagamentos

import { nanopaymentSystem } from "./nanopayment-system";
import { quantumAgent, technicalAgent } from "./multi-agent-system";
import { marketAgent } from "./market-agent";
import { volumeAgent } from "./volume-agent";
import newsAgent from "./news-agent";
import { votingSystem, AgentVote } from "./voting-system";
import { realBalance } from "./real-balance-integration";

export interface TradeSignal {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reason: string;
  agentsVotes: AgentVote[];
  expectedProfit: number;
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

  initialize(userAddress: string) {
    this.userAddress = userAddress;
    console.log(`🤖 Automated Trader inicializado para: ${userAddress}`);
  }

  async collectAgentSignals(): Promise<TradeSignal> {
    const votes: AgentVote[] = [];
    const payments = [];

    console.log("📡 Coletando sinais dos agentes...");

    // 1. QuantumAgent
    try {
      await nanopaymentSystem.makePayment('RealTrader', 'QuantumAgent', 0.02, 'Consulta quântica');
      const quantumOpinion = quantumAgent.decide(1.00);
      votes.push({
        agentName: quantumOpinion.agentName,
        action: quantumOpinion.action,
        confidence: quantumOpinion.confidence,
        weight: 1,
        color: '#a78bfa',
        icon: '🌌'
      });
      payments.push('QuantumAgent');
    } catch (e) { console.log('  ⚠️ Erro no QuantumAgent'); }

    // 2. TechnicalAgent
    try {
      await nanopaymentSystem.makePayment('RealTrader', 'TechnicalAgent', 0.008, 'Consulta técnica');
      const indicators = technicalAgent.calculateIndicators([1.00, 1.001, 0.999]);
      const indicatorsArray = Object.values(indicators);
      const numericIndicators = indicatorsArray.map((v: any) => {
        if (typeof v === 'string') return v === 'up' ? 1 : -1;
        return v as number;
      });
      const technicalOpinion = technicalAgent.decide(numericIndicators, 1.00);
      votes.push({
        agentName: technicalOpinion.agentName,
        action: technicalOpinion.action,
        confidence: technicalOpinion.confidence,
        weight: 1,
        color: '#00d4aa',
        icon: '📊'
      });
      payments.push('TechnicalAgent');
    } catch (e) { console.log('  ⚠️ Erro no TechnicalAgent'); }

    // 3. NewsAgent
    try {
      await nanopaymentSystem.makePayment('RealTrader', 'NewsAgent', 0.005, 'Consulta notícias');
      const newsDecision = await newsAgent.decide();
      votes.push({
        agentName: newsAgent.getScore().agentName,
        action: newsDecision.action as any,
        confidence: newsDecision.confidence,
        weight: 0.8,
        color: '#f97316',
        icon: '📰'
      });
      payments.push('NewsAgent');
    } catch (e) { console.log('  ⚠️ Erro no NewsAgent'); }

    // 4. MarketAgent
    try {
      await nanopaymentSystem.makePayment('RealTrader', 'MarketAgent', 0.01, 'Consulta mercado');
      await marketAgent.updateMarketInsights();
      const marketOpinion = marketAgent.getAdvice();
      votes.push({
        agentName: marketOpinion.agentName,
        action: marketOpinion.action,
        confidence: marketOpinion.confidence,
        weight: 0.9,
        color: '#f97316',
        icon: '📈'
      });
      payments.push('MarketAgent');
    } catch (e) { console.log('  ⚠️ Erro no MarketAgent'); }

    // 5. VolumeAgent
    try {
      await nanopaymentSystem.makePayment('RealTrader', 'VolumeAgent', 0.007, 'Consulta volume');
      const volumeAnalysis = volumeAgent.analyzeVolume(1000000, 2, 5);
      votes.push({
        agentName: volumeAgent.getScore().agentName,
        action: volumeAnalysis.action,
        confidence: volumeAnalysis.confidence,
        weight: 0.9,
        color: '#f97316',
        icon: '📊'
      });
      payments.push('VolumeAgent');
    } catch (e) { console.log('  ⚠️ Erro no VolumeAgent'); }

    const voteResult = votingSystem.vote(votes);
    
    console.log(`📊 Votação final: ${voteResult.action.toUpperCase()} com ${voteResult.confidence}%`);
    console.log(`💸 Pagamentos: ${payments.join(', ')}`);

    return {
      action: voteResult.action.toUpperCase() as 'BUY' | 'SELL' | 'HOLD',
      confidence: voteResult.confidence,
      reason: `Decisão baseada em ${votes.length} agentes. Confiança: ${voteResult.confidence}%`,
      agentsVotes: votes,
      expectedProfit: (voteResult.confidence / 100) * 0.5
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

    // Verificar saldo real
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

    // Simular trade (em produção, seria real)
    const isWin = Math.random() < (signal.confidence / 100);
    const profit = isWin ? tradeAmount * 0.005 : -tradeAmount * 0.002;
    
    console.log(`📈 ${signal.action} | ${isWin ? '✅ GANHOU' : '❌ PERDEU'} | Lucro: $${profit.toFixed(4)}`);

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
      message: `${signal.action} executado. Confiança: ${signal.confidence}%`,
      timestamp: Date.now()
    });

    return {
      success: true,
      profit,
      message: `${signal.action} executado com ${signal.confidence}% de confiança`,
      timestamp: Date.now()
    };
  }

  async runTradingCycle(tradeAmount: number = 3): Promise<TradeResult> {
    console.log("\n🔄 Iniciando ciclo de trading...");
    const signal = await this.collectAgentSignals();
    const result = await this.executeTrade(signal, tradeAmount);
    console.log(`📈 Resultado: ${result.message} | Lucro: $${result.profit.toFixed(4)}`);
    return result;
  }

  startAutomatedTrading(intervalSeconds: number = 25, tradeAmount: number = 3) {
    if (this.isRunning) return;

    this.isRunning = true;
    console.log(`\n🚀 AUTOMATED TRADER INICIADO! Intervalo: ${intervalSeconds}s | Trade: $${tradeAmount}`);
    
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