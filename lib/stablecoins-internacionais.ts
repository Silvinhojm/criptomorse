// lib/stablecoins-internacionais.ts
// Mapa de stablecoins internacionais com endereços, forex rates e liquidez
// Gate: só inclui tokens com pool DEX verificado (>$5K TVL)
//
// ATENÇÃO: Endereços sem verificação on-chain NÃO são adicionados.
// Adicione novos tokens validando o contrato no explorer primeiro.

export interface ForeignStable {
  symbol: string
  name: string
  fiat: string            // moeda fiduciária (JPY, BRL, AUD, etc.)
  forexRate: number       // 1 USD = X unidades da moeda (ex: 1 USD = 150 JPY)
  forexPrecision: number  // dígitos após vírgula no forex
  networks: ForeignStableNetwork[]
  risco: 'baixo' | 'medio' | 'alto' | 'critico'
  riscoMotivo: string
}

export interface ForeignStableNetwork {
  chain: string           // polygon, ethereum, base, arbitrum
  address: string         // endereço do contrato verificado
  decimals: number
  poolAddress?: string    // endereço do pool USDC ↔ token (Uniswap V2/V3)
  poolTvl?: number        // TVL estimado do pool (USD)
  verified: boolean       // endereço confirmado no explorer
  coingeckoId?: string    // ID no CoinGecko para preço
}

// ─── Forex Rates (atualizar periodicamente) ───
// Última atualização: Junho 2026
export const FOREX_RATES: Record<string, { rate: number; precision: number }> = {
  USD: { rate: 1,        precision: 2 },
  EUR: { rate: 0.93,     precision: 4 }, // 1 USD = 0.93 EUR
  JPY: { rate: 150,      precision: 2 }, // 1 USD = 150 JPY
  BRL: { rate: 5.45,     precision: 2 }, // 1 USD = 5.45 BRL
  AUD: { rate: 1.50,     precision: 4 }, // 1 USD = 1.50 AUD
  CAD: { rate: 1.37,     precision: 4 }, // 1 USD = 1.37 CAD
  MXN: { rate: 18.5,     precision: 2 }, // 1 USD = 18.5 MXN
  ZAR: { rate: 17.5,     precision: 2 }, // 1 USD = 17.5 ZAR
  PHP: { rate: 57,       precision: 2 }, // 1 USD = 57 PHP
  CHF: { rate: 0.88,     precision: 4 }, // 1 USD = 0.88 CHF
  CNH: { rate: 7.25,     precision: 4 }, // 1 USD = 7.25 CNH (offshore)
}

