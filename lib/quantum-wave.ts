import { TRADING_PAIRS, NetworkKey, TokenSymbol, isStable } from './real-swap-executor';
import { pairPriceFeed } from './pair-price-feed';

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

  async broadcastIntent(amount: number): Promise<QuantumWave> {
    const pairs: QuantumPair[] = [];

    // Monta a lista de todos os pares (network + from/to) primeiro, depois busca
    // preço real para cada um em paralelo — bem mais rápido que sequencial.
    const allPairs: { net: NetworkKey; pair: { from: TokenSymbol; to: TokenSymbol; label: string } }[] = [];
    for (const [networkKey, pairsList] of Object.entries(TRADING_PAIRS)) {
      const net = networkKey as NetworkKey;
      for (const pair of pairsList) {
        allPairs.push({ net, pair });
      }
    }

    const statsResults = await Promise.all(
      allPairs.map(({ pair }) => pairPriceFeed.getPairStats(pair.from, pair.to, isStable))
    );

    for (let i = 0; i < allPairs.length; i++) {
      const { net, pair } = allPairs[i];
      const stats = statsResults[i];

      pairs.push({
        network: net,
        fromToken: pair.from,
        toToken: pair.to,
        label: pair.label,
        amplitude: stats.amplitude,
        // phase não tem equivalente real de mercado — mantido só como metadado
        // decorativo da metáfora "onda", não influencia nenhuma decisão de trade.
        phase: 0,
        probability: 0,
        volatility: stats.volatility,
        liquidity: stats.liquidity,
        momentum: stats.momentum,
      });
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

    console.log(`🌊 Quantum wave criada: ${pairs.length} possibilidades (preço real) para $${amount}`);
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