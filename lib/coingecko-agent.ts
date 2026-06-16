class CoingeckoAgent {
  private cache: Map<string, { price: number; ts: number }> = new Map();
  private marketDataCache: { data: any; ts: number } | null = null;

  async getPrice(coinId: string): Promise<number> {
    const cached = this.cache.get(coinId);
    if (cached && Date.now() - cached.ts < 60000) return cached.price;

    try {
      const res = await fetch(`/api/price?ids=${coinId}`);
      if (!res.ok) return 65000;
      const data = await res.json();
      const price = data[coinId] ?? 65000;
      if (price > 0) {
        this.cache.set(coinId, { price, ts: Date.now() });
      }
      return price;
    } catch {
      return 65000;
    }
  }

  async getVolumeAnalysis(coinId: string) {
    try {
      const data = await this._fetchMarketData();
      const vol = data?.market?.volume24h ?? 0;
      const cap = data?.market?.totalMarketCap ?? 1;
      const ratio = cap > 0 ? vol / cap : 0;
      const signal = ratio > 0.05 ? "high" : ratio < 0.01 ? "low" : "normal";
      return { signal, volumeVsMarketCap: ratio };
    } catch {
      return { signal: "normal", volumeVsMarketCap: 0.05 };
    }
  }

  async getMarketTrend(coinId: string): Promise<string> {
    try {
      const data = await this._fetchMarketData();
      const fear = data?.fearGreed?.value ?? 50;
      if (fear < 25) return "bearish";
      if (fear > 60) return "bullish";
      return "neutral";
    } catch {
      return "neutral";
    }
  }

  private async _fetchMarketData() {
    if (this.marketDataCache && Date.now() - this.marketDataCache.ts < 30000) {
      return this.marketDataCache.data;
    }
    const res = await fetch('/api/market-data', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('Failed to fetch market data');
    const data = await res.json();
    this.marketDataCache = { data, ts: Date.now() };
    return data;
  }
}

export const coingeckoAgent = new CoingeckoAgent();
