// lib/job-robot.ts
// Robô autônomo de swaps na Arc testnet via Circle App Kit
// Segue o exemplo: conectar + executar + log + retry com backoff

import { ethers } from 'ethers'
import { AppKit, SwapChain } from '@circle-fin/app-kit'
import { createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2'

const ARC_RPC = 'https://rpc.testnet.arc.network'
const ARC_CHAIN_ID = 5042002

const SWAP_PAIRS: Array<{ tokenIn: string; tokenOut: string; label: string }> = [
  { tokenIn: 'USDC', tokenOut: 'EURC', label: 'USDC→EURC' },
  { tokenIn: 'EURC', tokenOut: 'USDC', label: 'EURC→USDC' },
]

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 30000

export interface SwapResult {
  success: boolean
  txHash?: string
  explorerUrl?: string
  pair?: string
  amountIn?: string
  amountOut?: string
  stage: string
  error?: string
  retryCount: number
}

class JobRobot {
  private kit: AppKit | null = null
  private adapter: ReturnType<typeof createViemAdapterFromPrivateKey> | null = null
  private address: string = ''
  private cycleCount = 0
  private consecutiveFails = 0
  private balanceUsdc = 0

  initialize(privateKey: string) {
    const provider = new ethers.JsonRpcProvider(ARC_RPC)
    const wallet = new ethers.Wallet(privateKey, provider)
    this.address = wallet.address
    this.adapter = createViemAdapterFromPrivateKey({ privateKey })
    this.kit = new AppKit()
  }

  isReady(): boolean {
    return this.kit !== null && this.adapter !== null
  }

  getAddress(): string | null {
    return this.address || null
  }

  getCycleCount(): number {
    return this.cycleCount
  }

  /** Verifica saldo USDC na Arc testnet via ethers */
  async checkBalance(): Promise<number> {
    if (!this.adapter) return 0
    try {
      const usdcAddress = '0x3600000000000000000000000000000000000000'
      const abi = ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)']
      const provider = new ethers.JsonRpcProvider(ARC_RPC)
      const contract = new ethers.Contract(usdcAddress, abi, provider)
      const [bal, dec] = await Promise.all([
        contract.balanceOf(this.address),
        contract.decimals().catch(() => 6),
      ])
      this.balanceUsdc = parseFloat(ethers.formatUnits(bal, Number(dec)))
      return this.balanceUsdc
    } catch {
      return this.balanceUsdc
    }
  }

  /** Executa um swap com retry */
  async executeSwap(amountUsd = '0.50'): Promise<SwapResult> {
    if (!this.kit || !this.adapter) {
      return { success: false, stage: 'init', error: 'AppKit não inicializado', retryCount: 0 }
    }

    const pair = SWAP_PAIRS[this.cycleCount % SWAP_PAIRS.length]
    let lastError = ''

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        }

        const bal = await this.checkBalance()
        if (bal < parseFloat(amountUsd)) {
          return { success: false, stage: 'balance', error: `Saldo insuficiente: $${bal.toFixed(2)} USDC`, retryCount: attempt }
        }

        const result = await this.kit.swap({
          from: { adapter: this.adapter, chain: SwapChain.Arc_Testnet },
          tokenIn: pair.tokenIn as any,
          tokenOut: pair.tokenOut as any,
          amountIn: amountUsd,
          config: { slippageBps: 500 },
        })

        this.cycleCount++
        this.consecutiveFails = 0

        return {
          success: true,
          txHash: result.txHash,
          explorerUrl: result.explorerUrl,
          pair: pair.label,
          amountIn: result.amountIn,
          amountOut: result.amountOut,
          stage: 'completed',
          retryCount: attempt,
        }
      } catch (err: any) {
        lastError = err?.message ?? 'Erro desconhecido'
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        }
      }
    }

    this.consecutiveFails++
    return {
      success: false,
      stage: `failed-after-${MAX_RETRIES}-retries`,
      error: lastError.slice(0, 300),
      retryCount: MAX_RETRIES,
    }
  }
}

export const jobRobot = new JobRobot()
export type { JobRobot }