// RI-BANK-76 Etapa 1 — porta o estado de decisão do Bandit (lib/pregao-arc.ts)
// para Redis, sem ainda conectar a nenhuma execução automática. Escopo
// deliberadamente restrito: só estado (profit/trades/weight por par,
// totalTrades, tradeAmount) e a matemática de recálculo de pesos
// (softmax/recalcWeights), lidas/escritas de forma atômica. NÃO gera
// planos, NÃO chama cron-plan, NÃO toca em executeCronPlanWithKms — isso é
// mandato futuro, só depois de validar que este estado funciona sozinho.
//
// RI-BANK-78 — a escala original ($5 a $50, herdada de lib/pregao-arc.ts)
// nunca passaria na checagem real de profundidade de pool (RI-BANK-70/72/
// 74): o par mais saudável (USDC/EURC) tem ~$18 de reserva, e a margem de
// 10x exigiria $180 de reserva só para o menor degrau ($5 * 10). Confirmado
// por teste direto contra reservas reais em RI-BANK-77: nenhum par, em
// nenhum patamar, passava. `tradeAmount` agora é fixo e pequeno (o mesmo
// $0,10 já exaustivamente validado na fila real do RI-BANK-71), sem
// escalada automática — o que também elimina de graça o problema do
// RI-BANK-69/77 sobre `materialFingerprint` mudar a cada degrau de valor
// (já que o valor nunca muda, o fingerprint de rota nunca muda por essa
// causa).
//
// Deliberadamente NÃO importa lib/pregao-arc.ts nem lib/real-swap-executor.ts:
// este módulo fica auto-contido (só Redis + matemática pura), para manter o
// raio de ação desta etapa isolado do Bandit em memória e de toda a
// maquinaria de execução real. Importa lib/route-verifier.ts apenas para o
// critério de elegibilidade (RI-BANK-78 item 2) — módulo igualmente leve,
// sem KMS/execução, já usado como dependência por real-swap-executor.ts. A
// lista de pares abaixo espelha TRADING_PAIRS.arc (lib/real-swap-executor.ts)
// por valor — mantenha as duas em sincronia se um novo par for adicionado.

import type { ethers } from "ethers"

import { hasSufficientPoolDepth, type PoolDepthCheck } from "./route-verifier"

export interface BanditPairInput {
  pair: string
  fromToken: string
  toToken: string
}

export interface BanditPairState extends BanditPairInput {
  profit: number
  trades: number
  weight: number
}

export interface BanditState {
  totalTrades: number
  tradeAmount: number
  version: number
  pairs: BanditPairState[]
}

// RI-BANK-78 — cirBTC→EURC removido deliberadamente: não existe pool direto
// para esse par em KNOWN_POOLS (lib/route-verifier.ts), só USDC/EURC e
// USDC/cirBTC — e hasSufficientPoolDepth() não faz roteamento multi-hop
// (cirBTC→USDC→EURC). Confirmado no RI-BANK-77 que essa chamada sempre
// devolve kind:"no_known_pool", nunca "sufficient". Sem suporte a rota
// multi-hop na checagem de liquidez, esse par é estruturalmente inviável
// hoje — não é um caso de "baixa liquidez", é um caso de "sem rota
// verificável nenhuma". Reintroduzir requer primeiro dar suporte a
// verificação de profundidade em duas pernas.
export const ARC_BANDIT_PAIRS: BanditPairInput[] = [
  { pair: "USDC→EURC", fromToken: "USDC", toToken: "EURC" },
  { pair: "EURC→USDC", fromToken: "EURC", toToken: "USDC" },
  { pair: "cirBTC→USDC", fromToken: "cirBTC", toToken: "USDC" },
]

// RI-BANK-78 — fixo, sem escalada automática (ver comentário de topo).
export const BANDIT_TRADE_AMOUNT = 0.10

// hasSufficientPoolDepth() (lib/route-verifier.ts) espera endereços de
// token, não símbolos -- compara contra KNOWN_POOLS, que é indexado por
// endereço. Os pares acima usam símbolos (mais legíveis no estado/rota de
// leitura, mesmo padrão de lib/pregao-arc.ts), então precisamos resolver
// símbolo → endereço antes de chamar a checagem de profundidade. Mesmos
// endereços já hardcoded em NETWORKS.arc.tokens (lib/real-swap-executor.ts)
// e em KNOWN_POOLS (lib/route-verifier.ts) — cópia por valor, não um
// import, pelo mesmo motivo de isolamento explicado no topo do arquivo.
const ARC_TOKEN_ADDRESSES: Record<string, string> = {
  USDC: "0x3600000000000000000000000000000000000000",
  EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  cirBTC: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
}

