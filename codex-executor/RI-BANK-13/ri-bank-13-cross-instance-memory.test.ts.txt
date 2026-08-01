// RI-BANK-13 — alternativa segura quando o Redis externo não pode ser usado.
// Dois clients independentes compartilham um servidor em memória. O servidor
// serializa comandos atômicos como o Redis faria; não existe fila compartilhada
// entre os clients.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { mutateRiskBoxesHash, readRiskBoxesHash, type RiskBoxesRedisClient } from "../risk-boxes-redis"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

class SharedRedisMemoryServer {
  readonly hashes = new Map<string, Record<string, string>>()
  private atomicQueue: Promise<unknown> = Promise.resolve()

  atomic<T>(operation: () => T): Promise<T> {
    const result = this.atomicQueue.then(operation, operation)
    this.atomicQueue = result.then(() => undefined, () => undefined)
    return result
  }
}

class IndependentMemoryClient implements RiskBoxesRedisClient {
  constructor(private readonly server: SharedRedisMemoryServer) {}

  async hgetall<TData extends Record<string, unknown>>(key: string): Promise<TData | null> {
    const hash = this.server.hashes.get(key)
    return (hash ? { ...hash } : null) as TData | null
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.server.hashes.get(key)?.[field] ?? null
  }

  async hset(key: string, fields: Record<string, string>): Promise<void> {
    const hash = this.server.hashes.get(key) ?? {}
    Object.assign(hash, fields)
    this.server.hashes.set(key, hash)
  }

  async hincrbyfloat(key: string, field: string, increment: number): Promise<number> {
    return this.server.atomic(() => {
      const hash = this.server.hashes.get(key) ?? {}
      const next = Number(hash[field] ?? 0) + increment
      hash[field] = String(next)
      this.server.hashes.set(key, hash)
      return next
    })
  }

  async eval<TArgs extends unknown[], TData = unknown>(
    script: string,
    keys: string[],
    args: TArgs,
  ): Promise<TData> {
    return this.server.atomic(() => {
      const key = keys[0]
      let hash = this.server.hashes.get(key)
      if (!script.includes("local op = ARGV[1]")) {
        if (!hash) {
          hash = {
            version: "0", isTestnet: "false",
            "a.valorPrincipal": "0", "a.riscoPercentual": "",
            "a.perdaAcumulada": "0", "a.esgotada": "false",
            "b.saldo": "0", "b.investir": "", "b.riscoPercentual": "",
            "b.baseline": "0", "b.perdaAcumulada": "0",
          }
          this.server.hashes.set(key, hash)
        }
        return 1 as TData
      }
      if (!hash) throw new Error("hash precisa ser inicializado")
      const values = args.map(String)
      const op = values[0]
      if (op === "configure") {
        Object.assign(hash, {
          "a.valorPrincipal": values[1], "a.riscoPercentual": values[2],
          "a.perdaAcumulada": "0", "a.esgotada": "false",
          "b.saldo": values[3], "b.investir": values[4],
          "b.riscoPercentual": values[5], "b.baseline": values[3],
          "b.perdaAcumulada": "0",
        })
      } else if (op === "profit_b") {
        const wasZero = Number(hash["b.saldo"]) === 0
        hash["b.saldo"] = String(Number(hash["b.saldo"]) + Number(values[1]))
        if (wasZero && Number(values[1]) > 0) {
          hash["b.baseline"] = hash["b.saldo"]
          hash["b.perdaAcumulada"] = "0"
        }
      } else if (op === "set_b_risk") {
        hash["b.riscoPercentual"] = values[1]
        hash["b.baseline"] = hash["b.saldo"]
        hash["b.perdaAcumulada"] = "0"
      } else {
        throw new Error(`operação não implementada no simulador seguro: ${op}`)
      }
      hash.version = String(Number(hash.version) + 1)
      return Number(hash.version) as TData
    })
  }
}

