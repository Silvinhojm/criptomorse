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
const ARC_CIRBTC = "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0".toLowerCase()
const ARC_MCIRBTC = "0x8cad4951192853D14f8Cb813695146b5Ae00EA6d".toLowerCase()

const ARC_AMM_PAIR = "0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb".toLowerCase()
const ARC_CIRBTC_POOL = "0xcd7885Ed7D3F4e4b6C88eA2C670a0075b612F073".toLowerCase()

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

let cache: Record<string, { result: boolean; timestamp: number }> = {}
const CACHE_TTL = 60_000

function key(token: string, network: string): string {
  return `${token.toLowerCase()}:${network}`
}

export function hasSellRoute(token: string, networkKey: string): boolean {
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

export async function checkRouteViaMulticall(
  provider: ethers.Provider,
  chainId: number,
  buyToken: string,
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
        if (reserve0 > 0n && reserve1 > 0n) {
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