function resolveArcTokenAddress(symbol: string): string {
  const address = ARC_TOKEN_ADDRESSES[symbol]
  if (!address) throw new Error(`bandit-state-redis: unknown Arc token symbol "${symbol}"`)
  return address
}
export const BANDIT_PHASE_SIZE = 10

export interface BanditRedisClient {
  eval<TArgs extends unknown[], TData = unknown>(script: string, keys: string[], args: TArgs): Promise<TData>
  hgetall<TData extends Record<string, unknown>>(key: string): Promise<TData | null>
}

// ── Matemática pura (idêntica à de lib/pregao-arc.ts) ───────────────────────
// Cópia deliberada, não um import: mantém este módulo livre de qualquer
// dependência do Bandit em memória ou de real-swap-executor.ts. A
// equivalência com o original é garantida por teste de regressão
// (lib/security/ri-bank-76-bandit-state-redis.test.ts), que importa a
// função original (agora exportada) e compara resultado a resultado.
export function banditSoftmax(profits: number[], temperature: number): number[] {
  const max = Math.max(...profits, 0)
  const exps = profits.map(p => Math.exp((p - max) / Math.max(temperature, 0.01)))
  const sum = exps.reduce((s, e) => s + e, 0)
  return exps.map(e => e / sum)
}

function computeTemperature(totalTrades: number): number {
  return Math.max(0.1, 1 - totalTrades * 0.01)
}

// RI-BANK-78 item 2 — mesmo critério que hasSufficientPoolDepth() já aplica
// internamente (reserva do lado stable >= 10x o valor do trade), exposto
// aqui como uma checagem explícita de elegibilidade ANTES de escolher um
// par, em vez de só descobrir depois, no gate de execução, que o par
// escolhido nunca ia passar. Reaproveita hasSufficientPoolDepth() em vez de
// duplicar a conta — a mesma matemática, a mesma fonte de verdade.
export interface BanditPairEligibility {
  pair: BanditPairInput
  eligible: boolean
  check: PoolDepthCheck
}

export async function evaluateBanditPairEligibility(
  provider: ethers.Provider,
  tradeAmount: number,
  pairs: BanditPairInput[] = ARC_BANDIT_PAIRS,
): Promise<BanditPairEligibility[]> {
  const results: BanditPairEligibility[] = []
  for (const pair of pairs) {
    const fromAddress = resolveArcTokenAddress(pair.fromToken)
    const toAddress = resolveArcTokenAddress(pair.toToken)
    const check = await hasSufficientPoolDepth(provider, fromAddress, toAddress, tradeAmount, "arc")
    results.push({ pair, eligible: check.sufficient, check })
  }
  return results
}

/** Só os pares que hoje realmente passariam na checagem de profundidade
 *  para este valor de trade — "vale a pena tentar", não "existe o par". */
export async function getEligibleBanditPairs(
  provider: ethers.Provider,
  tradeAmount: number,
  pairs: BanditPairInput[] = ARC_BANDIT_PAIRS,
): Promise<BanditPairInput[]> {
  const evaluated = await evaluateBanditPairEligibility(provider, tradeAmount, pairs)
  return evaluated.filter(e => e.eligible).map(e => e.pair)
}

// RI-BANK-79 — porte fiel de pickPair() (lib/pregao-arc.ts): sorteio
// ponderado por cumulative sum, mesmo fallback para o último item se `r`
// exceder a soma acumulada (protege contra imprecisão de ponto flutuante
// deixando a soma de pesos ligeiramente abaixo de 1). Genérico (não amarrado
// a BanditPairState) e com fonte de aleatoriedade injetável — o algoritmo é
// idêntico ao original, só a entropia é parametrizável, para permitir teste
// determinístico sem mockar Math.random global.
export function pickBanditPairByWeight<T extends { weight: number }>(
  weighted: T[],
  randomFn: () => number = Math.random,
): T {
  const r = randomFn()
  let cumulative = 0
  for (const item of weighted) {
    cumulative += item.weight
    if (r <= cumulative) return item
  }
  return weighted[weighted.length - 1]
}

export interface BanditDecision {
  decided: boolean
  pair?: BanditPairInput
  reason?: string
  evaluated: BanditPairEligibility[]
}

