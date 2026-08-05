import { ethers } from "ethers"

const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11"

const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[])",
]

const ERC20_BALANCE_ABI = "function balanceOf(address owner) view returns (uint256)"
const GET_RESERVES_ABI = "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"

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

export interface PoolDepthCheck {
  sufficient: boolean
  reason: string
  poolAddress?: string
  stableReserveUsd?: number
}

async function getReservesWithRetry(
  provider: ethers.Provider,
  poolAddress: string,
): Promise<{ reserve0: bigint; reserve1: bigint }> {
  const cached = reserveCache[poolAddress]
  if (cached && Date.now() - cached.timestamp < RESERVE_CACHE_TTL_MS) {
    return { reserve0: cached.reserve0, reserve1: cached.reserve1 }
  }
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const pool = new ethers.Contract(poolAddress, [GET_RESERVES_ABI], provider)
      const result = await pool.getReserves()
      const reserve0 = BigInt(result[0])
      const reserve1 = BigInt(result[1])
      reserveCache[poolAddress] = { reserve0, reserve1, timestamp: Date.now() }
      return { reserve0, reserve1 }
    } catch (e) {
      lastError = e
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 200))
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
    return { sufficient: true, reason: "check_not_implemented_outside_arc" }
  }

  const from = fromToken.toLowerCase()
  const to = toToken.toLowerCase()
  const pool = KNOWN_POOLS[ARC_CHAIN_ID]?.find(
    p => (p.token0 === from && p.token1 === to) || (p.token0 === to && p.token1 === from),
  )
  if (!pool) {
    return { sufficient: false, reason: "no_known_pool_for_pair" }
  }

  let reserve0: bigint, reserve1: bigint
  try {
    ;({ reserve0, reserve1 } = await getReservesWithRetry(provider, pool.address))
  } catch (e) {
    return {
      sufficient: false,
      reason: `reserve_read_failed: ${(e as Error)?.message ?? String(e)}`,
      poolAddress: pool.address,
    }
  }

  const stableIsToken0 = STABLECOINS.has(pool.token0)
  const stableIsToken1 = STABLECOINS.has(pool.token1)
  if (!stableIsToken0 && !stableIsToken1) {
    return { sufficient: false, reason: "no_stable_side_to_measure_depth", poolAddress: pool.address }
  }

  const stableReserveRaw = stableIsToken0 ? reserve0 : reserve1
  const stableReserveUsd = parseFloat(ethers.formatUnits(stableReserveRaw, 6)) // USDC/EURC na Arc, 6 casas
  const requiredUsd = amountUsd * LIQUIDITY_DEPTH_MULTIPLIER

  if (stableReserveUsd < requiredUsd) {
    return {
      sufficient: false,
      reason: `liquidez insuficiente: pool tem $${stableReserveUsd.toFixed(4)}, trade de $${amountUsd.toFixed(2)} exige pelo menos $${requiredUsd.toFixed(2)} (${LIQUIDITY_DEPTH_MULTIPLIER}x)`,
      poolAddress: pool.address,
      stableReserveUsd,
    }
  }
  return { sufficient: true, reason: "ok", poolAddress: pool.address, stableReserveUsd }
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
    const calls = relevant.map(p => ({
      target: p.address,
      allowFailure: true,
      callData: new ethers.Interface([GET_RESERVES_ABI]).encodeFunctionData("getReserves"),
    }))
    const mc = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider)
    const returnData = await mc.aggregate3.staticCall(calls)
    for (let i = 0; i < returnData.length; i++) {
      const r = returnData[i]
      if (r.success) {
        const decoded = new ethers.AbiCoder().decode(
          ["uint112", "uint112", "uint32"],
          r.returnData
        )
        const reserve0 = decoded[0] as bigint
        const reserve1 = decoded[1] as bigint
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
