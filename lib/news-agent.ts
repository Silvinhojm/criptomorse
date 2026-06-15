export interface NewsSentiment {
  score: number;
  bias: "positive" | "negative" | "neutral";
  headlines: string[];
}

interface AgentDecision {
  action: "buy" | "sell" | "hold";
  confidence: number;
  reason: string;
}

const MOCK_HEADLINES = [
  "Bitcoin ultrapassa resistência chave",
  "Institucionais aumentam posições em cripto",
  "Fed mantém juros estáveis",
  "Mercado cripto em consolidação",
  "DeFi registra novo recorde de TVL",
];

class NewsAgent {
  private sentiment: NewsSentiment = { score: 50, bias: "neutral", headlines: [] };
  private wins = 0;
  private losses = 0;
  private trades = 0;

  async updateSentiment(): Promise<NewsSentiment> {
    const score = 40 + Math.random() * 40;
    const bias: "positive" | "negative" | "neutral" = score > 60 ? "positive" : score < 40 ? "negative" : "neutral";
    const headlines = MOCK_HEADLINES.sort(() => Math.random() - 0.5).slice(0, 3);
    this.sentiment = { score: Math.round(score), bias, headlines };
    return this.sentiment;
  }

  async decide(): Promise<AgentDecision> {
    await this.updateSentiment();
    const { score, bias } = this.sentiment;
    const action: "buy" | "sell" | "hold" = bias === "positive" ? "buy" : bias === "negative" ? "sell" : "hold";
    const confidence = Math.round(35 + Math.abs(score - 50) * 0.6);
    return { action, confidence, reason: `Sentiment: ${bias} (${score})` };
  }

  getScore() {
    return {
      agentName: "News",
      wins: this.wins,
      losses: this.losses,
      totalTrades: this.trades,
      winRate: this.trades > 0 ? (this.wins / this.trades) * 100 : 0,
      avgConfidence: 35,
      color: "#f97316",
      icon: "📰",
    };
  }

  getFearGreedScore() {
    return {
      value: this.sentiment.score,
      classification: this.sentiment.bias
    };
  }
}

class EnhancedMarketAnalyzer {
  async getCompleteMarketAnalysis() {
    const score = 40 + Math.random() * 40;
    const bias: "positive" | "negative" | "neutral" = score > 60 ? "positive" : score < 40 ? "negative" : "neutral";
    return {
      sentiment: { score: Math.round(score), bias, headlines: MOCK_HEADLINES.slice(0, 2) } as NewsSentiment,
      recommendation: bias === "positive" ? "buy" : bias === "negative" ? "sell" : "hold",
    };
  }
}

const newsAgent = new NewsAgent();
export const enhancedMarketAnalyzer = new EnhancedMarketAnalyzer();
export default newsAgent;