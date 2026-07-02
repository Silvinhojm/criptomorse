import type { Ticker } from './MarketDataCollector'

const MIN_QUOTE_VOLUME_24H = 50_000
const MAX_HIGH_LOW_RANGE_PCT = 50

export function passesLiquidityFilter(ticker: Ticker): boolean {
  if (ticker.quoteVolume24h < MIN_QUOTE_VOLUME_24H) return false

  if (ticker.high24h > 0 && ticker.low24h > 0) {
    const rangePct = ((ticker.high24h - ticker.low24h) / ticker.low24h) * 100
    if (rangePct > MAX_HIGH_LOW_RANGE_PCT) return false
  }

  return true
}
