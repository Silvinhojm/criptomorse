interface AgentOpinion {
  agentName: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
  reason: string;
}

interface AgentScore {
  agentName: string;
  wins: number;
  losses: number;
  totalTrades: number;
  winRate: number;
  avgConfidence: number;
  color?: string;
  icon?: string;
}

// ── Quantum Agent ────────────────────────────────────────────
class QuantumAgent {
  private price = 1.0;
  private history: number[] = [];
  readonly agentName = "Quantum";
  private wins = 0;
  private losses = 0;
  private trades = 0;

  updateMarketState(price: number, history: number[]) {
    this.price = price;
    this.history = history;
  }

  decide(currentPrice: number): AgentOpinion {
    const trend = this.history.length >= 3
      ? this.history[this.history.length - 1] - this.history[this.history.length - 3]
      : 0;
    const volatility = this.history.length > 1
  ? Math.abs(trend) * 10
  : 0;
    const action: "buy" | "sell" | "hold" = trend > 0.001 ? "buy" : trend < -0.001 ? "sell" : "hold";
    const confidence = Math.min(75, 30 + Math.abs(trend) * 3000);
    return { agentName: this.agentName, action, confidence: Math.round(confidence), reason: `Quantum trend: ${trend.toFixed(5)}` };
  }

  getScore(): AgentScore {
    return { agentName: this.agentName, wins: this.wins, losses: this.losses, totalTrades: this.trades, winRate: this.trades > 0 ? (this.wins / this.trades) * 100 : 0, avgConfidence: 45, color: "#a78bfa", icon: "🌌" };
  }
}

// ── Technical Agent ──────────────────────────────────────────
class TechnicalAgent {
  readonly agentName = "Technical";
  private wins = 0;
  private losses = 0;
  private trades = 0;

  calculateIndicators(prices: number[]) {
    if (prices.length < 5) return { trend: 0, rsi: 50, momentum: 0 };
    const last = prices[prices.length - 1];
    const prev = prices[prices.length - 5];
    const trend = last > prev ? 1 : last < prev ? -1 : 0;
    const gains = prices.slice(1).map((p, i) => Math.max(0, p - prices[i]));
    const losses_ = prices.slice(1).map((p, i) => Math.max(0, prices[i] - p));
    const avgGain = gains.reduce((a, b) => a + b, 0) / gains.length || 1;
    const avgLoss = losses_.reduce((a, b) => a + b, 0) / losses_.length || 1;
    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);
    return { trend, rsi, momentum: last - prev };
  }

  decide(indicators: number[], currentPrice: number): AgentOpinion {
    const rsi = indicators[1] ?? 50;
    const trend = indicators[0] ?? 0;
    const action: "buy" | "sell" | "hold" = rsi < 35 || trend > 0 ? "buy" : rsi > 65 || trend < 0 ? "sell" : "hold";
    const confidence = Math.round(40 + Math.abs(rsi - 50) * 0.5);
    return { agentName: this.agentName, action, confidence, reason: `RSI: ${rsi.toFixed(1)}, Trend: ${trend}` };
  }

  getScore(): AgentScore {
    return { agentName: this.agentName, wins: this.wins, losses: this.losses, totalTrades: this.trades, winRate: this.trades > 0 ? (this.wins / this.trades) * 100 : 0, avgConfidence: 40, color: "#00d4aa", icon: "📊" };
  }
}

// ── Synthesis Agent ──────────────────────────────────────────
class SynthesisAgent {
  readonly agentName = "Synthesis";
  private wins = 0;
  private losses = 0;
  private trades = 0;

  decide(...opinions: AgentOpinion[]): AgentOpinion {
    const scores: Record<string, number> = { buy: 0, sell: 0, hold: 0 };
    for (const op of opinions) {
      if (op && op.action) scores[op.action] = (scores[op.action] || 0) + op.confidence;
    }
    const action = (Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]) as "buy" | "sell" | "hold";
    const total = Object.values(scores).reduce((a, b) => a + b, 1);
    const confidence = Math.round((scores[action] / total) * 100);
    return { agentName: this.agentName, action, confidence, reason: "Synthesis of all agents" };
  }

  getScore(): AgentScore {
    return { agentName: this.agentName, wins: this.wins, losses: this.losses, totalTrades: this.trades, winRate: this.trades > 0 ? (this.wins / this.trades) * 100 : 0, avgConfidence: 75, color: "#fbbf24", icon: "🧠" };
  }
}

export const quantumAgent = new QuantumAgent();
export const technicalAgent = new TechnicalAgent();
export const synthesisAgent = new SynthesisAgent();
