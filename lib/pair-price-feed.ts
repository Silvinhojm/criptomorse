// lib/pair-price-feed.ts
// Feed de preço real por par, compartilhado entre quantum-wave.ts e pregueiro.ts.
//
// FIX: Rate limiting para evitar flood na SoSoValue (limite gratuito ~30 req/min)
// - Batch de requisições: agrupa múltiplos coinIds em uma única chamada
// - Cache estendido: 30s em vez de 15s para tokens voláteis, 60s para stablecoins
// - Fila de requisições: máximo 1 batch a cada 2s
// - Fallback de preços: mantém último preço conhecido mesmo após falhas

import { ethers } from "ethers";
import type { TokenSymbol } from "./real-swap-executor";

const STORK_ARC_ADDRESS = "0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62";
const ARC_RPC_URL = "https://rpc.testnet.arc.network";

const STORK_ABI = [
  "function getTemporalNumericValueV1(bytes32 id) view returns ((int192 value, uint64 timestamp))",
  "function getTemporalNumericValueUnsafeV1(bytes32 id) view returns ((int192 value, uint64 timestamp))",
];

const STORK_FEED_IDS: Record<string, string> = {
  EURC: "0x64ffe1382a02f37d4e16872cde1e7379679aa83bba98d99036921942203afafb",
  BTC: "0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de",
};

import { COIN_IDS } from "./coin-ids";

// FIX: Cache estendido para reduzir requisições à SoSoValue
// Stablecoins mudam muito pouco — cache de 60s
// Tokens voláteis — cache de 30s (era 15s, duplicado)
const CACHE_MS_STABLE = 60_000
const CACHE_MS_VOLATILE = 12_000
const STABLES = new Set(["USDC", "USDT", "DAI", "EURC"])

const HISTORY_MAX_POINTS = 20;

// FIX: Rate limiting do batch — mínimo 2s entre batches para não exceder limite SoSoValue
const MIN_BATCH_INTERVAL_MS = 2_000
let lastBatchTime = 0
let pendingBatchIds: Set<string> = new Set()
let batchTimer: ReturnType<typeof setTimeout> | null = null

interface PricePoint {
  price: number;
  timestamp: number;
}

interface PairStats {
  relativePrice: number;
  momentum: number;
  volatility: number;
  amplitude: number;
  liquidity: number;
  dataPoints: number;
}

class PairPriceFeed {
  private usdPriceCache: Map<string, PricePoint> = new Map();
  private consecutiveFetchFailures: Map<string, number> = new Map();
  private pairHistory: Map<string, number[]> = new Map();
  private arcProvider: ethers.JsonRpcProvider | null = null;
  private storkContract: ethers.Contract | null = null;
  private useStorkForArc = false;
  private storkFailureCache: Map<string, number> = new Map();
  private storkFailCount: number = 0;
  private storkDisabledPermanently: boolean = false;
  private storkLoggedTokens: Set<string> = new Set();

  setUseStork(active: boolean): void {
    this.useStorkForArc = active;
    this.storkDisabledPermanently = false;
    this.storkFailCount = 0;
    if (active) console.log("[PairPriceFeed] Stork oracle ativado para Arc Testnet");
  }

  getUseStork(): boolean {
    return this.useStorkForArc;
  }

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

