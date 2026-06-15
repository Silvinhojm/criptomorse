import { NextRequest } from 'next/server';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

const FALLBACK_PRICES: Record<string, number> = {
  'ethereum': 1850,
  'matic-network': 0.35,
  'bitcoin': 68000,
  'arbitrum': 0.55,
  'solana': 145,
};

let priceCache: { data: Record<string, { usd: number }>; timestamp: number } | null = null;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ids = searchParams.get('ids');
    if (!ids) {
      return Response.json({ error: 'Missing ids param' }, { status: 400 });
    }

    const cached = priceCache;
    if (cached && Date.now() - cached.timestamp < 15000) {
      const result: Record<string, number> = {};
      for (const id of ids.split(',')) {
        result[id] = cached.data[id]?.usd ?? FALLBACK_PRICES[id] ?? 0;
      }
      return Response.json(result);
    }

    const res = await fetch(
      `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8000) }
    );

    if (!res.ok) {
      const result: Record<string, number> = {};
      if (cached) {
        for (const id of ids.split(',')) {
          result[id] = cached.data[id]?.usd ?? FALLBACK_PRICES[id] ?? 1.0;
        }
      } else {
        for (const id of ids.split(',')) {
          result[id] = FALLBACK_PRICES[id] ?? 1.0;
        }
      }
      return Response.json(result);
    }

    const data = await res.json();
    priceCache = { data, timestamp: Date.now() };

    const result: Record<string, number> = {};
    for (const id of ids.split(',')) {
      result[id] = data[id]?.usd ?? FALLBACK_PRICES[id] ?? 1.0;
    }
    return Response.json(result);
  } catch {
    const ids = new URL(request.url).searchParams.get('ids') ?? '';
    if (priceCache) {
      const result: Record<string, number> = {};
      for (const id of ids.split(',')) {
        result[id] = priceCache.data[id]?.usd ?? FALLBACK_PRICES[id] ?? 1.0;
      }
      return Response.json(result);
    }
    const result: Record<string, number> = {};
    for (const id of ids.split(',')) {
      result[id] = FALLBACK_PRICES[id] ?? 1.0;
    }
    return Response.json(result);
  }
}
