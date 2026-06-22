// lib/job-robot.ts
// Robô autônomo de Jobs ERC-8183 — assina com private key, sem MetaMask

import { ethers } from 'ethers'

const AGENTIC_COMMERCE = '0x0747EEf0706327138c69792bF28Cd525089e4583'
const USDC_ARC_TESTNET = '0x3600000000000000000000000000000000000000'
const ARC_TESTNET_RPC = 'https://rpc.testnet.arc.network'

const ERC8183_ABI = [
  'function createJob(address provider, address evaluator, uint256 expiredAt, string memory description, address hook) external returns (uint256 jobId)',
  'function setBudget(uint256 jobId, uint256 amount, bytes memory optParams) external',
  'function fund(uint256 jobId, bytes memory optParams) external',
  'function submit(uint256 jobId, bytes32 deliverable, bytes memory optParams) external',
  'function complete(uint256 jobId, bytes32 reason, bytes memory optParams) external',
  'function getJob(uint256 jobId) view returns (tuple(uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook))',
]

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
]

const JOB_CYCLE_DESCRIPTIONS = [
  'Robot autonomous trading analysis - CriptoMorse ARC',
  'Automated market making algorithm test - CriptoMorse',
  'Quantum wave pattern detection job - CriptoMorse',
  'Multi-agent consensus evaluation - CriptoMorse ARC',
  'Volatility-based staircase execution test',
  'Cross-chain arbitrage simulation - CriptoMorse',
  'Agent learning and performance evaluation',
  'Micro-trade profitability analysis job',
]

export interface JobRobotResult {
  success: boolean
  jobId?: number
  txHashes: string[]
  stage?: string
  error?: string
}

class JobRobot {
  private wallet: ethers.Wallet | null = null
  private pendingJobId: number | null = null
  private cycleCount = 0

  initialize(privateKey: string) {
    const provider = new ethers.JsonRpcProvider(ARC_TESTNET_RPC)
    this.wallet = new ethers.Wallet(privateKey, provider)
  }

  isReady(): boolean {
    return this.wallet !== null
  }

  getAddress(): string | null {
    return this.wallet?.address ?? null
  }

  getPendingJobId(): number | null {
    return this.pendingJobId
  }

  clearPendingJob() {
    this.pendingJobId = null
  }

  getCycleCount(): number {
    return this.cycleCount
  }

  // Executa um ciclo completo: createJob → approve + setBudget → fund → submit → complete
  async executeCycle(budgetUSDC = 0.50, deadlineMinutes = 60): Promise<JobRobotResult> {
    if (!this.wallet) return { success: false, txHashes: [], error: 'Wallet not initialized' }

    const txHashes: string[] = []
    const desc = JOB_CYCLE_DESCRIPTIONS[this.cycleCount % JOB_CYCLE_DESCRIPTIONS.length]
    const address = this.wallet.address
    const contract = new ethers.Contract(AGENTIC_COMMERCE, ERC8183_ABI, this.wallet)
    const usdc = new ethers.Contract(USDC_ARC_TESTNET, ERC20_ABI, this.wallet)

    try {
      // ─── 1. CREATE JOB ─────────────────────────────────────────
      const provider = this.wallet.provider!
      const block = await provider.getBlock('latest')
      const expiredAt = (block?.timestamp ?? Math.floor(Date.now() / 1000)) + deadlineMinutes * 60

      const txCreate = await contract.createJob(address, address, expiredAt, desc, ethers.ZeroAddress)
      const receiptCreate = await txCreate.wait()
      txHashes.push(txCreate.hash)

      const iface = new ethers.Interface(ERC8183_ABI)
      const jobCreatedLog = receiptCreate.logs.find((log: any) => {
        try {
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data })
          return parsed?.name === 'JobCreated'
        } catch { return false }
      })
      const parsed = jobCreatedLog
        ? iface.parseLog({ topics: jobCreatedLog.topics as string[], data: jobCreatedLog.data })
        : null
      const jobId = Number(parsed?.args?.jobId ?? 0)
      if (!jobId) return { success: false, txHashes, stage: 'createJob', error: 'Failed to get jobId from event' }

      this.pendingJobId = jobId
      this.cycleCount++

      // ─── 2. APPROVE USDC + SET BUDGET ─────────────────────────
      const amount = ethers.parseUnits(budgetUSDC.toFixed(6), 6)
      const txApprove = await usdc.approve(AGENTIC_COMMERCE, amount)
      await txApprove.wait()
      txHashes.push(txApprove.hash)

      const txBudget = await contract.setBudget(jobId, amount, '0x')
      await txBudget.wait()
      txHashes.push(txBudget.hash)

      // ─── 3. FUND JOB ──────────────────────────────────────────
      const txFund = await contract.fund(jobId, '0x')
      await txFund.wait()
      txHashes.push(txFund.hash)

      // ─── 4. SUBMIT DELIVERABLE ────────────────────────────────
      const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes(`robot-cycle-${this.cycleCount}-${Date.now()}`))
      const txSubmit = await contract.submit(jobId, deliverableHash, '0x')
      await txSubmit.wait()
      txHashes.push(txSubmit.hash)

      // ─── 5. COMPLETE JOB ──────────────────────────────────────
      const reasonHash = ethers.keccak256(ethers.toUtf8Bytes('deliverable-approved'))
      const txComplete = await contract.complete(jobId, reasonHash, '0x')
      await txComplete.wait()
      txHashes.push(txComplete.hash)

      this.pendingJobId = null

      return {
        success: true,
        jobId,
        txHashes,
        stage: 'completed',
      }
    } catch (err: any) {
      const msg = err?.reason ?? err?.message ?? 'Unknown error'
      return {
        success: false,
        jobId: this.pendingJobId ?? undefined,
        txHashes,
        stage: txHashes.length === 0 ? 'createJob' : txHashes.length < 4 ? 'approve-fund' : 'submit-complete',
        error: msg.slice(0, 200),
      }
    }
  }
}

export const jobRobot = new JobRobot()
