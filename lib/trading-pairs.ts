// lib/trading-pairs.ts

export interface TradingPair {
  id: string;
  name: string;
  baseToken: string;
  quoteToken: string;
  baseAddress: string;
  quoteAddress: string;
  chainId: number;
  decimalsBase: number;
  decimalsQuote: number;
  minSpreadPercent: number;
  volatility: 'low' | 'medium' | 'high';
  enabled: boolean;
  color: string;
}

// CONFIGURAÇÕES PARA ARC TESTNET
export const ARC_TESTNET_PAIRS: TradingPair[] = [
  {
    id: 'usdc_eurc_arc',
    name: 'USDC/EURC',
    baseToken: 'USDC',
    quoteToken: 'EURC',
    baseAddress: '0x3600000000000000000000000000000000000000',
    quoteAddress: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
    chainId: 1169,
    decimalsBase: 6,
    decimalsQuote: 6,
    minSpreadPercent: 0.35,
    volatility: 'low',
    enabled: true,
    color: '#3b82f6'
  },
  {
    id: 'usdc_btc_arc',
    name: 'USDC/BTC',
    baseToken: 'USDC',
    quoteToken: 'BTC',
    baseAddress: '0x3600000000000000000000000000000000000000',
    quoteAddress: '0x...BTC_TESTNET_ADDRESS...', // Em desenvolvimento na Arch
    chainId: 1169,
    decimalsBase: 6,
    decimalsQuote: 8,
    minSpreadPercent: 0.8,
    volatility: 'high',
    enabled: false, // Aguardando liquidez
    color: '#f7931a'
  }
];

// CONFIGURAÇÕES PARA BASE MAINNET
export const BASE_MAINNET_PAIRS: TradingPair[] = [
  {
    id: 'usdc_eurc_base',
    name: 'USDC/EURC',
    baseToken: 'USDC',
    quoteToken: 'EURC',
    baseAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    quoteAddress: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42',
    chainId: 8453,
    decimalsBase: 6,
    decimalsQuote: 6,
    minSpreadPercent: 0.3,
    volatility: 'low',
    enabled: true,
    color: '#3b82f6'
  },
  {
    id: 'usdc_weth_base',
    name: 'USDC/WETH',
    baseToken: 'USDC',
    quoteToken: 'WETH',
    baseAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    quoteAddress: '0x4200000000000000000000000000000000000006',
    chainId: 8453,
    decimalsBase: 6,
    decimalsQuote: 18,
    minSpreadPercent: 0.5,
    volatility: 'medium',
    enabled: true,
    color: '#00d4aa'
  },
  {
    id: 'usdc_wbtc_base',
    name: 'USDC/WBTC',
    baseToken: 'USDC',
    quoteToken: 'WBTC',
    baseAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    quoteAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    chainId: 8453,
    decimalsBase: 6,
    decimalsQuote: 8,
    minSpreadPercent: 0.8,
    volatility: 'high',
    enabled: true,
    color: '#f7931a'
  }
];

// Obter pares por rede
export function getTradingPairs(isMainnet: boolean): TradingPair[] {
  return isMainnet ? BASE_MAINNET_PAIRS : ARC_TESTNET_PAIRS;
}

// Obter melhor par baseado em spread (simulado)
export async function getBestPairBySpread(pairs: TradingPair[], currentSpreads: Record<string, number>): Promise<TradingPair | null> {
  let bestPair: TradingPair | null = null;
  let bestScore = 0;
  
  for (const pair of pairs) {
    if (!pair.enabled) continue;
    
    const spread = currentSpreads[pair.id] || 0.5;
    let score = 0;
    
    // Score baseado no spread em relação ao mínimo necessário
    if (spread > pair.minSpreadPercent) {
      score += (spread / pair.minSpreadPercent) * 50;
    }
    
    // Bônus por volatilidade (mais lucro potencial)
    if (pair.volatility === 'high') score += 20;
    else if (pair.volatility === 'medium') score += 10;
    
    if (score > bestScore) {
      bestScore = score;
      bestPair = pair;
    }
  }
  
  return bestPair;
}