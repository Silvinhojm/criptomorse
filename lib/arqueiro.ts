import { COIN_IDS } from "./coin-ids"

type StateName = 'OCIOSO' | 'TENSIONANDO' | 'ARMADO' | 'DISPARO' | 'DESARMADO'

interface PricePoint {
  price: number
  timestamp: number
}

interface PairState {
  state: StateName
  enteredStateAt: number
  periodsInState: number
  consecutiveCompressionPeriods: number
  prices: PricePoint[]
  pseudoATRShort: number
  pseudoATRLong: number
  atrPercentile: number
  squeezeActive: boolean
  tensionScore: number
  atrBaseline: number
  baselineDataPoints: number
}

const SHORT_WINDOW = 20
const LONG_WINDOW = 100
const COMPRESSION_THRESHOLD = 0.6
const SQUEEZE_WINDOW = 20
const BOLLINGER_STDDEV = 2
const KELTNER_ATR_MULT = 1.5
const DECAY_START = 20
const DECAY_FULL = 40
const TENSIONANDO_TIMEOUT = 30
const ARMADO_TIMEOUT = 50
const DISPARO_TIMEOUT = 20
const DESARMADO_COOLDOWN = 20
const CALIBRATION_WINDOW = 100
const RESET_THRESHOLD = 0.5
const MAX_ARMED_PAIRS = 3
const CYCLE_MS = 60_000

const STABLES = new Set(["USDC", "USDT", "DAI", "EURC"])

function volatileToken(pair: string): string {
  const [from, to] = pair.split("→")
  if (!from || !to) return pair
  if (STABLES.has(from) && !STABLES.has(to)) return to
  if (STABLES.has(to) && !STABLES.has(from)) return from
  return from
}

function isStableStable(pair: string): boolean {
  const [from, to] = pair.split("→")
  return STABLES.has(from) && STABLES.has(to)
}

class Arqueiro {
  private pairs = new Map<string, PairState>()
  private timer: ReturnType<typeof setInterval> | null = null
  private _shadowMode = true

  private armedCount(): number {
    let c = 0
    for (const ps of this.pairs.values()) {
      if (ps.state === "ARMADO" || ps.state === "DISPARO") c++
    }
    return c
  }

  private fresh(): PairState {
    return {
      state: "OCIOSO", enteredStateAt: Date.now(), periodsInState: 0,
      consecutiveCompressionPeriods: 0, prices: [],
      pseudoATRShort: 0, pseudoATRLong: 0, atrPercentile: 1,
      squeezeActive: false, tensionScore: 0,
      atrBaseline: 0, baselineDataPoints: 0,
    }
  }

  private key(token: string, network: string): string {
    return `${token}:${network}`
  }

  private resolveKey(pair: string, network: string): string {
    return this.key(volatileToken(pair), network)
  }

