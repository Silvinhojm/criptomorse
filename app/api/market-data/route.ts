import { NextRequest } from 'next/server';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

async function fetchWithFallback(url: string, fallback: unknown): Promise<unknown> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  try {
    const [newsData, fngData, globalData, cryptocompareNews] = await Promise.all([
      fetchWithFallback(`${COINGECKO_BASE}/news`, []),
      fetchWithFallback('https://api.alternative.me/fng/?limit=5', { data: [] }),
      fetchWithFallback(`${COINGECKO_BASE}/global`, { data: {} }),
      fetchWithFallback('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&limit=15', { Data: [] }),
    ]);

    const newsList = (newsData as any[])?.slice?.(0, 10) ?? [];
    const ccNews = ((cryptocompareNews as any)?.Data as any[])?.slice?.(0, 10) ?? [];

    const headlines = [
      ...newsList.map((n: any) => n.title?.replace(/<[^>]*>/g, '') ?? '').filter(Boolean),
      ...ccNews.map((n: any) => n.title?.replace(/<[^>]*>/g, '') ?? '').filter(Boolean),
    ];

    const fngItems = (fngData as any)?.data ?? [];
    const fngValue = parseInt(fngItems[0]?.value ?? '50');
    const fngClassification = fngItems[0]?.value_classification ?? 'Neutral';
    const fngHistory = fngItems.slice(0, 5).map((d: any) => ({
      value: parseInt(d.value ?? '50'),
      classification: d.value_classification ?? 'Neutral',
      timestamp: d.timestamp ?? 0,
    }));

    const global = globalData as any;
    const btcDominance = global?.data?.market_cap_percentage?.btc ?? 55;
    const totalMarketCap = global?.data?.total_market_cap?.usd ?? 0;
    const volume24h = global?.data?.total_volume?.usd ?? 0;

    return Response.json({
      headlines,
      fearGreed: { value: fngValue, classification: fngClassification, history: fngHistory },
      market: {
        btcDominance: Math.round(btcDominance * 100) / 100,
        totalMarketCap,
        volume24h,
      },
      timestamp: Date.now(),
    });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
