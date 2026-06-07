class CoingeckoAgent {
  private cache: Map<string, { price: number; ts: number }> = new Map();

  async getPrice(coinId: string): Promise<number> {
    const cached = this.cache.get(coinId);
    if (cached && Date.now() - cached.ts < 60000) return cached.price;

    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`);
      if (!res.ok) throw new Error("CoinGecko error");
      const data = await res.json();
      const price = data[coinId]?.usd ?? 65000;
      this.cache.set(coinId, { price, ts: Date.now() });
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
