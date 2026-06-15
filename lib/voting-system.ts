export interface AgentVote {
  agentName: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
  weight: number;
  color?: string;
  icon?: string;
}

interface VoteResult {
  action: "buy" | "sell" | "hold";
  confidence: number;
  votes: AgentVote[];
  breakdown: Record<string, number>;
  timeoutCount: number;
  failedAgents: string[];
}

interface AgentScoreEntry {
  wins: number;
  losses: number;
  totalVotes: number;
  dynamicWeight: number;
}

class VotingSystem {
  private history: VoteResult[] = [];
  private wins = 0;
  private losses = 0;

  private agentScores: Map<string, AgentScoreEntry> = new Map();
  private lastFinalAction: "buy" | "sell" | "hold" | null = null;
  private lastVotes: AgentVote[] = [];

  private readonly DEFAULT_TIMEOUT_MS = 5000;

  private getAgentEntry(name: string): AgentScoreEntry {
    if (!this.agentScores.has(name)) {
      this.agentScores.set(name, { wins: 0, losses: 0, totalVotes: 0, dynamicWeight: 1 });
    }
    return this.agentScores.get(name)!;
  }

  async voteWithTimeout(
    votePromises: Promise<AgentVote>[],
    timeoutMs: number = this.DEFAULT_TIMEOUT_MS
  ): Promise<VoteResult> {
    const timeoutPromises = votePromises.map(p => this.withTimeout(p, timeoutMs));
    const settledVotes = await Promise.allSettled(timeoutPromises);

    const validVotes: AgentVote[] = [];
    const failedAgents: string[] = [];

    for (const result of settledVotes) {
      if (result.status === 'fulfilled' && result.value !== null) {
        validVotes.push(result.value);
      } else {
        failedAgents.push('unknown-agent');
      }
    }

    console.log(`📊 Voting completed: ${validVotes.length}/${votePromises.length} agents responded`);
    if (failedAgents.length > 0) {
      console.warn(`⚠️ ${failedAgents.length} agents timed out or failed`);
    }

    if (validVotes.length === 0) {
      console.warn('⚠️ No agents responded - defaulting to HOLD');
      return this.createDefaultResult('hold', 0, [], failedAgents.length);
    }

    const result = this.vote(validVotes);
    return {
      ...result,
      timeoutCount: failedAgents.length,
      failedAgents: failedAgents
    };
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T | null> {
    return Promise.race([
      promise,
      new Promise<null>((resolve) =>
        setTimeout(() => {
          console.warn(`⏰ Vote timeout after ${timeoutMs}ms`);
          resolve(null);
        }, timeoutMs)
      )
    ]);
  }

  vote(votes: AgentVote[]): VoteResult {
    this.lastVotes = votes;

    const scores: Record<string, number> = { buy: 0, sell: 0, hold: 0 };
    let totalWeight = 0;
    let agentCount = 0;

    for (const v of votes) {
      const entry = this.getAgentEntry(v.agentName);
      const adaptiveWeight = entry.dynamicWeight * v.weight;
      const w = adaptiveWeight * (v.confidence / 100);
      scores[v.action] = (scores[v.action] || 0) + w;
      totalWeight += adaptiveWeight;
      agentCount++;
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const action = sorted[0][0] as "buy" | "sell" | "hold";
    const topScore = sorted[0][1];
    const secondScore = sorted[1]?.[1] ?? 0;

    const majorityWeight = scores[action];
    const confidence = totalWeight > 0 ? Math.round((majorityWeight / totalWeight) * 100) : 0;

    const agreeingAgents = votes.filter(v => v.action === action).length;
    const minMajority = Math.ceil(votes.length * 0.5) + 1;
    const hasMajority = agreeingAgents >= 3 || (agreeingAgents >= 2 && (topScore / (secondScore || 1)) > 2);

    this.lastFinalAction = hasMajority ? action : 'hold';

    const finalAction = hasMajority ? action : 'hold';
    const finalConfidence = hasMajority ? confidence : Math.min(confidence, 40);

    if (!hasMajority) {
      console.log(`⚖️ Sem maioria (${agreeingAgents}/${votes.length} concordaram) — HOLD forçado`);
    }

    const result: VoteResult = {
      action: finalAction,
      confidence: finalConfidence,
      votes,
      breakdown: scores,
      timeoutCount: 0,
      failedAgents: []
    };

    this.history.push(result);
    if (this.history.length > 100) this.history.shift();
    return result;
  }

  recordTradeOutcome(finalAction: "buy" | "sell" | "hold", wasProfitable: boolean) {
    const votes = this.lastVotes;
    if (votes.length === 0) return;

    for (const v of votes) {
      const entry = this.getAgentEntry(v.agentName);
      const votedWithMajority = v.action === finalAction;

      if (wasProfitable && votedWithMajority) {
        entry.wins++;
        entry.dynamicWeight = Math.min(2, entry.dynamicWeight + 0.1);
      } else if (wasProfitable && !votedWithMajority) {
        entry.losses++;
        entry.dynamicWeight = Math.max(0.3, entry.dynamicWeight - 0.05);
      } else if (!wasProfitable && votedWithMajority) {
        entry.losses++;
        entry.dynamicWeight = Math.max(0.3, entry.dynamicWeight - 0.1);
      } else if (!wasProfitable && !votedWithMajority) {
        entry.wins++;
        entry.dynamicWeight = Math.min(2, entry.dynamicWeight + 0.05);
      }

      entry.totalVotes++;
    }

    this.printAgentRankings();
  }

  private printAgentRankings() {
    const sorted = [...this.agentScores.entries()]
      .map(([name, s]) => ({
        name,
        winRate: s.totalVotes > 0 ? Math.round((s.wins / s.totalVotes) * 100) : 0,
        weight: Math.round(s.dynamicWeight * 100) / 100,
        total: s.totalVotes,
      }))
      .sort((a, b) => b.winRate - a.winRate);

    console.log('🏆 Agent Rankings:');
    for (const a of sorted) {
      console.log(`  ${a.name}: ${a.winRate}% win rate (${a.total} votes) — weight: ${a.weight}`);
    }
  }

  getAgentWeights(): Record<string, number> {
    const weights: Record<string, number> = {};
    for (const [name, entry] of this.agentScores) {
      weights[name] = Math.round(entry.dynamicWeight * 100) / 100;
    }
    return weights;
  }

  private createDefaultResult(
    action: "buy" | "sell" | "hold",
    confidence: number,
    votes: AgentVote[],
    failedCount: number
  ): VoteResult {
    return {
      action,
      confidence,
      votes,
      breakdown: { buy: 0, sell: 0, hold: 0 },
      timeoutCount: failedCount,
      failedAgents: Array(failedCount).fill('timeout')
    };
  }

  recordResult(won: boolean) {
    if (won) {
      this.wins++;
      console.log(`✅ Trade WIN recorded (${this.wins}/${this.wins + this.losses})`);
    } else {
      this.losses++;
      console.log(`❌ Trade LOSS recorded (${this.losses}/${this.wins + this.losses})`);
    }
  }

  getStats() {
    const totalVotes = this.history.length;
    if (totalVotes === 0) {
      return { totalVotes: 0, avgConfidence: 0, winRate: 0, totalTimeouts: 0 };
    }

    const avgConfidence = Math.round(
      this.history.reduce((s, r) => s + r.confidence, 0) / totalVotes
    );

    const totalTimeouts = this.history.reduce((s, r) => s + (r.timeoutCount || 0), 0);
    const totalResolved = this.wins + this.losses;
    const winRate = totalResolved > 0
      ? Math.round((this.wins / totalResolved) * 100)
      : 0;

    return {
      totalVotes,
      avgConfidence,
      winRate,
      totalTimeouts,
      wins: this.wins,
      losses: this.losses
    };
  }

  reset() {
    this.history = [];
    this.wins = 0;
    this.losses = 0;
    this.agentScores.clear();
    console.log('🔄 Voting system reset');
  }
}

export const votingSystem = new VotingSystem();
