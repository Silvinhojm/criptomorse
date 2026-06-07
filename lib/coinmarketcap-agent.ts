class CoinmarketcapAgent {
  async getPrice(symbol: string): Promise<number> {
    // CMC requires API key — returns mock for testnet
    return 65000 + Math.random() * 1000 - 500;
  }

  async getGlobalMetrics() {
    return { total_market_cap: 2_400_000_000_000, btc_dominance: 52 };
  }

  async getFearAndGreed() {
    const value = Math.round(30 + Math.random() * 40);
    const classification =
      value >= 75 ? "Extreme Greed" :
      value >= 55 ? "Greed" :
      value >= 45 ? "Neutral" :
      value >= 25 ? "Fear" : "Extreme Fear";
    return { value, classification };
  }
}

export const coinmarketcapAgent = new CoinmarketcapAgent();