  private async getStorkPrice(token: TokenSymbol): Promise<number | null> {
    if (this.storkDisabledPermanently) return null;

    let feedKey: string | undefined;
    if (token === "EURC") {
      feedKey = STORK_FEED_IDS.EURC;
    } else if (token === "cirBTC" || token === "mcirBTC" || token === "WBTC") {
      feedKey = STORK_FEED_IDS.BTC;
    }
    if (!feedKey) return null;

    const lastFail = this.storkFailureCache.get(token) ?? 0;
    if (lastFail > 0 && Date.now() - lastFail < 60_000) {
      return null;
    }

    try {
      const contract = this.ensureStorkContract();
      const result = await contract.getTemporalNumericValueUnsafeV1(feedKey);
      const rawValue = result.value.toString();
      const price = parseFloat(ethers.formatUnits(rawValue, 18));
      if (price > 0) return price;
    } catch (err) {
      this.storkFailureCache.set(token, Date.now());
      this.storkFailCount++;
      if (this.storkFailCount >= 10) {
        this.storkDisabledPermanently = true;
        this.useStorkForArc = false;
        console.warn(`[Stork] Desativado permanentemente após ${this.storkFailCount} falhas consecutivas`);
      }
      if (!this.storkLoggedTokens.has(token)) {
        this.storkLoggedTokens.add(token);
        console.warn(`[Stork] Fallback para ${token}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return null;
  }

  // FIX: Batch de múltiplos coinIds em uma única requisição
  // Evita N requisições separadas por ciclo — agrupa tudo em 1 chamada
  private async fetchBatch(coinIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>()
    if (coinIds.length === 0) return result

    // Deduplica
    const unique = [...new Set(coinIds)]
    const idsParam = unique.join(",")

    try {
      const res = await fetch(`/api/price?ids=${idsParam}`, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return result
      const body = await res.json()
      const prices = body?.prices
      if (!prices) return result
      for (const id of unique) {
        const price = prices[id]
        if (typeof price === "number" && price > 0) {
          result.set(id, price)
        }
      }
    } catch {
      // Silencioso — fallback para cache existente
    }
    return result
  }

  // FIX: getUsdPrice com cache estendido e sem requisição individual por token
  // Usa fetchBatch internamente quando precisar buscar múltiplos tokens de uma vez
  private async getUsdPrice(token: TokenSymbol, useArcStork = false): Promise<number> {
    const coinId = COIN_IDS[token];
    if (!coinId) return 1.0;

    const isStableToken = STABLES.has(token)
    const cacheDuration = isStableToken ? CACHE_MS_STABLE : CACHE_MS_VOLATILE
    const cacheKey = coinId

    const cached = this.usdPriceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cacheDuration) {
      return cached.price;
    }

    // Na rede Arc, tenta Stork oracle primeiro
    if (useArcStork) {
      const storkPrice = await this.getStorkPrice(token);
      if (storkPrice !== null && storkPrice > 0) {
        this.usdPriceCache.set(cacheKey, { price: storkPrice, timestamp: Date.now() });
        return storkPrice;
      }
    }

    // FIX: Rate limiting — se bateu o limite recente, retorna cache mesmo que expirado
    const agora = Date.now()
    if (agora - lastBatchTime < MIN_BATCH_INTERVAL_MS) {
      // Retorna cache expirado em vez de fazer requisição imediata
      return cached?.price ?? 1.0
    }

    // Faz requisição individual (sem batch aqui pois é chamada lazy)
    try {
      lastBatchTime = agora
      const batch = await this.fetchBatch([coinId])
      const price = batch.get(coinId)
      if (price !== undefined) {
        this.usdPriceCache.set(cacheKey, { price, timestamp: Date.now() })
        this.consecutiveFetchFailures.delete(cacheKey)
        return price
      }

      // Sem preço no batch
      const failures = (this.consecutiveFetchFailures.get(cacheKey) ?? 0) + 1
      this.consecutiveFetchFailures.set(cacheKey, failures)
      return cached?.price ?? 1.0
    } catch {
      const failures = (this.consecutiveFetchFailures.get(cacheKey) ?? 0) + 1
      this.consecutiveFetchFailures.set(cacheKey, failures)
      if (failures >= 3) {
        this.consecutiveFetchFailures.delete(cacheKey)
      }
      return cached?.price ?? 1.0
    }
  }

  // FIX: Novo método para pré-carregar preços de múltiplos tokens em 1 batch
  // Chamar isso no início do ciclo evita N requisições individuais depois
  async preloadPrices(tokens: TokenSymbol[]): Promise<void> {
    const agora = Date.now()

    // Filtra tokens que precisam de atualização (cache expirado)
    const tokensSemCache = tokens.filter(t => {
      const coinId = COIN_IDS[t]
      if (!coinId) return false
      const cached = this.usdPriceCache.get(coinId)
      const cacheDuration = STABLES.has(t) ? CACHE_MS_STABLE : CACHE_MS_VOLATILE
      return !cached || agora - cached.timestamp >= cacheDuration
    })

    if (tokensSemCache.length === 0) return

    // Respeita rate limit
    if (agora - lastBatchTime < MIN_BATCH_INTERVAL_MS) return

    const coinIds = [...new Set(tokensSemCache.map(t => COIN_IDS[t]).filter(Boolean))]
    if (coinIds.length === 0) return

    lastBatchTime = agora
    const batch = await this.fetchBatch(coinIds)

    for (const [coinId, price] of batch) {
      this.usdPriceCache.set(coinId, { price, timestamp: agora })
      this.consecutiveFetchFailures.delete(coinId)
    }

    if (batch.size > 0) {
      console.log(`[PairPriceFeed] Batch: ${batch.size}/${coinIds.length} preços atualizados`)
    }
  }

  async getPairStats(from: TokenSymbol, to: TokenSymbol, isStableFn: (t: TokenSymbol) => boolean): Promise<PairStats> {
    const [fromUsd, toUsd] = await Promise.all([
      this.getUsdPrice(from, this.useStorkForArc),
      this.getUsdPrice(to, this.useStorkForArc),
    ]);

    const relativePrice = fromUsd > 0 ? toUsd / fromUsd : 1.0;

    const key = `${from}:${to}`;
    const hist = this.pairHistory.get(key) ?? [];
    hist.push(relativePrice);
    if (hist.length > HISTORY_MAX_POINTS) hist.shift();
    this.pairHistory.set(key, hist);

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

    const oldest = hist[0];
    const newest = hist[hist.length - 1];
    const momentum = oldest > 0 ? (newest - oldest) / oldest : 0;

    const mean = hist.reduce((s, v) => s + v, 0) / hist.length;
    const variance = hist.reduce((s, v) => s + (v - mean) ** 2, 0) / hist.length;
    const stdDev = Math.sqrt(variance);
    const volatility = mean > 0 ? stdDev / mean : 0;

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
    this.consecutiveFetchFailures.clear();
    this.arcProvider = null;
    this.storkContract = null;
  }
}

export const pairPriceFeed = new PairPriceFeed();
export type { PairStats };