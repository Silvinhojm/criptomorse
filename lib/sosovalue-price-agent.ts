// SoSoValue currency IDs (hardcoded from /currencies endpoint)
const SOSO_CURRENCY_IDS: Record<string, string> = {
  WETH: "1673723677362319867",
  ETH: "1673723677362319867",
  WBTC: "1673723677362319882",
  BTC: "1673723677362319866",
  USDC: "1673723677362319870",
  USDT: "1673723677362319868",
  DAI: "1673723677362319879",
  EURC: "1673723677362320241",
  SOL: "1673723677362319875",
  ARB: "1673723677362319902",
  POL: "1730847291434274818",
  WMATIC: "1730847291434274818",
  WSTETH: "1673723677362319872",
  MATIC: "1730847291434274818",
  LINK: "1673723677362319887",
  UNI: "1673723677362319884",
  AAVE: "0",
  CRV: "0",
  // cirBTC/mcirBTC not on SoSoValue — fallback to BTC price
  cirBTC: "1673723677362319866",
  mcirBTC: "1673723677362319866",
  // ARC token — not the AI Rig Complex, keep separate
  ARC: "1867370404447481858",
};

const SOSO_API_BASE = "https://openapi.sosovalue.com/openapi/v1";
const API_KEY = process.env.SOSO_API_KEY || "";

interface PriceCache {
  prices: Record<string, number>;
  change24h: Record<string, number>;
  ts: number;
}

let cache: PriceCache | null = null;
let lastRequest = 0;
const MIN_INTERVAL_MS = 3000;
const CACHE_TTL_MS = 15000;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const wait = Math.max(0, MIN_INTERVAL_MS - (now - lastRequest));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequest = Date.now();
  return fetch(url, {
    headers: { "x-soso-api-key": API_KEY },
    signal: AbortSignal.timeout(8000),
  });
}

function getCurrencyId(token: string): string | undefined {
  const t = token.toUpperCase();
  if (SOSO_CURRENCY_IDS[t]) return SOSO_CURRENCY_IDS[t];
  if (SOSO_CURRENCY_IDS[token]) return SOSO_CURRENCY_IDS[token];
  return undefined;
}

export async function fetchPrice(token: string): Promise<number> {
  return fetchPrices([token]).then(r => r.prices[token] ?? 0);
}

export async function fetchPrices(tokens: string[]): Promise<{ prices: Record<string, number>; change24h: Record<string, number> }> {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL_MS) {
    const prices: Record<string, number> = {};
    const change24h: Record<string, number> = {};
    let allCached = true;
    for (const t of tokens) {
      if (cache.prices[t] !== undefined) {
        prices[t] = cache.prices[t];
        change24h[t] = cache.change24h[t] ?? 0;
      } else {
        allCached = false;
        break;
      }
    }
    if (allCached) return { prices, change24h };
  }

  const uniqueTokens = [...new Set(tokens)];
  const results = await Promise.allSettled(
    uniqueTokens.map(async (token) => {
      // Se o token já é um currency_id numérico (19+ dígitos), usa direto
      const id = /^\d{16,}$/.test(token) ? token : getCurrencyId(token);
      const idFinal = id || getCurrencyId(token);
      if (!idFinal || idFinal === "0") return { token, price: 0, change: 0 };
      const res = await rateLimitedFetch(`${SOSO_API_BASE}/currencies/${idFinal}/market-snapshot`);
      if (!res.ok) return { token, price: 0, change: 0 };
      const body = await res.json();
      const d = body.data ?? body;
      return {
        token,
        price: Number(d.price) || 0,
        change: Number(d.change_pct_24h) || 0,
      };
    })
  );

  const prices: Record<string, number> = {};
  const change24h: Record<string, number> = {};
  for (const result of results) {
    if (result.status === "fulfilled") {
      prices[result.value.token] = result.value.price;
      change24h[result.value.token] = result.value.change;
    }
  }

  cache = { prices: { ...cache?.prices, ...prices }, change24h: { ...cache?.change24h, ...change24h }, ts: now };
  return { prices, change24h };
}

export async function getMarketSnapshot(token: string): Promise<{
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  marketcap: number;
}> {
  const id = getCurrencyId(token);
  if (!id || id === "0") return { price: 0, change24h: 0, high24h: 0, low24h: 0, marketcap: 0 };
  const res = await rateLimitedFetch(`${SOSO_API_BASE}/currencies/${id}/market-snapshot`);
  if (!res.ok) return { price: 0, change24h: 0, high24h: 0, low24h: 0, marketcap: 0 };
  const body = await res.json();
  const d = body.data ?? body;
  return {
    price: Number(d.price) || 0,
    change24h: Number(d.change_pct_24h) || 0,
    high24h: Number(d.high_24h) || 0,
    low24h: Number(d.low_24h) || 0,
    marketcap: Number(d.marketcap) || 0,
  };
}
