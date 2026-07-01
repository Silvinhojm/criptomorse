const STORAGE_KEY = "arcflow_timing_profiles"
const MIN_SAMPLES_FOR_RELIABLE = 5

export interface TimingEntry {
  agentName: string
  pair: string
  hour: number
  dayOfWeek: number
  acertou: boolean
  confianca: number
  timestamp: number
}

export interface HourlyStats {
  samples: number
  wins: number
  losses: number
  winRate: number
  avgConfianca: number
}

export interface TimingProfile {
  agentName: string
  hourly: Record<number, HourlyStats>
  daily: Record<number, HourlyStats>
  lastUpdated: number
  totalSamples: number
}

export interface TimingRecomendacao {
  agentName: string
  confidenceMultiplier: number
  timingScore: number
  bestHour: number
  worstHour: number
  bestWinRate: number
  worstWinRate: number
  currentHourWinRate: number
  samples: number
  currentHour: number
  dayOfWeek: number
}

function emptyStats(): HourlyStats {
  return { samples: 0, wins: 0, losses: 0, winRate: 0, avgConfianca: 0 }
}

function computeWinRate(stats: HourlyStats): number {
  if (stats.samples === 0) return 0
  return (stats.wins / stats.samples) * 100
}

class TimingOptimizer {
  private profiles: Map<string, TimingProfile> = new Map()

  constructor() {
    this._carregar()
  }

  private _carregar(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw) as TimingProfile[]
        this.profiles = new Map(data.map(p => [p.agentName, p]))
      }
    } catch {}
  }

  private _salvar(): void {
    try {
      const data = Array.from(this.profiles.values())
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {}
  }

  registrarResultado(agentName: string, pair: string, acertou: boolean, confianca: number): void {
    const agora = Date.now()
    const hora = new Date(agora).getHours()
    const dia = new Date(agora).getDay()

    let profile = this.profiles.get(agentName)
    if (!profile) {
      profile = {
        agentName,
        hourly: {},
        daily: {},
        lastUpdated: agora,
        totalSamples: 0,
      }
      this.profiles.set(agentName, profile)
    }

    this._updateSlot(profile.hourly, hora, acertou, confianca)
    this._updateSlot(profile.daily, dia, acertou, confianca)

    profile.totalSamples++
    profile.lastUpdated = agora
    this._salvar()
  }

  private _updateSlot(
    slotMap: Record<number, HourlyStats>,
    key: number,
    acertou: boolean,
    confianca: number,
  ): void {
    if (!slotMap[key]) slotMap[key] = emptyStats()
    const stats = slotMap[key]
    stats.samples++
    if (acertou) stats.wins++
    else stats.losses++
    stats.winRate = computeWinRate(stats)
    stats.avgConfianca = (stats.avgConfianca * (stats.samples - 1) + confianca) / stats.samples
  }

  getRecomendacao(agentName: string): TimingRecomendacao {
    const agora = Date.now()
    const horaAtual = new Date(agora).getHours()
    const diaAtual = new Date(agora).getDay()

    const profile = this.profiles.get(agentName)
    if (!profile || profile.totalSamples === 0) {
      return {
        agentName,
        confidenceMultiplier: 1.0,
        timingScore: 0,
        bestHour: -1,
        worstHour: -1,
        bestWinRate: 0,
        worstWinRate: 0,
        currentHourWinRate: 0,
        samples: 0,
        currentHour: horaAtual,
        dayOfWeek: diaAtual,
      }
    }

    const currentStats = profile.hourly[horaAtual]
    const samplesCurrentHour = currentStats?.samples ?? 0

    let bestHour = -1
    let worstHour = -1
    let bestWinRate = 0
    let worstWinRate = 100
    let bestSamples = 0

    for (let h = 0; h < 24; h++) {
      const stats = profile.hourly[h]
      if (!stats || stats.samples < MIN_SAMPLES_FOR_RELIABLE) continue
      const wr = stats.winRate
      if (wr > bestWinRate || (wr === bestWinRate && stats.samples > bestSamples)) {
        bestWinRate = wr
        bestHour = h
        bestSamples = stats.samples
      }
      if (wr < worstWinRate) {
        worstWinRate = wr
        worstHour = h
      }
    }

    let multiplier = 1.0
    let timingScore = 0

    if (samplesCurrentHour >= MIN_SAMPLES_FOR_RELIABLE && currentStats) {
      const wr = currentStats.winRate
      timingScore = Math.round((wr - 50) * 2)

      if (wr >= 70) {
        multiplier = 1.0 + (wr - 70) / 100
      } else if (wr >= 60) {
        multiplier = 1.0
      } else if (wr >= 40) {
        multiplier = 0.5 + (wr - 40) / 40
      } else {
        multiplier = Math.max(0.1, wr / 100)
      }
    } else if (samplesCurrentHour > 0 && currentStats) {
      const wr = currentStats.winRate
      timingScore = Math.round((wr - 50))
      if (wr >= 50) {
        multiplier = 1.0
      } else {
        multiplier = 0.7
      }
    }

    const currentHourWinRate = currentStats?.winRate ?? 0

    return {
      agentName,
      confidenceMultiplier: Math.round(multiplier * 100) / 100,
      timingScore,
      bestHour,
      worstHour,
      bestWinRate,
      worstWinRate,
      currentHourWinRate,
      samples: samplesCurrentHour,
      currentHour: horaAtual,
      dayOfWeek: diaAtual,
    }
  }

  getProfile(agentName: string): TimingProfile | null {
    return this.profiles.get(agentName) ?? null
  }

  getAllProfiles(): TimingProfile[] {
    return Array.from(this.profiles.values())
      .sort((a, b) => b.totalSamples - a.totalSamples)
  }

  getStats() {
    const all = this.getAllProfiles()
    const horaAtual = new Date().getHours()
    let totalSamples = 0
    let agentesComDados = 0
    for (const p of all) {
      totalSamples += p.totalSamples
      if (p.totalSamples > 0) agentesComDados++
    }
    return {
      totalSamples,
      agentesComDados,
      totalAgentes: all.length,
      horaAtual,
      agentes: all.map(p => ({
        nome: p.agentName,
        totalSamples: p.totalSamples,
        currentHourStats: p.hourly[horaAtual] ?? null,
        bestHour: (() => {
          let best = -1
          let bestWr = 0
          for (let h = 0; h < 24; h++) {
            const s = p.hourly[h]
            if (s && s.samples >= MIN_SAMPLES_FOR_RELIABLE && s.winRate > bestWr) {
              bestWr = s.winRate
              best = h
            }
          }
          return best
        })(),
      })),
    }
  }

  getCurrentHourRecommendations(): TimingRecomendacao[] {
    const all = this.getAllProfiles()
    return all.map(p => this.getRecomendacao(p.agentName))
  }

  formatHour(hour: number): string {
    if (hour < 0) return "—"
    return `${hour.toString().padStart(2, "0")}:00`
  }

  formatDay(day: number): string {
    const nomes = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
    return nomes[day] ?? "?"
  }
}

export const timingOptimizer = new TimingOptimizer()
