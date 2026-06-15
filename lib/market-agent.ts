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

  async updateMarketInsights(externalData?: any) {
    try {
      const data = externalData ?? await (await fetch('/api/market-data', { signal: AbortSignal.timeout(5000) })).json();
      const fg = data.fearGreed ?? {};
      const mkt = data.market ?? {};

      const fear = fg.value ?? 50;
      const dominance = mkt.btcDominance ?? 55;

      this.lastInsights = {
        trend: fear < 25 ? "bearish" : fear > 60 ? "bullish" : "neutral",
        dominance: Math.round(dominance * 100) / 100,
        fear,
      };
    } catch {
      /* keep last insights */
    }
  }

  getAdvice(): MarketOpinion {
    const { trend, fear } = this.lastInsights;
    const action: "buy" | "sell" | "hold" = trend === "bullish" ? "buy" : trend === "bearish" ? "sell" : "hold";
    const confidence = Math.round(30 + Math.abs(fear - 50) * 0.3);
    const fgLabel = fear < 25 ? 'Extreme Fear' : fear < 45 ? 'Fear' : fear < 55 ? 'Neutral' : fear < 75 ? 'Greed' : 'Extreme Greed';
    return { agentName: "Market", action, confidence, reason: `Fear & Greed: ${Math.round(fear)} (${fgLabel}), Dominance: ${this.lastInsights.dominance}%` };
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
