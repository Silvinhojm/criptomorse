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

// RI-BANK-86 — tabela de fallback movida pra cá (era local a
// app/api/price/route.ts) para que o caminho server-side de preço
// (real-swap-executor.ts's _getTokenPrice(), chamado durante execução real
// de cron/KMS) possa usá-la sem depender de um round-trip HTTP até a
// própria rota. Mesmos valores, mesma fonte de verdade — a rota
// app/api/price/route.ts (usada pelo navegador) agora importa daqui em vez
// de duplicar.
export const FALLBACK_PRICES: Record<string, number> = {
  "1673723677362319866": 68000,  // btc (também cirBTC/mcirBTC, mapeados pro mesmo id)
  "1673723677362319867": 1850,   // eth
  "1730847291434274818": 0.078,  // POL
  "1673723677362319902": 0.55,   // arb
  "1673723677362319875": 145,    // sol
  "1673723677362320241": 1.08,   // eurc
  "1673723677362319870": 1.0,    // USDC
};

export const FALLBACK_CHANGE: Record<string, number> = {
  "1673723677362319866": 1.5,
  "1673723677362319867": 2.5,
  "1730847291434274818": 3.0,
  "1673723677362319902": 4.0,
  "1673723677362319875": 3.5,
  "1673723677362320241": 0.5,
  "1673723677362319870": 0.1,
};

// RI-BANK-86 — resolve o preço de um coinId em processo, sem HTTP, sem
// depender de nenhuma URL (relativa ou absoluta). Usado pelo caminho
// server-side de real-swap-executor.ts's _getTokenPrice() -- ver comentário
// lá para o contexto completo do bug que isso corrige (RI-BANK-85: a
// versão anterior montava uma URL via VERCEL_URL e fazia fetch() de volta
// pra própria rota /api/price; se essa URL não resolvesse, o preço nunca
// era buscado e caía direto no fallback de $0 pra ativos não-stable, sem
// nem tentar). Mesma lógica de fallback já usada por app/api/price/route.ts
// (preço real se disponível, senão FALLBACK_PRICES, senão $1.00).
export async function resolvePriceWithFallback(coinId: string): Promise<{ price: number; change24h: number }> {
  const { prices, change24h } = await fetchPrices([coinId])
  const raw = prices[coinId]
  const price = (raw !== undefined && raw > 0) ? raw : (FALLBACK_PRICES[coinId] ?? 1.0)
  return { price, change24h: change24h[coinId] ?? FALLBACK_CHANGE[coinId] ?? 0 }
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
