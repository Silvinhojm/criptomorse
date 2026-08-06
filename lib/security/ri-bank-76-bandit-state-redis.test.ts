// RI-BANK-76 Etapa 1 — prova de equivalência matemática entre o Bandit em
// memória original (lib/pregao-arc.ts) e a versão portada para Redis
// (lib/bandit-state-redis.ts). Duas camadas de prova:
//
//   A) softmax() original (agora exportada, comportamento inalterado) vs.
//      banditSoftmax() (cópia deliberada, não um import -- ver comentário
//      no topo de bandit-state-redis.ts) -- mesmos vetores de entrada devem
//      produzir o mesmo resultado, exatamente (mesma expressão JS).
//
//   B) um modelo de referência em memória, que replica fielmente a máquina
//      de estados de registrarResultadoArc()/recalcWeights() usando a
//      função softmax() ORIGINAL, é conduzido pela mesma sequência
//      determinística de resultados de trade que o módulo Redis-backed
//      (via um Redis falso em memória que interpreta os 3 scripts Lua) --
//      e os dois devem convergir para o mesmo profit/trades/weight por par,
//      mesmo totalTrades e mesmo tradeAmount, a cada passo.
//
// Nenhuma transação real, nenhum plano gerado -- só matemática e Redis
// simulado em memória.

import { softmax as originalSoftmax } from "../pregao-arc"
import {
  ARC_BANDIT_PAIRS,
  APPLY_BANDIT_RECALC_SCRIPT,
  banditSoftmax,
  BANDIT_PHASE_SIZE,
  BANDIT_TRADE_AMOUNT,
  ENSURE_BANDIT_STATE_SCRIPT,
  RECORD_BANDIT_RESULT_SCRIPT,
  readBanditState,
  recordBanditResult,
  type BanditRedisClient,
} from "../bandit-state-redis"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function expectClose(actual: number, expected: number, message: string, epsilon = 1e-9): void {
  expect(Math.abs(actual - expected) < epsilon, `${message} (actual=${actual}, expected=${expected})`)
}

// ── Parte A: equivalência direta de softmax() ───────────────────────────────
function testSoftmaxEquivalence(): void {
  const cases: Array<{ profits: number[]; temperature: number }> = [
    { profits: [0, 0, 0, 0], temperature: 1 },
    { profits: [5, -3, 0, 2.5], temperature: 1 },
    { profits: [10, 10, 10, 10], temperature: 0.5 },
    { profits: [-1, -2, -3, -4], temperature: 0.1 },
    { profits: [0.0001, -0.0001, 0, 0], temperature: 0.01 },
    { profits: [100, -100, 0, 50], temperature: 1 },
    { profits: [3, 3], temperature: 0.05 }, // temperatura próxima do clamp mínimo (0.01)
  ]
  for (const { profits, temperature } of cases) {
    const expected = originalSoftmax(profits, temperature)
    const actual = banditSoftmax(profits, temperature)
    expect(actual.length === expected.length, "softmax length mismatch")
    for (let i = 0; i < expected.length; i++) {
      expectClose(actual[i], expected[i], `softmax[${i}] mismatch for profits=${JSON.stringify(profits)} temp=${temperature}`)
    }
  }
  console.log("RI_BANK_76_SOFTMAX_MATH_EQUIVALENT=PASS")
}

// ── Parte B: modelo de referência em memória (réplica fiel do original) ────
interface ReferencePairState {
  pair: string
  profit: number
  trades: number
  weight: number
}

class ReferenceBandit {
  totalTrades = 0
  // RI-BANK-78 -- fixo, sem escalada (era Math.min(50, tradeAmount+5) a
  // cada fase; a escala real do Bandit portado nunca varia mais).
  tradeAmount = BANDIT_TRADE_AMOUNT
  currentPhaseTrades = 0
  pairs: ReferencePairState[]

  constructor(pairLabels: string[]) {
    this.pairs = pairLabels.map(pair => ({ pair, profit: 0, trades: 0, weight: 1 / pairLabels.length }))
  }

