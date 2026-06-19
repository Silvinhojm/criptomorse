// lib/pair-price-feed.ts
// Feed de preço real por par, compartilhado entre quantum-wave.ts e pregueiro.ts.
// Substitui os antigos geradores de amplitude/momentum/volatilidade via Math.random().
//
// Estratégia: usamos /api/price (CoinGecko) para obter o preço USD de cada token,
// calculamos o preço relativo to/from, e mantemos um histórico curto em memória
// por par para derivar momentum (variação) e volatilidade (dispersão) reais.
//
// Na rede Arc, usamos o oracle Stork on-chain como fonte primária de preço,
// com fallback para CoinGecko.

import { ethers } from "ethers";
import type { TokenSymbol } from "./real-swap-executor";

// Contrato do oracle Stork na Arc Testnet
const STORK_ARC_ADDRESS = "0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62";

// RPC da Arc Testnet
const ARC_RPC_URL = "https://rpc.testnet.arc.network";

// ABI mínimo do Stork — só o que precisamos para ler preço
const STORK_ABI = [
  "function getTemporalNumericValueV1(bytes32 id) view returns ((int192 value, uint64 timestamp))",
  "function getTemporalNumericValueUnsafeV1(bytes32 id) view returns ((int192 value, uint64 timestamp))",
];

// Stork feed IDs (encoded asset IDs) para tokens na Arc
// Fonte: https://docs.stork.network/resources/asset-id-registry.md
const STORK_FEED_IDS: Record<string, string> = {
  EURC: "0x64ffe1382a02f37d4e16872cde1e7379679aa83bba98d99036921942203afafb",
  BTC: "0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de",
};

// Mesmo mapeamento usado em real-swap-executor.ts — mantido aqui para não criar
// dependência circular. Se adicionar token novo, atualizar os dois lugares.
const COIN_IDS: Record<string, string> = {
  WETH: "ethereum", WMATIC: "matic-network", WBTC: "bitcoin",
  USDC: "usd-coin", USDT: "tether", DAI: "dai", EURC: "eurc",
  ARB: "arbitrum", SOL: "solana",
  cirBTC: "bitcoin", mcirBTC: "bitcoin",
};

const HISTORY_MAX_POINTS = 20;
const PRICE_CACHE_MS = 15_000;

interface PricePoint {
  price: number;
  timestamp: number;
}

interface PairStats {
  relativePrice: number;   // preço de "to" em termos de "from" (to/from)
  momentum: number;        // variação relativa entre a leitura mais antiga e a mais nova da janela
  volatility: number;      // desvio padrão relativo dos últimos pontos (0..~1)
  amplitude: number;       // força do sinal: combina |momentum| e volatility, normalizado 0..1
  liquidity: number;       // proxy de liquidez: estável-estável > estável-volátil > volátil-volátil
  dataPoints: number;       // quantos pontos de histórico já temos para este par
}

class PairPriceFeed {
  // cache de preço USD por token (coinId), evita repetir fetch pra cada par no mesmo ciclo
  private usdPriceCache: Map<string, PricePoint> = new Map();
  // histórico do preço relativo to/from por par (chave: "FROM:TO")
  private pairHistory: Map<string, number[]> = new Map();
  // provider para RPC da Arc (Stork oracle)
  private arcProvider: ethers.JsonRpcProvider | null = null;
  private storkContract: ethers.Contract | null = null;
  // Flag: usar Stork oracle na Arc (desabilitado por padrão, ativado via setUseStork)
  private useStorkForArc = false;

  /** Ativa/desativa o uso do oracle Stork na rede Arc */
  setUseStork(active: boolean): void {
    this.useStorkForArc = active;
    if (active) console.log("[PairPriceFeed] Stork oracle ativado para Arc Testnet");
  }

  getUseStork(): boolean {
    return this.useStorkForArc;
  }

  // Inicializa conexão com o oracle Stork na Arc (lazy)
  private ensureArcProvider(): ethers.JsonRpcProvider {
    if (!this.arcProvider) {
      this.arcProvider = new ethers.JsonRpcProvider(ARC_RPC_URL);
    }
    return this.arcProvider;
  }

  private ensureStorkContract(): ethers.Contract {
    if (!this.storkContract) {
      const provider = this.ensureArcProvider();
      this.storkContract = new ethers.Contract(STORK_ARC_ADDRESS, STORK_ABI, provider);
    }
    return this.storkContract;
  }

  // Busca preço no oracle Stork on-chain (apenas para rede Arc)
  private async getStorkPrice(token: TokenSymbol): Promise<number | null> {
    // Mapeia tokens para feed IDs do Stork
    let feedKey: string | undefined;
    if (token === "EURC") {
      feedKey = STORK_FEED_IDS.EURC;
    } else if (token === "cirBTC" || token === "mcirBTC" || token === "WBTC") {
      feedKey = STORK_FEED_IDS.BTC;
    }
    if (!feedKey) return null;

    try {
      const contract = this.ensureStorkContract();
      const result = await contract.getTemporalNumericValueUnsafeV1(feedKey);
      // Stork retorna int192 com 18 decimais
      const rawValue = result.value.toString();
      const price = parseFloat(ethers.formatUnits(rawValue, 18));
      if (price > 0) return price;
    } catch (err) {
      console.warn(`[Stork] Fallback para ${token}: ${err instanceof Error ? err.message : err}`);
    }
    return null;
  }

