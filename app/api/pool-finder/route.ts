import { NextResponse } from 'next/server';

const CHAIN_MAP: Record<string, string> = {
  polygon: 'polygon',
  ethereum: 'ethereum',
  base: 'base',
  arbitrum: 'arbitrum',
};

function calcularScore(p: any): number {
  const tvl = parseFloat(p.liquidity?.usd ?? '0');
  const vol = parseFloat(p.volume?.h24 ?? '0');
  const change1h = Math.abs(parseFloat(p.priceChange?.h1 ?? '0'));
  const giro = vol / Math.max(tvl, 1);
  const estabilidade = Math.max(0, 1 - change1h / 5);
  return Math.round(giro * estabilidade * 100);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rede = searchParams.get('rede') ?? 'polygon';
  const chain = CHAIN_MAP[rede];
  if (!chain) return NextResponse.json({ error: `Rede não suportada: ${rede}` }, { status: 400 });

  const queries = ['USDC', 'USDT', 'WETH', 'WMATIC', 'WBTC', 'EURC', 'DAI'];

  try {
    const results = await Promise.all(
      queries.map(async (q) => {
        try {
          const res = await fetch(
            `https://api.dexscreener.com/latest/dex/search/?q=${q}&chain=${chain}`,
            { signal: AbortSignal.timeout(10_000) },
          );
          const data = await res.json();
          return data.pairs ?? [];
        } catch { return []; }
      }),
    );

    const allPairs = results
      .flat()
      .filter((p: any) => parseFloat(p.liquidity?.usd ?? '0') > 50000)
      .filter((p: any) => parseFloat(p.volume?.h24 ?? '0') > 10000)
      .map((p: any) => ({
        address: p.pairAddress,
        chain: p.chainId,
        dex: p.dexId,
        token0: p.baseToken?.symbol ?? '',
        token1: p.quoteToken?.symbol ?? '',
        label: `${p.baseToken?.symbol ?? ''}/${p.quoteToken?.symbol ?? ''}`,
        tvlUSD: parseFloat(p.liquidity?.usd ?? '0'),
        volumeUSD24h: parseFloat(p.volume?.h24 ?? '0'),
        priceUSD: parseFloat(p.priceUsd ?? '0'),
        priceChange1h: parseFloat(p.priceChange?.h1 ?? '0'),
        priceChange24h: parseFloat(p.priceChange?.h24 ?? '0'),
        fee: parseFloat(p.fee ?? '0'),
        url: p.url,
        score: 0,
      }));

    // Remover duplicatas (mesmo endereço)
    const seen = new Set<string>();
    const unique = allPairs.filter((p: any) => {
      if (seen.has(p.address)) return false;
      seen.add(p.address);
      return true;
    });

    // Calcular score e ordenar
    for (const p of unique) p.score = calcularScore(p);
    unique.sort((a: any, b: any) => b.score - a.score);

    return NextResponse.json(unique.slice(0, 15));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
