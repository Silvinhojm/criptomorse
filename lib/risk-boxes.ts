// RI-BANK-12 — modelo de duas caixas de risco.
//
// Decisões de produto confirmadas em 31/07/2026:
// - Caixa A (principal) e Caixa B (lucro reinvestido) são independentes.
// - configuração inválida ou ausente bloqueia a operação (fail-closed);
// - os mesmos limites são aplicados em mainnet e testnet;
// - o baseline de B é FIXO entre reconfigurações. Ele não acompanha novos
//   picos de saldo. Esse trade-off é consciente: simplifica a explicação e
//   dá mais margem operacional, sem travar lucro intermediário como um
//   high-water mark faria.

import { getRedis, isKvConfigured, riskBoxesKvKey } from "./kv"
import {
  mutateRiskBoxesHash,
  readRiskBoxesHash,
  type RiskBoxesRedisOperation,
} from "./risk-boxes-redis"

export type RiskBoxId = "A" | "B"

export type CaixaAState = {
  valorPrincipal: number
  riscoPercentual: number | null
  perdaAcumulada: number
  esgotada: boolean
}

export type CaixaBState = {
  saldo: number
  investir: boolean | null
  riscoPercentual: number | null
  baseline: number
  perdaAcumulada: number
}

export type RiskBoxesState = {
  version: number
  isTestnet: boolean
  perTradeCapUsd: number
  caixaA: CaixaAState
  caixaB: CaixaBState
}

export type RiskBoxesConfiguration = {
  caixaA: { valorPrincipal: number; riscoPercentual: number }
  caixaB: { saldo: number; investir: boolean; riscoPercentual?: number | null }
}

export type RiskBoxAuthorization = {
  allowed: boolean
  reason: string
}

const initialState: RiskBoxesState = {
  version: 0,
  isTestnet: false,
  // RI-BANK-14: cinto de segurança comum a A e B. É configurável pelo
  // setter dedicado, mas nasce em $15 conforme decisão D3.
  perTradeCapUsd: 15,
  caixaA: { valorPrincipal: 0, riscoPercentual: null, perdaAcumulada: 0, esgotada: false },
  caixaB: { saldo: 0, investir: null, riscoPercentual: null, baseline: 0, perdaAcumulada: 0 },
}

let state: RiskBoxesState = structuredClone(initialState)
let persistenceDisabledForTests = false

function finiteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} deve ser um número finito >= 0 — recebido ${value}`)
  }
}

function validateRisk(value: number, min: number, max: number, field: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${field} deve estar entre ${min}% e ${max}% — recebido ${value}%`)
  }
}

function isConfigured(candidate: RiskBoxesState): boolean {
  if (candidate.caixaA.riscoPercentual === null) return false
  if (candidate.caixaB.investir === null) return false
  if (candidate.caixaB.investir && candidate.caixaB.riscoPercentual === null) return false
  return true
}

export function getRiskBoxesState(): RiskBoxesState {
  return structuredClone(state)
}

export async function getRiskBoxesStateFresh(): Promise<RiskBoxesState> {
  if (persistenceDisabledForTests || !isKvConfigured()) return getRiskBoxesState()
  try {
    state = parseRedisState(await readRiskBoxesHash(getRedis(), riskBoxesKvKey()))
  } catch (e) {
    console.error("[risk-boxes] Redis read failed:", (e as Error).message)
    throw e
  }
  return getRiskBoxesState()
}

function nullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function redisBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1"
}

