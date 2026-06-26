// lib/voting-system.ts — Stub para AutoTradeControl

export interface AgentVote {
  agent?: string;
  agentName: string;
  action: string;
  confidence: number;
  weight: number;
  color: string;
  icon: string;
}

export interface VoteResult {
  action: string;
  confidence: number;
}

export interface VotingStats {
  totalVotes: number;
  avgConfidence: number;
  winRate: number;
}

export const votingSystem = {
  vote(votes: AgentVote[]): VoteResult {
    const totalWeight = votes.reduce((sum, v) => sum + v.weight, 0);
    const avgConfidence = votes.reduce((sum, v) => sum + v.confidence, 0) / votes.length;
    const actionCounts: Record<string, number> = {};
    votes.forEach(v => { actionCounts[v.action] = (actionCounts[v.action] || 0) + v.weight; });
    const action = Object.entries(actionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "hold";
    return { action, confidence: avgConfidence };
  },

  getStats(): VotingStats {
    return { totalVotes: 0, avgConfidence: 0, winRate: 0 };
  },

  recordResult(_won: boolean): void {},
};
