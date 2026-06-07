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
}

class VotingSystem {
  private history: VoteResult[] = [];
  // Rastreia resultados reais: quantos trades venceram vs perderam
  private wins = 0;
  private losses = 0;

  vote(votes: AgentVote[]): VoteResult {
    const scores: Record<string, number> = { buy: 0, sell: 0, hold: 0 };
    let totalWeight = 0;

    for (const v of votes) {
      const w = v.weight * (v.confidence / 100);
      scores[v.action] = (scores[v.action] || 0) + w;
      totalWeight += v.weight;
    }

    const action = (
      Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]
    ) as "buy" | "sell" | "hold";

    // Confiança = proporção do peso da ação vencedora sobre o peso total
    const confidence = totalWeight > 0
      ? Math.round((scores[action] / totalWeight) * 100)
      : 0;

    const result: VoteResult = { action, confidence, votes, breakdown: scores };
    this.history.push(result);
    if (this.history.length > 100) this.history.shift();
    return result;
  }

  /**
   * Chamado após o resultado real do trade ser conhecido.
   * won = true se o trade gerou lucro, false se gerou prejuízo.
   */
  recordResult(won: boolean) {
    if (won) this.wins++;
    else this.losses++;
  }

  getStats() {
    const totalVotes = this.history.length;
    if (totalVotes === 0) return { totalVotes: 0, avgConfidence: 0, winRate: 0 };

    const avgConfidence = Math.round(
      this.history.reduce((s, r) => s + r.confidence, 0) / totalVotes
    );

    // winRate real: baseado nos resultados registrados via recordResult()
    const totalResolved = this.wins + this.losses;
    const winRate = totalResolved > 0
      ? Math.round((this.wins / totalResolved) * 100)
      : 0;

    return { totalVotes, avgConfidence, winRate };
  }
}

export const votingSystem = new VotingSystem();