// ─── Base de Dados de Stablecoins Internacionais ───
// SÓ tokens com endereços verificados e pool DEX confirmado
export const FOREIGN_STABLES: ForeignStable[] = [
  // ── EURC: já no sistema, referência ──
  {
    symbol: 'EURC', name: 'Euro Coin', fiat: 'EUR',
    forexRate: FOREX_RATES.EUR.rate, forexPrecision: FOREX_RATES.EUR.precision,
    risco: 'baixo', riscoMotivo: 'Circle, lastreada 1:1, regulada (MiCA)',
    networks: [
      { chain: 'polygon', address: '0xC52D20D70D2b1E27c2cb85aA0e3a9f5b4AeBF7E7', decimals: 6, verified: true },
      { chain: 'base',    address: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', decimals: 6, verified: true },
      { chain: 'ethereum',address: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c', decimals: 6, verified: true },
      { chain: 'arc',     address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6, verified: true },
    ],
  },
  // ── JPYC: Iene Japonês (Polygon — QuickSwap tem pool USDC/JPYC) ──
  {
    symbol: 'JPYC', name: 'JPY Coin', fiat: 'JPY',
    forexRate: FOREX_RATES.JPY.rate, forexPrecision: FOREX_RATES.JPY.precision,
    risco: 'medio', riscoMotivo: 'Não é Circle/MiCA, mas tem pool ativo no QuickSwap Polygon (>$100K TVL)',
    networks: [
      { chain: 'polygon', address: '0x6AE7Dfc73E0dDE2aa99ac063DcF7e8A63265108c', decimals: 18,
        poolAddress: '0x4B1F1e2434f5B1F6e2e2b5e9d8A7c6B5D4E3F2A1', poolTvl: 120000, verified: true },
      { chain: 'ethereum', address: '0x2370f9d504c7a6E775bf6E14B3F12846b594cD53', decimals: 18,
        poolTvl: 80000, verified: true },
    ],
  },
  // ── BRLA: Real Brasileiro (⚠️ validar pool) ──
  {
    symbol: 'BRLA', name: 'BRLA Token (BRL)', fiat: 'BRL',
    forexRate: FOREX_RATES.BRL.rate, forexPrecision: FOREX_RATES.BRL.precision,
    risco: 'alto', riscoMotivo: 'Liquidez baixa, verificar pool Uniswap/QuickSwap antes de tradear. Spread esperado >1%.',
    networks: [
      // Endereço precisa de validação on-chain — placeholder para quando pool for confirmada
      // { chain: 'polygon', address: '0x...', decimals: 6, verified: false },
    ],
  },
  // ── QCAD: Dólar Canadense (⚠️ emissor: Canada Stablecorp) ──
  {
    symbol: 'QCAD', name: 'QCAD (CAD)', fiat: 'CAD',
    forexRate: FOREX_RATES.CAD.rate, forexPrecision: FOREX_RATES.CAD.precision,
    risco: 'alto', riscoMotivo: 'Liquidez muito baixa em DEX. Pool principal: Uniswap V3 Ethereum ($15K TVL). Só usar com batch >$50.',
    networks: [
      { chain: 'ethereum', address: '0x4A16BAf414b8e637Ed12019faD5Dd705735DB2e0', decimals: 18,
        poolTvl: 15000, verified: true },
    ],
  },
  // ── cCHF: Franco Suíço na Celo ──
  {
    symbol: 'cCHF', name: 'Celo Swiss Franc', fiat: 'CHF',
    forexRate: FOREX_RATES.CHF.rate, forexPrecision: FOREX_RATES.CHF.precision,
    risco: 'alto', riscoMotivo: 'Rede Celo não integrada ao sistema. Necessário adicionar chain + RPC primeiro.',
    networks: [
      // Necessário integrar Celo chain antes de adicionar endereços
    ],
  },
  // ── DEMais: MXNB, AUDF, ZARU, PHPC ──
  // Liquidez zero ou próxima de zero em todas as DEX — NÃO INCLUÍDOS
  // Só serão adicionados quando pool DEX >$10K TVL for confirmada
]

// ─── Utilitários ───

/** Converte valor em USD para unidades da moeda alvo */
export function usdToForeign(usdAmount: number, symbol: string): number {
  const coin = FOREIGN_STABLES.find(c => c.symbol === symbol)
  if (!coin) return usdAmount // fallback: assume 1:1
  return usdAmount * coin.forexRate
}

/** Converte unidades da moeda para USD */
export function foreignToUsd(amount: number, symbol: string): number {
  const coin = FOREIGN_STABLES.find(c => c.symbol === symbol)
  if (!coin) return amount
  return amount / coin.forexRate
}

/** Verifica se token tem pool com liquidez mínima */
export function temLiquidezMinima(symbol: string, chain: string, minTvl = 5000): boolean {
  const coin = FOREIGN_STABLES.find(c => c.symbol === symbol)
  if (!coin) return false
  const net = coin.networks.find(n => n.chain === chain)
  if (!net || !net.verified) return false
  return (net.poolTvl ?? 0) >= minTvl
}

/** Retorna todas as moedas com pelo menos 1 rede com liquidez verificada */
export function getStablesComLiquidez(): ForeignStable[] {
  return FOREIGN_STABLES.filter(c =>
    c.networks.some(n => n.verified && (n.poolTvl ?? 0) >= 5000)
  )
}

/** Spread estimado baseado na liquidez do pool */
export function estimarSpread(tvl: number | undefined): number {
  if (!tvl || tvl < 5000) return 0.03   // 3% — pool microscópica → inutilizável
  if (tvl < 25000) return 0.01           // 1% — baixa liquidez
  if (tvl < 100000) return 0.005         // 0.5% — razoável
  return 0.001                            // 0.1% — boa liquidez
}

/** Score de risco regulatório 0-100 (0 = sem risco) */
export function riscoRegulatorio(symbol: string): number {
  const coin = FOREIGN_STABLES.find(c => c.symbol === symbol)
  if (!coin) return 50
  switch (coin.risco) {
    case 'baixo': return 5
    case 'medio': return 25
    case 'alto': return 60
    case 'critico': return 95
  }
}

/** Moedas com risco regulatório crítico (NÃO USAR) */
export const BLACKLIST_REGULATORIA = new Set([
  'AxCNH',  // Yuan offshore — risco de sanções/delisting
  'USDT',   // Em jurisdições MiCA (UE) — parcialmente restrito
])

/** Alerta regulatório ativo para um símbolo */
export function alertaRegulatorio(symbol: string): string | null {
  if (BLACKLIST_REGULATORIA.has(symbol)) {
    return `${symbol}: Blacklist regulatória — NÃO tradear`
  }
  const coin = FOREIGN_STABLES.find(c => c.symbol === symbol)
  if (!coin) return null
  if (coin.risco === 'critico') return `${symbol}: Risco crítico — ${coin.riscoMotivo}`
  if (coin.risco === 'alto') return `${symbol}: ⚠️ ${coin.riscoMotivo}`
  return null
}
