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
    minSpreadPercent: 0.3,
    volatility: 'low',
    enabled: true,
    color: '#3b82f6'
  },
  {
    id: 'usdc_cirbtc_arc',
    name: 'USDC/cirBTC',
    baseToken: 'USDC',
    quoteToken: 'cirBTC',
    baseAddress: '0x3600000000000000000000000000000000000000',
    quoteAddress: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
    chainId: 5042002,
    decimalsBase: 6,
    decimalsQuote: 8,
    minSpreadPercent: 0.5,
    volatility: 'medium',
    enabled: true,
    color: '#f7931a'
  },
  {
    id: 'eurc_cirbtc_arc',
    name: 'EURC/cirBTC',
    baseToken: 'EURC',
    quoteToken: 'cirBTC',
    baseAddress: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
    quoteAddress: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
    chainId: 5042002,
    decimalsBase: 6,
    decimalsQuote: 8,
    minSpreadPercent: 0.5,
    volatility: 'medium',
    enabled: true,
    color: '#f7931a'
  },
  {
    id: 'usdc_mcirbtc_arc',
    name: 'USDC/mcirBTC',
    baseToken: 'USDC',
    quoteToken: 'mcirBTC',
    baseAddress: '0x3600000000000000000000000000000000000000',
    quoteAddress: '0x8cad4951192853D14f8Cb813695146b5Ae00EA6d',
    chainId: 5042002,
    decimalsBase: 6,
    decimalsQuote: 8,
    minSpreadPercent: 0.5,
    volatility: 'medium',
    enabled: true,
    color: '#f7931a'
  },
  {
    id: 'eurc_mcirbtc_arc',
    name: 'EURC/mcirBTC',
    baseToken: 'EURC',
    quoteToken: 'mcirBTC',
    baseAddress: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
    quoteAddress: '0x8cad4951192853D14f8Cb813695146b5Ae00EA6d',
    chainId: 5042002,
    decimalsBase: 6,
    decimalsQuote: 8,
    minSpreadPercent: 0.5,
    volatility: 'medium',
    enabled: true,
    color: '#f7931a'
  }
];

// CONFIGURAÇÕES PARA POLYGON MAINNET
export const POLYGON_MAINNET_PAIRS: TradingPair[] = [
  {
    id: 'usdc_usdt_polygon',
    name: 'USDC/USDT',
    baseToken: 'USDC',
    quoteToken: 'USDT',
    baseAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    quoteAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    chainId: 137,
    decimalsBase: 6,
    decimalsQuote: 6,
    minSpreadPercent: 0.1,
    volatility: 'low',
    enabled: true,
    color: '#26a17b'
  },
  {
    id: 'usdt_usdc_polygon',
    name: 'USDT/USDC',
    baseToken: 'USDT',
    quoteToken: 'USDC',
    baseAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    quoteAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    chainId: 137,
    decimalsBase: 6,
    decimalsQuote: 6,
    minSpreadPercent: 0.1,
    volatility: 'low',
    enabled: true,
    color: '#3b82f6'
  },
  {
    id: 'usdc_eurc_polygon',
    name: 'USDC/EURC',
    baseToken: 'USDC',
    quoteToken: 'EURC',
    baseAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    quoteAddress: '0xc52d20D70d2B1E27C2cb85AA0E3a9F5b4AEBf7e7',
    chainId: 137,
    decimalsBase: 6,
    decimalsQuote: 6,
    minSpreadPercent: 0.25,
    volatility: 'low',
    enabled: true,
    color: '#3b82f6'
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
export function getTradingPairs(isMainnet: boolean, chainId?: number): TradingPair[] {
  if (chainId === 137) return POLYGON_MAINNET_PAIRS;
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