// RI-BANK-99 — coleta de observação de spread (read-only, sem transações).
// Migração do coletor local (scripts/ri-bank-99-observer.tmp.mjs) para
// execução na nuvem (Vercel + GitHub Actions schedule). Uma chamada = uma
// única leitura de três fontes, persistida no Redis (lista append-only):
//   1. pool próprio GenericAMMPair USDC/EURC (x*y=k com fee 0,3%)
//   2. caminho App Kit (LI.Fi quote read-only, mesmo backbone do RI-BANK-91/93)
//   3. câmbio externo Frankfurter (ECB)
// Nenhuma das fontes dispara transação: pool via eth_call, LI.Fi via quote,
// Frankfurter via GET público. Erro de uma fonte NÃO invalida a amostra —
// a observação é gravada mesmo assim com o campo de erro, para a estatística
// final poder distinguir "gap real" de "fonte indisponível".

import { Contract, JsonRpcProvider } from "ethers"

import type { Redis } from "@upstash/redis"

import { getRedis, isKvConfigured, kvEnvNamespace } from "./kv"

export const RIBANK99_ARC_RPC = "https://rpc.testnet.arc.network"
export const RIBANK99_ARC_CHAIN_ID = 5_042_002
export const RIBANK99_USDC = "0x3600000000000000000000000000000000000000"
export const RIBANK99_EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
export const RIBANK99_POOL = "0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb"
export const RIBANK99_FROM_ADDR = "0x88993E37Ed022C56F83f67C74d33C783E8e49C75"
export const RIBANK99_REF_AMOUNT = 7_000_000n // 7 USDC (6 decimais) — mesma referência do RI-BANK-93
export const RIBANK99_FEE_BPS = 300n

export const RIBANK99_MAX_OBSERVATIONS = 5_000

export interface RIBank99PoolQuote {
  reserveUsdc: number
  reserveEurc: number
  poolEurFor7Usdc: number
  poolPriceUsdcPerEur: number
}

export interface RIBank99LifiQuote {
  ok: boolean
  status?: number
  tool?: string | null
  lifiEurFor7Usdc?: number
  lifiPriceUsdPerEur?: number | null
  fromAmountUsd?: number
  toAmountUsd?: number
  feeLifiUsd?: number
  gasUsd?: number
  error?: string
}

export interface RIBank99FxQuote {
  usdPerEur: number
}

export interface RIBank99Observation {
  ts: string
  idx: number
  pool: RIBank99PoolQuote | { ok: false; error: string }
  lifi: RIBank99LifiQuote
  fx: RIBank99FxQuote | { ok: false; error: string }
  poolPriceEffUsdPerEur?: number
  poolFxGapPct?: number
  lifiPriceEffUsdPerEur?: number
  lifiFxGapPct?: number
}

export function riBank99ObservationsKvKey(): string {
  return `arcflow:${kvEnvNamespace()}:ri-bank-99:observations`
}

/** Leitura read-only do nosso GenericAMMPair via eth_call (x*y=k + fee 0,3%). */
export async function readPool(): Promise<RIBank99PoolQuote> {
  const provider = new JsonRpcProvider(RIBANK99_ARC_RPC, RIBANK99_ARC_CHAIN_ID, {
    staticNetwork: true,
  })
  const pool = new Contract(
    RIBANK99_POOL,
    [
      "function reserve0() view returns (uint256)",
      "function reserve1() view returns (uint256)",
      "function token0() view returns (address)",
    ],
    provider,
  )
  const [t0, r0, r1] = await Promise.all([pool.token0(), pool.reserve0(), pool.reserve1()])
  const t0IsUsdc = t0.toLowerCase() === RIBANK99_USDC.toLowerCase()
  const reserveIn = t0IsUsdc ? r0 : r1
  const reserveOut = t0IsUsdc ? r1 : r0
  const inAfterFee = (RIBANK99_REF_AMOUNT * (10_000n - RIBANK99_FEE_BPS)) / 10_000n
  const out = (reserveOut * inAfterFee) / (reserveIn + inAfterFee)
  return {
    reserveUsdc: Number(reserveIn) / 1e6,
    reserveEurc: Number(reserveOut) / 1e6,
    poolEurFor7Usdc: Number(out) / 1e6,
    poolPriceUsdcPerEur: Number(reserveIn) / Number(reserveOut),
  }
}

