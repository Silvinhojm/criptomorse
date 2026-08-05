import { ethers } from "ethers"

import { withRetries, BACKUP_RPCS } from "./network-resilience"

const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11"

const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[])",
]

const ERC20_BALANCE_ABI = "function balanceOf(address owner) view returns (uint256)"

// RI-BANK-74 — o pool real (contracts/GenericAMMPair.sol) não é um par
// Uniswap V2 padrão: não implementa `getReserves()` (seletor 0x0902f1ac).
// Reservas são duas variáveis públicas separadas, `reserve0`/`reserve1`
// (uint256, não uint112), cada uma com seu próprio getter auto-gerado.
// RI-BANK-73 confirmou isso lendo o bytecode on-chain (eth_getCode) e
// testando os seletores reais (0x443cb4bc/0x5a76f25e) contra o pool
// USDC/EURC — a checagem de profundidade (RI-BANK-70/72) vinha chamando um
// seletor que nunca existiu nesse contrato, revertendo sempre, em todo RPC.
const POOL_RESERVES_ABI = [
  "function reserve0() view returns (uint256)",
  "function reserve1() view returns (uint256)",
]

interface PoolEntry {
  address: string
  token0: string
  token1: string
  fee: number
  stablecoin: boolean
}

const ARC_CHAIN_ID = 5042002
const POLYGON_CHAIN_ID = 137

const ARC_USDC = "0x3600000000000000000000000000000000000000".toLowerCase()
const ARC_EURC = "0x89b50855aa3be2f677cd6303cec089b5f319d72a".toLowerCase()
const ARC_CIRBTC = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF".toLowerCase()
const ARC_MCIRBTC = "0x8cad4951192853D14f8Cb813695146b5Ae00EA6d".toLowerCase()

const ARC_AMM_PAIR = "0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb".toLowerCase()
const ARC_CIRBTC_POOL = "0x185556c077c95FC07498FEd4D4faF03b6EE30C5C".toLowerCase()

const SYMBOL_TO_ADDRESS: Record<string, string> = {
  usdc: ARC_USDC,
  eurc: ARC_EURC,
  cirbtc: ARC_CIRBTC,
  mcirbtc: ARC_MCIRBTC,
}

const STABLECOINS = new Set([
  ARC_USDC, ARC_EURC,
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
  "0x07865c6e87b9f70255377e024ace6630c1eaa37f",
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
])

const KNOWN_POOLS: Record<number, PoolEntry[]> = {
  [ARC_CHAIN_ID]: [
    { address: ARC_AMM_PAIR, token0: ARC_USDC, token1: ARC_EURC, fee: 0.003, stablecoin: true },
    { address: ARC_CIRBTC_POOL, token0: ARC_USDC, token1: ARC_CIRBTC, fee: 0.003, stablecoin: false },
  ],
  [POLYGON_CHAIN_ID]: [],
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000"

// ── Per-pair circuit breaker ──────────────────────────────────────────────────
// Bloqueia um par após N falhas consecutivas de rota, por 30 minutos
const ROUTE_FAILURE_THRESHOLD = 5
const ROUTE_COOLDOWN_MS = 30 * 60 * 1000
const routeFailures = new Map<string, { count: number; blockedUntil: number }>()

function routeKey(token: string, network: string): string {
  return `${token.toLowerCase()}:${network}`
}

export function isRouteBlocked(token: string, network: string): boolean {
  const k = routeKey(token, network)
  const entry = routeFailures.get(k)
  if (!entry) return false
  if (Date.now() >= entry.blockedUntil) {
    routeFailures.delete(k)
    return false
  }
  return true
}

export function recordRouteFailure(token: string, network: string): void {
  const k = routeKey(token, network)
  const entry = routeFailures.get(k) ?? { count: 0, blockedUntil: 0 }
  entry.count++
  if (entry.count >= ROUTE_FAILURE_THRESHOLD) {
    entry.blockedUntil = Date.now() + ROUTE_COOLDOWN_MS
    console.warn(`[ROUTE] 🚫 Par ${k} bloqueado por ${ROUTE_COOLDOWN_MS / 60000}min (${entry.count} falhas consecutivas)`)
  }
  routeFailures.set(k, entry)
}

export function resetRouteFailures(token?: string, network?: string): void {
  if (token && network) {
    routeFailures.delete(routeKey(token, network))
  } else {
    routeFailures.clear()
  }
}

let cache: Record<string, { result: boolean; timestamp: number }> = {}
const CACHE_TTL = 60_000

function key(token: string, network: string): string {
  return `${token.toLowerCase()}:${network}`
}

export function hasSellRoute(token: string, networkKey: string): boolean {
  if (isRouteBlocked(token, networkKey)) return false
  const k = key(token, networkKey)
  const cached = cache[k]
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result
  }
  const result = checkSellRouteImpl(token, networkKey)
  cache[k] = { result, timestamp: Date.now() }
  return result
}

