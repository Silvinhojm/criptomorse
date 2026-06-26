// lib/confidence-staking.ts
// Agentes apostam reputacao na decisao - acertar ganha peso, errar perde

interface StakeEntry {
  agentName: string;
  action: "buy" | "sell" | "hold";
  stakeAmount: number;
  confidence: number;
  cycleId: number;
}

interface StakerProfile {
  agentName: string;
  reputation: number;
  totalStaked: number;
  wins: number;
  losses: number;
  winRate: number;
}

class ConfidenceStaking {
  private stakers: Map<string, StakerProfile> = new Map();
  private activeStakes: StakeEntry[] = [];
  private cycleCounter = 0;
  private readonly MIN_STAKE = 1;
  private readonly MAX_STAKE = 100;

  registerAgent(agentName: string) {
    if (!this.stakers.has(agentName)) {
      this.stakers.set(agentName, {
        agentName,
        reputation: 50,
        totalStaked: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
      });
    }
  }

  placeStake(agentName: string, action: "buy" | "sell" | "hold", confidence: number): StakeEntry {
    this.registerAgent(agentName);
    const profile = this.stakers.get(agentName)!;
    const stakeAmount = Math.max(this.MIN_STAKE, Math.min(this.MAX_STAKE, Math.round(confidence * profile.reputation / 100)));

    const entry: StakeEntry = {
      agentName,
      action,
      stakeAmount,
      confidence,
      cycleId: this.cycleCounter,
    };

    this.activeStakes.push(entry);
    profile.totalStaked += stakeAmount;
    return entry;
  }

  resolveCycle(winningAction: "buy" | "sell" | "hold") {
    this.cycleCounter++;
    for (const stake of this.activeStakes) {
      const profile = this.stakers.get(stake.agentName);
      if (!profile) continue;

      if (stake.action === winningAction) {
        profile.reputation = Math.min(100, profile.reputation + 5);
        profile.wins++;
        profile.totalStaked += 2;
      } else {
        profile.reputation = Math.max(1, profile.reputation - 3);
        profile.losses++;
        profile.totalStaked = Math.max(0, profile.totalStaked - stake.stakeAmount);
      }
      profile.winRate = profile.wins + profile.losses > 0
        ? Math.round((profile.wins / (profile.wins + profile.losses)) * 100)
        : 0;
    }
    this.activeStakes = [];
  }

  getWeightedConfidence(agentName: string, baseConfidence: number): number {
    const profile = this.stakers.get(agentName);
    if (!profile) return baseConfidence;
    const multiplier = 0.5 + (profile.reputation / 100);
    return Math.round(Math.min(100, baseConfidence * multiplier));
  }

  getProfile(agentName: string): StakerProfile | null {
    return this.stakers.get(agentName) || null;
  }

  getAllProfiles(): StakerProfile[] {
    return Array.from(this.stakers.values());
  }

  getStats() {
    const profiles = this.getAllProfiles();
    return {
      totalAgents: profiles.length,
      avgReputation: profiles.length > 0
        ? Math.round(profiles.reduce((s, p) => s + p.reputation, 0) / profiles.length)
        : 0,
      totalStaked: profiles.reduce((s, p) => s + p.totalStaked, 0),
    };
  }
}

export const confidenceStaking = new ConfidenceStaking();
