// lib/gas-price-oracle.ts
// Gas price oracle: busca gas real da RPC + preco do token nativo via SoSoValue
// Fallback para GAS_COST_ESTIMATE estatico se falhar

import { ethers } from "ethers";
import { NETWORKS as NETWORKS_STATIC, type NetworkKey } from "./real-swap-executor";

const GAS_COST_ESTIMATE: Record<string, number> = {
  arc: 0.006,
  base: 0.003,
  polygon: 0.005,
  ethereum: 1.50,
  arbitrum: 0.02,
  sepolia: 0.006,
};

const GAS_UNITS_SWAP = 200000;

const STABLECOIN_SYMBOLS = new Set(["USDC", "USDT", "DAI", "EURC", "ARC"]);

const COINGECKO_IDS: Record<string, string> = {
  ETH: "1673723677362319867",
  POL: "1730847291434274818",
};

class GasPriceOracle {
  private cache: Map<string, { gasCostUsd: number; timestamp: number }> = new Map();
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();
  private nativePriceCache: Map<string, { price: number; timestamp: number }> = new Map();

  private _getProvider(rpcUrl: string): ethers.JsonRpcProvider {
    if (!this.providers.has(rpcUrl)) {
      this.providers.set(rpcUrl, new ethers.JsonRpcProvider(rpcUrl));
    }
    return this.providers.get(rpcUrl)!;
  }

  private async _fetchNativePrice(nativeSymbol: string): Promise<number> {
    if (STABLECOIN_SYMBOLS.has(nativeSymbol)) return 1.0;

    const cached = this.nativePriceCache.get(nativeSymbol);
    if (cached && Date.now() - cached.timestamp < 60000) return cached.price;

    const coinId = COINGECKO_IDS[nativeSymbol];
    if (!coinId) return 1.0;

    try {
      const res = await fetch(`/api/price?ids=${coinId}`);
      if (!res.ok) return this.nativePriceCache.get(nativeSymbol)?.price ?? 1.0;
      const data = await res.json();
      const _prices = data.prices ?? data;
      const price = _prices[coinId] ?? 1.0;
      if (price > 0) {
        this.nativePriceCache.set(nativeSymbol, { price, timestamp: Date.now() });
      }
      return price;
    } catch {
      return this.nativePriceCache.get(nativeSymbol)?.price ?? 1.0;
    }
  }

  async getGasCost(networkKey: NetworkKey): Promise<number> {
    const cached = this.cache.get(networkKey);
    if (cached && Date.now() - cached.timestamp < 30000) return cached.gasCostUsd;

    const net = NETWORKS_STATIC[networkKey];
    if (!net) return GAS_COST_ESTIMATE[networkKey] ?? 0.05;

    try {
      const provider = this._getProvider(net.rpcUrl);
      const feeData = await provider.getFeeData();
      let gasPriceWei = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
      if (gasPriceWei === 0n) throw new Error("Gas price is 0");

      // Arc min base fee is 20 Gwei
      if (networkKey === "arc") {
        const MIN_GWEI = 20n;
        const feeGwei = ethers.formatUnits(gasPriceWei, "gwei");
        if (BigInt(Math.floor(Number(feeGwei))) < MIN_GWEI) {
          gasPriceWei = ethers.parseUnits(MIN_GWEI.toString(), "gwei");
        }
      }

      const gasPriceGwei = parseFloat(ethers.formatUnits(gasPriceWei, "gwei"));
      const nativePriceUsd = await this._fetchNativePrice(net.nativeSymbol);

      const gasCostUsd = (gasPriceGwei * 1e-9) * GAS_UNITS_SWAP * nativePriceUsd;
      this.cache.set(networkKey, { gasCostUsd, timestamp: Date.now() });

      console.log(`Gas price oracle: ${gasPriceGwei.toFixed(2)} gwei | ${net.nativeSymbol} $${nativePriceUsd.toFixed(2)} | swap ~$${gasCostUsd.toFixed(4)}`);
      return gasCostUsd;
    } catch {
      const fallback = GAS_COST_ESTIMATE[networkKey] ?? 0.05;
      console.log(`Gas price oracle falhou, fallback $${fallback.toFixed(3)}`);
      return fallback;
    }
  }

  invalidateCache(networkKey?: NetworkKey) {
    if (networkKey) {
      this.cache.delete(networkKey);
    } else {
      this.cache.clear();
    }
  }

  async scanBestNetwork(tokenForSpread?: string): Promise<{
    best: NetworkKey
    networks: { network: NetworkKey; name: string; gasUsd: number; spreadPct: number; totalPerTrade: number; isTestnet: boolean }[]
  }> {
    const SPREAD_ESTIMATE: Record<string, number> = {
      polygon: 0.001, base: 0.002, arbitrum: 0.0015,
      ethereum: 0.0005, arc: 0.003, sepolia: 0.002,
    }

    const MAINNETS: NetworkKey[] = ["polygon", "base", "arbitrum", "ethereum"]
    const results: { network: NetworkKey; name: string; gasUsd: number; spreadPct: number; totalPerTrade: number; isTestnet: boolean }[] = []

    const gasResults = await Promise.allSettled(
      MAINNETS.map(async (nk) => {
        const gasUsd = await this.getGasCost(nk)
        const net = NETWORKS_STATIC[nk]
        const spreadPct = SPREAD_ESTIMATE[nk] ?? 0.002
        const isTestnet = net?.isTestnet ?? false
        return {
          network: nk,
          name: net?.name ?? nk,
          gasUsd,
          spreadPct,
          totalPerTrade: gasUsd + spreadPct * 10,
          isTestnet,
        }
      })
    )

    for (const r of gasResults) {
      if (r.status === "fulfilled") results.push(r.value)
    }

    results.sort((a, b) => a.totalPerTrade - b.totalPerTrade)

    const best = results.length > 0 ? results[0].network : "polygon"
    return { best, networks: results }
  }
}

export const gasPriceOracle = new GasPriceOracle();