function parseRedisState(hash: Record<string, unknown>): RiskBoxesState {
  return {
    version: Number(hash.version ?? 0),
    isTestnet: redisBoolean(hash.isTestnet),
    perTradeCapUsd: Number(hash.perTradeCapUsd ?? 15),
    caixaA: {
      valorPrincipal: Number(hash["a.valorPrincipal"] ?? 0),
      riscoPercentual: nullableNumber(hash["a.riscoPercentual"]),
      perdaAcumulada: Number(hash["a.perdaAcumulada"] ?? 0),
      esgotada: redisBoolean(hash["a.esgotada"]),
    },
    caixaB: {
      saldo: Number(hash["b.saldo"] ?? 0),
      investir: hash["b.investir"] === "" || hash["b.investir"] === undefined
        ? null
        : redisBoolean(hash["b.investir"]),
      riscoPercentual: nullableNumber(hash["b.riscoPercentual"]),
      baseline: Number(hash["b.baseline"] ?? 0),
      perdaAcumulada: Number(hash["b.perdaAcumulada"] ?? 0),
    },
  }
}

// Todas as mutações, inclusive configuração e settlement, compartilham a
// mesma fila. Isso elimina a classe A4b dentro do processo: nenhuma leitura
// seguida de await pode ser sobrescrita por outra mutação concorrente.
let mutationQueue: Promise<unknown> = Promise.resolve()
function serialize<T>(run: () => T | Promise<T>): Promise<T> {
  const result = mutationQueue.then(run, run)
  mutationQueue = result.then(() => undefined, () => undefined)
  return result
}

async function mutateAndReturn(
  operation: RiskBoxesRedisOperation,
  args: Array<string | number | boolean>,
  mutateLocal: () => void,
): Promise<RiskBoxesState> {
  if (!persistenceDisabledForTests && isKvConfigured()) {
    try {
      const redis = getRedis()
      await mutateRiskBoxesHash(redis, riskBoxesKvKey(), operation, args)
      state = parseRedisState(await readRiskBoxesHash(redis, riskBoxesKvKey()))
      return getRiskBoxesState()
    } catch (e) {
      console.error("[risk-boxes] Redis atomic mutation failed:", (e as Error).message)
      throw e
    }
  }
  if (!persistenceDisabledForTests) {
    console.warn("[risk-boxes] Upstash não configurado — estado somente em memória neste processo.")
  }
  mutateLocal()
  state.version += 1
  return getRiskBoxesState()
}

/** Configuração canônica e atômica: nunca publica um estado intermediário null. */
export function configureRiskBoxes(config: RiskBoxesConfiguration): Promise<RiskBoxesState> {
  validateRisk(config.caixaA.riscoPercentual, 2, 20, "Risco da Caixa A")
  finiteNonNegative(config.caixaA.valorPrincipal, "valorPrincipal da Caixa A")
  finiteNonNegative(config.caixaB.saldo, "saldo da Caixa B")
  if (config.caixaB.investir) {
    if (config.caixaB.riscoPercentual === null || config.caixaB.riscoPercentual === undefined) {
      throw new Error("Caixa B com investir=true exige riscoPercentual explícito")
    }
    validateRisk(config.caixaB.riscoPercentual, 2, 50, "Risco da Caixa B")
  }

  return serialize(() => mutateAndReturn("configure", [
    config.caixaA.valorPrincipal,
    config.caixaA.riscoPercentual,
    config.caixaB.saldo,
    config.caixaB.investir,
    config.caixaB.investir ? config.caixaB.riscoPercentual! : "",
  ], () => {
    state.caixaA = {
      valorPrincipal: config.caixaA.valorPrincipal,
      riscoPercentual: config.caixaA.riscoPercentual,
      perdaAcumulada: 0,
      esgotada: false,
    }
    state.caixaB = {
      saldo: config.caixaB.saldo,
      investir: config.caixaB.investir,
      riscoPercentual: config.caixaB.investir ? config.caixaB.riscoPercentual! : null,
      baseline: config.caixaB.saldo,
      perdaAcumulada: 0,
    }
  }))
}

// Setters legados mantidos para compatibilidade. Cada chamada é atômica e
// nunca limpa um campo antes de gravar o novo valor.
export function setCaixaAValorPrincipal(valor: number): Promise<RiskBoxesState> {
  finiteNonNegative(valor, "valorPrincipal da Caixa A")
  return serialize(() => mutateAndReturn("set_a_principal", [valor], () => { state.caixaA.valorPrincipal = valor }))
}

