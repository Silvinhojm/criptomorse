import { ethers } from "ethers"
import type { NetworkKey, TokenSymbol } from "./real-swap-executor"
import { NETWORKS, TOKEN_DECIMALS } from "./real-swap-executor"
import { gasPriceOracle } from "./gas-price-oracle"

const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11"

const MULTICALL3_ABI = [
  "function aggregate3(Call[] calldata calls) payable returns (Result[] memory returnData)",
  "struct Call { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
]

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]

export interface UltraFlashSwap {
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
}

export interface UltraFlashResult {
  success: boolean
  results: { swap: UltraFlashSwap; success: boolean; txHash?: string; error?: string }[]
  txHash?: string
  totalGasUsed?: number
}

const approvedSet = new Set<string>()

function approvedKey(tokenAddr: string, spender: string): string {
  return `${tokenAddr}:${spender}`
}

export async function batchApprove(
  signer: ethers.Signer,
  userAddress: string,
  network: NetworkKey,
  swaps: UltraFlashSwap[],
  onLog?: (msg: string) => void,
): Promise<string[]> {
  const log = onLog || ((m: string) => {})
  const calls: { target: string; allowFailure: boolean; callData: string }[] = []
  const approvedKeys: string[] = []

  for (const swap of swaps) {
    const net = NETWORKS[network]
    const tokenAddr = (net.tokens as any)[swap.fromToken]
    if (!tokenAddr) continue

    const key = approvedKey(tokenAddr, swap.spender)
    if (approvedSet.has(key)) continue

    const tc = new ethers.Contract(tokenAddr, ERC20_ABI, signer)
    const al = await tc.allowance(userAddress, swap.spender)
    if (al >= swap.amountRaw) {
      approvedSet.add(key)
      continue
    }

    const iface = new ethers.Interface(ERC20_ABI)
    const callData = iface.encodeFunctionData("approve", [swap.spender, ethers.MaxUint256])
    calls.push({ target: tokenAddr, allowFailure: false, callData })
    approvedKeys.push(key)
    log(`🔓 Pré-aprovando ${swap.fromToken} → ${swap.spender.slice(0, 10)}...`)
  }

  if (calls.length === 0) return approvedKeys

  const multicall = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, signer)
  const tx = await multicall.aggregate3(calls, { gasLimit: 200000 + calls.length * 50000 })
  const receipt = await tx.wait()
  if (!receipt || receipt.status === 0) {
    throw new Error(`Batch approve falhou na tx ${tx.hash}`)
  }
  log(`✅ ${calls.length} approvals em 1 tx: ${tx.hash}`)

  for (const key of approvedKeys) approvedSet.add(key)
  return approvedKeys
}

export async function executeBatch(
  signer: ethers.Signer,
  network: NetworkKey,
  swaps: UltraFlashSwap[],
  onLog?: (msg: string) => void,
): Promise<UltraFlashResult> {
  const log = onLog || ((m: string) => {})

  if (swaps.length === 0) {
    return { success: false, results: [] }
  }

  const gasCost = await gasPriceOracle.getGasCost(network)
  const batchGasEstimate = swaps.reduce((s, sw) => s + 200000, 100000)
  log(`⚡ UltraFlash batch: ${swaps.length} swaps | ${network} | gas ~${batchGasEstimate} | $${((batchGasEstimate * gasCost) / 21000).toFixed(4)}`)

  const calls: { target: string; allowFailure: boolean; callData: string }[] = []
  let totalValue = 0n

  for (const swap of swaps) {
    calls.push({ target: swap.target, allowFailure: true, callData: swap.calldata })
    totalValue += swap.value
  }

  try {
    const multicall = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, signer)
    const tx = await multicall.aggregate3(calls, {
      value: totalValue,
      gasLimit: batchGasEstimate,
    })
    log(`🔗 UltraFlash TX: ${tx.hash}`)
    const receipt = await tx.wait()

    if (!receipt || receipt.status === 0) {
      return { success: false, results: swaps.map(s => ({ swap: s, success: false, error: "TX revertida" })), txHash: tx.hash }
    }

    const gasUsed = receipt.gasUsed ? Number(receipt.gasUsed) : batchGasEstimate
    log(`✅ Batch concluído: ${gasUsed} gas | TX: ${tx.hash}`)

    const results = swaps.map((swap, i) => {
      const callSuccess = receipt.results?.[i]?.success ?? true
      return {
        swap,
        success: callSuccess,
        txHash: tx.hash,
        error: callSuccess ? undefined : `Swap ${i + 1} falhou on-chain`,
      }
    })

    return { success: true, results, txHash: tx.hash, totalGasUsed: gasUsed }
  } catch (err: any) {
    log(`❌ UltraFlash batch falhou: ${err.message.slice(0, 150)}`)
    return { success: false, results: swaps.map(s => ({ swap: s, success: false, error: err.message.slice(0, 150) })) }
  }
}

export function resetApprovals(): void {
  approvedSet.clear()
}
