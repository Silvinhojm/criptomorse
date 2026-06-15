// lib/gas-price-oracle.ts
// Gas price oracle: busca gas real da RPC + preco do token nativo via CoinGecko
// Fallback para GAS_COST_ESTIMATE estatico se falhar

import { ethers } from "ethers";
import { NETWORKS as NETWORKS_STATIC, type NetworkKey } from "./real-swap-executor";

const GAS_COST_ESTIMATE: Record<string, number> = {
  arc: 0.001,
  base: 0.05,
  polygon: 0.08,
  ethereum: 1.50,
  arbitrum: 0.03,
};

const GAS_UNITS_SWAP = 280000;

const COINGECKO_IDS: Record<string, string> = {
  ETH: "ethereum",
  POL: "matic-network",
  ARC: "arc-network",
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
    const cached = this.nativePriceCache.get(nativeSymbol);
    if (cached && Date.now() - cached.timestamp < 60000) return cached.price;

    const coinId = COINGECKO_IDS[nativeSymbol];
    if (!coinId) return 1.0;

    try {
      const res = await fetch(`/api/price?ids=${coinId}`);
      if (!res.ok) return this.nativePriceCache.get(nativeSymbol)?.price ?? 1.0;
      const data = await res.json();
      const price = data[coinId] ?? 1.0;
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
      const gasPriceWei = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
      if (gasPriceWei === 0n) throw new Error("Gas price is 0");

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
}

export const gasPriceOracle = new GasPriceOracle();
