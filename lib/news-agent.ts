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

class NewsAgent {
  private sentiment: NewsSentiment = { score: 50, bias: "neutral", headlines: [] };
  private wins = 0;
  private losses = 0;
  private trades = 0;

  private async fetchRealNews(externalData?: any): Promise<NewsSentiment> {
    try {
      const data = externalData ?? await (await fetch('/api/market-data', { signal: AbortSignal.timeout(5000) })).json();
      const headlines: string[] = data.headlines ?? [];
      if (headlines.length === 0) throw new Error('No headlines');

      const positiveWords = ['alta','bull','rally','record','cresce','lucro','aprova','parceria','lança','inovação','adocão','positivo'];
      const negativeWords = ['queda','bear','crash','perda','multa','ban','proibição','hack','fraude','regulação','negativo','correção'];

      let score = 50;
      for (const h of headlines) {
        const hl = h.toLowerCase();
        for (const w of positiveWords) { if (hl.includes(w)) score += 3; }
        for (const w of negativeWords) { if (hl.includes(w)) score -= 3; }
      }
      score = Math.max(5, Math.min(95, score));

      const bias: "positive" | "negative" | "neutral" = score > 60 ? "positive" : score < 40 ? "negative" : "neutral";
      return { score, bias, headlines: headlines.slice(0, 5) };
    } catch {
      return { score: 50, bias: "neutral", headlines: ["Indisponível — modo fallback"] };
    }
  }

  async updateSentiment(): Promise<NewsSentiment> {
    this.sentiment = await this.fetchRealNews();
    return this.sentiment;
  }

  async decide(externalData?: any): Promise<AgentDecision> {
    this.sentiment = await this.fetchRealNews(externalData);
    const { score, bias } = this.sentiment;
    const action: "buy" | "sell" | "hold" = bias === "positive" ? "buy" : bias === "negative" ? "sell" : "hold";
    const confidence = Math.round(35 + Math.abs(score - 50) * 0.6);
    const headline = this.sentiment.headlines[0] ?? '';
    return { action, confidence, reason: `Notícias: ${bias} (${score}) — ${headline.slice(0, 60)}` };
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
    return { value: this.sentiment.score, classification: this.sentiment.bias };
  }
}

class EnhancedMarketAnalyzer {
  async getCompleteMarketAnalysis(externalData?: any) {
    try {
      const data = externalData ?? await (await fetch('/api/market-data', { signal: AbortSignal.timeout(5000) })).json();
      const headlines = (data.headlines ?? []).slice(0, 3);
      const fg = data.fearGreed ?? {};
      const score = fg.value ?? 50;
      const bias: "positive" | "negative" | "neutral" = score > 55 ? "positive" : score < 45 ? "negative" : "neutral";
      return {
        sentiment: { score, bias, headlines } as NewsSentiment,
        recommendation: bias === "positive" ? "buy" : bias === "negative" ? "sell" : "hold",
      };
    } catch {
      return {
        sentiment: { score: 50, bias: "neutral", headlines: [] } as NewsSentiment,
        recommendation: "hold",
      };
    }
  }
}

const newsAgent = new NewsAgent();
export const enhancedMarketAnalyzer = new EnhancedMarketAnalyzer();
export default newsAgent;
