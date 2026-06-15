class CoingeckoAgent {
  private cache: Map<string, { price: number; ts: number }> = new Map();

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
    return { signal: "normal", volumeVsMarketCap: 0.05 };
  }

  async getMarketTrend(coinId: string): Promise<string> {
    return "neutral";
  }
}

export const coingeckoAgent = new CoingeckoAgent();
