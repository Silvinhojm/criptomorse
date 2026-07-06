import { ethers } from "ethers"
import { IntentPublisher, type AgentIntent, type IntentRecord } from "./intent-publisher"
import { AGENTIC_COMMERCE_ABI, ZERO_HOOK } from "@/lib/agentic-commerce-abi"

const ARC_RPC = "https://rpc.testnet.arc.network"
const ERC8183_ADDRESS = "0x319227cf1de5c61d11313af8226a8f5309fa70d9"

export class OnChainIntentPublisher {
  private publisher: IntentPublisher
  private signer: ethers.Wallet | null = null
  private jobMap = new Map<string, string>() // intentId → onChainJobId
  onChainEnabled = false

  constructor(publisher: IntentPublisher) {
    this.publisher = publisher
  }

  configure(privateKey: string): boolean {
    try {
      const key = privateKey.startsWith("0x") ? privateKey : "0x" + privateKey
      const provider = new ethers.JsonRpcProvider(ARC_RPC)
      this.signer = new ethers.Wallet(key, provider)
      this.onChainEnabled = true
      return true
    } catch {
      this.onChainEnabled = false
      return false
    }
  }

  async publish(intent: AgentIntent, onChain = false): Promise<string> {
    const id = await this.publisher.publish(intent)

    if (onChain && this.onChainEnabled && this.signer) {
      try {
        const contract = new ethers.Contract(ERC8183_ADDRESS, AGENTIC_COMMERCE_ABI, this.signer)
        const provider = new ethers.JsonRpcProvider(ARC_RPC)
        const block = await provider.getBlock("latest")
        const expiredAt = (block?.timestamp ?? Math.floor(Date.now() / 1000)) + 3600

        const description = JSON.stringify({
          intentId: id,
          agentId: intent.agentId,
          action: intent.action,
          params: intent.params,
          confidence: intent.confidence,
        })

        const tx = await contract.createJob(
          await this.signer.getAddress(),
          await this.signer.getAddress(),
          expiredAt,
          description,
          ZERO_HOOK,
        )
        const receipt = await tx.wait()
        if (!receipt || receipt.status === 0) throw new Error("createJob revertido")

        const iface = new ethers.Interface(AGENTIC_COMMERCE_ABI)
        const jobCreatedLog = receipt.logs.find((log: any) => {
          try {
            const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data })
            return parsed?.name === "JobCreated"
          } catch { return false }
        })
        if (jobCreatedLog) {
          const parsed = iface.parseLog({ topics: (jobCreatedLog as any).topics as string[], data: (jobCreatedLog as any).data })
          const jobId = parsed?.args?.jobId?.toString()
          if (jobId) {
            this.jobMap.set(id, jobId)
            this.publisher.recordResult(id, {
              success: true,
              profit: 0,
              txHash: tx.hash,
            })
            this.publisher.updateStatus(id, "APPROVED")
          }
        }
      } catch (e) {
        console.warn("[ONCHAIN] Erro ao publicar intent na Arc:", e)
      }
    }

    return id
  }

  async submitDeliverable(intentId: string, deliverableHash: string): Promise<boolean> {
    const jobId = this.jobMap.get(intentId)
    if (!jobId || !this.signer) return false

    try {
      const contract = new ethers.Contract(ERC8183_ADDRESS, AGENTIC_COMMERCE_ABI, this.signer)
      const tx = await contract.submit(jobId, deliverableHash, "0x")
      const receipt = await tx.wait()
      if (!receipt || receipt.status === 0) throw new Error("submit revertido")
      this.publisher.updateStatus(intentId, "COMPLETED")
      return true
    } catch (e) {
      console.warn("[ONCHAIN] Erro ao submeter deliverable:", e)
      return false
    }
  }

  async completeJob(intentId: string): Promise<boolean> {
    const jobId = this.jobMap.get(intentId)
    if (!jobId || !this.signer) return false

    try {
      const contract = new ethers.Contract(ERC8183_ADDRESS, AGENTIC_COMMERCE_ABI, this.signer)
      const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("intent-executed"))
      const tx = await contract.complete(jobId, reasonHash, "0x")
      const receipt = await tx.wait()
      if (!receipt || receipt.status === 0) throw new Error("complete revertido")
      return true
    } catch (e) {
      console.warn("[ONCHAIN] Erro ao completar job:", e)
      return false
    }
  }

  getOnChainJobId(intentId: string): string | null {
    return this.jobMap.get(intentId) ?? null
  }

  // Delegated methods
  getPublisher(): IntentPublisher { return this.publisher }
  getRecord(id: string): IntentRecord | null { return this.publisher.getRecord(id) }
  list(...args: Parameters<IntentPublisher["list"]>): IntentRecord[] { return this.publisher.list(...args) }
  getStats() { return this.publisher.getStats() }
  subscribe(cb: (record: IntentRecord) => void): () => void { return this.publisher.subscribe(cb) }
  recordVote(id: string, vote: { agentId: string; approved: boolean; confidence: number; reason: string }): boolean { return this.publisher.recordVote(id, vote) }
  updateStatus(id: string, status: import("./intent-types").IntentStatus): boolean { return this.publisher.updateStatus(id, status) }
}
