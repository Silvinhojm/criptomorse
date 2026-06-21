import { NextRequest } from 'next/server';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

const FALLBACK_PRICES: Record<string, number> = {
  'ethereum': 1850,
  'matic-network': 0.078,
  'bitcoin': 68000,
  'arbitrum': 0.55,
  'solana': 145,
  'eurc': 1.08,
  'usd-coin': 1.0,
};

const FALLBACK_CHANGE: Record<string, number> = {
  'ethereum': 2.5,
  'matic-network': 3.0,
  'bitcoin': 1.5,
  'arbitrum': 4.0,
  'solana': 3.5,
  'eurc': 0.5,
  'usd-coin': 0.1,
};

let priceCache: { data: Record<string, { usd: number; usd_24h_change?: number }>; timestamp: number } | null = null;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ids = searchParams.get('ids');
    if (!ids) {
      return Response.json({ error: 'Missing ids param' }, { status: 400 });
    }

    const cached = priceCache;
    if (cached && Date.now() - cached.timestamp < 15000) {
      const prices: Record<string, number> = {};
      const change24h: Record<string, number> = {};
      for (const id of ids.split(',')) {
        prices[id] = cached.data[id]?.usd ?? FALLBACK_PRICES[id] ?? 1.0;
        change24h[id] = cached.data[id]?.usd_24h_change ?? FALLBACK_CHANGE[id] ?? 0;
      }
      return Response.json({ prices, change24h });
    }

    const res = await fetch(
      `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(8000) }
    );

    if (!res.ok) {
      const prices: Record<string, number> = {};
      const change24h: Record<string, number> = {};
      if (cached) {
        for (const id of ids.split(',')) {
          prices[id] = cached.data[id]?.usd ?? FALLBACK_PRICES[id] ?? 1.0;
          change24h[id] = cached.data[id]?.usd_24h_change ?? FALLBACK_CHANGE[id] ?? 0;
        }
      } else {
        for (const id of ids.split(',')) {
          prices[id] = FALLBACK_PRICES[id] ?? 1.0;
          change24h[id] = FALLBACK_CHANGE[id] ?? 0;
        }
      }
      return Response.json({ prices, change24h });
    }

    const data = await res.json();
    priceCache = { data, timestamp: Date.now() };

    const prices: Record<string, number> = {};
    const change24h: Record<string, number> = {};
    for (const id of ids.split(',')) {
      prices[id] = data[id]?.usd ?? FALLBACK_PRICES[id] ?? 1.0;
      change24h[id] = data[id]?.usd_24h_change ?? FALLBACK_CHANGE[id] ?? 0;
    }
    return Response.json({ prices, change24h });
  } catch {
    const ids = new URL(request.url).searchParams.get('ids') ?? '';
    const prices: Record<string, number> = {};
    const change24h: Record<string, number> = {};
    if (priceCache) {
      for (const id of ids.split(',')) {
        prices[id] = priceCache.data[id]?.usd ?? FALLBACK_PRICES[id] ?? 1.0;
        change24h[id] = priceCache.data[id]?.usd_24h_change ?? FALLBACK_CHANGE[id] ?? 0;
      }
    } else {
      for (const id of ids.split(',')) {
        prices[id] = FALLBACK_PRICES[id] ?? 1.0;
        change24h[id] = FALLBACK_CHANGE[id] ?? 0;
      }
    }
    return Response.json({ prices, change24h });
  }
}
