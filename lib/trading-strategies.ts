interface TradingDecision {
  action: string;
  confidence: number;
}

interface DeliberationResult {
  shouldTrade: boolean;
  action: string;
  confidence: number;
  reason: string;
}

class TradingStrategies {
  private minConfidence = 60;
  private history: DeliberationResult[] = [];

  async deliberate(
    decision: TradingDecision,
    validator: () => Promise<TradingDecision>
  ): Promise<DeliberationResult> {
    const validated = await validator();
    const confidence = Math.round((decision.confidence + validated.confidence) / 2);
    const shouldTrade = confidence >= this.minConfidence && decision.action !== "hold";

    const result: DeliberationResult = {
      shouldTrade,
      action: decision.action,
      confidence,
      reason: shouldTrade
        ? `Confidence ${confidence}% above threshold ${this.minConfidence}%`
        : `Confidence ${confidence}% below threshold or hold signal`,
    };

    this.history.push(result);
    if (this.history.length > 50) this.history.shift();
    return result;
  }

  getHistory() {
    return this.history;
  }
}

export const tradingStrategies = new TradingStrategies();
