import { ethers } from "ethers"
import { IntentPublisher, type AgentIntent, type IntentRecord } from "./intent-publisher"
import { AGENTIC_COMMERCE_ABI, ZERO_HOOK } from "@/lib/agentic-commerce-abi"
import { DECISION_ANCHOR_ABI } from "@/lib/decision-anchor-abi"
import type { DecisionReport } from "./decision-report"
import type { OnChainProofReconciler } from "./onchain-proof-reconciler"
import type { OnChainProofOutbox } from "./onchain-proof-outbox"

const ARC_RPC = "https://rpc.testnet.arc.network"
const ERC8183_ADDRESS = "0x0747EEf0706327138c69792bF28Cd525089e4583"
const DECISION_ANCHOR_ADDRESS = (typeof process !== "undefined" && (process.env as any).NEXT_PUBLIC_DECISION_ANCHOR_ADDRESS) || "0x7813e04338dc9d6b7676843a52152c57438cc7b2"

export class OnChainIntentPublisher {
  private publisher: IntentPublisher
  private signer: ethers.Wallet | null = null
  private jobMap = new Map<string, string>() // intentId → onChainJobId
  private pendingProofs = new Map<string, { report: DecisionReport; retries: number }>()
  private proofReconciler: OnChainProofReconciler | null = null
  private durableOutbox: OnChainProofOutbox | null = null
  readonly MAX_RETRIES = 5
  onChainEnabled = false

  constructor(publisher: IntentPublisher) {
    this.publisher = publisher
    this.autoConfigureFromEnv()
  }

  /** Lê PRIVATE_KEY do .env e auto-configura (server-side apenas) */
  autoConfigureFromEnv(): boolean {
    try {
      if (typeof process === "undefined" || typeof window !== "undefined") {
        return false // só roda no servidor Node.js
      }
      const pk = (process.env as any).PRIVATE_KEY as string | undefined
      if (!pk) {
        console.log("[ONCHAIN] PRIVATE_KEY não definida — fallback off-chain")
        return false
      }
      return this.configure(pk)
    } catch {
      return false
    }
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

  getPendingCount(): number {
    return this.pendingProofs.size
  }

  setProofReconciler(reconciler: OnChainProofReconciler): void {
    this.proofReconciler = reconciler
  }

  setDurableOutbox(outbox: OnChainProofOutbox): void {
    this.durableOutbox = outbox
  }

  async retryPendingProofs(): Promise<number> {
    let resolved = 0
    for (const [id, entry] of this.pendingProofs) {
      const result = await this.anchorDecisionInternal(id, entry.report, false)
      if (result) {
        if (this.proofReconciler?.reconcileConfirmedProof(id, result).reconciled) {
          this.pendingProofs.delete(id)
          resolved++
        }
      } else {
        entry.retries++
        if (entry.retries >= this.MAX_RETRIES) {
          console.warn(`[ONCHAIN] ⏭️ Desistindo de ancorar ${id} após ${this.MAX_RETRIES} tentativas`)
          if (this.proofReconciler?.reconcileFailedProof(id).reconciled) {
            this.pendingProofs.delete(id)
          }
        }
      }
    }
    return resolved
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

  async anchorDecision(id: string, report: DecisionReport): Promise<{ txHash: string; blockNumber: number; hash: string } | null> {
    return this.anchorDecisionInternal(id, report, true)
  }

  private async anchorDecisionInternal(id: string, report: DecisionReport, enqueueOnFailure: boolean): Promise<{ txHash: string; blockNumber: number; hash: string } | null> {
    const baseMeta = {
      decisionReportHash: "",
      intentId: report.intentId,
      agentId: report.agentId,
      action: report.action,
      status: report.execution?.success ? "COMPLETED" : "FAILED",
      executionTxHash: report.execution?.txHash ?? "",
      timestamp: report.createdAt,
    }
    const hash = ethers.solidityPackedKeccak256(["string"], [JSON.stringify(baseMeta)])
    const metaWithHash = JSON.stringify({ ...baseMeta, decisionReportHash: hash })
    try {
      if (this.onChainEnabled && this.signer) {
        // Server-side: assina direto com ethers
        const contract = new ethers.Contract(DECISION_ANCHOR_ADDRESS, DECISION_ANCHOR_ABI, this.signer)
        const tx = await contract.anchor(hash, metaWithHash, { gasLimit: 200000 })
        const receipt = await tx.wait()
        if (!receipt || receipt.status === 0) throw new Error("anchor revertido")

        console.log(`[ONCHAIN] 🔗 Decision anchored: ${id} → tx:${tx.hash} block:${receipt.blockNumber} hash:${hash.slice(0, 18)}...`)
        return { txHash: tx.hash, blockNumber: receipt.blockNumber, hash }
      }

      // Browser: delega para API route server-side
      const res = await fetch("/api/anchor-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash, metadataURI: metaWithHash }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      console.log(`[ONCHAIN] 🔗 Decision anchored via API: ${id} → tx:${data.txHash} block:${data.blockNumber} hash:${hash.slice(0, 18)}...`)
      return data
    } catch (e) {
      console.warn(`[ONCHAIN] ⏳ Anchor falhou para ${id} — marcando como pending (retry ${(this.pendingProofs.get(id)?.retries ?? 0) + 1}/${this.MAX_RETRIES})`, e)
      // Redis outbox is authoritative when configured. The legacy in-memory
      // queue is retained only as a local/offline fallback, never in parallel.
      if (enqueueOnFailure && !this.durableOutbox && !this.pendingProofs.has(id)) {
        this.pendingProofs.set(id, { report, retries: 0 })
      }
      if (enqueueOnFailure && this.durableOutbox && report.auditId) {
        await this.durableOutbox.enqueue({
          intentId: id, decisionReportId: report.id, auditId: report.auditId,
          decisionHash: hash, compactPayload: metaWithHash, nextAttemptAt: Date.now(), lastError: e instanceof Error ? e.message : String(e),
        })
      }
      return null
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
  recordVote(id: string, vote: { agentId: string; approved: boolean; confidence: number; reputationWeight?: number; knowledgeWeight?: number; reason: string }): boolean { return this.publisher.recordVote(id, vote) }
  recordResult(id: string, result: { success: boolean; profit: number; txHash?: string; errorMsg?: string }): boolean { return this.publisher.recordResult(id, result) }
  updateStatus(id: string, status: import("./intent-types").IntentStatus): boolean { return this.publisher.updateStatus(id, status) }
  setDecisionReport(id: string, report: import("./decision-report").DecisionReport): boolean { return this.publisher.setDecisionReport(id, report) }
}
