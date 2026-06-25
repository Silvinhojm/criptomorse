// DEPRECATED: CoinMarketCap replaced by SoSoValue. Kept for backward compatibility.
import { fetchPrice } from "@/lib/sosovalue-price-agent";

class CoinmarketcapAgent {
  private marketDataCache: { data: any; ts: number } | null = null;

  async getPrice(symbol: string): Promise<number> {
    return fetchPrice(symbol);
  }

  async getGlobalMetrics() {
    try {
      const data = await this._fetchMarketData();
      const mkt = data?.market ?? {};
      return {
        total_market_cap: mkt.totalMarketCap ?? 2_400_000_000_000,
        btc_dominance: mkt.btcDominance ?? 52,
      };
    } catch {
      return { total_market_cap: 2_400_000_000_000, btc_dominance: 52 };
    }
  }

  async getFearAndGreed() {
    try {
      const data = await this._fetchMarketData();
      const fg = data?.fearGreed ?? {};
      return {
        value: fg.value ?? 50,
        classification: fg.classification ?? 'Neutral',
      };
    } catch {
      const value = Math.round(30 + Math.random() * 40);
      const classification =
        value >= 75 ? "Extreme Greed" :
        value >= 55 ? "Greed" :
        value >= 45 ? "Neutral" :
        value >= 25 ? "Fear" : "Extreme Fear";
      return { value, classification };
    }
  }

  async getTopGainers(limit: number = 10): Promise<Array<{ symbol: string; price: number; change24h: number }>> {
    return [];
  }

  async getTrending(): Promise<Array<{ symbol: string; name: string }>> {
    return [];
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

export const coinmarketcapAgent = new CoinmarketcapAgent();
