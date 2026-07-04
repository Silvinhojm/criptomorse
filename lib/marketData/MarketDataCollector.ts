interface BackpackKlineRaw {
  start: string
  end: string
  open: string
  high: string
  low: string
  close: string
  volume: string
  quoteVolume: string
  trades: string
}

export interface Kline {
  start: number
  end: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  quoteVolume: number
  trades: number
}

export interface BackpackMarket {
  symbol: string
  baseSymbol: string
  quoteSymbol: string
  marketType: string
  visible: boolean
  orderBookState: string
}

export interface Trade {
  id: number
  price: number
  quantity: number
  quoteQuantity: number
  timestamp: number
  isBuyerMaker: boolean
}

interface BackpackTickerRaw {
  symbol: string
  firstPrice: string
  high: string
  lastPrice: string
  low: string
  priceChange: string
  priceChangePercent: string
  quoteVolume: string
  trades: string
  volume: string
}

export interface Ticker {
  symbol: string
  lastPrice: number
  priceChange24h: number
  priceChangePercent24h: number
  volume24h: number
  quoteVolume24h: number
  trades: number
  high24h: number
  low24h: number
}

export interface StockCandidate {
  symbol: string
  baseSymbol: string
  quoteVolume24h: number
  trades: number
}

type KlineInterval = '1s' | '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1month'

const ONE_HOUR_MS = 3_600_000

interface CacheEntry {
  data: unknown
  timestamp: number
}

const BACKPACK_BASE = typeof window !== 'undefined'
  ? '/api/backpack'
  : 'https://api.backpack.exchange'
const CACHE_TTL_MS = 60_000
const CACHE_TTL_STOCKS_MS = ONE_HOUR_MS
const MAX_RPS = 10
const INTERVAL_MS = 1000 / MAX_RPS

export class MarketDataCollector {
  private cache = new Map<string, CacheEntry>()
  private lastCall = 0
  private pending: Promise<void> = Promise.resolve()

  private async throttle(): Promise<void> {
    const now = Date.now()
    const elapsed = now - this.lastCall
    if (elapsed < INTERVAL_MS) {
      await new Promise(r => setTimeout(r, INTERVAL_MS - elapsed))
    }
    this.lastCall = Date.now()
  }