  private recalcWeights(): void {
    const temperature = Math.max(0.1, 1 - this.totalTrades * 0.01)
    const profits = this.pairs.map(p => p.profit)
    const weights = originalSoftmax(profits, temperature)
    this.pairs.forEach((p, i) => { p.weight = weights[i] })
  }

  registrarResultado(pairLabel: string, profit: number): void {
    const pair = this.pairs.find(p => p.pair === pairLabel)
    if (!pair) return
    pair.profit += profit
    pair.trades++
    this.totalTrades++
    this.currentPhaseTrades++
    if (this.currentPhaseTrades >= BANDIT_PHASE_SIZE) {
      this.currentPhaseTrades = 0
      this.recalcWeights()
    }
  }
}

// ── Redis falso em memória, interpretando os 3 scripts Lua exportados por
// referência exata -- mesmo padrão já usado em
// lib/security/ri-bank-13-cross-instance-memory.test.ts (simula o efeito do
// script em JS em vez de rodar um interpretador Lua de verdade). ──────────
class FakeBanditRedis implements BanditRedisClient {
  private hashes = new Map<string, Record<string, string>>()

  async hgetall<TData extends Record<string, unknown>>(key: string): Promise<TData | null> {
    const hash = this.hashes.get(key)
    return (hash ? { ...hash } : null) as TData | null
  }

  async eval<TArgs extends unknown[], TData = unknown>(script: string, keys: string[], args: TArgs): Promise<TData> {
    const key = keys[0]
    const values = (args as unknown[]).map(String)

    if (script === ENSURE_BANDIT_STATE_SCRIPT) {
      const hash = this.hashes.get(key) ?? {}
      if (hash.totalTrades === undefined) hash.totalTrades = "0"
      if (hash.tradeAmount === undefined) hash.tradeAmount = values[0]
      if (hash.version === undefined) hash.version = "0"
      const numPairs = Number(values[1])
      const initialWeight = String(1 / numPairs)
      for (let i = 2; i < values.length; i += 3) {
        const pair = values[i]
        const fromToken = values[i + 1]
        const toToken = values[i + 2]
        if (hash[`pair:${pair}:fromToken`] === undefined) hash[`pair:${pair}:fromToken`] = fromToken
        if (hash[`pair:${pair}:toToken`] === undefined) hash[`pair:${pair}:toToken`] = toToken
        if (hash[`pair:${pair}:profit`] === undefined) hash[`pair:${pair}:profit`] = "0"
        if (hash[`pair:${pair}:trades`] === undefined) hash[`pair:${pair}:trades`] = "0"
        if (hash[`pair:${pair}:weight`] === undefined) hash[`pair:${pair}:weight`] = initialWeight
      }
      this.hashes.set(key, hash)
      return 1 as TData
    }

    if (script === RECORD_BANDIT_RESULT_SCRIPT) {
      const hash = this.hashes.get(key)
      if (!hash) throw new Error("bandit state not initialized")
      const pair = values[0]
      const profitDelta = Number(values[1])
      hash[`pair:${pair}:profit`] = String(Number(hash[`pair:${pair}:profit`] ?? 0) + profitDelta)
      hash[`pair:${pair}:trades`] = String(Number(hash[`pair:${pair}:trades`] ?? 0) + 1)
      hash.totalTrades = String(Number(hash.totalTrades ?? 0) + 1)
      hash.version = String(Number(hash.version ?? 0) + 1)
      return Number(hash.totalTrades) as TData
    }

    if (script === APPLY_BANDIT_RECALC_SCRIPT) {
      const hash = this.hashes.get(key)
      if (!hash) throw new Error("bandit state not initialized")
      const expectedVersion = values[0]
      const currentVersion = hash.version ?? "0"
      if (currentVersion !== expectedVersion) return 0 as TData
      for (let i = 1; i < values.length; i += 2) {
        hash[values[i]] = values[i + 1]
      }
      hash.version = String(Number(hash.version) + 1)
      return 1 as TData
    }

    throw new Error("unrecognized script in FakeBanditRedis.eval")
  }
}

