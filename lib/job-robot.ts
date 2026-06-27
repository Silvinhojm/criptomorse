// lib/job-robot.ts
// Robô autônomo de swaps na Arc testnet via Circle App Kit
// Segue o exemplo: conectar + executar + log + retry com backoff

import { applyCircleProxyFix } from './circle-proxy-fix'
applyCircleProxyFix()
import { ethers } from 'ethers'
import { AppKit, SwapChain } from '@circle-fin/app-kit'
import { createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2'
import { defineChain, createWalletClient, createPublicClient, http } from 'viem'
import { JOB_PROOF_BYTECODE, JOB_PROOF_ABI } from './contracts'

const ARC_RPC = 'https://rpc.testnet.arc.network'
const ARC_CHAIN_ID = 5042002

const ARC_CHAIN = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'ARC', symbol: 'ARC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
})

const SWAP_PAIRS: Array<{ tokenIn: string; tokenOut: string; label: string }> = [
  { tokenIn: 'USDC', tokenOut: 'EURC', label: 'USDC→EURC' },
  { tokenIn: 'EURC', tokenOut: 'USDC', label: 'EURC→USDC' },
  { tokenIn: 'USDC', tokenOut: 'cirBTC', label: 'USDC→cirBTC' },
  { tokenIn: 'cirBTC', tokenOut: 'USDC', label: 'cirBTC→USDC' },
  { tokenIn: 'EURC', tokenOut: 'cirBTC', label: 'EURC→cirBTC' },
  { tokenIn: 'cirBTC', tokenOut: 'EURC', label: 'cirBTC→EURC' },
]

const MAX_RETRIES = 0          // Stress: tenta 1x, se falhar já faz deploy
const RETRY_DELAY_MS = 10000
const SWAP_TIMEOUT_MS = 30000  // timeout de 30s por tentativa

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
  contractAddress?: string // address of deployed JobProof contract
}

class JobRobot {
  private kit: AppKit | null = null
  private adapter: ReturnType<typeof createViemAdapterFromPrivateKey> | null = null
  private address: string = ''
  private _privateKey: string = ''
  private cycleCount = 0
  private consecutiveFails = 0
  private balanceUsdc = 0

  initialize(privateKey: string) {
    this._privateKey = privateKey
    const provider = new ethers.JsonRpcProvider(ARC_RPC)
    const wallet = new ethers.Wallet(privateKey, provider)
    this.address = wallet.address
    this.adapter = createViemAdapterFromPrivateKey({
      privateKey,
      getPublicClient: () => createPublicClient({ chain: ARC_CHAIN, transport: http(ARC_RPC) }),
      getWalletClient: ({ account }) => createWalletClient({ account, chain: ARC_CHAIN, transport: http(ARC_RPC) }),
    })
    this.kit = new AppKit()
  }

  /** Reseta contadores — útil ao reiniciar o contratante */
  reset() {
    this.cycleCount = 0
    this.consecutiveFails = 0
  }

  getKitKey(): string {
    return process.env.KIT_KEY || (typeof window !== "undefined" ? localStorage.getItem("arcflow_kit_key") : null) || ""
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

  /** Executa swap com timeout de 30s */
  private _swapWithTimeout(pair: typeof SWAP_PAIRS[0], amountUsd: string): Promise<SwapResult> {
    return Promise.race([
      this.kit!.swap({
        from: { adapter: this.adapter!, chain: SwapChain.Arc_Testnet },
        tokenIn: pair.tokenIn as any,
        tokenOut: pair.tokenOut as any,
        amountIn: amountUsd,
        config: { slippageBps: 500, kitKey: this.getKitKey() || undefined },
      }).then(result => {
        this.consecutiveFails = 0
        return {
          success: true,
          txHash: result.txHash,
          explorerUrl: result.explorerUrl,
          pair: pair.label,
          amountIn: result.amountIn,
          amountOut: result.amountOut,
          stage: 'completed',
          retryCount: 0,
        } as SwapResult
      }).catch(err => ({
        success: false,
        stage: 'swap-error',
        error: err?.message?.slice(0, 200) ?? 'Erro desconhecido',
        retryCount: 0,
      } as SwapResult)),
      new Promise<SwapResult>(resolve =>
        setTimeout(() => resolve({ success: false, stage: 'timeout', error: 'Swap timeout (30s)', retryCount: 0 }), SWAP_TIMEOUT_MS)
      ),
    ])
  }

  /** Deploy do contrato JobProof na Arc testnet como prova on-chain */
  async deployJobProof(robotName: string, jobNumber: number): Promise<SwapResult> {
    try {
      const provider = new ethers.JsonRpcProvider(ARC_RPC)
      const wallet = new ethers.Wallet(this._privateKey, provider)
      const factory = new ethers.ContractFactory(JOB_PROOF_ABI, JOB_PROOF_BYTECODE, wallet)
      const contract = await factory.deploy(robotName, jobNumber)
      const tx = contract.deploymentTransaction()!
      const receipt = await tx.wait()
      const contractAddress = await contract.getAddress()
      return {
        success: true,
        txHash: receipt?.hash ?? tx.hash,
        pair: `JobProof:${robotName}#${jobNumber}`,
        amountIn: "0",
        amountOut: "0",
        stage: 'deployed',
        retryCount: 0,
        contractAddress,
      }
    } catch (err: any) {
      return {
        success: false,
        stage: 'deploy-error',
        error: err?.message?.slice(0, 200) ?? 'Falha no deploy',
        retryCount: 0,
      }
    }
  }

  /** Executa um swap com retry rápido. Se falhar, faz deploy de JobProof como stress tx. */
  async executeSwap(amountUsd = '0.50', robotName = 'unknown'): Promise<SwapResult> {
    if (!this.kit || !this.adapter) {
      return { success: false, stage: 'init', error: 'AppKit não inicializado', retryCount: 0 }
    }

    this.cycleCount++
    const pair = SWAP_PAIRS[this.cycleCount % SWAP_PAIRS.length]

    // Circuit breaker: após 3 falhas consecutivas de swap para de tentar
    if (this.consecutiveFails >= 3) {
      return {
        success: false,
        stage: 'circuit-breaker',
        error: '3 falhas consecutivas de swap — parando para evitar deploys desnecessários',
        retryCount: this.consecutiveFails,
      }
    }

    // Uma tentativa rápida de swap
    const bal = await this.checkBalance()
    if (bal >= parseFloat(amountUsd)) {
      const result = await this._swapWithTimeout(pair, amountUsd)
      if (result.success) {
        return result
      }
      // Nonce/revert errors são infraestrutura, não falha de estratégia
      const errMsg = result.error?.toLowerCase() ?? ''
      if (errMsg.includes('nonce') || errMsg.includes('revert') || errMsg.includes('already been used')) {
        this.consecutiveFails = Math.max(0, this.consecutiveFails - 1)
        return result
      }
    }

    // Fallback: deploy do JobProof como transação de stress na rede
    this.consecutiveFails++
    const deployResult = await this.deployJobProof(robotName, this.cycleCount)
    if (deployResult.success) {
      return deployResult
    }
    return {
      success: false,
      stage: 'stress-failed',
      error: `Swap+deploy falharam: ${deployResult.error ?? 'erro desconhecido'}`,
      retryCount: 0,
    }
  }
}

export const jobRobot = new JobRobot()
export type { JobRobot }