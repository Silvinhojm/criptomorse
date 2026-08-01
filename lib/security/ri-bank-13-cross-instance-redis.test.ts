// RI-BANK-13 — prova real de coordenação entre dois clientes Redis.
// Não importa corretor, executor, wallet ou qualquer módulo de trade.
// Todas as chaves usam namespace efêmero e são removidas no finally.

import { Redis } from "@upstash/redis"
import { mutateRiskBoxesHash, readRiskBoxesHash } from "../risk-boxes-redis"
import { createTestRedisClient } from "./test-redis-client"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

async function vulnerableReadModifyWrite(
  client: Redis,
  key: string,
  barrier: Promise<void>,
  ready: () => void,
): Promise<void> {
  const snapshot = Number(await client.hget(key, "spentToday") ?? 0)
  ready()
  await barrier
  await client.hset(key, { spentToday: String(snapshot + 1) })
}

export async function runRiBank13CrossInstanceRedisTest(): Promise<void> {
  expect(process.env.VERCEL_ENV !== "production", "teste recusado em VERCEL_ENV=production")
  const clientA = createTestRedisClient()
  const clientB = createTestRedisClient()
  const suffix = `${Date.now()}:${Math.random().toString(16).slice(2)}`
  const prefix = `arcflow:ri-bank-13:test:${suffix}`
  expect(prefix.startsWith("arcflow:ri-bank-13:test:"), "namespace de teste inválido")
  const vulnerableKey = `${prefix}:vulnerable-budget`
  const fixedBudgetKey = `${prefix}:fixed-budget`
  const fixedRiskKey = `${prefix}:fixed-risk-boxes`
  const keys = [vulnerableKey, fixedBudgetKey, fixedRiskKey]

  try {
    // BEFORE: dois clientes leem o mesmo snapshot e ambos gravam snapshot+1.
    let lostUpdates = 0
    for (let trial = 0; trial < 30; trial++) {
      await clientA.hset(vulnerableKey, { spentToday: "0" })
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      let readers = 0
      let bothRead!: () => void
      const bothReady = new Promise<void>(resolve => { bothRead = resolve })
      const ready = () => { readers++; if (readers === 2) bothRead() }
      const operations = [
        vulnerableReadModifyWrite(clientA, vulnerableKey, barrier, ready),
        vulnerableReadModifyWrite(clientB, vulnerableKey, barrier, ready),
      ]
      await bothReady
      release()
      await Promise.all(operations)
      if (Number(await clientA.hget(vulnerableKey, "spentToday")) !== 2) lostUpdates++
    }
    expect(lostUpdates === 30, `BEFORE deveria perder atualização 30/30; perdeu ${lostUpdates}/30`)
    console.log(`[CROSS_INSTANCE BEFORE] atualização perdida em ${lostUpdates}/30.`)

    // AFTER/trading-budget: HINCRBYFLOAT soma no servidor, sem snapshot local.
    await clientA.hset(fixedBudgetKey, { spentToday: "0" })
    const increments = Array.from({ length: 100 }, (_, i) =>
      (i % 2 === 0 ? clientA : clientB).hincrbyfloat(fixedBudgetKey, "spentToday", 1))
    await Promise.all(increments)
    const fixedSpent = Number(await clientA.hget(fixedBudgetKey, "spentToday"))
    expect(fixedSpent === 100, `trading-budget atômico deveria somar 100; veio ${fixedSpent}`)

    // AFTER/risk-boxes: o script Lua combina o delta, invariantes e version.
    await mutateRiskBoxesHash(clientA, fixedRiskKey, "configure", [1000, 10, 0, true, 30])
    const profits = Array.from({ length: 100 }, (_, i) =>
      mutateRiskBoxesHash(i % 2 === 0 ? clientA : clientB, fixedRiskKey, "profit_b", [1]))
    await Promise.all(profits)
    let hash = await readRiskBoxesHash(clientA, fixedRiskKey)
    expect(Number(hash["b.saldo"]) === 100, `Caixa B deveria acumular 100; veio ${hash["b.saldo"]}`)
    expect(Number(hash.version) === 101, `version deveria ser 101; veio ${hash.version}`)

    // Configuração e delta simultâneos precisam equivaler a alguma ordem serial,
    // nunca perder lucro nem a nova configuração.
    await Promise.all([
      mutateRiskBoxesHash(clientA, fixedRiskKey, "profit_b", [10]),
      mutateRiskBoxesHash(clientB, fixedRiskKey, "set_b_risk", [25]),
    ])
    hash = await readRiskBoxesHash(clientA, fixedRiskKey)
    expect(Number(hash["b.saldo"]) === 110, "lucro concorrente não pode ser perdido")
    expect(Number(hash["b.riscoPercentual"]) === 25, "configuração concorrente não pode ser perdida")
    expect(Number(hash.version) === 103, `duas mutações devem gerar duas versões; veio ${hash.version}`)

    console.log("[CROSS_INSTANCE AFTER] trading-budget=100/100; risk-boxes=100/100; inconsistências=0.")
    console.log("ALL_RI_BANK_13_CROSS_INSTANCE_REDIS_ASSERTIONS_PASSED=YES")
  } finally {
    await clientA.del(...keys)
  }
}

runRiBank13CrossInstanceRedisTest().catch(error => {
  console.error(error)
  process.exitCode = 1
})
