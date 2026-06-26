interface BearOpportunity {
  opportunity: "strong" | "moderate" | "none";
  confidence: number;
  reason: string;
}

class SosovalueAgent {
  private marketDataCache: { data: any; ts: number } | null = null;

  async analyzeBearOpportunity(btcDominance?: number, fearValue?: number): Promise<BearOpportunity> {
    const dom = btcDominance ?? await this._fetchBtcDominance();
    const fear = fearValue ?? await this._fetchFearValue();

    if (dom > 55 && fear < 30) {
      return { opportunity: "strong", confidence: 80, reason: `High BTC dominance (${dom}%) + extreme fear (${fear}) = bear opportunity` };
    }
    if (dom > 50 || fear < 40) {
      return { opportunity: "moderate", confidence: 55, reason: `Moderate bear signals: dominance ${dom}%, fear ${fear}` };
    }
    return { opportunity: "none", confidence: 20, reason: `No significant bear opportunity: dominance ${dom}%, fear ${fear}` };
  }

  private async _fetchBtcDominance(): Promise<number> {
    const data = await this._fetchMarketData();
    return data?.market?.btcDominance ?? 55;
  }

  private async _fetchFearValue(): Promise<number> {
    const data = await this._fetchMarketData();
    return data?.fearGreed?.value ?? 50;
  }

  private async _fetchMarketData() {
    if (this.marketDataCache && Date.now() - this.marketDataCache.ts < 30000) {
      return this.marketDataCache.data;
    }
    try {
      const res = await fetch('/api/market-data', { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error('Failed to fetch market data');
      const data = await res.json();
      this.marketDataCache = { data, ts: Date.now() };
      return data;
    } catch {
      return null;
    }
  }
}

export const sosovalueAgent = new SosovalueAgent();
