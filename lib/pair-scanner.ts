// lib/pair-scanner.ts
// Escaneia a LI.FI por tokens suportados na rede atual
// e calcula spreads/spreads para sugerir os melhores pares

const LI_FI_API = "https://li.quest/v1";

const STABLE_SYMBOLS = new Set(["USDC", "USDT", "DAI", "EURC", "FRAX", "LUSD"]);

const VOLATILE_PRIORITY: Record<string, number> = {
  WETH: 1, WBTC: 2, WMATIC: 3, ARB: 4, SOL: 5,
};

export interface ScannedPair {
  fromToken: string;
  toToken: string;
  fromSymbol: string;
  toSymbol: string;
  fromDecimals: number;
  toDecimals: number;
  fromPrice?: number;
  toPrice?: number;
  spread: number;
  type: "stable_stable" | "stable_volatile" | "volatile_stable" | "volatile_volatile";
  priority: number;
}

export interface ScannedToken {
  symbol: string;
  address: string;
  decimals: number;
  chainId: number;
  coinKey?: string;
  name?: string;
  logoURI?: string;
}

interface LifiTokenData {
  symbol: string;
  address: string;
  decimals: number;
  chainId: number;
  coinKey?: string;
  name?: string;
  logoURI?: string;
}

interface LifiTokensResponse {
  tokens: Record<string, LifiTokenData[]>;
}

let tokenCache: Map<number, { tokens: ScannedToken[]; timestamp: number }> = new Map();
let priceCache: Map<string, { price: number; timestamp: number }> = new Map();

const COINGECKO_IDS: Record<string, string> = {
  WETH: "ethereum",
  WBTC: "bitcoin",
  WMATIC: "matic-network",
  ARB: "arbitrum",
  SOL: "solana",
  USDC: "usd-coin",
  USDT: "tether",
  DAI: "dai",
  EURC: "euro-coin",
  FRAX: "frax",
};

async function fetchTokenPrice(symbol: string): Promise<number | undefined> {
  const cached = priceCache.get(symbol);
  if (cached && Date.now() - cached.timestamp < 60000) return cached.price;

  const coinId = COINGECKO_IDS[symbol];
  if (!coinId) return undefined;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);
    const data = await res.json();
    const price = data[coinId]?.usd;
    if (price) {
      priceCache.set(symbol, { price, timestamp: Date.now() });
    }
    return price;
  } catch {
    return priceCache.get(symbol)?.price;
  }
}

class PairScanner {
  async fetchTokens(chainId: number): Promise<ScannedToken[]> {
    const cached = tokenCache.get(chainId);
    if (cached && Date.now() - cached.timestamp < 300000) return cached.tokens;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${LI_FI_API}/tokens?chains=${chainId}`, { signal: controller.signal });
      clearTimeout(timeoutId);
      const data: LifiTokensResponse = await res.json();
      const tokens = (data.tokens?.[String(chainId)] ?? []).map((t: LifiTokenData) => ({
        symbol: t.symbol,
        address: t.address,
        decimals: t.decimals,
        chainId: t.chainId,
        coinKey: t.coinKey,
        name: t.name,
        logoURI: t.logoURI,
      }));
      tokenCache.set(chainId, { tokens, timestamp: Date.now() });
      return tokens;
    } catch {
      return tokenCache.get(chainId)?.tokens ?? [];
    }
  }

  isStable(symbol: string): boolean {
    return STABLE_SYMBOLS.has(symbol);
  }

  async scanPairs(chainId: number, topN = 10): Promise<ScannedPair[]> {
    const tokens = await this.fetchTokens(chainId);
    const pairs: ScannedPair[] = [];

    // Pegar precos de todas as stables e volatels
    const relevantSymbols = [...new Set(tokens.map(t => t.symbol))];
    const pricePromises = relevantSymbols.map(sym => fetchTokenPrice(sym));
    const prices = await Promise.all(pricePromises);
    const priceMap = new Map<string, number>();
    relevantSymbols.forEach((sym, i) => {
      if (prices[i] !== undefined) priceMap.set(sym, prices[i]!);
    });

    for (const tokenA of tokens) {
      for (const tokenB of tokens) {
        if (tokenA.address === tokenB.address) continue;

        const typeA = this.isStable(tokenA.symbol);
        const typeB = this.isStable(tokenB.symbol);

        // Só nos interessam pares com ao menos uma stable
        if (!typeA && !typeB) continue;

        const priceA = priceMap.get(tokenA.symbol);
        const priceB = priceMap.get(tokenB.symbol);

        let spread = 0;
        if (priceA !== undefined && priceB !== undefined) {
          spread = Math.abs((priceB - priceA) / priceA) * 100;
        }

        let priority = 99;
        if (typeA && typeB) {
          // stable-stable: quanto maior o spread, melhor
          priority = Math.round(100 - spread);
        } else if (typeA && !typeB) {
          // stable->volatile: prioridade pelo token volatil
          priority = VOLATILE_PRIORITY[tokenB.symbol] ?? 10;
        } else if (!typeA && typeB) {
          priority = VOLATILE_PRIORITY[tokenA.symbol] ?? 10;
        }

        pairs.push({
          fromToken: tokenA.address,
          toToken: tokenB.address,
          fromSymbol: tokenA.symbol,
          toSymbol: tokenB.symbol,
          fromDecimals: tokenA.decimals,
          toDecimals: tokenB.decimals,
          fromPrice: priceA,
          toPrice: priceB,
          spread,
          type: typeA && typeB ? "stable_stable"
            : typeA && !typeB ? "stable_volatile"
            : !typeA && typeB ? "volatile_stable"
            : "volatile_volatile",
          priority,
        });
      }
    }

    // Ordenar: stable_volatile > stable_stable com spread alto
    pairs.sort((a, b) => {
      const order = { stable_volatile: 0, volatile_stable: 1, stable_stable: 2, volatile_volatile: 3 };
      const diff = (order[a.type] ?? 9) - (order[b.type] ?? 9);
      if (diff !== 0) return diff;
      if (a.type === "stable_stable") return b.spread - a.spread;
      return a.priority - b.priority;
    });

    return pairs.slice(0, topN);
  }

  invalidateCache(chainId?: number) {
    if (chainId) {
      tokenCache.delete(chainId);
    } else {
      tokenCache.clear();
    }
  }
}

export const pairScanner = new PairScanner();
