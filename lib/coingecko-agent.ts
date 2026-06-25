// DEPRECATED: CoinGecko replaced by SoSoValue. Kept for backward compatibility.
// All price fetching now uses SoSoValue API via sosovalue-price-agent.ts
import { fetchPrice } from "@/lib/sosovalue-price-agent";

class CoingeckoAgent {
  async getPrice(coinId: string): Promise<number> {
    return fetchPrice(coinId);
  }

  async getVolumeAnalysis(coinId: string): Promise<{ signal: string; volumeVsMarketCap: number }> {
    try {
      const res = await fetch('/api/market-data', { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { signal: "normal", volumeVsMarketCap: 0.05 };
      const data = await res.json();
      const vol = data?.market?.volume24h ?? 0;
      const cap = data?.market?.totalMarketCap ?? 1;
      const ratio = cap > 0 ? vol / cap : 0;
      const signal = ratio > 0.05 ? "high" : ratio < 0.01 ? "low" : "normal";
      return { signal, volumeVsMarketCap: ratio };
    } catch {
      return { signal: "normal", volumeVsMarketCap: 0.05 };
    }
  }

  async getMarketTrend(): Promise<string> {
    try {
      const res = await fetch('/api/market-data', { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return "neutral";
      const data = await res.json();
      const fear = data?.fearGreed?.value ?? 50;
      if (fear < 25) return "bearish";
      if (fear > 60) return "bullish";
      return "neutral";
    } catch {
      return "neutral";
    }
  }
}

export const coingeckoAgent = new CoingeckoAgent();
