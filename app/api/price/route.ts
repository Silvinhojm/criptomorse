import { NextRequest } from 'next/server';
import { fetchPrices } from '@/lib/sosovalue-price-agent';

const FALLBACK_PRICES: Record<string, number> = {
  '1673723677362319866': 68000,  // btc
  '1673723677362319867': 1850,   // eth
  '1730847291434274818': 0.078,  // POL
  '1673723677362319902': 0.55,   // arb
  '1673723677362319875': 145,    // sol
  '1673723677362320241': 1.08,   // eurc
  '1673723677362319870': 1.0,    // USDC
};

const FALLBACK_CHANGE: Record<string, number> = {
  '1673723677362319866': 1.5,
  '1673723677362319867': 2.5,
  '1730847291434274818': 3.0,
  '1673723677362319902': 4.0,
  '1673723677362319875': 3.5,
  '1673723677362320241': 0.5,
  '1673723677362319870': 0.1,
};

let priceCache: { prices: Record<string, number>; change24h: Record<string, number>; ts: number } | null = null;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const idsParam = searchParams.get('ids');
    if (!idsParam) {
      return Response.json({ error: 'Missing ids param' }, { status: 400 });
    }

    const ids = idsParam.split(',').filter(Boolean);
    const cached = priceCache;
    if (cached && Date.now() - cached.ts < 15000) {
      const prices: Record<string, number> = {};
      const change24h: Record<string, number> = {};
      let allCached = true;
      for (const id of ids) {
        if (cached.prices[id] !== undefined) {
          prices[id] = cached.prices[id];
          change24h[id] = cached.change24h[id] ?? 0;
        } else {
          allCached = false;
          break;
        }
      }
      if (allCached) return Response.json({ prices, change24h });
    }

    const result = await fetchPrices(ids);
    const prices: Record<string, number> = {};
    const change24h: Record<string, number> = {};
    for (const id of ids) {
      const raw = result.prices[id];
      prices[id] = (raw !== undefined && raw > 0) ? raw : (FALLBACK_PRICES[id] ?? 1.0);
      change24h[id] = result.change24h[id] ?? FALLBACK_CHANGE[id] ?? 0;
    }

    priceCache = { prices, change24h, ts: Date.now() };
    return Response.json({ prices, change24h });
  } catch {
    const idsParam = new URL(request.url).searchParams.get('ids') ?? '';
    const ids = idsParam.split(',').filter(Boolean);
    const prices: Record<string, number> = {};
    const change24h: Record<string, number> = {};
    if (priceCache) {
      for (const id of ids) {
        prices[id] = priceCache.prices[id] ?? FALLBACK_PRICES[id] ?? 1.0;
        change24h[id] = priceCache.change24h[id] ?? FALLBACK_CHANGE[id] ?? 0;
      }
    } else {
      for (const id of ids) {
        prices[id] = FALLBACK_PRICES[id] ?? 1.0;
        change24h[id] = FALLBACK_CHANGE[id] ?? 0;
      }
    }
    return Response.json({ prices, change24h });
  }
}
