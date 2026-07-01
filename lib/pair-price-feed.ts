// lib/pair-price-feed.ts
// Feed de preço real por par, compartilhado entre quantum-wave.ts e pregueiro.ts.
//
// Fontes de preço (em ordem de prioridade):
//   1. Chainlink Data Feeds (on-chain, Arc testnet via Chainlink Scale)
//   2. SoSoValue API (off-chain, fallback universal)
//
// Chainlink foi anunciado para Arc em 30/06/2026 via Chainlink Scale.
// Quando os feeds forem deployados na Arc, adicionar endereços em CHAINLINK_FEEDS.

import { ethers } from "ethers";
import type { TokenSymbol } from "./real-swap-executor";

const ARC_RPC_URL = "https://rpc.testnet.arc.network";

// ─── Chainlink Data Feeds ──────────────────────────────────────────────
// Adicione aquí os endereços dos proxies Chainlink conforme forem deployados
// na Arc testnet via Chainlink Scale.
// Formato: AgregatorV3Interface (latestRoundData + decimals)
const CHAINLINK_FEEDS: Partial<Record<TokenSymbol, string>> = {
  // Exemplo quando deployado:
  // USDC: "0x...",
  // EURC: "0x...",
  // BTC:  "0x...",
};

const AGGREGATOR_V3_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
];

import { COIN_IDS } from "./coin-ids";

const CACHE_MS_STABLE = 60_000
const CACHE_MS_VOLATILE = 12_000
const STABLES = new Set(["USDC", "USDT", "DAI", "EURC"])

const HISTORY_MAX_POINTS = 20;

const MIN_BATCH_INTERVAL_MS = 2_000
let lastBatchTime = 0

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
  private chainlinkContracts: Map<string, ethers.Contract> = new Map();
  private useChainlinkForArc = false;

  setUseChainlink(active: boolean): void {
    if (active && Object.keys(CHAINLINK_FEEDS).length === 0) {
      if (!this._warnedNoFeeds) {
        this._warnedNoFeeds = true;
        console.warn("[PairPriceFeed] Chainlink feeds não configurados para Arc — adicione endereços em CHAINLINK_FEEDS");
      }
      return;
    }
    this.useChainlinkForArc = active;
    if (active) console.log("[PairPriceFeed] Chainlink Data Feeds ativado para Arc Testnet");
  }
  private _warnedNoFeeds = false;

  getUseChainlink(): boolean {
    return this.useChainlinkForArc;
  }

  /** Retorna endereços configurados (útil para debug) */
  getConfiguredFeeds(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(CHAINLINK_FEEDS).map(([t, addr]) => [t, addr!])
    );
  }

  private ensureArcProvider(): ethers.JsonRpcProvider {
    if (!this.arcProvider) {
      this.arcProvider = new ethers.JsonRpcProvider(ARC_RPC_URL);
    }
    return this.arcProvider;
  }

  /** Tenta ler preço de um feed Chainlink na Arc testnet */
  private async getChainlinkPrice(token: TokenSymbol): Promise<number | null> {
    const feedAddress = CHAINLINK_FEEDS[token];
    if (!feedAddress) return null;

    const provider = this.ensureArcProvider();
    let contract = this.chainlinkContracts.get(token);
    if (!contract) {
      contract = new ethers.Contract(feedAddress, AGGREGATOR_V3_ABI, provider);
      this.chainlinkContracts.set(token, contract);
    }

    try {
      const [, answer] = await contract.latestRoundData();
      if (answer <= 0) return null;
      const dec = await contract.decimals().catch(() => 8);
      return parseFloat(ethers.formatUnits(answer, Number(dec)));
    } catch {
      return null;
    }
  }

  private async fetchBatch(coinIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>()
    if (coinIds.length === 0) return result

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

  private async getUsdPrice(token: TokenSymbol, preferOnchain = false): Promise<number> {
    const coinId = COIN_IDS[token];
    if (!coinId) return 1.0;

    const isStableToken = STABLES.has(token)
    const cacheDuration = isStableToken ? CACHE_MS_STABLE : CACHE_MS_VOLATILE
    const cacheKey = coinId

    const cached = this.usdPriceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cacheDuration) {
      return cached.price;
    }

    // Tenta Chainlink primeiro (apenas na Arc testnet)
    if (preferOnchain && this.useChainlinkForArc) {
      const clPrice = await this.getChainlinkPrice(token);
      if (clPrice !== null && clPrice > 0) {
        this.usdPriceCache.set(cacheKey, { price: clPrice, timestamp: Date.now() });
        return clPrice;
      }
    }

    // Rate limiting — retorna cache expirado em vez de bater API
    const agora = Date.now()
    if (agora - lastBatchTime < MIN_BATCH_INTERVAL_MS) {
      return cached?.price ?? 1.0
    }

    try {
      lastBatchTime = agora
      const batch = await this.fetchBatch([coinId])
      const price = batch.get(coinId)
      if (price !== undefined) {
        this.usdPriceCache.set(cacheKey, { price, timestamp: Date.now() })
        this.consecutiveFetchFailures.delete(cacheKey)
        return price
      }

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

  async preloadPrices(tokens: TokenSymbol[]): Promise<void> {
    const agora = Date.now()

    const tokensSemCache = tokens.filter(t => {
      const coinId = COIN_IDS[t]
      if (!coinId) return false
      const cached = this.usdPriceCache.get(coinId)
      const cacheDuration = STABLES.has(t) ? CACHE_MS_STABLE : CACHE_MS_VOLATILE
      return !cached || agora - cached.timestamp >= cacheDuration
    })

    if (tokensSemCache.length === 0) return

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
      this.getUsdPrice(from, this.useChainlinkForArc),
      this.getUsdPrice(to, this.useChainlinkForArc),
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
    this.chainlinkContracts.clear();
    this.useChainlinkForArc = false;
  }
}

export const pairPriceFeed = new PairPriceFeed();
export type { PairStats };