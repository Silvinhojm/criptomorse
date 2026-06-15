interface VolumeAnalysis {
  action: "buy" | "sell" | "hold";
  confidence: number;
  reason: string;
  signal: string;
}

class VolumeAgent {
  private wins = 0;
  private losses = 0;
  private trades = 0;

  private cached: { ratio: number; momentum: number } = { ratio: 1, momentum: 0 };

  async refreshFromMarket() {
    try {
      const res = await fetch('/api/market-data', { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;
      const data = await res.json();
      const mkt = data.market ?? {};
      const vol = mkt.volume24h ?? 0;
      const cap = mkt.totalMarketCap ?? 1;
      const ratio = cap > 0 ? (vol / cap) * 100 : 1;
      this.cached = { ratio, momentum: ratio > 5 ? 1 : ratio < 2 ? -1 : 0 };
    } catch {
      /* keep cached */
    }
  }

  analyzeVolume(volume: number, volumeRatio: number, momentum: number): VolumeAnalysis {
    const vr = this.cached.ratio > 0 ? this.cached.ratio : volumeRatio;
    const m = this.cached.momentum !== 0 ? this.cached.momentum : momentum;

    const signal = vr > 5 ? "high" : vr < 2 ? "low" : "normal";
    const action: "buy" | "sell" | "hold" =
      signal === "high" && m > 0 ? "buy" :
      signal === "high" && m < 0 ? "sell" : "hold";
    const confidence = signal === "high" ? 55 : 35;
    return { action, confidence, reason: `Volume 24h: ${vr.toFixed(1)}% mkt cap (${signal})`, signal };
  }

  getScore() {
    return {
      agentName: "Volume",
      wins: this.wins,
      losses: this.losses,
      totalTrades: this.trades,
      winRate: this.trades > 0 ? (this.wins / this.trades) * 100 : 0,
      avgConfidence: 35,
      color: "#f97316",
      icon: "📊",
    };
  }
}

export const volumeAgent = new VolumeAgent();
