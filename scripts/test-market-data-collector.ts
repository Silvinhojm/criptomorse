import { marketDataCollector } from '../lib/marketData/MarketDataCollector'
import { labelPriceMovement, getThresholdForSymbol } from '../lib/marketData/labelPriceMovement'
import { passesLiquidityFilter } from '../lib/marketData/liquidityFilter'
import { isUSStockMarketOpen, isStockSymbol, getNYSEtatHour } from '../lib/marketData/marketHours'

async function main() {
  console.log('=== MarketDataCollector Test ===\n')

  // 1. Fetch available markets
  console.log('📡 Fetching markets...')
  const markets = await marketDataCollector.getMarkets('SPOT')
  console.log(`Total markets: ${markets.length}`)

  const btcMarket = markets.find(m => m.symbol === 'BTC_USDC')
  const ethMarket = markets.find(m => m.symbol === 'ETH_USDC')
  const stockMarkets = markets.filter(m => m.symbol.includes('.US_'))
  console.log(`BTC_USDC: ${btcMarket?.orderBookState ?? 'not found'}`)
  console.log(`ETH_USDC: ${ethMarket?.orderBookState ?? 'not found'}`)
  console.log(`Stock tokens: ${stockMarkets.length} —`, stockMarkets.map(m => m.symbol).join(', ') || '(none)')

  // 2. getTopStocksByVolume
  console.log('\n📊 getTopStocksByVolume(15) — sorted by trades (volume unreliable for stocks)...')
  const topStocks = await marketDataCollector.getTopStocksByVolume(15)
  console.log(`Discovered ${topStocks.length} stock candidates:`)
  for (const s of topStocks) {
    console.log(`  ${s.symbol} | quoteVolume24h: unreliable (set to 0) | trades: ${s.trades.toLocaleString()} (ref data)`)
  }

  // 3. Liquidity filter (stocks always fail since quoteVolume24h=0 — expected)
  console.log('\n🔍 passesLiquidityFilter — testing discovered stocks:')
  let passed = 0
  for (const s of topStocks) {
    const ticker = await marketDataCollector.getTicker(s.symbol)
    const ok = passesLiquidityFilter(ticker)
    if (ok) passed++
    console.log(`  ${s.symbol}: ${ok ? '✅' : '❌'} (vol unreliable=0, range ${ticker.high24h > 0 ? (((ticker.high24h - ticker.low24h) / ticker.low24h) * 100).toFixed(1) : '?'}%)`)
  }
  console.log(`  → ${passed}/${topStocks.length} passed (stocks always fail: quoteVolume24h=0 by design)`)
  console.log(`  (Scanner skips liquidity filter for stocks — includes all discovered stock markets)`) 

  // 4. Market hours
  console.log('\n🕐 isUSStockMarketOpen():')
  console.log(`  NYSE ET: ${getNYSEtatHour()}h`)
  console.log(`  Market ${isUSStockMarketOpen() ? '🟢 OPEN' : '🔴 CLOSED'}`)

  // 5. Threshold test
  console.log('\n📐 getThresholdForSymbol:')
  const testSymbols = ['BTC_USDC', 'ETH_USDC', 'SOL_USDC', 'SPCX.US_USDC', 'MU.US_USDC', 'SOME_CRYPTO']
  for (const sym of testSymbols) {
    console.log(`  ${sym}: ${getThresholdForSymbol(sym)}%`)
  }

  // 6. labelPriceMovement with different thresholds
  console.log('\n📊 labelPriceMovement with per-symbol thresholds...')
  const now = Math.floor(Date.now() / 1000)
  const startTime = now - 24 * 3600

  const btcKlines = await marketDataCollector.getKlines('BTC_USDC', '1h', startTime, now)
  const btcLabels = labelPriceMovement(btcKlines, 60, 'BTC_USDC')
  console.log(`  BTC_USDC (threshold ${getThresholdForSymbol('BTC_USDC')}%): ${btcLabels.length} windows — ` +
    `alta:${btcLabels.filter(l => l.label === 'alta').length} baixa:${btcLabels.filter(l => l.label === 'baixa').length} neutro:${btcLabels.filter(l => l.label === 'neutro').length}`)

  if (stockMarkets.length > 0) {
    const stockSymbol = stockMarkets[0].symbol
    const stockKlines = await marketDataCollector.getKlines(stockSymbol, '1h', startTime, now)
    const stockLabels = labelPriceMovement(stockKlines, 60, stockSymbol)
    console.log(`  ${stockSymbol} (threshold ${getThresholdForSymbol(stockSymbol)}%): ${stockLabels.length} windows — ` +
      `alta:${stockLabels.filter(l => l.label === 'alta').length} baixa:${stockLabels.filter(l => l.label === 'baixa').length} neutro:${stockLabels.filter(l => l.label === 'neutro').length}`)
  }

  // 7. Verify crypto not classified as stock
  console.log('\n🔎 isStockSymbol check:')
  for (const m of markets.slice(0, 10)) {
    if (isStockSymbol(m.symbol)) {
      console.log(`  WARNING: ${m.symbol} classified as stock (false positive)`)
    }
  }
  for (const m of stockMarkets) {
    console.log(`  ${m.symbol}: ${isStockSymbol(m.symbol) ? '✅ stock' : '❌ not stock'}`)
  }

  // 8. Backward compat — labelPriceMovement without symbol still works
  console.log('\n♻️ Backward compatibility test...')
  const compatLabels = labelPriceMovement(btcKlines, 60)
  console.log(`  No symbol passed: ${compatLabels.length} windows (default threshold 0.5%)`)

  console.log('\n=== Done ===')
}

main().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