export function setCaixaARisco(percentual: number): Promise<RiskBoxesState> {
  validateRisk(percentual, 2, 20, "Risco da Caixa A")
  return serialize(() => mutateAndReturn("set_a_risk", [percentual], () => { state.caixaA.riscoPercentual = percentual }))
}

export function setCaixaBInvestir(investir: boolean): Promise<RiskBoxesState> {
  return serialize(() => mutateAndReturn("set_b_invest", [investir], () => {
    if (investir && state.caixaB.riscoPercentual === null) {
      throw new Error("Caixa B com investir=true exige riscoPercentual já configurado ou configureRiskBoxes() atômico")
    }
    state.caixaB.investir = investir
    if (!investir) state.caixaB.riscoPercentual = null
    state.caixaB.baseline = state.caixaB.saldo
    state.caixaB.perdaAcumulada = 0
  }))
}

export function setCaixaBRisco(percentual: number): Promise<RiskBoxesState> {
  validateRisk(percentual, 2, 50, "Risco da Caixa B")
  return serialize(() => mutateAndReturn("set_b_risk", [percentual], () => {
    state.caixaB.riscoPercentual = percentual
    state.caixaB.baseline = state.caixaB.saldo
    state.caixaB.perdaAcumulada = 0
  }))
}

export function setRiskBoxesPerTradeCap(capUsd: number): Promise<RiskBoxesState> {
  if (!Number.isFinite(capUsd) || capUsd <= 0) {
    throw new RangeError(`teto por trade deve ser um número finito > 0 — recebido ${capUsd}`)
  }
  return serialize(() => mutateAndReturn("set_per_trade_cap", [capUsd], () => {
    state.perTradeCapUsd = capUsd
  }))
}

export function setRiskBoxesTestnetMode(isTestnet: boolean): Promise<RiskBoxesState> {
  return serialize(() => mutateAndReturn("set_mode", [isTestnet], () => {
    if (state.isTestnet !== isTestnet) {
      state.isTestnet = isTestnet
      state.caixaA.perdaAcumulada = 0
      state.caixaA.esgotada = false
      state.caixaB.perdaAcumulada = 0
      state.caixaB.baseline = state.caixaB.saldo
    }
  }))
}

export function resumeCaixaA(): Promise<RiskBoxesState> {
  return serialize(() => mutateAndReturn("resume_a", [], () => {
    state.caixaA.esgotada = false
    state.caixaA.perdaAcumulada = 0
  }))
}

export function podeOperar(): boolean {
  return isConfigured(state)
}

/** Gate específico por origem de capital; chamado antes de qualquer swap. */
export function authorizeRiskBoxTrade(box: RiskBoxId | null | undefined, amountUsd: number): RiskBoxAuthorization {
  if (!isConfigured(state)) return { allowed: false, reason: "risk_boxes_not_configured" }
  if (box !== "A" && box !== "B") return { allowed: false, reason: "risk_box_origin_required" }
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return { allowed: false, reason: "invalid_trade_amount" }
  if (amountUsd > state.perTradeCapUsd) {
    return { allowed: false, reason: "trade_amount_exceeds_per_trade_cap" }
  }

  if (box === "A") {
    if (state.caixaA.esgotada) return { allowed: false, reason: "caixa_a_exhausted" }
    if (state.caixaA.valorPrincipal <= 0) return { allowed: false, reason: "caixa_a_without_principal" }
    return { allowed: true, reason: "authorized" }
  }

  if (state.caixaB.investir !== true) return { allowed: false, reason: "caixa_b_investment_disabled" }
  if (state.caixaB.riscoPercentual === null) return { allowed: false, reason: "caixa_b_risk_not_configured" }
  if (state.caixaB.saldo <= 0) return { allowed: false, reason: "caixa_b_without_balance" }
  if (amountUsd > state.caixaB.saldo) return { allowed: false, reason: "caixa_b_insufficient_balance" }
  return { allowed: true, reason: "authorized" }
}

