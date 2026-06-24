import { ethers } from 'ethers'
import { realSwap } from './real-swap-executor'
import type { SwapResult } from './real-swap-executor'

// ─── Interface para ordem em lote ─────────────────────────────────────────────

export interface BatchOrder {
  id: string
  fromToken: string
  toToken: string
  amount: string
  amountUsd: number
  network: string
  agentName: string
  confidence: number
  fromAddress: string
  toAddress: string
  memoRef?: string
}

export interface BatchResult {
  success: boolean
  orders: BatchOrder[]
  txHash?: string
  gasSaved?: number
  totalProfit?: number
  errors?: string[]
  timestamp: number
}

// ─── Batch Executor ────────────────────────────────────────────────────────────

class BatchExecutor {
  private pendingOrders: BatchOrder[] = []
  private readonly MAX_BATCH_SIZE = 5
  private readonly BATCH_WINDOW_MS = 8000 // 8 segundos
  private timer: NodeJS.Timeout | null = null
  private lastExecution = 0
  private totalBatches = 0
  private totalOrdersExecuted = 0
  private totalGasSaved = 0
  private history: BatchResult[] = []

  constructor() {
    // Inicia o loop de verificação
    this._startTimer()
  }

  // ─── Adicionar ordem ao lote ────────────────────────────────────────────────

  addOrder(order: BatchOrder): void {
    this.pendingOrders.push(order)
    console.log(`📦 Ordem adicionada ao batch (${this.pendingOrders.length}/${this.MAX_BATCH_SIZE})`)

    // Se atingiu o tamanho máximo, executa imediatamente
    if (this.pendingOrders.length >= this.MAX_BATCH_SIZE) {
      this.executeBatch()
    }
  }

  // ─── Executar lote ──────────────────────────────────────────────────────────

  async executeBatch(): Promise<BatchResult[]> {
    if (this.pendingOrders.length === 0) {
      return []
    }

    const orders = [...this.pendingOrders]
    this.pendingOrders = []
    this.lastExecution = Date.now()

    console.log(`⚡ Executando batch com ${orders.length} ordens`)

    // Agrupa por rede
    const byNetwork = orders.reduce((acc, o) => {
      acc[o.network] = acc[o.network] || []
      acc[o.network].push(o)
      return acc
    }, {} as Record<string, BatchOrder[]>)

    const results: BatchResult[] = []

    for (const [network, networkOrders] of Object.entries(byNetwork)) {
      const result = await this._executeNetworkBatch(network, networkOrders)
      results.push(result)
    }

    this.totalBatches++
    this.totalOrdersExecuted += orders.length
    this.history.push(...results)

    return results
  }

  // ─── Executar lote por rede ─────────────────────────────────────────────────

  private async _executeNetworkBatch(network: string, orders: BatchOrder[]): Promise<BatchResult> {
    const startTime = Date.now()

    try {
      // Estima gas individual
      let totalGasEstimate = 0
      let totalGasBatch = 0

      // Usa multicall para executar todos de uma vez
      const result = await this._executeMulticall(network, orders)

      const gasSaved = totalGasEstimate - totalGasBatch
      this.totalGasSaved += gasSaved

      return {
        success: true,
        orders,
        txHash: result.txHash,
        gasSaved,
        totalProfit: result.totalProfit,
        timestamp: startTime,
      }
    } catch (error) {
      console.error(`❌ Batch falhou na rede ${network}:`, error)
      return {
        success: false,
        orders,
        errors: [error instanceof Error ? error.message : String(error)],
        timestamp: startTime,
      }
    }
  }

  // ─── Multicall (simplificado) ──────────────────────────────────────────────

  private async _executeMulticall(network: string, orders: BatchOrder[]): Promise<{ txHash: string; totalProfit: number }> {
    // Endereço do Multicall3 na Polygon
    const MULTICALL_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'

    // Abi simplificado para multicall
    const multicallAbi = [
      'function aggregate(tuple(address target, bytes callData)[] calls) public payable returns (uint256 blockNumber, bytes[] returnData)',
    ]

    // Prepara as chamadas
    const calls = []
    for (const order of orders) {
      // Cada ordem vira uma chamada para o router de swap
      const callData = this._buildSwapCallData(order)
      calls.push({
        target: order.fromAddress, // ou endereço do router
        callData,
      })
    }

    // Executa
    const provider = await realSwap.getProvider(network)
    const signer = await realSwap.getSigner()
    const contract = new ethers.Contract(MULTICALL_ADDRESS, multicallAbi, signer)

    const tx = await contract.aggregate(calls, {
      gasLimit: 500000 + orders.length * 200000,
    })

    const receipt = await tx.wait()

    return {
      txHash: receipt.transactionHash,
      totalProfit: 0, // Calculado após o swap
    }
  }

  // ─── Build call data para swap ─────────────────────────────────────────────

  private _buildSwapCallData(order: BatchOrder): string {
    // Simplificado: usa a função swapExactTokensForTokens do router
    const routerAbi = [
      'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) external returns (uint[] amounts)',
    ]

    const iface = new ethers.Interface(routerAbi)

    const path = [order.fromToken, order.toToken]
    const deadline = Math.floor(Date.now() / 1000) + 600 // 10 min

    return iface.encodeFunctionData('swapExactTokensForTokens', [
      ethers.parseUnits(order.amount, 6), // USDC tem 6 decimais
      0, // amountOutMin (slippage 0% por simplicidade)
      path,
      order.toAddress,
      deadline,
    ])
  }

  // ─── Timer para execução automática ────────────────────────────────────────

  private _startTimer(): void {
    setInterval(() => {
      if (this.pendingOrders.length > 0 && Date.now() - this.lastExecution > this.BATCH_WINDOW_MS) {
        this.executeBatch()
      }
    }, 5000)
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  getStats() {
    return {
      totalBatches: this.totalBatches,
      totalOrdersExecuted: this.totalOrdersExecuted,
      totalGasSaved: this.totalGasSaved,
      pendingOrders: this.pendingOrders.length,
      history: this.history.slice(-20),
    }
  }

  getPendingCount(): number {
    return this.pendingOrders.length
  }

  flush(): void {
    if (this.pendingOrders.length > 0) {
      this.executeBatch()
    }
  }
}

export const batchExecutor = new BatchExecutor()