  private async getUsdPrice(token: TokenSymbol, useArcStork = false): Promise<number> {
    const coinId = COIN_IDS[token];
    if (!coinId) return 1.0; // token desconhecido (ex.: stablecoin sem listagem) — assume paridade USD

    const cacheKey = `${coinId}_${useArcStork ? "stork" : "coingecko"}`;
    const cached = this.usdPriceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < PRICE_CACHE_MS) {
      return cached.price;
    }

    // Na rede Arc, tenta Stork oracle primeiro
    if (useArcStork) {
      const storkPrice = await this.getStorkPrice(token);
      if (storkPrice !== null && storkPrice > 0) {
        this.usdPriceCache.set(cacheKey, { price: storkPrice, timestamp: Date.now() });
        return storkPrice;
      }
      console.warn(`[PairPriceFeed] Stork falhou para ${token}, usando CoinGecko como fallback`);
    }

    // Fallback: CoinGecko via /api/price
    try {
      const res = await fetch(`/api/price?ids=${coinId}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return cached?.price ?? 1.0;
      const data = await res.json();
      const price = data[coinId] ?? data.prices?.[coinId];
      if (typeof price === "number" && price > 0) {
        this.usdPriceCache.set(cacheKey, { price, timestamp: Date.now() });
        return price;
      }
      return cached?.price ?? 1.0;
    } catch {
      return cached?.price ?? 1.0;
    }
  }

  /**
   * Calcula estatísticas reais de um par (from→to) com base em preço de mercado.
   * Deve ser chamado uma vez por par a cada ciclo da onda; mantém histórico próprio.
   */
  async getPairStats(from: TokenSymbol, to: TokenSymbol, isStableFn: (t: TokenSymbol) => boolean): Promise<PairStats> {
    const [fromUsd, toUsd] = await Promise.all([
      this.getUsdPrice(from, this.useStorkForArc),
      this.getUsdPrice(to, this.useStorkForArc),
    ]);

    // Preço relativo: quantos "from" equivalem a 1 "to". Para pares estável-estável
    // isso captura o spread real (ex.: USDC/EURC ~0.92-0.95 dependendo do dia).
    const relativePrice = fromUsd > 0 ? toUsd / fromUsd : 1.0;

    const key = `${from}:${to}`;
    const hist = this.pairHistory.get(key) ?? [];
    hist.push(relativePrice);
    if (hist.length > HISTORY_MAX_POINTS) hist.shift();
    this.pairHistory.set(key, hist);

    // Sem histórico suficiente ainda: sinal neutro (não inventa tendência do nada)
    if (hist.length < 3) {
      return {
        relativePrice,
        momentum: 0,
        volatility: 0,
        amplitude: 0,
        liquidity: this.estimateLiquidity(from, to, isStableFn),
        dataPoints: hist.length,
      };
    }

    // Momentum: variação relativa entre o primeiro e o último ponto da janela
    const oldest = hist[0];
    const newest = hist[hist.length - 1];
    const momentum = oldest > 0 ? (newest - oldest) / oldest : 0;

    // Volatilidade: desvio padrão relativo dos pontos da janela
    const mean = hist.reduce((s, v) => s + v, 0) / hist.length;
    const variance = hist.reduce((s, v) => s + (v - mean) ** 2, 0) / hist.length;
    const stdDev = Math.sqrt(variance);
    const volatility = mean > 0 ? stdDev / mean : 0;

    // Amplitude: combina magnitude do momentum com a volatilidade, normalizado 0..1.
    // Pensar como "força do sinal" — quanto maior, mais convicção a onda deveria ter no par.
    const amplitude = Math.min(1, Math.abs(momentum) * 20 + volatility * 10);

    return {
      relativePrice,
      momentum,
      volatility,
      amplitude,
      liquidity: this.estimateLiquidity(from, to, isStableFn),
      dataPoints: hist.length,
    };
  }

  // Proxy simples de liquidez até termos volume real por par (CoinGecko free tier
  // não dá volume por par specific, só por moeda). Estável-estável tende a ter mais
  // liquidez em DEXs do que pares envolvendo ativos voláteis sintéticos (cirBTC etc).
  private estimateLiquidity(from: TokenSymbol, to: TokenSymbol, isStableFn: (t: TokenSymbol) => boolean): number {
    const fromStable = isStableFn(from);
    const toStable = isStableFn(to);
    if (fromStable && toStable) return 0.8;
    if (fromStable || toStable) return 0.5;
    return 0.3;
  }

  reset() {
    this.usdPriceCache.clear();
    this.pairHistory.clear();
    this.arcProvider = null;
    this.storkContract = null;
  }
}

export const pairPriceFeed = new PairPriceFeed();
export type { PairStats };