function checkSellRouteImpl(token: string, networkKey: string): boolean {
  let t = token.toLowerCase()
  // Resolve símbolo → endereço (callers podem passar "cirBTC" em vez do hex)
  if (SYMBOL_TO_ADDRESS[t]) t = SYMBOL_TO_ADDRESS[t]
  if (STABLECOINS.has(t)) return true
  if (networkKey === "arc") {
    for (const pool of KNOWN_POOLS[ARC_CHAIN_ID]) {
      if (pool.token0 === t || pool.token1 === t) return true
    }
    return false
  }
  if (networkKey === "polygon") {
    return true
  }
  return false
}

// RI-BANK-70 — checagem de profundidade de pool, proporcional ao valor do
// trade, conectada ao caminho real usado pelo Bandit/execução testnet
// (real-swap-executor.ts chama isso antes de qualquer swap AMM-direto).
//
// hasSellRoute()/checkSellRouteImpl() acima só confirmam que um pool
// EXISTE — nada dizem sobre se ele aguenta o trade sem ser esvaziado.
// checkRouteViaMulticall() (abaixo) já fazia uma checagem de reservas, mas
// só é chamada no pipeline mainnet (agentes-do-pregão.ts), que não roda em
// Arc Testnet, e usa um limiar fixo quase nulo (1n) — não proporcional ao
// trade. Caso real que motivou esta correção: o pool USDC/cirBTC tem hoje
// ~$1 de liquidez total; o menor trade do Bandit ($5) já é 5x o pool
// inteiro (RI-BANK-69).
const LIQUIDITY_DEPTH_MULTIPLIER = 10
// Múltiplo escolhido por julgamento conservador, não um modelo preciso de
// price impact: exigir que a reserva do lado stable do pool seja pelo
// menos 10x o valor do trade mantém o impacto de preço de um swap
// constant-product (x*y=k) abaixo de ~10% no pior caso realista para essa
// proporção, com boa margem de segurança para os pares operados hoje.
const RESERVE_CACHE_TTL_MS = 30_000
const reserveCache: Record<string, { reserve0: bigint; reserve1: bigint; timestamp: number }> = {}

// RI-BANK-72 — `kind` distingue "sem liquidez real" de "não conseguimos
// nem verificar". RI-BANK-71 encontrou a versão anterior desta função
// (retry local de 3 tentativas, só contra `provider`) bloqueando um trade
// genuinamente seguro (pool saudável, ~$17,78) porque o RPC público da Arc
// Testnet falhou de forma intermitente na leitura de `getReserves()` — a
// mesma classe de instabilidade já resolvida para saldo (RI-BANK-50/62/63),
// só que reaplicada aqui de forma mais fraca. A mensagem final também
// misturava as duas causas sob o mesmo rótulo "Liquidez insuficiente",
// escondendo que era uma falha de RPC, não de liquidez de verdade — mesmo
// padrão de mascaramento já corrigido em outro lugar (RI-BANK-46/55).
export type PoolDepthCheckKind =
  | "ok"
  | "insufficient_liquidity"
  | "verification_failed"
  | "no_known_pool"
  | "no_stable_side"
  | "not_applicable"