// RI-BANK-79 — decisão real do Bandit: lê o estado persistido (pesos
// aprendidos até agora), avalia elegibilidade de cada par contra a
// liquidez real (mesma fonte de verdade do gate de execução), e sorteia
// por peso ENTRE os pares elegíveis apenas — não sorteia primeiro e
// descobre depois que o par escolhido não valia a pena (RI-BANK-77/78).
// Os pesos dos elegíveis são renormalizados para somar 1 antes do sorteio,
// preservando a proporção relativa entre eles sem viés artificial de
// "sobra" de peso dos pares descartados. Não escreve nada — quem decide
// escrever o plano é o chamador (a rota), depois de confirmar a decisão.
export async function decideBanditPair(
  provider: ethers.Provider,
  redis: BanditRedisClient,
  key: string,
  tradeAmount: number = BANDIT_TRADE_AMOUNT,
  pairs: BanditPairInput[] = ARC_BANDIT_PAIRS,
  randomFn: () => number = Math.random,
): Promise<BanditDecision> {
  const state = await readBanditState(redis, key, pairs)
  const evaluated = await evaluateBanditPairEligibility(provider, tradeAmount, pairs)

  const eligiblePairStates = state.pairs.filter(p =>
    evaluated.find(e => e.pair.pair === p.pair)?.eligible === true,
  )

  if (eligiblePairStates.length === 0) {
    return { decided: false, reason: "no_eligible_pair", evaluated }
  }

  const totalWeight = eligiblePairStates.reduce((sum, p) => sum + p.weight, 0)
  const normalized = eligiblePairStates.map(p => ({
    ...p,
    weight: totalWeight > 0 ? p.weight / totalWeight : 1 / eligiblePairStates.length,
  }))
  const chosen = pickBanditPairByWeight(normalized, randomFn)

  return {
    decided: true,
    pair: { pair: chosen.pair, fromToken: chosen.fromToken, toToken: chosen.toToken },
    evaluated,
  }
}

// ── Nomenclatura de campos na hash ──────────────────────────────────────────
function pairProfitField(pair: string): string { return `pair:${pair}:profit` }
function pairTradesField(pair: string): string { return `pair:${pair}:trades` }
function pairWeightField(pair: string): string { return `pair:${pair}:weight` }

// ── Lua: inicialização idempotente (mesmo padrão de risk-boxes-redis.ts:
// HSETNX por campo, nunca sobrescreve estado já existente) ─────────────────
export const ENSURE_BANDIT_STATE_SCRIPT = `
local key = KEYS[1]
redis.call('HSETNX', key, 'totalTrades', '0')
redis.call('HSETNX', key, 'tradeAmount', ARGV[1])
redis.call('HSETNX', key, 'version', '0')
local numPairs = tonumber(ARGV[2])
local initialWeight = tostring(1 / numPairs)
for i = 3, #ARGV, 3 do
  local pair = ARGV[i]
  local fromToken = ARGV[i + 1]
  local toToken = ARGV[i + 2]
  redis.call('HSETNX', key, 'pair:' .. pair .. ':fromToken', fromToken)
  redis.call('HSETNX', key, 'pair:' .. pair .. ':toToken', toToken)
  redis.call('HSETNX', key, 'pair:' .. pair .. ':profit', '0')
  redis.call('HSETNX', key, 'pair:' .. pair .. ':trades', '0')
  redis.call('HSETNX', key, 'pair:' .. pair .. ':weight', initialWeight)
end
return 1
`

// ── Lua: registra o resultado de um trade, atomicamente (equivalente a
// registrarResultadoArc() sem a parte de recálculo de pesos, que precisa da
// matemática em JS — ver recalcBanditWeights() abaixo). Devolve o
// totalTrades já incrementado, para o chamador decidir sem uma segunda
// ida-e-volta se cruzou um limite de fase (totalTrades % PHASE_SIZE === 0,
// equivalente ao currentPhaseTrades>=10 do original, já que os dois sempre
// andam em lockstep e resetam juntos). ─────────────────────────────────────
export const RECORD_BANDIT_RESULT_SCRIPT = `
local key = KEYS[1]
local pair = ARGV[1]
local profitDelta = ARGV[2]
redis.call('HINCRBYFLOAT', key, 'pair:' .. pair .. ':profit', profitDelta)
redis.call('HINCRBY', key, 'pair:' .. pair .. ':trades', 1)
local totalTrades = redis.call('HINCRBY', key, 'totalTrades', 1)
redis.call('HINCRBY', key, 'version', 1)
return totalTrades
`

