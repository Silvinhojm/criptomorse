// RI-BANK-96 — evaluateBridgeOpportunity(): sinal consultivo de "vale a pena
// considerar mover capital via CCTP?", conforme Opção B do RI-BANK-95.
//
// Somente leitura / consultiva: a função recebe as condições atuais como
// input (preço/liquidez nas duas redes), aplica a barreira mínima e devolve
// um sinal informativo (opportunity: boolean + números). Ela NÃO gera, não
// autoriza e não se aproxima de um cron-plan — quem decide escrever plano é
// o chamador (e, nesta etapa, ninguém chama: existe apenas o endpoint de
// consulta manual GET /api/internal/ri-bank-96-bridge-opportunity).
//
// Barreira mínima (cópia fiel do desenho RI-BANK-95 com a constante 3x
// explicitada pelo ticket RI-BANK-96):
//
//   totalBarrier = (cctpFeeUsd + gasSourceUsd + gasDestinationUsd) x 3
//                  + transitMarginUsd
//   opportunity = priceDifferenceUsd (> / >= conforme teste) > totalBarrier
//
// Por que 3x e não o 10x do slippage (LIQUIDITY_DEPTH_MULTIPLIER em
// lib/route-verifier.ts)? O 10x é um multiplicador de PROFUNDIDADE de pool
// (reserva >= 10x o valor do trade) — protege a EXECUÇÃO de um swap de
// deslocar o preço. Aqui o 3x é um multiplicador de CUSTO FIXO (fee + gas):
// 1x paga o custo, os 2x adicionais cobrem (a) erro de estimativa de gas
// (o preço do gas pode subir entre a cotação e a execução das duas pernas)
// e (b) o descolamento adverso da referência de preço ANTES de a primeira
// perna executar. São duas barreiras de natureza diferente (liquidez vs.
// custo de trânsito), logo multiplicadores diferentes — documentado no
// ticket RI-BANK-96 e refletido nos testes de regressão abaixo.
//
// A margem de trânsito é separada e proporcional ao valor movido x tempo:
// quanto maior o capital em trânsito e mais longa a janela (burn→attestation→mint),
// maior o prêmio pelo risco de o preço mudar DURANTE o trânsito (RI-BANK-95 R1/R2).

export interface BridgeOpportunityInput {
  /** Label do par na origem (ex: "USDC→EURC"). Apenas descritivo. */
  pairLabel: string
  /** Rede de origem (ex.: "arc") e de destino (ex.: "base"). Descritivo. */
  sourceNetwork: string
  destinationNetwork: string
  /** Preço da unidade do ativo na origem e no destino, em USD. */
  priceSourceUsd: number
  priceDestinationUsd: number
  /** Custo do CCTP (observado RI-BANK-94: maxFee ~0,00026 USDC). */
  cctpFeeUsd: number
  /** Custo em USD do gas do burn (origem). */
  gasSourceUsd: number
  /** Custo em USD do gas do mint (destino). */
  gasDestinationUsd: number
  /** Janela de trânsito em horas (burn→attestation→mint). Default 0.25h. */
  transitWindowHours?: number
  /** Risco de variação de preço por hora do ativo movido (fração de 0 a 1). */
  transitDriftRatePerHour?: number
  /** Valor em USD que seria movido (para multiplicar a margem de trânsito). */
  tradeAmountUsd?: number
}

export interface BridgeOpportunityResult {
  signal: "bridges_worth_considering" | "not_worth_considering"
  pairLabel: string
  sourceNetwork: string
  destinationNetwork: string
  priceDifferenceUsd: number
  cctpFeeUsd: number
  gasSourceUsd: number
  gasDestinationUsd: number
  fixedCostUsd: number
  /** (cctpFee + gasSource + gasDest) x 3 */
  barrierUsd: number
  transitWindowHours: number
  transitDriftRate: number
  transitMarginUsd: number
  /** barrierUsd + transitMarginUsd */
  totalBarrierUsd: number
  /** Quanto a diferença de preço excede a barreira (positivo = vale considerar). */
  surplusUsd: number
  reason: string
}

