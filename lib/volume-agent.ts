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

  analyzeVolume(volume: number, volumeRatio: number, momentum: number): VolumeAnalysis {
    const signal = volumeRatio > 1.5 ? "high" : volumeRatio < 0.5 ? "low" : "normal";
    const action: "buy" | "sell" | "hold" =
      signal === "high" && momentum > 0 ? "buy" :
      signal === "high" && momentum < 0 ? "sell" : "hold";
    const confidence = signal === "high" ? 70 : 50;
    return { action, confidence, reason: `Volume: ${signal}, Momentum: ${momentum > 0 ? "up" : "down"}`, signal };
  }

  getScore() {
    return {
      agentName: "Volume",
      wins: this.wins,
      losses: this.losses,
      totalTrades: this.trades,
      winRate: this.trades > 0 ? (this.wins / this.trades) * 100 : 0,
      avgConfidence: 62,
      color: "#f97316",
      icon: "📊",
    };
  }
}

export const volumeAgent = new VolumeAgent();
