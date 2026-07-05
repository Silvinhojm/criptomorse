import { ethers } from "ethers"
import { NonceManager } from "./nonce-manager"
import { realSwap, NETWORKS, type NetworkKey, type TokenSymbol, TOKEN_DECIMALS } from "./real-swap-executor"
import { executeDirectSwap } from "./arc-direct-swap"
import { executeBatch as ultraflashExecute, type UltraFlashSwap, type UltraFlashResult } from "./ultraflash"
import { gasPriceOracle } from "./gas-price-oracle"
import { capitalController } from "./capital-controller"

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"
const AGGREGATE3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[])",
]
const ERC20_BALANCE_ABI = "function balanceOf(address owner) view returns (uint256)"

interface BatchExecOrder {
  fromToken: TokenSymbol
  toToken: TokenSymbol
  amountRaw: bigint
  amountUsd: number
  target: string
  calldata: string
  value: bigint
  spender: string
  expectedToAmount: number
  network: NetworkKey
  minAmountOut: bigint
}

export interface BatchSimulationResult {
  passed: boolean
  simulatedOutputs: bigint[]
  failures: number[]
  gasEstimate: bigint
}

export interface BatchExecResult {
  success: boolean
  txHash?: string
  results: { index: number; success: boolean; amountOut?: bigint; error?: string }[]
  gasUsed?: number
  gasSaved?: number
}

const ROUTE_CACHE_TTL = 120_000
const routeCache: Record<string, { routes: UltraFlashSwap[]; timestamp: number }> = {}

function cacheKey(from: string, to: string, net: string): string {
  return `${from}:${to}:${net}`
}

class BatchExecutorService {
  private pendingOrders: BatchExecOrder[] = []
  private readonly MAX_BATCH = 10
  private readonly WINDOW_MS = 8000
  private timer: ReturnType<typeof setInterval> | null = null
  private lastFlush = 0
  private totalBatches = 0
  private totalOrders = 0
  private totalGasSaved = 0

  constructor() {
    if (typeof setInterval !== "undefined") {
      this.timer = setInterval(() => this._flush(), 5000)
    }
  }

  addOrder(order: BatchExecOrder): void {
    this.pendingOrders.push(order)
    if (this.pendingOrders.length >= this.MAX_BATCH) {
      this._flush()
    }
  }

  get pending(): number { return this.pendingOrders.length }

  private _getSigner(): ethers.Signer {
    const s = realSwap.getSigner()
    if (!s) throw new Error("Sem signer")
    return s
  }

  private _getProvider(): ethers.Provider {
    const p = realSwap.getProvider()
    if (!p) throw new Error("Sem provider")
    return p
  }

  private async _simulateBatch(
    orders: BatchExecOrder[],
    network: NetworkKey,
  ): Promise<BatchSimulationResult> {
    const signer = this._getSigner()
    const provider = this._getProvider()
    const net = NETWORKS[network]
    const userAddr = realSwap.getAddress()

    const simulatedOutputs: bigint[] = []
    const failures: number[] = []
    const calls: { target: string; allowFailure: boolean; callData: string }[] = []

    for (const o of orders) {
      if (net.isTestnet) {
        try {
          const pool = new ethers.Contract(o.target, [
            "function getAmountOut(address tokenIn, uint256 amountIn) view returns (uint256)",
          ], provider)
          const out = await pool.getAmountOut.staticCall(
            (net.tokens as any)[o.fromToken],
            o.amountRaw,
          )
          const outBig = BigInt(out.toString())
          simulatedOutputs.push(outBig >= o.minAmountOut ? outBig : 0n)
        } catch {
          simulatedOutputs.push(0n)
          failures.push(orders.indexOf(o))
        }
      } else {
        calls.push({ target: o.target, allowFailure: true, callData: o.calldata })
      }
    }

    if (calls.length > 0) {
      try {
        const mc = new ethers.Contract(MULTICALL3, AGGREGATE3_ABI, provider)
        const results = await mc.aggregate3.staticCall(calls)
        for (let i = 0; i < results.length; i++) {
          const r = results[i]
          if (r.success) {
            const decoded = new ethers.AbiCoder().decode(["uint256"], r.returnData)
            simulatedOutputs.push(BigInt(decoded[0].toString()))
          } else {
            simulatedOutputs.push(0n)
            failures.push(i)
          }
        }
      } catch {
        simulatedOutputs.push(...orders.map(() => 0n))
      }
    }

    const gasEstimate = await provider.estimateGas({
      to: MULTICALL3,
      data: new ethers.Interface(AGGREGATE3_ABI).encodeFunctionData("aggregate3", [calls]),
    }).catch(() => 500_000n)

    return {
      passed: failures.length === 0,
      simulatedOutputs,
      failures,
      gasEstimate,
    }
  }

  private async _executeTestnetBatch(
    orders: BatchExecOrder[],
    network: NetworkKey,
    userAddr: string,
  ): Promise<BatchExecResult> {
    const signer = this._getSigner()
    const results: BatchExecResult["results"] = []
    let allOk = true

    for (let i = 0; i < orders.length; i++) {
      const o = orders[i]
      const net = NETWORKS[network]
      const fromAddr = (net.tokens as any)[o.fromToken]
      const toAddr = (net.tokens as any)[o.toToken]

      try {
        const direct = await executeDirectSwap(
          signer, fromAddr, toAddr, o.amountRaw.toString(),
          userAddr, net.chainId, (m) => console.log(`[BatchExec] ${m}`),
        )
        if (direct.success) {
          results.push({ index: i, success: true, amountOut: BigInt(direct.amountReceived ?? "0") })
        } else {
          results.push({ index: i, success: false, error: direct.error })
          allOk = false
        }
      } catch (e: any) {
        results.push({ index: i, success: false, error: e.message })
        allOk = false
      }
    }

    return {
      success: allOk,
      results,
      gasUsed: orders.length * 100_000,
      gasSaved: 0,
    }
  }

