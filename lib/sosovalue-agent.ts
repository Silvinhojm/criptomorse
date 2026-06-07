interface BearOpportunity {
  opportunity: "strong" | "moderate" | "none";
  confidence: number;
  reason: string;
}

class SosovalueAgent {
  analyzeBearOpportunity(btcDominance: number, fearValue: number): BearOpportunity {
    if (btcDominance > 55 && fearValue < 30) {
      return { opportunity: "strong", confidence: 80, reason: "High BTC dominance + extreme fear = bear opportunity" };
    }
    if (btcDominance > 50 || fearValue < 40) {
      return { opportunity: "moderate", confidence: 55, reason: "Moderate bear signals detected" };
    }
    return { opportunity: "none", confidence: 20, reason: "No significant bear opportunity" };
  }
}

export const sosovalueAgent = new SosovalueAgent();
