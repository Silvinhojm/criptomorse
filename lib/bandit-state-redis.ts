// RI-BANK-76 Etapa 1 — porta o estado de decisão do Bandit (lib/pregao-arc.ts)
// para Redis, sem ainda conectar a nenhuma execução automática. Escopo
// deliberadamente restrito: só estado (profit/trades/weight por par,
// totalTrades, tradeAmount) e a matemática de recálculo de pesos
// (softmax/recalcWeights), lidas/escritas de forma atômica. NÃO gera
// planos, NÃO chama cron-plan, NÃO toca em executeCronPlanWithKms — isso é
// mandato futuro, só depois de validar que este estado funciona sozinho.
//
// Deliberadamente NÃO importa lib/pregao-arc.ts nem lib/real-swap-executor.ts:
// este módulo fica auto-contido (só Redis + matemática pura), para manter o
// raio de ação desta etapa isolado do Bandit em memória e de toda a
// maquinaria de execução real. A lista de pares abaixo espelha
// TRADING_PAIRS.arc (lib/real-swap-executor.ts) por valor — mantenha as
// duas em sincronia se um novo par for adicionado.

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

export const ARC_BANDIT_PAIRS: BanditPairInput[] = [
  { pair: "USDC→EURC", fromToken: "USDC", toToken: "EURC" },
  { pair: "EURC→USDC", fromToken: "EURC", toToken: "USDC" },
  { pair: "cirBTC→USDC", fromToken: "cirBTC", toToken: "USDC" },
  { pair: "cirBTC→EURC", fromToken: "cirBTC", toToken: "EURC" },
]

export const BANDIT_INITIAL_TRADE_AMOUNT = 5
export const BANDIT_MAX_TRADE_AMOUNT = 50
export const BANDIT_TRADE_AMOUNT_STEP = 5
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

function computeNextTradeAmount(current: number): number {
  return Math.min(BANDIT_MAX_TRADE_AMOUNT, current + BANDIT_TRADE_AMOUNT_STEP)
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

// ── Lua: aplica pesos recalculados (e um possível novo tradeAmount) de
// forma atômica, condicionado à versão lida no momento do cálculo (CAS
// otimista) — preparado para um futuro escritor concorrente, mesmo que
// hoje só um processo escreva aqui. Se a versão mudou entre a leitura e a
// escrita, devolve 0 (stale) em vez de sobrescrever um estado mais novo. ───
export const APPLY_BANDIT_RECALC_SCRIPT = `
local key = KEYS[1]
local expectedVersion = ARGV[1]
local newTradeAmount = ARGV[2]
local currentVersion = redis.call('HGET', key, 'version') or '0'
if currentVersion ~= expectedVersion then
  return 0
end
redis.call('HSET', key, 'tradeAmount', newTradeAmount)
for i = 3, #ARGV, 2 do
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
  const argv: string[] = [String(BANDIT_INITIAL_TRADE_AMOUNT), String(pairs.length)]
  for (const p of pairs) argv.push(p.pair, p.fromToken, p.toToken)
  await redis.eval(ENSURE_BANDIT_STATE_SCRIPT, [key], argv)
}

function parseBanditState(hash: Record<string, unknown>, pairs: BanditPairInput[]): BanditState {
  return {
    totalTrades: Number(hash.totalTrades ?? 0),
    tradeAmount: Number(hash.tradeAmount ?? BANDIT_INITIAL_TRADE_AMOUNT),
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
// quando isso deixar de ser verdade. ───────────────────────────────────────
export async function recalcBanditWeights(
  redis: BanditRedisClient,
  key: string,
  pairs: BanditPairInput[] = ARC_BANDIT_PAIRS,
): Promise<BanditState> {
  const state = await readBanditState(redis, key, pairs)
  const temperature = computeTemperature(state.totalTrades)
  const profits = state.pairs.map(p => p.profit)
  const weights = banditSoftmax(profits, temperature)
  const newTradeAmount = computeNextTradeAmount(state.tradeAmount)

  const argv: string[] = [String(state.version), String(newTradeAmount)]
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
// recalcula pesos e aumenta tradeAmount — mesma condição e mesma matemática
// do original, agora persistida. ────────────────────────────────────────────
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
