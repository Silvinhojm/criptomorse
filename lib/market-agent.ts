interface MarketOpinion {
  agentName: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
  reason: string;
}

class MarketAgent {
  private lastInsights = { trend: "neutral", dominance: 50, fear: 50 };
  private wins = 0;
  private losses = 0;
  private trades = 0;

  async updateMarketInsights() {
    this.lastInsights = {
      trend: Math.random() > 0.5 ? "bullish" : Math.random() > 0.5 ? "bearish" : "neutral",
      dominance: 45 + Math.random() * 10,
      fear: 30 + Math.random() * 40,
    };
  }

  getAdvice(): MarketOpinion {
    const { trend, fear } = this.lastInsights;
    const action: "buy" | "sell" | "hold" = trend === "bullish" ? "buy" : trend === "bearish" ? "sell" : "hold";
    const confidence = Math.round(30 + Math.abs(fear - 50) * 0.3);
    return { agentName: "Market", action, confidence, reason: `Trend: ${trend}, Fear: ${Math.round(fear)}` };
  }

  getScore() {
    return {
      agentName: "Market",
      wins: this.wins,
      losses: this.losses,
      totalTrades: this.trades,
      winRate: this.trades > 0 ? (this.wins / this.trades) * 100 : 0,
      avgConfidence: 30,
      color: "#f97316",
      icon: "📈",
    };
  }
}

export const marketAgent = new MarketAgent();
