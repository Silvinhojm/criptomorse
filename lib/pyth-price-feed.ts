// lib/pyth-price-feed.ts
// Preços via Pyth Oracle usando Hermes API (off-chain HTTP).
// Para Arc testnet — contrato Pyth em 0x2880aB155794e7179c9eE2e38200202908C17B43
// Feed IDs globais (mesmos em todas as chains).

const HERMES_URL = "https://hermes.pyth.network/v2/updates/price/latest"

// Feed IDs Pyth para tokens suportados (32 bytes hex)
// Fonte: https://pyth.network/developers/price-feed-ids
const PYTH_FEED_IDS: Record<string, string> = {
  BTC:  "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  WBTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH:  "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  WETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOL:  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  USDC: "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  USDT: "2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
  DAI:  "b0948a5e5313200c632b51bb5ca32f6de0d36e9950a942d19751e833f70dabfd",
  EURC: "76fa85158bf14ede77087fe3ae472f66213f6ea2f5b411cb2de472794990fa5c",
  POL:  "ffd11c5a1cfd42f80afb2df4d9f264c15f956d68153335374ec10722edd70472",
  WMATIC:"ffd11c5a1cfd42f80afb2df4d9f264c15f956d68153335374ec10722edd70472",
}

export function hasPythFeed(token: string): boolean {
  return !!PYTH_FEED_IDS[token]
}

export async function queryPythPrice(
  token: string,
): Promise<number | null> {
  const feedId = PYTH_FEED_IDS[token]
  if (!feedId) return null

  try {
    const url = `${HERMES_URL}?ids[]=${feedId}`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null

    const body = await res.json()
    const parsed = body?.parsed
    if (!parsed?.length) return null

    const { price: priceObj } = parsed[0]
    if (!priceObj) return null

    const rawPrice = BigInt(priceObj.price)
    const expo = Number(priceObj.expo)
    const decimals = Math.abs(expo)

    if (rawPrice <= 0n) return null

    const priceStr = rawPrice.toString()
    const sign = expo >= 0 ? 1 : -1
    const absDec = Math.abs(expo)
    const padded = priceStr.padStart(absDec + 1, "0")
    const intPart = padded.slice(0, padded.length - absDec) || "0"
    const fracPart = padded.slice(padded.length - absDec)
    const result = parseFloat(`${intPart}.${fracPart}`)

    return result > 0 ? result : null
  } catch {
    return null
  }
}

export async function queryPythPrices(
  tokens: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const ids = tokens
    .map(t => PYTH_FEED_IDS[t])
    .filter(Boolean) as string[]

  if (ids.length === 0) return result

  try {
    const url = `${HERMES_URL}?${ids.map(id => `ids[]=${id}`).join("&")}`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return result

    const body = await res.json()
    const parsed = body?.parsed
    if (!parsed?.length) return result

    const tokenById = Object.fromEntries(
      Object.entries(PYTH_FEED_IDS).map(([t, id]) => [id, t])
    )

    for (const item of parsed) {
      const token = tokenById[item.id]
      if (!token) continue
      const { price: priceObj } = item
      if (!priceObj || BigInt(priceObj.price) <= 0n) continue

      const rawPrice = BigInt(priceObj.price)
      const expo = Number(priceObj.expo)
      const absDec = Math.abs(expo)
      const padded = rawPrice.toString().padStart(absDec + 1, "0")
      const intPart = padded.slice(0, padded.length - absDec) || "0"
      const fracPart = padded.slice(padded.length - absDec)
      const price = parseFloat(`${intPart}.${fracPart}`)

      if (price > 0) result.set(token, price)
    }
  } catch {
    // Silencioso
  }

  return result
}
