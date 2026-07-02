import type { Kline } from './MarketDataCollector'

export type MovementLabel = 'alta' | 'baixa' | 'neutro'

export interface LabeledWindow {
  startTime: number
  endTime: number
  openPrice: number
  closePrice: number
  changePercent: number
  label: MovementLabel
}

const CRYPTO_MAJORS = new Set(['BTC_USDC', 'ETH_USDC', 'SOL_USDC'])
const THRESHOLD_CRYPTO = 0.3
const THRESHOLD_STOCK = 1.5
const THRESHOLD_DEFAULT = 0.5

export function getThresholdForSymbol(symbol: string): number {
  if (CRYPTO_MAJORS.has(symbol)) return THRESHOLD_CRYPTO
  if (symbol.includes('.US_')) return THRESHOLD_STOCK
  return THRESHOLD_DEFAULT
}

export function labelPriceMovement(
  klines: Kline[],
  windowMinutes: number,
  symbol?: string,
): LabeledWindow[] {
  const thresholdPct = symbol ? getThresholdForSymbol(symbol) : THRESHOLD_DEFAULT
  if (klines.length < 2) return []

  const sorted = [...klines].sort((a, b) => a.start - b.start)
  const results: LabeledWindow[] = []

  const windowMs = windowMinutes * 60 * 1000

  for (let i = 0; i < sorted.length; i++) {
    const startCandle = sorted[i]
    const endIdx = sorted.findIndex(
      (c, j) => j > i && c.start >= startCandle.start + windowMs,
    )

    let endCandle: Kline
    if (endIdx === -1) {
      if (i + 1 >= sorted.length) break
      endCandle = sorted[sorted.length - 1]
    } else {
      if (endIdx - 1 <= i) continue
      endCandle = sorted[endIdx - 1]
    }

    const changePercent = ((endCandle.close - startCandle.open) / startCandle.open) * 100

    let label: MovementLabel
    if (changePercent > thresholdPct) {
      label = 'alta'
    } else if (changePercent < -thresholdPct) {
      label = 'baixa'
    } else {
      label = 'neutro'
    }

    results.push({
      startTime: startCandle.start,
      endTime: endCandle.end,
      openPrice: startCandle.open,
      closePrice: endCandle.close,
      changePercent: Math.round(changePercent * 10000) / 10000,
      label,
    })
  }

  return results
}
