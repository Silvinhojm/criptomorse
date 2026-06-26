// lib/trading-strategies.ts — Stub para AutoTradeControl

export interface DeliberationInput {
  action: string;
  confidence: number;
}

export interface DeliberationResult {
  shouldTrade: boolean;
  action: string;
  confidence: number;
}

export const tradingStrategies = {
  async deliberate(
    decision: DeliberationInput,
    _fn: () => Promise<DeliberationInput>
  ): Promise<DeliberationResult> {
    return {
      shouldTrade: decision.confidence > 50,
      action: decision.action,
      confidence: decision.confidence,
    };
  },
};
