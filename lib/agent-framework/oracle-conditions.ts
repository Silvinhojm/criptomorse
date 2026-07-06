export interface PricePoint {
  price: number
  timestamp: number
}

export interface HistoryEntry {
  timestamp: number
  value: number
  label: string
}

export interface ConditionSnapshot {
  key: string
  state: string
  score: number
  percentile: number
  active: boolean
}

export class OracleConditions {
  readonly name: string
  protected states = new Map<string, string>()
  protected scores = new Map<string, number>()
  protected history = new Map<string, HistoryEntry[]>()

  constructor(name: string) {
    this.name = name
  }

  update(key: string, state: string, score: number): void {
    this.states.set(key, state)
    this.scores.set(key, score)

    const h = this.history.get(key) ?? []
    h.push({ timestamp: Date.now(), value: score, label: state })
    if (h.length > 500) h.splice(0, h.length - 500)
    this.history.set(key, h)
  }

  getScore(key: string): number {
    return this.scores.get(key) ?? 0
  }

  getState(key: string): string {
    return this.states.get(key) ?? "unknown"
  }

  getHistory(key: string, limit = 100): HistoryEntry[] {
    const h = this.history.get(key) ?? []
    return h.slice(-limit)
  }

  getAllSnapshots(): ConditionSnapshot[] {
    return Array.from(this.states.entries()).map(([key, state]) => ({
      key,
      state,
      score: this.scores.get(key) ?? 0,
      percentile: 0,
      active: this.scores.get(key) !== 0,
    }))
  }

  reset(): void {
    this.states.clear()
    this.scores.clear()
    this.history.clear()
  }
}
