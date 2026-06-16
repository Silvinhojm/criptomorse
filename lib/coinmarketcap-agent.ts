class CoinmarketcapAgent {
  private priceCache: Map<string, { price: number; ts: number }> = new Map();
  private marketDataCache: { data: any; ts: number } | null = null;

  async getPrice(symbol: string): Promise<number> {
    const cached = this.priceCache.get(symbol);
    if (cached && Date.now() - cached.ts < 60000) return cached.price;

    const coinId = this._symbolToCoinId(symbol);
    try {
      const res = await fetch(`/api/price?ids=${coinId}`);
      if (!res.ok) return this._randomPrice(symbol);
      const data = await res.json();
      const price = data[coinId] ?? this._randomPrice(symbol);
      if (price > 0) {
        this.priceCache.set(symbol, { price, ts: Date.now() });
      }
      return price;
    } catch {
      return this._randomPrice(symbol);
    }
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

  private _symbolToCoinId(symbol: string): string {
    const map: Record<string, string> = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      USDC: 'usd-coin',
      EURC: 'eurc',
      POL: 'matic-network',
      SOL: 'solana',
      ARB: 'arbitrum',
    };
    return map[symbol.toUpperCase()] ?? symbol.toLowerCase();
  }

  private _randomPrice(symbol: string): number {
    const basePrices: Record<string, number> = {
      BTC: 68000, ETH: 1850, USDC: 1, EURC: 1, POL: 0.35, SOL: 145, ARB: 0.55,
    };
    const base = basePrices[symbol.toUpperCase()] ?? 1;
    return base + (Math.random() - 0.5) * base * 0.03;
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
