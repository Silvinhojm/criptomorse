// lib/arc-memo.ts
// Interacao com o contrato Memo (0x5294E9927c3306DcBaDb03fe70b92e01cCede505)
// Anexa contexto estruturado a chamadas de contrato na Arc Testnet
// Documentacao: https://docs.arc.io/arc/concepts/transaction-memos

import { ethers } from "ethers"

export const MEMO_ADDRESS = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505"
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000"

const MEMO_ABI = [
  "function memo(address target, bytes calldata data, bytes32 memoId, bytes calldata memoData) external",
  "event BeforeMemo(uint256 indexed memoIndex)",
  "event Memo(address indexed sender, address indexed target, bytes32 callDataHash, bytes32 indexed memoId, bytes memo, uint256 memoIndex)",
]

const ERC20_TRANSFER_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
]

export interface MemoEvent {
  sender: string
  target: string
  callDataHash: string
  memoId: string
  memo: string
  memoIndex: bigint
}

class ArcMemo {
  /**
   * Chama Memo.memo() para anexar contexto a uma chamada de contrato.
   * O contrato Memo encaminha a chamada para o target preservando o sender original
   * e emite eventos BeforeMemo + Memo.
   */
  async sendWithMemo(
    signer: ethers.Signer,
    target: string,
    data: string,
    memoId: string,
    memoData: string
  ): Promise<string> {
    const memo = new ethers.Contract(MEMO_ADDRESS, MEMO_ABI, signer)
    const tx = await memo.memo(target, data, memoId, memoData)
    const receipt = await tx.wait()
    if (!receipt || receipt.status === 0) {
      throw new Error("Memo transaction reverted")
    }
    return tx.hash
  }

  /**
   * Envia USDC com memo em uma unica transacao.
   * Codifica transfer(recipient, amount) e chama Memo.memo(usdcAddr, transferData, memoId, memoData).
   */
  async sendUSDCWithMemo(
    signer: ethers.Signer,
    recipient: string,
    amount: number,
    memoId: string,
    memoData: string
  ): Promise<string> {
    const erc20 = new ethers.Interface(ERC20_TRANSFER_ABI)
    const transferData = erc20.encodeFunctionData("transfer", [
      ethers.getAddress(recipient),
      ethers.parseUnits(amount.toFixed(6), 6),
    ])
    return this.sendWithMemo(signer, USDC_ADDRESS, transferData, memoId, memoData)
  }

  /**
   * Busca eventos Memo pelo memoId na Arc Testnet.
   */
  async queryMemoEvents(
    provider: ethers.Provider,
    memoId: string,
    fromBlock?: number,
    toBlock?: number
  ): Promise<MemoEvent[]> {
    const memo = new ethers.Contract(MEMO_ADDRESS, MEMO_ABI, provider)
    const filter = memo.filters.Memo(null, null, null, memoId)
    const raw = await memo.queryFilter(filter, fromBlock ?? 0, toBlock)
    return (raw as ethers.EventLog[]).map((log) => ({
      sender: log.args.sender,
      target: log.args.target,
      callDataHash: log.args.callDataHash,
      memoId: log.args.memoId,
      memo: log.args.memo,
      memoIndex: log.args.memoIndex,
    }))
  }

  /** Verifica se o contrato Memo esta implantado na rede */
  async isDeployed(provider: ethers.Provider): Promise<boolean> {
    const code = await provider.getCode(MEMO_ADDRESS)
    return code !== "0x"
  }

  getMemoAddress(): string {
    return MEMO_ADDRESS
  }
}

export const arcMemo = new ArcMemo()
