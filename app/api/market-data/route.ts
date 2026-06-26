import { NextRequest } from 'next/server';

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
    const [fngData, cryptocompareNews] = await Promise.all([
      fetchWithFallback('https://api.alternative.me/fng/?limit=5', { data: [] }),
      fetchWithFallback('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&limit=15', { Data: [] }),
    ]);

    const ccNews = ((cryptocompareNews as any)?.Data as any[])?.slice?.(0, 10) ?? [];
    const headlines = ccNews.map((n: any) => n.title?.replace(/<[^>]*>/g, '') ?? '').filter(Boolean);

    const fngItems = (fngData as any)?.data ?? [];
    const fngValue = parseInt(fngItems[0]?.value ?? '50');
    const fngClassification = fngItems[0]?.value_classification ?? 'Neutral';
    const fngHistory = fngItems.slice(0, 5).map((d: any) => ({
      value: parseInt(d.value ?? '50'),
      classification: d.value_classification ?? 'Neutral',
      timestamp: d.timestamp ?? 0,
    }));

    return Response.json({
      headlines,
      fearGreed: { value: fngValue, classification: fngClassification, history: fngHistory },
      market: { btcDominance: 55, totalMarketCap: 0, volume24h: 0 },
      timestamp: Date.now(),
    });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