/** Constante da barreira mínima — VER JUSTIFICATIVA no comentário de topo. */
export const BRIDGE_FIXED_COST_MULTIPLIER = 3

/** Defaults observados/calibrados para margem de trânsito. */
export const DEFAULT_TRANSIT_WINDOW_HOURS = 0.5 // 30min conservador (RI-BANK-94 mediu 10-30min reais de protocolo)
export const DEFAULT_TRANSIT_DRIFT_RATE = 0.001 // 0,1% de variação por hora (preço pode mover durante o trânsito)
export const DEFAULT_TRADE_AMOUNT_USD = 2.0 // valor de referência (2,0 USDC movidos no teste real)

/** A barreira de custo fixo: (feeCCTP + gasOrigem + gasDestino) x 3. */
export function computeBridgeFixedCostBarrier(input: {
  cctpFeeUsd: number
  gasSourceUsd: number
  gasDestinationUsd: number
}): number {
  return (input.cctpFeeUsd + input.gasSourceUsd + input.gasDestinationUsd) * BRIDGE_FIXED_COST_MULTIPLIER
}

/** Margem de trânsito: valor movido x drift por hora x janela de horas. */
export function computeTransitMargin(input: {
  tradeAmountUsd?: number
  transitDriftRate?: number
  transitWindowHours?: number
}): number {
  const amount = input.tradeAmountUsd ?? DEFAULT_TRADE_AMOUNT_USD
  const drift = input.transitDriftRate ?? DEFAULT_TRANSIT_DRIFT_RATE
  const hours = input.transitWindowHours ?? DEFAULT_TRANSIT_WINDOW_HOURS
  return amount * drift * hours
}

/**
 * Núcleo consultivo: calcula a barreira mínima e devolve o sinal.
 * Função pura (sem I/O); todos os dados de mercado entram pelos inputs.
 */
export function evaluateBridgeOpportunity(input: BridgeOpportunityInput): BridgeOpportunityResult {
  const fixedCost = input.cctpFeeUsd + input.gasSourceUsd + input.gasDestinationUsd
  const barrierUsd = computeBridgeFixedCostBarrier(input)
  const transitMarginUsd = computeTransitMargin(input)
  const totalBarrierUsd = barrierUsd + transitMarginUsd
  const priceDifferenceUsd = Math.abs(input.priceSourceUsd - input.priceDestinationUsd)
  const surplusUsd = priceDifferenceUsd - totalBarrierUsd
  const opportunity = surplusUsd > 0
  return {
    signal: opportunity ? "bridges_worth_considering" : "not_worth_considering",
    pairLabel: input.pairLabel,
    sourceNetwork: input.sourceNetwork,
    destinationNetwork: input.destinationNetwork,
    priceDifferenceUsd,
    cctpFeeUsd: input.cctpFeeUsd,
    gasSourceUsd: input.gasSourceUsd,
    gasDestinationUsd: input.gasDestinationUsd,
    fixedCostUsd: fixedCost,
    barrierUsd,
    transitWindowHours: input.transitWindowHours ?? DEFAULT_TRANSIT_WINDOW_HOURS,
    transitDriftRate: input.transitDriftRatePerHour ?? DEFAULT_TRANSIT_DRIFT_RATE,
    transitMarginUsd,
    totalBarrierUsd,
    surplusUsd,
    reason: opportunity
      ? `diff ${priceDifferenceUsd.toFixed(6)} > barreira ${totalBarrierUsd.toFixed(6)} — vale considerar`
      : `diff ${priceDifferenceUsd.toFixed(6)} <= barreira ${totalBarrierUsd.toFixed(6)} — não compensa o risco de trânsito`,
  }
}