/** Gate cross-instance: atualiza o snapshot antes da autorização pré-swap. */
export async function authorizeRiskBoxTradeFresh(
  box: RiskBoxId | null | undefined,
  amountUsd: number,
): Promise<RiskBoxAuthorization> {
  await getRiskBoxesStateFresh()
  return authorizeRiskBoxTrade(box, amountUsd)
}

export function registrarPerdaCaixaA(valor: number): Promise<RiskBoxesState> {
  finiteNonNegative(valor, "perda da Caixa A")
  return serialize(() => mutateAndReturn("loss_a", [valor], () => {
    if (state.caixaA.riscoPercentual === null) throw new Error("Caixa A não configurada")
    state.caixaA.perdaAcumulada += valor
    if (state.caixaA.valorPrincipal > 0) {
      const drawdown = (state.caixaA.perdaAcumulada / state.caixaA.valorPrincipal) * 100
      if (drawdown >= state.caixaA.riscoPercentual) state.caixaA.esgotada = true
    }
  }))
}

export function registrarPerdaCaixaB(valor: number): Promise<RiskBoxesState> {
  finiteNonNegative(valor, "perda da Caixa B")
  return serialize(() => mutateAndReturn("loss_b", [valor], () => {
    if (state.caixaB.investir !== true || state.caixaB.riscoPercentual === null) {
      throw new Error("Perda em Caixa B desabilitada/não configurada — o gate pré-trade deveria ter bloqueado")
    }
    state.caixaB.perdaAcumulada += valor
    state.caixaB.saldo = Math.max(0, state.caixaB.saldo - valor)
    if (state.caixaB.baseline > 0) {
      const drawdown = (state.caixaB.perdaAcumulada / state.caixaB.baseline) * 100
      if (drawdown >= state.caixaB.riscoPercentual) {
        state.caixaB.saldo = 0
        state.caixaB.baseline = 0
        state.caixaB.perdaAcumulada = 0
      }
    }
  }))
}

export function registrarLucroCaixaB(valor: number): Promise<RiskBoxesState> {
  finiteNonNegative(valor, "lucro da Caixa B")
  if (valor === 0) return Promise.resolve(getRiskBoxesState())
  return serialize(() => mutateAndReturn("profit_b", [valor], () => {
    const recomeçando = state.caixaB.saldo === 0
    state.caixaB.saldo += valor
    if (recomeçando) {
      state.caixaB.baseline = state.caixaB.saldo
      state.caixaB.perdaAcumulada = 0
    }
    // Deliberadamente NÃO atualiza baseline quando B já tinha saldo.
  }))
}

/** Único roteador de resultado realizado: lucro sempre vai para B. */
export function recordRiskBoxEconomicResult(box: RiskBoxId, profit: number): Promise<RiskBoxesState> {
  if (!Number.isFinite(profit)) throw new RangeError(`profit inválido: ${profit}`)
  if (profit >= 0) return registrarLucroCaixaB(profit)
  return box === "A" ? registrarPerdaCaixaA(Math.abs(profit)) : registrarPerdaCaixaB(Math.abs(profit))
}

/** Test hook protegido: impede qualquer acesso a Redis e restaura memória. */
export async function resetRiskBoxesForTests(): Promise<RiskBoxesState> {
  if (process.env.ARCFLOW_RISK_BOXES_TEST_MODE !== "1") {
    throw new Error("resetRiskBoxesForTests requer ARCFLOW_RISK_BOXES_TEST_MODE=1")
  }
  persistenceDisabledForTests = true
  await mutationQueue
  state = structuredClone(initialState)
  mutationQueue = Promise.resolve()
  return getRiskBoxesState()
}
