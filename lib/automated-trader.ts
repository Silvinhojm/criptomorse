import { nanopaymentSystem } from "./nanopayment-system";
import { quantumAgent, technicalAgent } from "./multi-agent-system";
import { marketAgent } from "./market-agent";
import { volumeAgent } from "./volume-agent";
import newsAgent from "./news-agent";
import { votingSystem, AgentVote } from "./voting-system";
import { realBalance } from "./real-balance-integration";
import { quantumWaveTrader, QuantumPair } from "./quantum-wave";
import { realSwap } from "./real-swap-executor";
import { isStable } from "./real-swap-executor";

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
  private networkKey: 'arc' | 'base' | 'polygon' | 'ethereum' = 'arc';

  initialize(userAddress: string, networkKey?: string) {
    this.userAddress = userAddress;
    if (networkKey === 'arc' || networkKey === 'base' || networkKey === 'polygon' || networkKey === 'ethereum') {
      this.networkKey = networkKey;
    }
    console.log(`Automated Trader inicializado para: ${userAddress} na ${this.networkKey}`);
  }

  async collectAgentSignals(): Promise<TradeSignal> {
    console.log("Coletando sinais dos agentes...");

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
        const qSignal = await quantumAgent.evaluatePair(pair);
        if (qSignal) agentVotes.push({ pair, confidence: qSignal.confidence });
      } catch { /* quantum agent fallback */ }

      try {
        const res = await fetch('/api/market-data', { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = await res.json();
          if (data.pairs?.[pair.label]) {
            const spread = data.pairs[pair.label].spread ?? 0.5;
            const confidence = Math.min(90, Math.round(spread * 200));
            agentVotes.push({ pair, confidence });
          }
        }
      } catch { /* market data fallback */ }

      if (agentVotes.length > 0) {
        agentConsensus.set(pair.label, agentVotes);
      }
    }

    let bestAction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let bestConfidence = 0;
    let bestReason = 'Nenhum sinal forte';
    let bestPair: QuantumPair | undefined;
    let allVotes: AgentVote[] = [];

    agentConsensus.forEach((votes, label) => {
      const avgConfidence = votes.reduce((s, v) => s + v.confidence, 0) / votes.length;
      if (avgConfidence > bestConfidence) {
        bestConfidence = avgConfidence;
        bestAction = avgConfidence > 60 ? 'BUY' : avgConfidence > 40 ? 'SELL' : 'HOLD';
        bestReason = `Sinal ${label} (${avgConfidence.toFixed(0)}%)`;
        bestPair = votes[0]?.pair;
        allVotes = votes.map((v, i) => ({
          agentName: `Agent_${i}`,
          action: bestAction.toLowerCase() as 'buy' | 'sell' | 'hold',
          confidence: v.confidence,
          weight: 1,
        }));
      }
    });

    return {
      action: bestAction,
      confidence: bestConfidence,
      reason: bestReason,
      agentsVotes: allVotes,
      expectedProfit: this.tradeAmount * (bestConfidence / 100) * 0.01,
      collapsedPair: bestPair,
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
      : 'USDC->par';

    const currentBalance = await realBalance.getRealUSDCBalance(this.userAddress);
    if (currentBalance < tradeAmount) {
      return {
        success: false,
        profit: 0,
        message: `Saldo insuficiente: $${currentBalance.toFixed(4)}. Necessario: $${tradeAmount}`,
        timestamp: Date.now()
      };
    }

    try {
      let fromToken: string;
      let toToken: string;

      if (signal.action === 'BUY') {
        fromToken = 'USDC';
        toToken = signal.collapsedPair?.label.replace('/USDC', '').replace('USDC/', '') || 'EURC';
        if (!isStable(toToken) && !isStable(fromToken)) {
          toToken = 'EURC';
        }
      } else {
        fromToken = signal.collapsedPair?.label.replace('/USDC', '').replace('USDC/', '') || 'EURC';
        toToken = 'USDC';
        if (!isStable(fromToken)) {
          fromToken = 'EURC';
        }
      }

      const result = await realSwap.executeSwap(
        fromToken as any,
        toToken as any,
        tradeAmount,
        (msg: string) => console.log(msg)
      );

      if (result.success) {
        const profit = result.profit ?? 0;
        this.totalProfit += profit;

        if (profit > 0) {
          const agentProfit = profit * 0.3;
          signal.agentsVotes.forEach(vote => {
            nanopaymentSystem.addCredits(vote.agentName, agentProfit / signal.agentsVotes.length);
          });
          nanopaymentSystem.addCredits('RealTrader', profit * 0.7);
        }

        this.tradeHistory.push({
          success: true,
          profit,
          txHash: result.txHash,
          message: `${signal.action} ${pairInfo}: ${signal.confidence}% | profit: $${profit.toFixed(4)} | TX: ${result.txHash?.slice(0, 10)}...`,
          timestamp: Date.now()
        });

        return {
          success: true,
          profit,
          txHash: result.txHash,
          message: `${pairInfo} ${signal.action} — $${profit.toFixed(4)} profit`,
          timestamp: Date.now()
        };
      }

      this.tradeHistory.push({
        success: false,
        profit: 0,
        message: `Trade falhou: ${result.message}`,
        timestamp: Date.now()
      });

      return {
        success: false,
        profit: 0,
        message: `Trade falhou: ${result.message}`,
        timestamp: Date.now()
      };
    } catch (err: any) {
      this.tradeHistory.push({
        success: false,
        profit: 0,
        message: `Erro ao executar trade: ${err.message?.slice(0, 100)}`,
        timestamp: Date.now()
      });

      return {
        success: false,
        profit: 0,
        message: `Erro ao executar trade: ${err.message?.slice(0, 100)}`,
        timestamp: Date.now()
      };
    }
  }

  async runTradingCycle(tradeAmount: number = 3): Promise<TradeResult> {
    this.tradeAmount = tradeAmount;
    const signal = await this.collectAgentSignals();
    const result = await this.executeTrade(signal, tradeAmount);

    if (signal.action !== 'HOLD') {
      const action = signal.action.toLowerCase() as 'buy' | 'sell' | 'hold';
      votingSystem.recordTradeOutcome(action, result.profit > 0);
    }

    return result;
  }

  startAutomatedTrading(intervalSeconds: number = 25, tradeAmount: number = 3) {
    if (this.isRunning) return;

    this.isRunning = true;
    const cycle = () => {
      if (!this.isRunning) return;
      this.runTradingCycle(tradeAmount).catch(err => {
        console.error(`Erro no ciclo: ${err?.message || err}`);
      });
    };
    cycle();
    this.intervalId = setInterval(cycle, intervalSeconds * 1000);
  }

  stopAutomatedTrading() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log("Automated Trader parado");
  }

  getStats() {
    const total = this.tradeHistory.length;
    const wins = this.tradeHistory.filter(t => t.profit > 0).length;
    const losses = this.tradeHistory.filter(t => t.profit < 0).length;
    return {
      totalTrades: total,
      totalProfit: this.totalProfit,
      winRate: total > 0 ? (wins / total * 100).toFixed(1) : "0.0",
      wins,
      losses,
      isRunning: this.isRunning,
    };
  }

  getHistory(): TradeResult[] {
    return [...this.tradeHistory].reverse();
  }
}

export const automatedTrader = new AutomatedTrader();