  async executeBatch(network: NetworkKey): Promise<BatchExecResult> {
    const orders = [...this.pendingOrders]
    this.pendingOrders = []
    this.lastFlush = Date.now()

    if (orders.length === 0) return { success: true, results: [] }

    const net = NETWORKS[network]
    const userAddr = realSwap.getAddress()
    const totalAmount = orders.reduce((s, o) => s + o.amountUsd, 0)

    const ccId = `batch:${network}:${Date.now()}`
    const approval = capitalController.request({
      id: ccId, strategy: "batch",
      pair: `${orders[0].fromToken}→...(${orders.length})`,
      network, amountUSD: totalAmount,
      score: Math.min(100, Math.round(totalAmount * 10)),
      estimatedProfit: 0, requestedAt: Date.now(),
    })
    if (!approval.authorized) {
      this.pendingOrders.push(...orders)
      return { success: false, results: orders.map((_, i) => ({ index: i, success: false, error: `Capital ocupado: ${approval.reason}` })) }
    }

    try {
      if (net.isTestnet) {
        const sim = await this._simulateBatch(orders, network)
        if (!sim.passed) {
          this.log(`⚠️ Simulação: ${sim.failures.length}/${orders.length} ordens falham — abortando batch`)
          const results = orders.map((_, i) => ({
            index: i, success: false,
            error: sim.failures.includes(i) ? "Simulação falhou" : "Batch abortado por falhas na simulação",
          }))
          return { success: false, results, gasUsed: Number(sim.gasEstimate), gasSaved: 0 }
        }
        this.log(`✅ Simulação: ${orders.length}/${orders.length} ordens OK (gas ~${sim.gasEstimate})`)
        return await this._executeTestnetBatch(orders, network, userAddr)
      }

      const swaps: UltraFlashSwap[] = orders.map((o, i) => ({
        fromToken: o.fromToken, toToken: o.toToken,
        amountRaw: o.amountRaw, amountUsd: o.amountUsd,
        target: o.target, calldata: o.calldata,
        value: o.value, spender: o.spender,
        expectedToAmount: o.expectedToAmount,
        network,
      }))

      const sim = await this._simulateBatch(orders, network)
      if (!sim.passed) {
        this.log(`⚠️ Simulação: ${sim.failures.length}/${orders.length} falham — abortando`)
        return {
          success: false,
          results: orders.map((_, i) => ({
            index: i, success: false,
            error: sim.failures.includes(i) ? "Simulação falhou" : "Batch abortado",
          })),
          gasUsed: Number(sim.gasEstimate),
          gasSaved: 0,
        }
      }

      const { batchApprove } = await import("./ultraflash")
      await batchApprove(this._getSigner(), userAddr, network, swaps, (m) => this.log(m))

      const batchResult: UltraFlashResult = await ultraflashExecute(this._getSigner(), network, swaps, (m) => this.log(m))

      if (!batchResult.success) {
        return { success: false, results: orders.map((_, i) => ({ index: i, success: false, error: "Batch falhou" })) }
      }

      const results = batchResult.results.map((r, i) => ({
        index: i,
        success: r.success,
        amountOut: r.success ? undefined : undefined,
        error: r.error,
      }))

      const gasSaved = orders.length * 210_000 - (batchResult.totalGasUsed ?? orders.length * 150_000)

      this.totalBatches++
      this.totalOrders += orders.length
      this.totalGasSaved += Math.max(0, gasSaved)

      this.log(`✅ Batch ${this.totalBatches}: ${orders.length} ordens | gas usado: ${batchResult.totalGasUsed} | economia: ${Math.max(0, gasSaved)} gas`)

      capitalController.unlockNetwork(network)
      return { success: true, txHash: batchResult.txHash, results, gasUsed: batchResult.totalGasUsed, gasSaved: Math.max(0, gasSaved) }

    } catch (e: any) {
      this.log(`❌ Batch execução falhou: ${e.message}`)
      capitalController.unlockNetwork(network)
      return { success: false, results: orders.map((_, i) => ({ index: i, success: false, error: e.message })) }
    }
  }

  async simulateOnly(orders: BatchExecOrder[], network: NetworkKey): Promise<BatchSimulationResult> {
    return this._simulateBatch(orders, network)
  }

  private async _flush(): Promise<void> {
    if (this.pendingOrders.length === 0) return
    if (Date.now() - this.lastFlush < this.WINDOW_MS) return
    const net = realSwap.getNetworkKey()
    if (!net) return
    await this.executeBatch(net as NetworkKey)
  }

  flush(): void {
    if (this.pendingOrders.length > 0) {
      const net = realSwap.getNetworkKey()
      if (net) this.executeBatch(net as NetworkKey)
    }
  }

  private log(msg: string): void {
    console.log(`[BatchExec] ${msg}`)
  }

  getStats() {
    return {
      totalBatches: this.totalBatches,
      totalOrders: this.totalOrders,
      totalGasSaved: this.totalGasSaved,
      pending: this.pendingOrders.length,
    }
  }
}

export const batchExecutorService = new BatchExecutorService()
export type { BatchExecOrder }