/** Cotação read-only do caminho App Kit (LI.Fi quote). Nunca executa swap. */
export async function readLifi(): Promise<RIBank99LifiQuote> {
  const params = new URLSearchParams({
    fromChain: String(RIBANK99_ARC_CHAIN_ID),
    toChain: String(RIBANK99_ARC_CHAIN_ID),
    fromToken: RIBANK99_USDC,
    toToken: RIBANK99_EURC,
    fromAmount: RIBANK99_REF_AMOUNT.toString(),
    fromAddress: RIBANK99_FROM_ADDR,
    toAddress: RIBANK99_FROM_ADDR,
  })
  const url = `https://li.quest/v1/quote?${params.toString()}`
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
  const txt = await res.text()
  let body: any = null
  try { body = JSON.parse(txt) } catch { /* não-JSON */ }
  if (!res.ok) {
    return { ok: false, status: res.status, error: body?.message ?? txt.slice(0, 200) }
  }
  const toAmount = Number(body?.estimate?.toAmount ?? 0) / 1e6
  const toAmountUsd = Number(body?.estimate?.toAmountUSD ?? 0)
  const fromAmountUsd = Number(body?.estimate?.fromAmountUSD ?? 0)
  return {
    ok: true,
    status: res.status,
    tool: body?.tool ?? null,
    lifiEurFor7Usdc: toAmount,
    lifiPriceUsdPerEur: toAmountUsd > 0 && toAmount > 0 ? toAmountUsd / toAmount : null,
    fromAmountUsd,
    toAmountUsd,
    feeLifiUsd: Number(body?.estimate?.feeCosts?.[0]?.amountUSD ?? 0),
    gasUsd: Number(body?.estimate?.gasCosts?.[0]?.amountUSD ?? 0),
  }
}

/** Câmbio real EUR→USD (Frankfurter / ECB). */
export async function readFrankfurter(): Promise<RIBank99FxQuote> {
  const res = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD", {
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error("frankfurter_http_" + res.status)
  const body = await res.json()
  const usdPerEur = body?.rates?.USD
  if (!usdPerEur || usdPerEur <= 0) throw new Error("frankfurter_missing")
  return { usdPerEur }
}

/** Coleta uma amostra completa. Erros de fonte são registrados na amostra. */
export async function collectObservation(idx: number): Promise<RIBank99Observation> {
  const rec: RIBank99Observation = { ts: new Date().toISOString(), idx } as RIBank99Observation
  for (const [key, fn] of Object.entries({
    pool: readPool,
    lifi: readLifi,
    fx: readFrankfurter,
  }) as [keyof Pick<RIBank99Observation, "pool" | "lifi" | "fx">, () => Promise<any>][]) {
    try {
      ;(rec as any)[key] = await fn()
    } catch (e) {
      ;(rec as any)[key] = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  if (rec.pool && "poolEurFor7Usdc" in rec.pool && rec.pool.poolEurFor7Usdc && rec.fx && "usdPerEur" in rec.fx) {
    rec.poolPriceEffUsdPerEur = 7 / rec.pool.poolEurFor7Usdc
    rec.poolFxGapPct = (rec.poolPriceEffUsdPerEur / rec.fx.usdPerEur - 1) * 100
  }
  if (rec.lifi?.ok && rec.fx && "usdPerEur" in rec.fx && rec.lifi.lifiEurFor7Usdc) {
    rec.lifiPriceEffUsdPerEur = 7 / rec.lifi.lifiEurFor7Usdc
    rec.lifiFxGapPct = (rec.lifiPriceEffUsdPerEur / rec.fx.usdPerEur - 1) * 100
  }
  return rec
}

/** Anexa a observação à lista no Redis (append-only, bounded via ltrim). */
export async function appendObservation(redis: Redis, obs: RIBank99Observation): Promise<number> {
  const key = riBank99ObservationsKvKey()
  await redis.rpush(key, JSON.stringify(obs))
  // bounded: mantém só as últimas MAX_OBSERVATIONS (5.000 ≈ 52 dias a cada 15min)
  await redis.ltrim(key, -RIBANK99_MAX_OBSERVATIONS, -1)
  const len = await redis.llen(key)
  return len
}

/** Lê todas as observações coletadas até agora (mais antiga primeiro). */
export async function readObservations(redis: Redis): Promise<RIBank99Observation[]> {
  const key = riBank99ObservationsKvKey()
  const raw = await redis.lrange(key, 0, -1)
  return raw.map((r) => {
    try { return JSON.parse(typeof r === "string" ? r : JSON.stringify(r)) as RIBank99Observation }
    catch { return null }
  }).filter((o): o is RIBank99Observation => o !== null)
}

export { getRedis, isKvConfigured }
