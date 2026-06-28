// lib/stable-mr.ts
// Stable Mean Reversion — Engine Estocástica Pi (Modo Grão V2)
//
// Combina:
//   1. PoolProfiler — só opera pares com pool V3 confirmada
//   2. PiFilter — distribuição Gaussiana com threshold adaptativo via π
//   3. DEX quoting — preço real da pool V3 (zero dependência SoSoValue)
//   4. Lote dinâmico — escala por sigma² para diluir custo de gás

import { pregão } from "./pregão"
import { TRADING_PAIRS, realSwap, NETWORKS, TOKEN_DECIMALS } from "./real-swap-executor"
import { poolProfiler } from "./pool-profiler"
import { getDirectDexQuoteV3, getDirectDexQuoteV2, hasDirectDex, hasV3Router, sanitizeQuote } from "./direct-dex"
import {
  createInitialState, updatePiFilter,
  type PiFilterState, type PiFilterConfig,
} from "./math/pi-filter"
import { ethers } from "ethers"

const STABLES = new Set(["USDC", "USDT", "DAI", "EURC"])

const CACHE_TTL_MS = 10_000
const STORAGE_KEY = "arcflow_stable_mr"

const PI_CONFIG: PiFilterConfig = {
  alphaMin: 0.05,
  alphaMax: 0.30,
  volNormalizer: 0.005,
  sigmaEntryBuy: -1.5,
  sigmaEntrySell: 1.5,
  baseAmount: 12,
  maxAmount: 30,
}

type State = Record<string, PiFilterState>

export interface StableMRSnapshot {
  key: string
  pair: string
  network: string
  ewma: number
  lastPrice: number
  sigma: number
  confidence: number
  alpha: number
  volatility: number
  signal: "buy" | "sell" | "none"
  suggestedAmount?: number
  samples: number
}

function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveState(s: State) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch {}
}

class StableMR {
  private state: State = {}
  private lastSignalTs: Map<string, number> = new Map()

  async check(network: string) {
    this.state = loadState()
    const provider = realSwap.getProvider()
    if (!provider) return

    const stablePairs = (TRADING_PAIRS[network as keyof typeof TRADING_PAIRS] || []).filter((p: any) =>
      STABLES.has(p.from) && STABLES.has(p.to)
    )

    if (!stablePairs || stablePairs.length === 0) {
      pregão.adicionarLog("[STABLE-MR] ⚠️ Varredura pulada: sem pares estáveis configurados ou RPC indisponível.")
      return
    }

    const net = NETWORKS[network as keyof typeof NETWORKS]
    if (!net) return

    for (const pair of stablePairs) {
      const key = `${pair.from}→${pair.to}@${network}`
      const fromAddr = (net.tokens as any)[pair.from]
      const toAddr = (net.tokens as any)[pair.to]
      if (!fromAddr || !toAddr) continue

      // ─── Inicializa estado PiFilter ───────────────────────────────
      if (!this.state[key]) {
        this.state[key] = createInitialState()
      }
      const ps = this.state[key]

      // ─── Preço via DEX V3 (se pool existir) ou fallback V2 ─────────
      const quoteAmount = ethers.parseUnits("10000", TOKEN_DECIMALS[pair.from] ?? 6)
      let price: number | null = null

      // Tenta V3 via PoolProfiler
      const pools = await poolProfiler.getPools(network as any, fromAddr, toAddr)
      if (pools.length > 0 && hasV3Router(network)) {
        const bestFee = pools.reduce((best: any, p: any) => p.fee < best.fee ? p : best, pools[0])
        const v3quote = await getDirectDexQuoteV3(
          network, provider, fromAddr, toAddr, quoteAmount, bestFee.fee
        )
        if (v3quote && sanitizeQuote(v3quote, TOKEN_DECIMALS[pair.from] ?? 6, TOKEN_DECIMALS[pair.to] ?? 6, {
          amountInUsd: 10000, isStablePair: true, maxDeviationPct: 0.10,
        })) {
          const inAmt = Number(ethers.formatUnits(quoteAmount, TOKEN_DECIMALS[pair.from] ?? 6))
          const outAmt = Number(ethers.formatUnits(v3quote.amountOut, TOKEN_DECIMALS[pair.to] ?? 6))
          price = outAmt / inAmt
        }
      }

      // Fallback V2 (também usado quando PoolProfiler não acha V3)
      if (price === null && hasDirectDex(network)) {
        const v2quote = await getDirectDexQuoteV2(
          network, provider, fromAddr, toAddr, quoteAmount
        )
        if (v2quote && sanitizeQuote(v2quote, TOKEN_DECIMALS[pair.from] ?? 6, TOKEN_DECIMALS[pair.to] ?? 6, {
          amountInUsd: 10000, isStablePair: true, maxDeviationPct: 0.10,
        })) {
          const inAmt = Number(ethers.formatUnits(quoteAmount, TOKEN_DECIMALS[pair.from] ?? 6))
          const outAmt = Number(ethers.formatUnits(v2quote.amountOut, TOKEN_DECIMALS[pair.to] ?? 6))
          price = outAmt / inAmt
        }
      }

      if (price === null || price <= 0) continue

      // ─── Filtro estocástico Pi ────────────────────────────────────
      const { state: newState, signal } = updatePiFilter(ps, price, PI_CONFIG)
      this.state[key] = newState

      if (!signal || signal.direction === "none") continue

      // ─── Rate limit entre sinais ───────────────────────────────────
      const sinceLastSignal = Date.now() - (this.lastSignalTs.get(key) ?? 0)
      if (sinceLastSignal < CACHE_TTL_MS) continue
      this.lastSignalTs.set(key, Date.now())

      // ─── Verifica saldo e envia OK ─────────────────────────────────
      const bal = realSwap.getBalance(pair.from)
      const amountUsd = Math.min(signal.suggestedAmount, Math.floor(bal * 0.9 * 100) / 100)

      if (amountUsd < 5) continue

      pregão.receberOK({
        pregueiro: "StableMR",
        rede: network as any,
        par: pair.label,
        confianca: signal.confidence,
        amountUsd,
        timestamp: Date.now(),
        fromToken: pair.from,
        toToken: pair.to,
      })

      pregão.adicionarLog(
        `🌾 PiEngine ${signal.direction === "buy" ? "COMPRA" : "VENDA"} ${pair.label} ` +
        `(σ=${signal.sigma.toFixed(2)}, conf=${signal.confidence}%, ` +
        `α=${newState.alpha.toFixed(3)}, vol=${(newState.volatility * 100).toFixed(3)}%, ` +
        `threshold=${(signal.threshold * 100).toFixed(3)}%, $${amountUsd})`
      )
    }

    saveState(this.state)
  }

  getSnapshot(): StableMRSnapshot[] {
    const result: StableMRSnapshot[] = []
    for (const [key, ps] of Object.entries(this.state)) {
      if (ps.samples < 1) continue
      const [pair, network] = key.split("@")
      const sigma = ps.sigma ?? 0
      result.push({
        key, pair, network,
        ewma: ps.ewma,
        lastPrice: ps.lastPrice,
        sigma,
        confidence: ps.confidence,
        alpha: ps.alpha,
        volatility: ps.volatility,
        signal: sigma <= PI_CONFIG.sigmaEntryBuy ? "buy" : sigma >= PI_CONFIG.sigmaEntrySell ? "sell" : "none",
        samples: ps.samples,
      })
    }
    return result
  }
}

export const stableMR = new StableMR()
export type StableMRInstance = typeof stableMR
