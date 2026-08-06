// RI-BANK-81 — fecha o elo diagnosticado no RI-BANK-80: calcula o
// resultado real de uma execução (comparando quantidades on-chain reais de
// entrada/saída, já apuradas por real-swap-executor.ts via saldo
// antes/depois -- não uma estimativa) e converte para USD usando câmbio
// externo real (lib/external-forex-rate.ts), nunca o preço interno do pool
// de testnet. O valor resultante é o que alimenta recordBanditResult()
// (lib/bandit-state-redis.ts) -- ver integração em
// lib/cron-trading-runtime.ts e lib/cron-trading-service.ts.
//
// Deliberadamente restrito a USDC/EURC hoje: são os únicos dois lados que
// ARC_BANDIT_PAIRS (RI-BANK-78) usa em pares elegíveis com câmbio fiat
// direto conhecido. cirBTC não tem uma fonte de câmbio fiat -- calcular
// "lucro" para ele exigiria uma fonte de preço de ativo (BTC/USD), uma
// categoria de problema diferente (garimpeiros multi-rede, fora do escopo
// deste ticket). Falha fechada: um par não suportado nunca é silenciosamente
// tratado como 1:1.

import { fetchExternalUsdEurRate, type ExternalForexRate } from "./external-forex-rate"

export type BanditExecutionEnvironment = "testnet" | "mainnet"

export interface SwapProfitResult {
  profitUsd: number
  priceSource: string
  environment: BanditExecutionEnvironment
}

const SUPPORTED_FOREX_TOKENS = new Set(["USDC", "EURC"])

/** USDC assumido 1:1 com USD (peg padrão de indústria, não uma fonte de
 *  câmbio "de mercado" separada -- é a própria definição do ativo). EURC
 *  usa a taxa de câmbio externa real passada pelo chamador. */
export function convertTokenAmountToUsd(symbol: string, amount: number, usdPerEur: number): number {
  const s = symbol.toUpperCase()
  if (s === "USDC") return amount
  if (s === "EURC") return amount * usdPerEur
  throw new Error(`bandit-execution-feedback: unsupported_forex_token:${symbol}`)
}

export function isSupportedForexToken(symbol: string): boolean {
  return SUPPORTED_FOREX_TOKENS.has(symbol.toUpperCase())
}

/** Calcula o lucro real (USD) de um swap já executado, comparando o valor
 *  de mundo real do que entrou vs. do que saiu -- usando quantidades
 *  on-chain reais (não estimadas) e câmbio externo real (não o preço do
 *  pool). `fetchRate` é injetável para teste determinístico sem rede real. */
export async function computeSwapProfitUsd(
  fromToken: string,
  toToken: string,
  fromAmount: number,
  toAmount: number,
  isTestnet: boolean,
  fetchRate: () => Promise<ExternalForexRate> = fetchExternalUsdEurRate,
): Promise<SwapProfitResult> {
  if (!isSupportedForexToken(fromToken) || !isSupportedForexToken(toToken)) {
    throw new Error(`bandit-execution-feedback: unsupported_pair:${fromToken}->${toToken}`)
  }
  const rate = await fetchRate()
  const fromUsd = convertTokenAmountToUsd(fromToken, fromAmount, rate.usdPerEur)
  const toUsd = convertTokenAmountToUsd(toToken, toAmount, rate.usdPerEur)
  return {
    profitUsd: toUsd - fromUsd,
    priceSource: rate.source,
    environment: isTestnet ? "testnet" : "mainnet",
  }
}
