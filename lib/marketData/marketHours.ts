const NY_OPEN_HOUR = 9
const NY_OPEN_MINUTE = 30
const NY_CLOSE_HOUR = 16
const NY_CLOSE_MINUTE = 0

export function isUSStockMarketOpen(date?: Date): boolean {
  const d = date ?? new Date()

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })

  const parts = formatter.formatToParts(d)
  const weekday = parts.find(p => p.type === 'weekday')?.value ?? ''
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10)
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10)

  if (weekday === 'Sat' || weekday === 'Sun') return false

  const totalMinutes = hour * 60 + minute
  const openMinutes = NY_OPEN_HOUR * 60 + NY_OPEN_MINUTE
  const closeMinutes = NY_CLOSE_HOUR * 60 + NY_CLOSE_MINUTE

  return totalMinutes >= openMinutes && totalMinutes < closeMinutes
}

export function isStockSymbol(symbol: string): boolean {
  return symbol.includes('.US_')
}

export function getNYSEtatHour(): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })
  return formatter.format(new Date())
}
