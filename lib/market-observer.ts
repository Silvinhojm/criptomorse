// lib/market-observer.ts - Analise de mercado baseada em dados reais

export interface MarketOpportunity {
  id: string;
  type: 'arbitrage' | 'trend' | 'volume_spike' | 'sentiment_shift';
  symbol: string;
  potentialProfit: number;
  confidence: number;
  reason: string;
  timestamp: number;
}

export interface MarketData {
  symbol: string;
  price: number;
  volume24h: number;
  priceChange24h: number;
  marketCap: number;
  timestamp: number;
}

const COINGECKO_CACHE_DURATION = 60000;

class MarketObserver {
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private lastArbitrageCheck = 0;
  private readonly ARBITRAGE_COOLDOWN = 30000;

  private async fetchWithTimeout(url: string, timeoutMs = 8000): Promise<any> {
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.timestamp < COINGECKO_CACHE_DURATION) {
      return cached.data;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`API ${url} retornou status ${response.status}`);
        return null;
      }

      const data = await response.json();
      this.cache.set(url, { data, timestamp: Date.now() });
      return data;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.warn(`Timeout ao buscar ${url}`);
      } else {
        console.warn(`Erro ao buscar ${url}:`, error.message);
      }
      return null;
    }
  }

  async fetchCoinGeckoData(coinId: string = 'bitcoin'): Promise<any> {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinId}&order=market_cap_desc&per_page=1&page=1&sparkline=false&price_change_percentage=24h`;

    const data = await this.fetchWithTimeout(url);
    if (data && Array.isArray(data) && data.length > 0) {
      return data[0];
    }

    return null;
  }

  async fetchOpportunities(): Promise<MarketOpportunity[]> {
    const opportunities: MarketOpportunity[] = [];

    try {
      const btcData = await this.fetchCoinGeckoData('bitcoin');
      const ethData = await this.fetchCoinGeckoData('ethereum');

      if (btcData?.price_change_percentage_24h != null) {
        const btcChange = btcData.price_change_percentage_24h;

        if (btcChange > 5) {
          opportunities.push({
            id: `btc_trend_${Date.now()}`,
            type: 'trend',
            symbol: 'BTC',
            potentialProfit: btcChange / 10,
            confidence: Math.min(85, 60 + btcChange),
            reason: `Bitcoin em alta de ${btcChange.toFixed(1)}% nas ultimas 24h`,
            timestamp: Date.now()
          });
        } else if (btcChange < -5) {
          opportunities.push({
            id: `btc_dip_${Date.now()}`,
            type: 'trend',
            symbol: 'BTC',
            potentialProfit: Math.abs(btcChange) / 8,
            confidence: Math.min(80, 55 + Math.abs(btcChange)),
            reason: `Bitcoin em queda de ${Math.abs(btcChange).toFixed(1)}% - possivel oportunidade de compra`,
            timestamp: Date.now()
          });
        }

        if (Math.abs(btcChange) > 3) {
          opportunities.push({
            id: `btc_volume_${Date.now()}`,
            type: 'volume_spike',
            symbol: 'BTC',
            potentialProfit: Math.abs(btcChange) / 15,
            confidence: 50 + Math.min(30, Math.abs(btcChange) * 3),
            reason: `Movimento de ${btcChange > 0 ? "alta" : "queda"} de ${Math.abs(btcChange).toFixed(1)}% nas ultimas 24h`,
            timestamp: Date.now()
          });
        }
      }

      if (ethData?.price_change_percentage_24h != null) {
        const ethChange = ethData.price_change_percentage_24h;
        if (Math.abs(ethChange) > 4) {
          opportunities.push({
            id: `eth_trend_${Date.now()}`,
            type: 'trend',
            symbol: 'ETH',
            potentialProfit: Math.abs(ethChange) / 12,
            confidence: 50 + Math.min(30, Math.abs(ethChange) * 2),
            reason: `Ethereum ${ethChange > 0 ? "subiu" : "caiu"} ${Math.abs(ethChange).toFixed(1)}% em 24h`,
            timestamp: Date.now()
          });
        }
      }
    } catch (error) {
      console.warn('Erro ao buscar dados CoinGecko:', error);
    }

    return opportunities;
  }

  async getMarketData(): Promise<MarketData[]> {
    const marketData: MarketData[] = [];

    try {
      const [btcData, ethData] = await Promise.all([
        this.fetchCoinGeckoData('bitcoin'),
        this.fetchCoinGeckoData('ethereum'),
      ]);

      if (btcData) {
        marketData.push({
          symbol: 'BTC',
          price: btcData.current_price || 0,
          volume24h: btcData.total_volume || 0,
          priceChange24h: btcData.price_change_percentage_24h || 0,
          marketCap: btcData.market_cap || 0,
          timestamp: Date.now()
        });
      }

      if (ethData) {
        marketData.push({
          symbol: 'ETH',
          price: ethData.current_price || 0,
          volume24h: ethData.total_volume || 0,
          priceChange24h: ethData.price_change_percentage_24h || 0,
          marketCap: ethData.market_cap || 0,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.warn('Erro ao buscar dados de mercado:', error);
    }

    return marketData;
  }

  async analyzeArbitrage(): Promise<MarketOpportunity | null> {
    if (Date.now() - this.lastArbitrageCheck < this.ARBITRAGE_COOLDOWN) return null;
    this.lastArbitrageCheck = Date.now();

    try {
      const usdcData = await this.fetchCoinGeckoData('usd-coin');
      const usdtData = await this.fetchCoinGeckoData('tether');

      if (usdcData?.current_price && usdtData?.current_price) {
        const spread = Math.abs(usdcData.current_price - usdtData.current_price) * 100;

        if (spread > 0.1) {
          return {
            id: `arb_stable_${Date.now()}`,
            type: 'arbitrage',
            symbol: 'USDC/USDT',
            potentialProfit: spread,
            confidence: 60 + Math.min(30, spread * 20),
            reason: `Spread de ${spread.toFixed(3)}% entre USDC e USDT detectado`,
            timestamp: Date.now()
          };
        }
      }
    } catch {
      // fallback silencioso
    }

    return null;
  }

  clearCache(): void {
    this.cache.clear();
    console.log('Cache do MarketObserver limpo');
  }
}

export const marketObserver = new MarketObserver();