export interface PoolDepthCheck {
  sufficient: boolean
  kind: PoolDepthCheckKind
  reason: string
  poolAddress?: string
  stableReserveUsd?: number
}

async function readReserves(provider: ethers.Provider, poolAddress: string): Promise<{ reserve0: bigint; reserve1: bigint }> {
  const pool = new ethers.Contract(poolAddress, POOL_RESERVES_ABI, provider)
  const [reserve0, reserve1] = await Promise.all([pool.reserve0(), pool.reserve1()])
  return { reserve0: BigInt(reserve0), reserve1: BigInt(reserve1) }
}

/** Mesma robustez já validada para leitura de saldo (RI-BANK-50/62/63):
 *  `withRetries()` no provider principal e, se ele se esgotar, tenta cada
 *  `BACKUP_RPCS[networkKey]` em sequência (provider dedicado, chainId
 *  fixado via `staticNetwork` para evitar o problema do RI-BANK-56). */
async function getReservesResilient(
  provider: ethers.Provider,
  poolAddress: string,
  networkKey: string,
  chainId: number,
): Promise<{ reserve0: bigint; reserve1: bigint }> {
  const cached = reserveCache[poolAddress]
  if (cached && Date.now() - cached.timestamp < RESERVE_CACHE_TTL_MS) {
    return { reserve0: cached.reserve0, reserve1: cached.reserve1 }
  }

  const attempts: Array<() => Promise<{ reserve0: bigint; reserve1: bigint }>> = [
    () => withRetries(() => readReserves(provider, poolAddress)),
    ...(BACKUP_RPCS[networkKey] ?? []).map(rpcUrl => async () => {
      const backupProvider = new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true })
      return withRetries(() => readReserves(backupProvider, poolAddress))
    }),
  ]

  let lastError: unknown
  for (const attempt of attempts) {
    try {
      const { reserve0, reserve1 } = await attempt()
      reserveCache[poolAddress] = { reserve0, reserve1, timestamp: Date.now() }
      return { reserve0, reserve1 }
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}

/** Bloqueia (fail-closed) sempre que a profundidade não puder ser
 *  confirmada como suficiente — nunca deixa passar silenciosamente por
 *  falta de dado. Só implementada para Arc hoje (onde o caminho AMM-direto
 *  é realmente usado); outras redes retornam `sufficient: true` porque
 *  passam por LI.FI/agregadores com sua própria proteção de slippage. */
export async function hasSufficientPoolDepth(
  provider: ethers.Provider,
  fromToken: string,
  toToken: string,
  amountUsd: number,
  networkKey: string,
): Promise<PoolDepthCheck> {
  if (networkKey !== "arc") {
    return { sufficient: true, kind: "not_applicable", reason: "check_not_implemented_outside_arc" }
  }

  const from = fromToken.toLowerCase()
  const to = toToken.toLowerCase()
  const pool = KNOWN_POOLS[ARC_CHAIN_ID]?.find(
    p => (p.token0 === from && p.token1 === to) || (p.token0 === to && p.token1 === from),
  )
  if (!pool) {
    return { sufficient: false, kind: "no_known_pool", reason: "nenhum pool conhecido para este par" }
  }

  let reserve0: bigint, reserve1: bigint
  try {
    ;({ reserve0, reserve1 } = await getReservesResilient(provider, pool.address, networkKey, ARC_CHAIN_ID))
  } catch (e) {
    return {
      sufficient: false,
      kind: "verification_failed",
      reason: `não foi possível ler as reservas do pool após tentar o RPC primário e ${(BACKUP_RPCS[networkKey] ?? []).length} backups: ${(e as Error)?.message ?? String(e)}`,
      poolAddress: pool.address,
    }
  }

  const stableIsToken0 = STABLECOINS.has(pool.token0)
  const stableIsToken1 = STABLECOINS.has(pool.token1)
  if (!stableIsToken0 && !stableIsToken1) {
    return { sufficient: false, kind: "no_stable_side", reason: "nenhum lado do pool é uma stablecoin conhecida — sem como medir profundidade em USD", poolAddress: pool.address }
  }

  const stableReserveRaw = stableIsToken0 ? reserve0 : reserve1
  const stableReserveUsd = parseFloat(ethers.formatUnits(stableReserveRaw, 6)) // USDC/EURC na Arc, 6 casas
  const requiredUsd = amountUsd * LIQUIDITY_DEPTH_MULTIPLIER

  if (stableReserveUsd < requiredUsd) {
    return {
      sufficient: false,
      kind: "insufficient_liquidity",
      reason: `pool tem $${stableReserveUsd.toFixed(4)}, trade de $${amountUsd.toFixed(2)} exige pelo menos $${requiredUsd.toFixed(2)} (${LIQUIDITY_DEPTH_MULTIPLIER}x)`,
      poolAddress: pool.address,
      stableReserveUsd,
    }
  }
  return { sufficient: true, kind: "ok", reason: "ok", poolAddress: pool.address, stableReserveUsd }
}

export async function checkRouteViaMulticall(
  provider: ethers.Provider,
  chainId: number,
  buyToken: string,
  minReserve0?: bigint,
  minReserve1?: bigint,
): Promise<{ hasRoute: boolean; poolAddress?: string }> {
  const pools = KNOWN_POOLS[chainId]
  if (!pools || pools.length === 0) {
    return { hasRoute: false }
  }
  const relevant = pools.filter(p =>
    p.token0 === buyToken.toLowerCase() || p.token1 === buyToken.toLowerCase()
  )
  if (relevant.length === 0) {
    return { hasRoute: false }
  }
  try {
    // RI-BANK-74 — mesma correção de ABI de readReserves(): reserve0()/
    // reserve1() são getters separados (uint256), não um getReserves()
    // combinado. allowFailure:true aqui é o motivo pelo qual esse bug nunca
    // apareceu como erro visível: uma chamada com o seletor errado
    // simplesmente virava `success:false` silenciosamente, e o loop abaixo
    // seguia adiante como se o pool não tivesse rota — nunca lançava
    // exceção, nunca logava nada.
    const iface = new ethers.Interface(POOL_RESERVES_ABI)
    const calls = relevant.flatMap(p => [
      { target: p.address, allowFailure: true, callData: iface.encodeFunctionData("reserve0") },
      { target: p.address, allowFailure: true, callData: iface.encodeFunctionData("reserve1") },
    ])
    const mc = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider)
    const returnData = await mc.aggregate3.staticCall(calls)
    for (let i = 0; i < relevant.length; i++) {
      const r0 = returnData[i * 2]
      const r1 = returnData[i * 2 + 1]
      if (r0.success && r1.success) {
        const reserve0 = new ethers.AbiCoder().decode(["uint256"], r0.returnData)[0] as bigint
        const reserve1 = new ethers.AbiCoder().decode(["uint256"], r1.returnData)[0] as bigint
        const r0Min = minReserve0 ?? 1n
        const r1Min = minReserve1 ?? 1n
        if (reserve0 >= r0Min && reserve1 >= r1Min) {
          return { hasRoute: true, poolAddress: relevant[i].address }
        }
      }
    }
  } catch {
  }
  return { hasRoute: false }
}

export function estimateAMMOutput(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  fee: number,
): bigint {
  if (reserveIn <= 0n || reserveOut <= 0n || amountIn <= 0n) return 0n
  const feeBps = BigInt(Math.floor((1 - fee) * 10000))
  const amountInWithFee = (amountIn * feeBps) / 10000n
  const numerator = amountInWithFee * reserveOut
  const denominator = reserveIn + amountInWithFee
  if (denominator <= 0n) return 0n
  return numerator / denominator
}

export function resetRouteCache(): void {
  cache = {}
}

export { KNOWN_POOLS, STABLECOINS }