// ── Lua: aplica pesos recalculados de forma atômica, condicionado à versão
// lida no momento do cálculo (CAS otimista) — preparado para um futuro
// escritor concorrente, mesmo que hoje só um processo escreva aqui. Se a
// versão mudou entre a leitura e a escrita, devolve 0 (stale) em vez de
// sobrescrever um estado mais novo. RI-BANK-78: não escreve mais
// `tradeAmount` — o valor é fixo (ver BANDIT_TRADE_AMOUNT), nunca escalado
// por este script. ──────────────────────────────────────────────────────
export const APPLY_BANDIT_RECALC_SCRIPT = `
local key = KEYS[1]
local expectedVersion = ARGV[1]
local currentVersion = redis.call('HGET', key, 'version') or '0'
if currentVersion ~= expectedVersion then
  return 0
end
for i = 2, #ARGV, 2 do
  redis.call('HSET', key, ARGV[i], ARGV[i + 1])
end
redis.call('HINCRBY', key, 'version', 1)
return 1
`

export async function ensureBanditState(
  redis: BanditRedisClient,
  key: string,
  pairs: BanditPairInput[] = ARC_BANDIT_PAIRS,
): Promise<void> {
  const argv: string[] = [String(BANDIT_TRADE_AMOUNT), String(pairs.length)]
  for (const p of pairs) argv.push(p.pair, p.fromToken, p.toToken)
  await redis.eval(ENSURE_BANDIT_STATE_SCRIPT, [key], argv)
}

function parseBanditState(hash: Record<string, unknown>, pairs: BanditPairInput[]): BanditState {
  return {
    totalTrades: Number(hash.totalTrades ?? 0),
    tradeAmount: Number(hash.tradeAmount ?? BANDIT_TRADE_AMOUNT),
    version: Number(hash.version ?? 0),
    pairs: pairs.map(p => ({
      pair: p.pair,
      fromToken: p.fromToken,
      toToken: p.toToken,
      profit: Number(hash[pairProfitField(p.pair)] ?? 0),
      trades: Number(hash[pairTradesField(p.pair)] ?? 0),
      weight: Number(hash[pairWeightField(p.pair)] ?? 1 / pairs.length),
    })),
  }
}

export async function readBanditState(
  redis: BanditRedisClient,
  key: string,
  pairs: BanditPairInput[] = ARC_BANDIT_PAIRS,
): Promise<BanditState> {
  await ensureBanditState(redis, key, pairs)
  const hash = (await redis.hgetall<Record<string, unknown>>(key)) ?? {}
  return parseBanditState(hash, pairs)
}

// ── Equivalente a recalcWeights(): lê o estado atual, recalcula pesos com
// a mesma matemática (softmax sobre profit, temperatura decrescente com
// totalTrades), e escreve tudo atomicamente, condicionado à versão lida.
// Lança em caso de escrita obsoleta (stale write) — hoje impossível de
// ocorrer de verdade com um único escritor, mas o caminho já existe para
// quando isso deixar de ser verdade. RI-BANK-78: não mexe mais em
// tradeAmount — fixo, sem escalada. ─────────────────────────────────────
export async function recalcBanditWeights(
  redis: BanditRedisClient,
  key: string,
  pairs: BanditPairInput[] = ARC_BANDIT_PAIRS,
): Promise<BanditState> {
  const state = await readBanditState(redis, key, pairs)
  const temperature = computeTemperature(state.totalTrades)
  const profits = state.pairs.map(p => p.profit)
  const weights = banditSoftmax(profits, temperature)

  const argv: string[] = [String(state.version)]
  state.pairs.forEach((p, i) => {
    argv.push(pairWeightField(p.pair), String(weights[i]))
  })

  const applied = Number(await redis.eval(APPLY_BANDIT_RECALC_SCRIPT, [key], argv))
  if (applied !== 1) {
    throw new Error("bandit_state_stale_write: version changed between read and recalc apply — retry")
  }
  return readBanditState(redis, key, pairs)
}

// ── Equivalente a registrarResultadoArc(): registra o resultado de um
// trade e, ao cruzar um limite de fase (a cada BANDIT_PHASE_SIZE trades),
// recalcula pesos — mesma condição e mesma matemática do original, agora
// persistida. RI-BANK-78: já não aumenta tradeAmount (fixo, sem escalada).
// ────────────────────────────────────────────────────────────────────────
export async function recordBanditResult(
  redis: BanditRedisClient,
  key: string,
  pairLabel: string,
  profit: number,
  pairs: BanditPairInput[] = ARC_BANDIT_PAIRS,
): Promise<BanditState> {
  await ensureBanditState(redis, key, pairs)
  const totalTrades = Number(
    await redis.eval(RECORD_BANDIT_RESULT_SCRIPT, [key], [pairLabel, String(profit)]),
  )
  if (totalTrades % BANDIT_PHASE_SIZE === 0) {
    return recalcBanditWeights(redis, key, pairs)
  }
  return readBanditState(redis, key, pairs)
}