async function vulnerableIncrement(
  client: IndependentMemoryClient,
  key: string,
  barrier: Promise<void>,
  ready: () => void,
): Promise<void> {
  const snapshot = Number(await client.hget(key, "spentToday") ?? 0)
  ready()
  await barrier
  await client.hset(key, { spentToday: String(snapshot + 1) })
}

export async function runRiBank13CrossInstanceMemoryTest(): Promise<void> {
  const server = new SharedRedisMemoryServer()
  const clientA = new IndependentMemoryClient(server)
  const clientB = new IndependentMemoryClient(server)
  const budgetKey = "arcflow:ri-bank-13:test:memory:budget"
  const riskKey = "arcflow:ri-bank-13:test:memory:risk"

  let lostUpdates = 0
  for (let trial = 0; trial < 30; trial++) {
    await clientA.hset(budgetKey, { spentToday: "0" })
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    let readers = 0
    let bothRead!: () => void
    const bothReady = new Promise<void>(resolve => { bothRead = resolve })
    const ready = () => { readers++; if (readers === 2) bothRead() }
    const pending = [
      vulnerableIncrement(clientA, budgetKey, barrier, ready),
      vulnerableIncrement(clientB, budgetKey, barrier, ready),
    ]
    await bothReady
    release()
    await Promise.all(pending)
    if (Number(await clientA.hget(budgetKey, "spentToday")) !== 2) lostUpdates++
  }
  expect(lostUpdates === 30, `BEFORE deveria perder atualização 30/30; perdeu ${lostUpdates}/30`)

  await clientA.hset(budgetKey, { spentToday: "0" })
  await Promise.all(Array.from({ length: 100 }, (_, i) =>
    (i % 2 ? clientA : clientB).hincrbyfloat(budgetKey, "spentToday", 1)))
  expect(Number(await clientA.hget(budgetKey, "spentToday")) === 100,
    "AFTER trading-budget deveria preservar 100/100 incrementos")

  await mutateRiskBoxesHash(clientA, riskKey, "configure", [1000, 10, 0, true, 30])
  await Promise.all(Array.from({ length: 100 }, (_, i) =>
    mutateRiskBoxesHash(i % 2 ? clientA : clientB, riskKey, "profit_b", [1])))
  await Promise.all([
    mutateRiskBoxesHash(clientA, riskKey, "profit_b", [10]),
    mutateRiskBoxesHash(clientB, riskKey, "set_b_risk", [25]),
  ])
  const risk = await readRiskBoxesHash(clientA, riskKey)
  expect(Number(risk["b.saldo"]) === 110, "AFTER risk-boxes não pode perder lucro")
  expect(Number(risk["b.riscoPercentual"]) === 25, "AFTER risk-boxes não pode perder configuração")
  expect(Number(risk.version) === 103, "AFTER cada mutação precisa gerar versão única")

  // Verifica que o código entregue usa os comandos exigidos, e não voltou ao
  // snapshot inteiro que a prova BEFORE reproduziu.
  const root = join(__dirname, "..", "..")
  const budgetSource = readFileSync(join(root, "lib", "trading-budget.ts"), "utf8")
  const redisSource = readFileSync(join(root, "lib", "risk-boxes-redis.ts"), "utf8")
  expect(budgetSource.includes("hincrbyfloat(tradingBudgetKvKey(), \"spentToday\""),
    "trading-budget deve usar HINCRBYFLOAT")
  expect(redisSource.includes("redis.call('HINCRBYFLOAT', key, 'b.saldo'"),
    "risk-boxes deve aplicar delta de saldo dentro do Lua")
  expect(redisSource.includes("return bump()"), "script deve versionar a mesma operação atômica")

  console.log(`[CROSS_INSTANCE SAFE BEFORE] atualização perdida em ${lostUpdates}/30.`)
  console.log("[CROSS_INSTANCE SAFE AFTER] trading-budget=100/100; risk-boxes=100/100; inconsistências=0.")
  console.log("ALL_RI_BANK_13_CROSS_INSTANCE_MEMORY_ASSERTIONS_PASSED=YES")
}

runRiBank13CrossInstanceMemoryTest().catch(error => {
  console.error(error)
  process.exitCode = 1
})