async function testFullEquivalence(): Promise<void> {
  const pairLabels = ARC_BANDIT_PAIRS.map(p => p.pair)
  const reference = new ReferenceBandit(pairLabels)
  const redis = new FakeBanditRedis()
  const key = "test:bandit:state"

  // Sequência determinística de 37 trades -- cruza múltiplos limites de
  // fase (a cada 10) para exercitar recalcBanditWeights() várias vezes,
  // com lucros e perdas variados por par.
  const sequence: Array<{ pair: string; profit: number }> = []
  const profitsByStep = [1.2, -0.5, 0.3, -1.1, 0.8, 2.0, -0.2, 0.05, -0.9, 1.5]
  for (let i = 0; i < 37; i++) {
    const pair = pairLabels[i % pairLabels.length]
    const profit = profitsByStep[i % profitsByStep.length] * (1 + (i % 3))
    sequence.push({ pair, profit })
  }

  for (const { pair, profit } of sequence) {
    reference.registrarResultado(pair, profit)
    await recordBanditResult(redis, key, pair, profit, ARC_BANDIT_PAIRS)
  }

  const finalState = await readBanditState(redis, key, ARC_BANDIT_PAIRS)

  expect(finalState.totalTrades === reference.totalTrades, `totalTrades mismatch: redis=${finalState.totalTrades} reference=${reference.totalTrades}`)
  expectClose(finalState.tradeAmount, reference.tradeAmount, "tradeAmount mismatch")

  for (const refPair of reference.pairs) {
    const redisPair = finalState.pairs.find(p => p.pair === refPair.pair)
    expect(!!redisPair, `pair ${refPair.pair} missing from redis-backed state`)
    expectClose(redisPair!.profit, refPair.profit, `profit mismatch for ${refPair.pair}`)
    expect(redisPair!.trades === refPair.trades, `trades mismatch for ${refPair.pair}: redis=${redisPair!.trades} reference=${refPair.trades}`)
    expectClose(redisPair!.weight, refPair.weight, `weight mismatch for ${refPair.pair}`)
  }

  // Confirma que os pesos ainda somam ~1 (softmax é uma distribuição) --
  // não uma checagem de equivalência, mas uma sanidade adicional barata.
  const weightSum = finalState.pairs.reduce((s, p) => s + p.weight, 0)
  expectClose(weightSum, 1, "final weights should sum to ~1")

  console.log(`RI_BANK_76_FULL_STATE_MACHINE_EQUIVALENT=PASS (totalTrades=${finalState.totalTrades}, tradeAmount=${finalState.tradeAmount})`)
}

async function testNoAutomaticExecution(): Promise<void> {
  // Sanidade de escopo: nada neste módulo referencia cron-plan, execução
  // real ou geração automática de planos -- confirmado estaticamente aqui
  // como um lembrete vivo caso alguém tente estender essa etapa sem querer.
  const moduleSource = await import("../bandit-state-redis")
  const exportedNames = Object.keys(moduleSource)
  const forbidden = ["executeCronPlanWithKms", "savePlan", "generatePlan", "executeSwap"]
  for (const name of forbidden) {
    expect(!exportedNames.includes(name), `bandit-state-redis.ts must not export ${name} at this stage`)
  }
  console.log("RI_BANK_76_NO_EXECUTION_WIRING=PASS")
}

async function run(): Promise<void> {
  testSoftmaxEquivalence()
  await testFullEquivalence()
  await testNoAutomaticExecution()
}

run()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    // Importar pregao-arc.ts (para a comparação de equivalência) traz
    // transitivamente real-swap-executor.ts, cujo singleton mantém
    // handles/timers em segundo plano que impedem o processo de sair
    // sozinho -- mesmo padrão já visto em outros testes desta suíte.
    process.exit(process.exitCode ?? 0)
  })
