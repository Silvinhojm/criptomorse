import { NETWORKS, TRADING_PAIRS, NetworkKey, TokenSymbol } from './real-swap-executor';

export interface QuantumPair {
  network: NetworkKey;
  fromToken: TokenSymbol;
  toToken: TokenSymbol;
  label: string;
  amplitude: number;
  phase: number;
  probability: number;
  volatility: number;
  liquidity: number;
  momentum: number;
}

export interface QuantumWave {
  pairs: QuantumPair[];
  investmentAmount: number;
  timestamp: number;
  collapsed: boolean;
  collapsedPair: QuantumPair | null;
}

class QuantumWaveTrader {
  private wave: QuantumWave | null = null;
  private waveMemory: QuantumWave[] = [];

  broadcastIntent(amount: number): QuantumWave {
    const pairs: QuantumPair[] = [];

    for (const [networkKey, pairsList] of Object.entries(TRADING_PAIRS)) {
      const net = networkKey as NetworkKey;
      for (const pair of pairsList) {
        const amplitude = Math.random();
        const phase = Math.random() * 2 * Math.PI;
        const volatility = 0.2 + Math.random() * 0.6;
        const momentum = (Math.random() - 0.5) * 0.1;

        pairs.push({
          network: net,
          fromToken: pair.from,
          toToken: pair.to,
          label: pair.label,
          amplitude,
          phase,
          probability: 0,
          volatility,
          liquidity: 0.3 + Math.random() * 0.5,
          momentum,
        });
      }
    }

    const totalAmplitude = pairs.reduce((s, p) => s + p.amplitude, 0);
    for (const p of pairs) {
      p.probability = totalAmplitude > 0 ? (p.amplitude / totalAmplitude) * 100 : 0;
    }

    this.wave = {
      pairs,
      investmentAmount: amount,
      timestamp: Date.now(),
      collapsed: false,
      collapsedPair: null,
    };

    console.log(`🌊 Quantum wave criada: ${pairs.length} possibilidades superpostas para $${amount}`);
    return this.wave;
  }

  collapseWave(
    wave: QuantumWave,
    agentConsensus: Map<string, { pair: QuantumPair; confidence: number }[]>
  ): { collapsed: QuantumPair; confidence: number } | null {
    const pairScores = new Map<string, { pair: QuantumPair; totalConfidence: number; votes: number }>();

    for (const agentVotes of agentConsensus.values()) {
      for (const vote of agentVotes) {
        const key = `${vote.pair.network}:${vote.pair.label}`;
        const existing = pairScores.get(key) || { pair: vote.pair, totalConfidence: 0, votes: 0 };
        existing.totalConfidence += vote.confidence;
        existing.votes++;
        pairScores.set(key, existing);
      }
    }

    const sorted = [...pairScores.entries()]
      .map(([key, s]) => ({ key, ...s }))
      .sort((a, b) => b.totalConfidence - a.totalConfidence);

    if (sorted.length === 0) return null;

    const best = sorted[0];
    const avgConfidence = Math.round(best.totalConfidence / best.votes);

    wave.collapsed = true;
    wave.collapsedPair = best.pair;

    console.log(`🌀 Onda colapsada: ${best.pair.label} (${best.pair.network}) — ${best.votes}/${sorted.length} agentes — ${avgConfidence}% confiança`);

    this.waveMemory.push({ ...wave });
    if (this.waveMemory.length > 50) this.waveMemory.shift();

    return { collapsed: best.pair, confidence: avgConfidence };
  }

  getLatestWave(): QuantumWave | null {
    return this.wave;
  }

  getWaveHistory(): QuantumWave[] {
    return [...this.waveMemory];
  }
}

export const quantumWaveTrader = new QuantumWaveTrader();
