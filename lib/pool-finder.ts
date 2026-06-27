export interface PoolInfo {
  address: string;
  chain: string;
  dex: string;
  token0: string;
  token1: string;
  label: string;
  tvlUSD: number;
  volumeUSD24h: number;
  priceUSD: number;
  priceChange1h: number;
  priceChange24h: number;
  fee: number;
  url: string;
  score: number;
}

const poolCache: { data: PoolInfo[]; timestamp: number } = { data: [], timestamp: 0 };
const CACHE_TTL = 5 * 60 * 1000;

export async function getTopPools(rede: string = 'polygon'): Promise<PoolInfo[]> {
  const now = Date.now();
  if (now - poolCache.timestamp < CACHE_TTL && poolCache.data.length > 0) {
    return poolCache.data;
  }

  try {
    const res = await fetch(`/api/pool-finder?rede=${rede}`, { signal: AbortSignal.timeout(10_000) });
    const data = await res.json();
    if (Array.isArray(data)) {
      poolCache.data = data;
      poolCache.timestamp = now;
      return data;
    }
    return [];
  } catch {
    return poolCache.data; // fallback para cache expirado
  }
}

export function calcularScore(p: { tvlUSD: number; volumeUSD24h: number; priceChange1h: number }): number {
  const giro = p.volumeUSD24h / Math.max(p.tvlUSD, 1);
  const estabilidade = Math.max(0, 1 - Math.abs(p.priceChange1h) / 5);
  return Math.round(giro * estabilidade * 100);
}

export function isStableToken(symbol: string): boolean {
  return ['USDC', 'USDT', 'DAI', 'EURC'].includes(symbol);
}