  private getCacheKey<T>(endpoint: string, params: Record<string, unknown>): string {
    return `${endpoint}?${Object.entries(params).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('&')}`
  }

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key)
    if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
      return entry.data as T
    }
    return null
  }

  private setCache(key: string, data: unknown): void {
    this.cache.set(key, { data, timestamp: Date.now() })
  }

  private async fetchWithRetry<T>(url: string, retries = 2): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await this.throttle()
        const res = await fetch(url)
        if (!res.ok) {
          const text = await res.text()
          throw new Error(`Backpack ${res.status}: ${text.slice(0, 200)}`)
        }
        return (await res.json()) as T
      } catch (err) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          continue
        }
        throw err
      }
    }
    throw new Error('Unreachable')
  }

  async getMarkets(marketType = 'SPOT'): Promise<BackpackMarket[]> {
    const params = { marketType }
    const cacheKey = this.getCacheKey('/api/v1/markets', params)
    const cached = this.getFromCache<BackpackMarket[]>(cacheKey)
    if (cached) return cached

    const data = await this.fetchWithRetry<BackpackMarket[]>(`${BACKPACK_BASE}/api/v1/markets?marketType=${marketType}`)
    this.setCache(cacheKey, data)
    return data
  }

  private _parseBackpackDate(dateStr: string): number {
    return Math.floor(new Date(dateStr.replace(' ', 'T') + 'Z').getTime() / 1000)
  }

  private _parseKlines(raw: BackpackKlineRaw[]): Kline[] {
    return raw.map(k => ({
      start: this._parseBackpackDate(k.start),
      end: this._parseBackpackDate(k.end),
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close: parseFloat(k.close),
      volume: parseFloat(k.volume),
      quoteVolume: parseFloat(k.quoteVolume),
      trades: parseInt(k.trades, 10),
    }))
  }

  async getKlines(
    symbol: string,
    interval: KlineInterval,
    startTime: number,
    endTime?: number,
    priceType?: 'Last' | 'Index' | 'Mark',
  ): Promise<Kline[]> {
    const params: Record<string, string> = {
      symbol,
      interval,
      startTime: String(startTime),
    }
    if (endTime) params.endTime = String(endTime)
    if (priceType) params.priceType = priceType

    const cacheKey = this.getCacheKey('/api/v1/klines', params)
    const cached = this.getFromCache<Kline[]>(cacheKey)
    if (cached) return cached

    const qs = new URLSearchParams(params).toString()
    const raw = await this.fetchWithRetry<BackpackKlineRaw[]>(`${BACKPACK_BASE}/api/v1/klines?${qs}`)
    const data = this._parseKlines(raw)
    this.setCache(cacheKey, data)
    return data
  }

  async getTrades(symbol: string, limit = 1000): Promise<Trade[]> {
    const params = { symbol, limit: String(limit) }
    const cacheKey = this.getCacheKey('/api/v1/trades', params)
    const cached = this.getFromCache<Trade[]>(cacheKey)
    if (cached) return cached

    const qs = new URLSearchParams(params).toString()
    const data = await this.fetchWithRetry<Trade[]>(`${BACKPACK_BASE}/api/v1/trades?${qs}`)
    this.setCache(cacheKey, data)
    return data
  }

  async getTradesHistory(symbol: string, limit = 1000, offset = 0): Promise<Trade[]> {
    const params = { symbol, limit: String(limit), offset: String(offset) }
    const cacheKey = this.getCacheKey('/api/v1/trades/history', params)
    const cached = this.getFromCache<Trade[]>(cacheKey)
    if (cached) return cached

    const qs = new URLSearchParams(params).toString()
    const data = await this.fetchWithRetry<Trade[]>(`${BACKPACK_BASE}/api/v1/trades/history?${qs}`)
    this.setCache(cacheKey, data)
    return data
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const params = { symbol }
    const cacheKey = this.getCacheKey('/api/v1/ticker', params)
    const cached = this.getFromCache<Ticker>(cacheKey)
    if (cached) return cached

    const raw = await this.fetchWithRetry<BackpackTickerRaw>(`${BACKPACK_BASE}/api/v1/ticker?symbol=${symbol}`)
    const lastPrice = parseFloat(raw.lastPrice)
    const volume = parseFloat(raw.volume)
    const quoteVolume = parseFloat(raw.quoteVolume || '0')
    const trades = parseInt(raw.trades, 10)
    const isStock = symbol.includes('.US_')

    // Stock tokens (RWA) return NASDAQ reference data in volume/quoteVolume/trades,
    // not the exchange's actual trading volume. Set to 0 — cannot determine real
    // Backpack volume from ticker endpoint. Use trades count as a rough proxy
    // of "this stock has activity" (even if reference data, correlated with popularity).
    const data: Ticker = {
      symbol: raw.symbol,
      lastPrice,
      priceChange24h: parseFloat(raw.priceChange),
      priceChangePercent24h: parseFloat(raw.priceChangePercent) * 100,
      volume24h: volume,
      quoteVolume24h: isStock ? 0 : quoteVolume,
      trades,
      high24h: parseFloat(raw.high),
      low24h: parseFloat(raw.low),
    }
    this.setCache(cacheKey, data)
    return data
  }

  async getTopStocksByVolume(limit = 15): Promise<StockCandidate[]> {
    const cacheKey = this.getCacheKey('/api/v1/markets?filter=topStocks', {})
    const cached = this.getFromCache<StockCandidate[]>(cacheKey)
    if (cached) return cached

    // Backpack lists .US_ symbols in the markets endpoint but does NOT support
    // ticker/klines endpoints for them — they return 204 No Content.
    // Skip stock scanning until a dedicated stock data provider (e.g. Brapi,
    // Twelve Data) is integrated. Crypto-only for now.
    const result: StockCandidate[] = []
    this.setCache(cacheKey, result)
    return result
  }

  clearCache(): void {
    this.cache.clear()
  }
}

export const marketDataCollector = new MarketDataCollector()
