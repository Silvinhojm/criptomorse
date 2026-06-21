import { positionManager } from "./position-manager"
import { pairPriceFeed } from "./pair-price-feed"
import { volatilityTracker } from "./volatility-tracker"
import { pregão } from "./pregão"
import {
  TRADING_PAIRS,
  type NetworkKey,
  type TokenSymbol,
  isStable,
} from "./real-swap-executor"

const GRID_SPACING = 0.015 // 1.5% entre níveis
const GRID_MIN_AMOUNT = 5
const MAX_GRID_LEVELS = 3
const STORAGE_KEY = "arcflow_grid_state"

interface GridLevel {
  id: string
  token: TokenSymbol
  direction: "buy" | "sell"
  triggerPrice: number
  amount: number
  pairLabel: string
  pairFrom: TokenSymbol
  pairTo: TokenSymbol
  status: "pending" | "executed" | "completed"
  createdAt: number
  executedAt?: number
}

interface GridState {
  levels: GridLevel[]
  lastInitPrice: number
  network: NetworkKey
}

function loadState(): Record<string, GridState> {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveState(state: Record<string, GridState>) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

class GridTrading {
  private state: Record<string, GridState> = {}

  async init(network: NetworkKey) {
    this.state = loadState()
    this.cleanStaleGrids(network)
    const pairs = TRADING_PAIRS[network] || []
    const volatileTokens = [
      ...new Set(
        pairs.flatMap((p) => [p.from, p.to])
      ),
    ].filter((t) => !isStable(t))

    for (const token of volatileTokens) {
      const key = `${network}:${token}`
      if (this.state[key]?.lastInitPrice > 0) continue

      const price = await positionManager.fetchTokenPrice(token)
      if (price <= 0) continue

      const buyPair = pairs.find(
        (p) => isStable(p.from) && p.to === token
      )
      const sellPair = pairs.find(
        (p) => p.from === token && isStable(p.to)
      )
      if (!buyPair || !sellPair) continue

      const levels: GridLevel[] = []
      const amount = GRID_MIN_AMOUNT

      for (let i = 1; i <= MAX_GRID_LEVELS; i++) {
        levels.push({
          id: `${key}_buy_${i}_${Date.now()}`,
          token,
          direction: "buy",
          triggerPrice: price * (1 - GRID_SPACING * i),
          amount,
          pairLabel: buyPair.label,
          pairFrom: buyPair.from,
          pairTo: buyPair.to,
          status: "pending",
          createdAt: Date.now(),
        })
      }
      for (let i = 1; i <= MAX_GRID_LEVELS; i++) {
        levels.push({
          id: `${key}_sell_${i}_${Date.now()}`,
          token,
          direction: "sell",
          triggerPrice: price * (1 + GRID_SPACING * i),
          amount,
          pairLabel: sellPair.label,
          pairFrom: sellPair.from,
          pairTo: sellPair.to,
          status: "pending",
          createdAt: Date.now(),
        })
      }

      this.state[key] = { levels, lastInitPrice: price, network }
      pregão.adicionarLog(
        `📊 Grid ${token}: ${MAX_GRID_LEVELS}níveis COMPRA @ ${(GRID_SPACING * 100).toFixed(1)}% abaixo + ${MAX_GRID_LEVELS}níveis VENDA @ ${(GRID_SPACING * 100).toFixed(1)}% acima ($${amount.toFixed(2)} cada)`
      )
    }
    saveState(this.state)
  }

  async checkLevels(
    network: NetworkKey
  ): Promise<{ votes: GridLevel[] }> {
    this.cleanStaleGrids(network)
    const triggered: GridLevel[] = []

    for (const [key, gridState] of Object.entries(this.state)) {
      if (gridState.network !== network) continue
      const currentPrice = await positionManager
        .fetchTokenPrice(gridState.levels[0]?.token as TokenSymbol)
        .catch(() => 0)
      if (currentPrice <= 0) continue

      const openPositions = positionManager
        .getOpenPositions()
        .filter(
          (p) =>
            p.networkKey === network && p.status === "open"
        )

      for (const level of gridState.levels) {
        if (level.status !== "pending") continue

        const isBuy = level.direction === "buy"
        const openCount = openPositions.filter(
          (p) => p.boughtToken === level.token
        ).length
        if (isBuy && openCount >= MAX_GRID_LEVELS) continue

        const hit = isBuy
          ? currentPrice <= level.triggerPrice
          : currentPrice >= level.triggerPrice

        if (hit) {
          level.status = "executed"
          level.executedAt = Date.now()
          triggered.push(level)
          pregão.adicionarLog(
            `📊 Grid ${isBuy ? "🟢 COMPRA" : "🔴 VENDA"} ${level.pairLabel} disparado @ $${level.triggerPrice.toFixed(4)} (atual $${currentPrice.toFixed(4)})`
          )
        }
      }
    }
    saveState(this.state)
    return { votes: triggered }
  }

  private isGridStale(
    gridState: GridState
  ): boolean {
    const buys = gridState.levels.filter((l) => l.direction === "buy")
    const sells = gridState.levels.filter((l) => l.direction === "sell")
    const buysPending = buys.every((l) => l.status === "pending")
    const sellsExecuted = sells.every((l) => l.status === "executed")
    const sellsPending = sells.every((l) => l.status === "pending")
    const buysExecuted = buys.every((l) => l.status === "executed")
    const allExecuted =
      buys.length > 0 &&
      sells.length > 0 &&
      buys.every((l) => l.status !== "pending") &&
      sells.every((l) => l.status !== "pending")
    return (
      (buysPending && sellsExecuted) ||
      (sellsPending && buysExecuted) ||
      allExecuted
    )
  }

  private cleanStaleGrids(network: NetworkKey) {
    for (const [key, gridState] of Object.entries(this.state)) {
      if (gridState.network !== network) continue
      if (this.isGridStale(gridState)) {
        const token = gridState.levels[0]?.token
        pregão.adicionarLog(
          `🧹 Grid ${token} obsoleto — reinicializando com preço atual`
        )
        delete this.state[key]
      }
    }
    saveState(this.state)
  }

  onPositionClosed(
    boughtToken: TokenSymbol,
    profitPercent: number,
    network: NetworkKey
  ) {
    if (profitPercent <= 0) return
    const key = `${network}:${boughtToken}`
    const grid = this.state[key]
    if (!grid) return

    const filled = grid.levels.filter(
      (l) => l.status === "executed"
    ).length
    if (filled >= MAX_GRID_LEVELS * 2) return

    const lastExecuted = grid.levels
      .filter((l) => l.status === "executed")
      .sort((a, b) => (b.executedAt ?? 0) - (a.executedAt ?? 0))[0]

    const newAmount = lastExecuted?.amount ?? GRID_MIN_AMOUNT
    const spacing = GRID_SPACING

    if (profitPercent > 0) {
      const buyLevel: GridLevel = {
        id: `${key}_buy_re${Date.now()}`,
        token: boughtToken,
        direction: "buy",
        triggerPrice: grid.lastInitPrice * (1 - spacing),
        amount: newAmount,
        pairLabel: `${"USDC"}→${boughtToken}`,
        pairFrom: "USDC" as TokenSymbol,
        pairTo: boughtToken,
        status: "pending",
        createdAt: Date.now(),
      }
      grid.levels.push(buyLevel)
      pregão.adicionarLog(
        `🔄 Grid rebalance: novo nível COMPRA ${boughtToken} @ $${buyLevel.triggerPrice.toFixed(4)}`
      )
    }
    saveState(this.state)
  }

  getLevels(token: TokenSymbol, network: NetworkKey): GridLevel[] {
    return this.state[`${network}:${token}`]?.levels ?? []
  }

  clear(token: TokenSymbol, network: NetworkKey) {
    delete this.state[`${network}:${token}`]
    saveState(this.state)
  }
}

export const gridTrader = new GridTrading()
