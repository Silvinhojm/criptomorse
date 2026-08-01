// RI-BANK-11 Trilha B — orçamento de trading por janela de tempo (server-side)
//
// WHY THIS EXISTS: RI-BANK-10 Estágio 1 confirmou que o único controle de
// valor que existe hoje (`getPregãoAllowedBalance()`/`setPregãoAllowedBalance()`,
// lib/agentes-do-pregão.ts:400-411) é um teto de SALDO, não um orçamento
// por JANELA DE TEMPO — e é persistido em `localStorage`, invisível para
// qualquer processo server-side (um cron, por exemplo). Este módulo segue o
// mesmo padrão já usado por `lib/nanopayment-system.ts` (dailyLimitDefault/
// dailySpent/lastReset), mas para trading real e com backend Redis, não
// localStorage — mesmo backend já usado pelo circuit breaker e por
// posições abertas (RI-BANK-5).
//
// DECISÃO JÁ TOMADA (Estágio 3 do RI-BANK-10, referenciada no mandato
// RI-BANK-11): reset é SEMPRE manual. Nenhuma função aqui reseta
// `spentToday` automaticamente por tempo — um reset automático à meia-noite
// reintroduziria exatamente o problema que motivou este módulo: um número
// que se autorrenova e perde o efeito de freio.
//
// RI-BANK-14 fechou D3 em $50. O valor é aplicado uma única vez quando o
// campo ainda está ausente/null; uma configuração posterior nunca é
// sobrescrita pela inicialização.

import { getRedis, isKvConfigured, tradingBudgetKvKey } from "./kv"

export type TradingBudgetState = {
  dailyLimitUsd: number | null
  spentToday: number
  lastResetAt: string | null
}

const initialState: TradingBudgetState = {
  dailyLimitUsd: null,
  spentToday: 0,
  lastResetAt: null,
}

export const INITIAL_TRADING_BUDGET_DAILY_USD = 50

const SET_LIMIT_IF_UNCONFIGURED_SCRIPT = `
local current = redis.call('HGET', KEYS[1], 'dailyLimitUsd')
if current == false or current == '' then
  redis.call('HSET', KEYS[1], 'dailyLimitUsd', ARGV[1])
  return ARGV[1]
end
return current
`

// Módulo server-side apenas (mesma convenção de circuit-breaker.ts) — o
// estado em memória é o "fast path" síncrono; getTradingBudgetStateFresh()
// é o read cross-instance real, do Redis.
let state: TradingBudgetState = { ...initialState }

export function getTradingBudgetState(): TradingBudgetState {
  return { ...state }
}

export async function getTradingBudgetStateFresh(): Promise<TradingBudgetState> {
  if (!isKvConfigured()) return { ...state }
  try {
    const hash = await getRedis().hgetall<Record<string, unknown>>(tradingBudgetKvKey())
    if (hash && Object.keys(hash).length > 0) {
      const raw = hash.dailyLimitUsd
      state = {
        dailyLimitUsd: raw === undefined || raw === "" || raw === null ? null : Number(raw as any),
        spentToday: Number(hash.spentToday ?? 0),
        lastResetAt: hash.lastResetAt ? String(hash.lastResetAt) : null,
      }
    }
  } catch (e) {
    console.error("[trading-budget] Redis read failed (getTradingBudgetStateFresh):", (e as Error).message)
  }
  return { ...state }
}

// Define o teto por janela — número real fica para uma decisão explícita
// de D3 (RI-BANK-10), fora do escopo deste mandato.
export async function setTradingBudgetDaily(
  limitUsd: number | null,
  options: { onlyIfUnconfigured?: boolean } = {},
): Promise<void> {
  if (!isKvConfigured()) {
    if (!options.onlyIfUnconfigured || state.dailyLimitUsd === null) state.dailyLimitUsd = limitUsd
    console.warn("[trading-budget] Upstash não configurado — limite somente em memória neste processo.")
    return
  }
  try {
    if (options.onlyIfUnconfigured) {
      const chosen = await getRedis().eval(
        SET_LIMIT_IF_UNCONFIGURED_SCRIPT,
        [tradingBudgetKvKey()],
        [limitUsd === null ? "" : String(limitUsd)],
      )
      state.dailyLimitUsd = chosen === "" || chosen === null ? null : Number(chosen)
      return
    }
    state.dailyLimitUsd = limitUsd
    // HSET de um único campo: uma configuração concorrente não regrava
    // spentToday/lastResetAt a partir de um snapshot obsoleto.
    await getRedis().hset(tradingBudgetKvKey(), {
      dailyLimitUsd: limitUsd === null ? "" : String(limitUsd),
    })
  } catch (e) {
    console.error("[trading-budget] Redis atomic config write failed:", (e as Error).message)
    throw e
  }
}

/** Aplica $50 apenas se ainda não houver uma decisão persistida. */
export async function initializeTradingBudgetDailyLimit(): Promise<TradingBudgetState> {
  await getTradingBudgetStateFresh()
  if (state.dailyLimitUsd === null) {
    await setTradingBudgetDaily(INITIAL_TRADING_BUDGET_DAILY_USD, { onlyIfUnconfigured: true })
  }
  return { ...state }
}

// Síncrona de propósito — chamada no hot path de execução (mesmo padrão de
// blockIfPanicked()), antes de qualquer swap real.
export function isBudgetExceeded(amountUsd: number): boolean {
  if (state.dailyLimitUsd === null) return false
  return state.spentToday + amountUsd > state.dailyLimitUsd
}

// Registra o valor de um trade executado com sucesso contra o acumulado da
// janela — chamado depois de `resultado.success`, não antes (orçamento
// mede exposição de fato deployada, não tentativas).
export async function recordTradingSpend(amountUsd: number): Promise<TradingBudgetState> {
  if (!isKvConfigured()) {
    state.spentToday += amountUsd
    console.warn("[trading-budget] Upstash não configurado — gasto somente em memória neste processo.")
    return { ...state }
  }
  try {
    // Mesmo padrão já validado pelo circuit breaker: o delta é aplicado pelo
    // Redis, sem read-modify-write no processo chamador.
    state.spentToday = Number(
      await getRedis().hincrbyfloat(tradingBudgetKvKey(), "spentToday", amountUsd),
    )
  } catch (e) {
    console.error("[trading-budget] Redis atomic spend increment failed:", (e as Error).message)
    throw e
  }
  return { ...state }
}

// Reset SEMPRE manual — nunca chamado por cron/timer. Ver nota no topo do
// arquivo.
export async function resetTradingBudgetManual(): Promise<TradingBudgetState> {
  state.spentToday = 0
  state.lastResetAt = new Date().toISOString()
  if (!isKvConfigured()) {
    console.warn("[trading-budget] Upstash não configurado — reset somente em memória neste processo.")
    return { ...state }
  }
  try {
    // Um único comando substitui apenas os dois campos pertencentes ao reset.
    await getRedis().hset(tradingBudgetKvKey(), {
      spentToday: "0",
      lastResetAt: state.lastResetAt,
    })
  } catch (e) {
    console.error("[trading-budget] Redis atomic manual reset failed:", (e as Error).message)
    throw e
  }
  return { ...state }
}
