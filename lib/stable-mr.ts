import { pregão } from "./pregão"
import { TRADING_PAIRS, realSwap } from "./real-swap-executor"

const STABLES = new Set(["USDC", "USDT", "DAI", "EURC"])

const SMA_WINDOW = 12
const DEVIATION_THRESHOLD = 0.0005
const CACHE_TTL_MS = 10_000
const STORAGE_KEY = "arcflow_stable_mr"

interface PriceSample {
  price: number
  ts: number
}

interface PairState {
  history: PriceSample[]
  lastSignal: "buy" | "sell" | null
  signalTs: number
  sma: number
  lastPrice: number
  deviation: number
}

type State = Record<string, PairState>

export interface StableMRSnapshot {
  key: string
  pair: string
  network: string
  sma: number
  lastPrice: number
  deviation: number
  signal: "buy" | "sell" | "none"
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

  async check(network: string) {
    this.state = loadState()

    const pairs = (TRADING_PAIRS[network as keyof typeof TRADING_PAIRS] || []).filter((p: any) =>
      STABLES.has(p.from) && STABLES.has(p.to)
    )

    for (const pair of pairs) {
      const key = `${pair.from}→${pair.to}@${network}`
      if (!this.state[key]) {
        this.state[key] = { history: [], lastSignal: null, signalTs: 0, sma: 1, lastPrice: 0, deviation: 0 }
      }

      const ps = this.state[key]
      const price = await this.getPrice(pair.label)
      if (!price || price <= 0) continue

      const last = ps.history[ps.history.length - 1]
      if (last && Date.now() - last.ts < CACHE_TTL_MS) continue

      ps.history.push({ price, ts: Date.now() })
      if (ps.history.length > SMA_WINDOW) ps.history.shift()

      ps.lastPrice = price

      if (ps.history.length < 4) continue

      ps.sma = ps.history.reduce((s: number, p: PriceSample) => s + p.price, 0) / ps.history.length
      ps.deviation = (price - ps.sma) / ps.sma

      const sinceLastSignal = Date.now() - ps.signalTs
      const isBuy = ps.deviation <= -DEVIATION_THRESHOLD
      const isSell = ps.deviation >= DEVIATION_THRESHOLD

      if ((isBuy || isSell) && sinceLastSignal > CACHE_TTL_MS) {
        const devAbs = Math.abs(ps.deviation)
        let amountUsd = Math.max(12, Math.round(devAbs * 5000 * 100) / 100)
        const bal = realSwap.getBalance(pair.from)
        const fromPrice = await realSwap.fetchTokenPrice(pair.from as any).catch(() => 1)
        const balUsd = bal * (STABLES.has(pair.from) ? 1 : fromPrice)
        amountUsd = Math.min(amountUsd, Math.floor(balUsd * 0.9 * 100) / 100)

        if (amountUsd < 5) continue

        pregão.receberOK({
          pregueiro: "StableMR",
          rede: network as any,
          par: pair.label,
          confianca: 75,
          amountUsd,
          timestamp: Date.now(),
          fromToken: pair.from,
          toToken: pair.to,
        })
        ps.lastSignal = isBuy ? "buy" : "sell"
        ps.signalTs = Date.now()
        pregão.adicionarLog(`🌾 StableMR ${isBuy ? "COMPRA" : "VENDA"} ${pair.label} (desvio ${(ps.deviation * 100).toFixed(3)}%, $${amountUsd})`)
      }
    }

    saveState(this.state)
  }

  getSnapshot(): StableMRSnapshot[] {
    const result: StableMRSnapshot[] = []
    for (const [key, ps] of Object.entries(this.state)) {
      if (ps.history.length < 4) continue
      const [pair, network] = key.split("@")
      result.push({
        key,
        pair,
        network,
        sma: ps.sma,
        lastPrice: ps.lastPrice,
        deviation: ps.deviation,
        signal: ps.deviation <= -DEVIATION_THRESHOLD ? "buy" : ps.deviation >= DEVIATION_THRESHOLD ? "sell" : "none",
      })
    }
    return result
  }

  private async getPrice(pairLabel: string): Promise<number | null> {
    const [from, to] = pairLabel.split("→")
    const fromPrice = await realSwap.fetchTokenPrice(from as any).catch(() => 0)
    const toPrice = await realSwap.fetchTokenPrice(to as any).catch(() => 0)
    if (!fromPrice || !toPrice) return null
    if (STABLES.has(from)) return toPrice / fromPrice
    return fromPrice / toPrice
  }
}

export const stableMR = new StableMR()
export type StableMRInstance = typeof stableMR
