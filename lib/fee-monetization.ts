// lib/fee-monetization.ts
// ARC Fee Monetization - coleta spread em swaps sem contratos novos
// https://docs.arc.io/app-kit/tutorials/swap/collect-swap-fee

interface FeeConfig {
  spreadBps: number;
  minFee: number;
  maxFee: number;
  feeRecipient: string;
  enabled: boolean;
}

interface FeeCalculation {
  grossAmount: number;
  fee: number;
  netAmount: number;
  feePercent: number;
}

class FeeMonetization {
  private configs: Map<string, FeeConfig> = new Map();

  private readonly DEFAULT_CONFIG: FeeConfig = {
    spreadBps: 30,
    minFee: 0.01,
    maxFee: 5,
    feeRecipient: '0xFeeCollector',
    enabled: true,
  };

  constructor() {
    this.configs.set('USDC_EURC', { ...this.DEFAULT_CONFIG, spreadBps: 30 });
    this.configs.set('USDC_USDT', { ...this.DEFAULT_CONFIG, spreadBps: 10 });
    this.configs.set('USDC_WETH', { ...this.DEFAULT_CONFIG, spreadBps: 50 });
    this.configs.set('default', { ...this.DEFAULT_CONFIG });
  }

  setConfig(pair: string, config: Partial<FeeConfig>) {
    const existing = this.configs.get(pair) ?? { ...this.DEFAULT_CONFIG };
    this.configs.set(pair, { ...existing, ...config });
  }

  getConfig(pair: string): FeeConfig {
    return this.configs.get(pair) ?? this.configs.get('default')!;
  }

  calculateFee(pair: string, amount: number): FeeCalculation {
    const config = this.getConfig(pair);
    if (!config.enabled) {
      return { grossAmount: amount, fee: 0, netAmount: amount, feePercent: 0 };
    }

    const feePercent = config.spreadBps / 10000;
    const rawFee = amount * feePercent;
    const fee = Math.min(config.maxFee, Math.max(config.minFee, rawFee));

    return {
      grossAmount: amount,
      fee: parseFloat(fee.toFixed(6)),
      netAmount: parseFloat((amount - fee).toFixed(6)),
      feePercent: feePercent * 100,
    };
  }

  applySpread(pair: string, amount: number): { buyPrice: number; sellPrice: number; spread: number } {
    const config = this.getConfig(pair);
    const halfSpread = config.spreadBps / 20000;
    return {
      buyPrice: 1 + halfSpread,
      sellPrice: 1 - halfSpread,
      spread: config.spreadBps / 100,
    };
  }

  getQuote(
    pair: string,
    baseAmount: number,
    direction: 'buy' | 'sell'
  ): { executedAmount: number; fee: number; totalCost: number } {
    const config = this.getConfig(pair);
    if (!config.enabled) {
      return { executedAmount: baseAmount, fee: 0, totalCost: baseAmount };
    }

    const feeAmount = baseAmount * (config.spreadBps / 10000);
    const fee = Math.min(config.maxFee, Math.max(config.minFee, feeAmount));
    const totalCost = direction === 'buy' ? baseAmount + fee : baseAmount - fee;

    return {
      executedAmount: baseAmount,
      fee: parseFloat(fee.toFixed(6)),
      totalCost: parseFloat(totalCost.toFixed(6)),
    };
  }

  getStats() {
    const allConfigs = Array.from(this.configs.entries());
    return {
      pairs: allConfigs.length,
      enabled: allConfigs.filter(([_, c]) => c.enabled).length,
      configs: allConfigs.map(([pair, config]) => ({
        pair,
        spread: `${config.spreadBps / 100}%`,
        enabled: config.enabled,
      })),
    };
  }
}

export const feeMonetization = new FeeMonetization();
export type { FeeConfig, FeeCalculation };
