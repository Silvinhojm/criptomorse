// lib/pool-profiler.ts
// Consulta on-chain da QuickSwap/Uniswap V3 Factory para verificar pools ativas
// por par + fee tier. Cacheia resultados com TTL diferenciado:
// - Pools encontradas: 5 min
// - Pools inexistentes ou erro RPC: 1 hora (evita soft-lock permanente)

import { ethers } from "ethers"
import { NETWORKS, type NetworkKey } from "./real-swap-executor"
import { realSwap } from "./real-swap-executor"

export interface PoolInfo {
  address: string
  fee: number
  liquidity: bigint
}

// QuickSwap V3 fork da Uniswap V3 — mesma interface de factory
const FACTORY_V3: Partial<Record<NetworkKey, string>> = {
  polygon:  "0x411b0fAcC3489691f28ad58c47006AF5E3Ab3A28",
  base:     "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
  ethereum: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
}

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
]

const POOL_ABI = [
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
]

export const FEE_TIERS = [100, 500, 3000] as const // 0.01%, 0.05%, 0.30%

type CacheKey = string

function cacheKey(network: string, tokenA: string, tokenB: string, fee: number): CacheKey {
  const t0 = tokenA.toLowerCase()
  const t1 = tokenB.toLowerCase()
  return `${network}:${[t0, t1].sort().join(":")}:${fee}`
}

const STORAGE_KEY = "arcflow_pool_profiler"
const CACHE_TTL_FOUND = 300_000   // 5 min para pools confirmadas
const CACHE_TTL_MISS = 3_600_000  // 1 hora para pools ausentes/erro

interface CacheEntry {
  info: PoolInfo | null  // null = pool não encontrada
  ts: number
  ttl: number
}

class PoolProfiler {
  private cache: Map<CacheKey, CacheEntry> = new Map()

  constructor() {
    this._load()
  }

  getSupportedNetworks(): NetworkKey[] {
    return Object.keys(FACTORY_V3) as NetworkKey[]
  }

  hasFactory(network: NetworkKey): boolean {
    return network in FACTORY_V3
  }

  async getPools(network: NetworkKey, tokenA: string, tokenB: string): Promise<PoolInfo[]> {
    const results: PoolInfo[] = []
    const factoryAddr = FACTORY_V3[network]
    if (!factoryAddr) return results

    const provider = realSwap.getProvider()
    if (!provider) return results

    const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, provider)

    for (const fee of FEE_TIERS) {
      const key = cacheKey(network, tokenA, tokenB, fee)
      const cached = this.cache.get(key)

      // Cache válido dentro do TTL
      if (cached && Date.now() - cached.ts < cached.ttl) {
        if (cached.info) results.push(cached.info)
        continue
      }

      // Cache expirado ou inexistente — consulta on-chain
      try {
        const poolAddr = await factory.getPool(tokenA, tokenB, fee)
        if (poolAddr === ethers.ZeroAddress) {
          this.cache.set(key, { info: null, ts: Date.now(), ttl: CACHE_TTL_MISS })
          continue
        }
        const pool = new ethers.Contract(poolAddr, POOL_ABI, provider)
        const liq = await pool.liquidity()
        const info: PoolInfo = { address: poolAddr, fee, liquidity: liq }
        this.cache.set(key, { info, ts: Date.now(), ttl: CACHE_TTL_FOUND })
        results.push(info)
      } catch {
        this.cache.set(key, { info: null, ts: Date.now(), ttl: CACHE_TTL_MISS })
      }
    }

    this._save()
    return results
  }

  async findBestFeeTier(network: NetworkKey, tokenA: string, tokenB: string): Promise<number | null> {
    const pools = await this.getPools(network, tokenA, tokenB)
    const sorted = pools.sort((a, b) => a.fee - b.fee)
    const LIQUIDITY_MIN = 1000n
    const withLiq = sorted.filter(p => p.liquidity >= LIQUIDITY_MIN)
    if (withLiq.length > 0) return withLiq[0].fee
    if (sorted.length > 0) return sorted[0].fee
    return null
  }

  async getPoolAddress(network: NetworkKey, tokenA: string, tokenB: string, fee: number): Promise<string | null> {
    const pools = await this.getPools(network, tokenA, tokenB)
    const match = pools.find(p => p.fee === fee)
    return match?.address ?? null
  }

  invalidate(): void {
    this.cache.clear()
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
  }

  private _save(): void {
    try {
      const obj: Record<string, { info: { address: string; fee: number; liqStr: string } | null; ts: number; ttl: number }> = {}
      for (const [key, entry] of this.cache) {
        obj[key] = {
          info: entry.info ? { address: entry.info.address, fee: entry.info.fee, liqStr: entry.info.liquidity.toString() } : null,
          ts: entry.ts,
          ttl: entry.ttl,
        }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
    } catch {}
  }

  private _load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const obj = JSON.parse(raw) as Record<string, { info: { address: string; fee: number; liqStr: string } | null; ts: number; ttl: number }>
      const now = Date.now()
      for (const [key, entry] of Object.entries(obj)) {
        if (now - entry.ts < entry.ttl && entry.info) {
          this.cache.set(key, {
            info: { address: entry.info.address, fee: entry.info.fee, liquidity: BigInt(entry.info.liqStr) },
            ts: entry.ts,
            ttl: entry.ttl,
          })
        }
      }
    } catch {}
  }
}

export const poolProfiler = new PoolProfiler()