  private async fetchPrice(token: string): Promise<number | null> {
    const coinId = COIN_IDS[token]
    if (!coinId) return null
    try {
      const res = await fetch(`/api/price?ids=${coinId}`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return null
      const data = await res.json()
      const p = (data.prices ?? data)[coinId]
      return typeof p === "number" && p > 0 ? p : null
    } catch {
      return null
    }
  }

  private absoluteReturns(ps: PairState): number[] {
    const r: number[] = []
    for (let i = 1; i < ps.prices.length; i++) {
      const prev = ps.prices[i - 1].price
      if (prev > 0) r.push(Math.abs((ps.prices[i].price - prev) / prev))
    }
    return r
  }

  private detectSqueeze(ps: PairState): boolean {
    if (ps.prices.length < SQUEEZE_WINDOW + 1) return false
    const recent = ps.prices.slice(-SQUEEZE_WINDOW).map(p => p.price)
    const m = recent.reduce((s, v) => s + v, 0) / recent.length
    const v = recent.reduce((s, v) => s + (v - m) ** 2, 0) / recent.length
    const std = Math.sqrt(v)
    const bw = 2 * BOLLINGER_STDDEV * std / m
    const kw = 2 * KELTNER_ATR_MULT * ps.pseudoATRLong / m
    return bw < kw
  }

  private checkCalibration(token: string, ps: PairState): void {
    if (ps.prices.length < CALIBRATION_WINDOW + 1) return
    const rets = this.absoluteReturns(ps)
    if (rets.length < CALIBRATION_WINDOW) return
    const recent = rets.slice(-CALIBRATION_WINDOW)
    const mean = recent.reduce((s, v) => s + v, 0) / recent.length
    if (ps.baselineDataPoints < CALIBRATION_WINDOW) {
      ps.atrBaseline = mean
      ps.baselineDataPoints = CALIBRATION_WINDOW
      return
    }
    if (ps.atrBaseline > 0) {
      const chg = Math.abs(mean - ps.atrBaseline) / ps.atrBaseline
      if (chg > RESET_THRESHOLD) {
        console.log(`[ARQUEIRO] 🔄 Reset calibração ${token}: ATR ${(ps.atrBaseline*100).toFixed(3)}% → ${(mean*100).toFixed(3)}% (${(chg*100).toFixed(0)}%)`)
        Object.assign(ps, this.fresh())
        ps.atrBaseline = mean
        ps.baselineDataPoints = CALIBRATION_WINDOW
      }
    }
  }

  private fireCondition(ps: PairState): boolean {
    if (ps.prices.length < SQUEEZE_WINDOW + 1) return false
    const recent = ps.prices.slice(-SQUEEZE_WINDOW).map(p => p.price)
    if (recent.length < 3) return false
    const m = recent.reduce((s, v) => s + v, 0) / recent.length
    const v = recent.reduce((s, v) => s + (v - m) ** 2, 0) / recent.length
    const std = Math.sqrt(v)
    const cur = recent[recent.length - 1]
    const p1 = recent[recent.length - 3], p2 = recent[recent.length - 2]
    const d1 = p2 - p1, d2 = cur - p2
    if (d1 * d2 <= 0) return false
    const mag = Math.abs(d2) / m
    return mag > ps.pseudoATRLong * 0.5
  }

  private computeScore(ps: PairState, state: StateName): number {
    const norm = Math.max(0, Math.min(1, (COMPRESSION_THRESHOLD - ps.atrPercentile) / COMPRESSION_THRESHOLD))
    switch (state) {
      case "OCIOSO": case "DESARMADO": return 0
      case "TENSIONANDO": return Math.round(Math.min(50, Math.max(0, 20 + 30 * norm)))
      case "ARMADO": {
        let s = Math.round(Math.min(70, Math.max(40, 30 + 40 * norm)))
        if (ps.periodsInState > DECAY_START) {
          const df = Math.max(0, 1 - (ps.periodsInState - DECAY_START) / DECAY_FULL)
          s = Math.round(s * df)
        }
        return s
      }
      case "DISPARO": {
        let s = Math.round(Math.min(100, Math.max(50, 50 + 50 * norm)))
        if (ps.periodsInState > 5) {
          const df = Math.max(0.3, 1 - (ps.periodsInState - 5) / DISPARO_TIMEOUT)
          s = Math.round(s * df)
        }
        return s
      }
    }
  }

  private transition(key: string, ps: PairState, next: StateName): void {
    if (ps.state === next) return
    if ((next === "ARMADO" || next === "DISPARO") && this.armedCount() >= MAX_ARMED_PAIRS) return
    const prev = ps.state
    ps.state = next
    ps.enteredStateAt = Date.now()
    ps.periodsInState = 0
    if (next !== "ARMADO" && next !== "DISPARO") ps.tensionScore = 0
    console.log(`[ARQUEIRO] 🔄 ${key}: ${prev} → ${next}`)
  }

  private async tick(token: string, network: string): Promise<void> {
    const k = this.key(token, network)
    let ps = this.pairs.get(k)
    if (!ps) { ps = this.fresh(); this.pairs.set(k, ps) }

    const price = await this.fetchPrice(token)
    if (price === null || price <= 0) return

    ps.prices.push({ price, timestamp: Date.now() })
    if (ps.prices.length > LONG_WINDOW + 1) ps.prices.shift()

    if (ps.prices.length < SHORT_WINDOW + 1) {
      if (ps.state !== "OCIOSO") this.transition(k, ps, "OCIOSO")
      return
    }

    const rets = this.absoluteReturns(ps)
    if (rets.length < SHORT_WINDOW) return

    ps.pseudoATRShort = rets.slice(-SHORT_WINDOW).reduce((s, v) => s + v, 0) / SHORT_WINDOW
    ps.pseudoATRLong = rets.slice(-LONG_WINDOW).reduce((s, v) => s + v, 0) / Math.min(LONG_WINDOW, rets.length)
    ps.atrPercentile = ps.pseudoATRLong > 0 ? ps.pseudoATRShort / ps.pseudoATRLong : 1

    ps.squeezeActive = this.detectSqueeze(ps)

    const compressed = ps.atrPercentile < COMPRESSION_THRESHOLD && ps.squeezeActive
    ps.consecutiveCompressionPeriods = compressed ? ps.consecutiveCompressionPeriods + 1 : 0

    this.checkCalibration(token, ps)

    ps.periodsInState++
    const s = ps.state
    if (s === "OCIOSO" && ps.consecutiveCompressionPeriods >= 2) this.transition(k, ps, "TENSIONANDO")
    else if (s === "TENSIONANDO") {
      if (!compressed) this.transition(k, ps, "OCIOSO")
      else if (ps.consecutiveCompressionPeriods >= 4) this.transition(k, ps, "ARMADO")
      else if (ps.periodsInState > TENSIONANDO_TIMEOUT) this.transition(k, ps, "DESARMADO")
    } else if (s === "ARMADO") {
      if (!compressed) this.transition(k, ps, "OCIOSO")
      else if (this.fireCondition(ps)) this.transition(k, ps, "DISPARO")
      else if (ps.periodsInState > ARMADO_TIMEOUT) this.transition(k, ps, "DESARMADO")
    } else if (s === "DISPARO") {
      if (!compressed) this.transition(k, ps, "OCIOSO")
      else if (ps.periodsInState > DISPARO_TIMEOUT) this.transition(k, ps, "OCIOSO")
    } else if (s === "DESARMADO" && ps.periodsInState > DESARMADO_COOLDOWN) {
      this.transition(k, ps, "OCIOSO")
    }

    ps.tensionScore = this.computeScore(ps, ps.state)

    if (this._shadowMode && ps.tensionScore > 0) {
      console.log(`[ARQUEIRO] 🏹 ${token}@${network} | ${ps.state} | ATR=${(ps.pseudoATRShort*100).toFixed(3)}% | pctl=${ps.atrPercentile.toFixed(3)} | squeeze=${ps.squeezeActive} | tensão=${ps.tensionScore} (SHADOW)`)
    }
  }

  // ─── Public API ───

  get shadowMode(): boolean { return this._shadowMode }
  setShadowMode(v: boolean): void { this._shadowMode = v }

  getScore(pair: string, network: string): number {
    if (this._shadowMode) return 0
    if (isStableStable(pair)) return 0
    const ps = this.pairs.get(this.resolveKey(pair, network))
    return ps?.tensionScore ?? 0
  }

  getSnapshot(pair: string, network: string): { state: StateName; tensionScore: number; atrPercentile: number; squeezeActive: boolean } | null {
    const ps = this.pairs.get(this.resolveKey(pair, network))
    if (!ps) return null
    return { state: ps.state, tensionScore: ps.tensionScore, atrPercentile: ps.atrPercentile, squeezeActive: ps.squeezeActive }
  }

  allSnapshots(): { key: string; state: StateName; tensionScore: number }[] {
    return Array.from(this.pairs.entries()).map(([k, ps]) => ({ key: k, state: ps.state, tensionScore: ps.tensionScore }))
  }

  async feedPrice(pair: string, network: string): Promise<void> {
    if (isStableStable(pair)) return
    await this.tick(volatileToken(pair), network)
  }

  start(): void {
    if (this.timer) return
    console.log("[ARQUEIRO] 🏹 Iniciado (shadow mode)")
    this.timer = setInterval(async () => {
      for (const [k, ps] of this.pairs) {
        if (ps.state !== "OCIOSO") {
          const [token, network] = k.split(":")
          await this.tick(token, network)
        }
      }
    }, CYCLE_MS)
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }
}

export const arqueiro = new Arqueiro()
export type { StateName as ArqueiroStateName }
