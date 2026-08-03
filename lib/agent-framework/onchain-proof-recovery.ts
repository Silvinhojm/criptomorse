import { randomUUID } from "crypto"
import type { OnChainProofReconciler, ConfirmedOnChainProof } from "./onchain-proof-reconciler"
import type { OnChainProofOutbox, OnChainProofOutboxItem } from "./onchain-proof-outbox"

export interface OnChainProofBroadcaster {
  findKnownProof(item: OnChainProofOutboxItem): Promise<ConfirmedOnChainProof | null>
  /** A future signer must call persistKnownProof after signing and before network broadcast. */
  broadcast(item: OnChainProofOutboxItem, persistKnownProof: (proof: ConfirmedOnChainProof) => Promise<void>): Promise<ConfirmedOnChainProof>
}

export interface RecoveryRunResult {
  status: "idle" | "confirmed" | "retry_scheduled" | "dead_letter"
  intentId?: string
  attempts?: number
}

export class OnChainProofRecoveryService {
  readonly maxAttempts: number
  constructor(
    private readonly outbox: OnChainProofOutbox,
    private readonly reconciler: OnChainProofReconciler,
    private readonly broadcaster: OnChainProofBroadcaster,
    maxAttempts = 5,
  ) { this.maxAttempts = maxAttempts }

  async runOnce(now = Date.now(), owner: string = randomUUID()): Promise<RecoveryRunResult> {
    const item = await this.outbox.claimDue(owner, now)
    if (!item) return { status: "idle" }
    try {
      let proof: ConfirmedOnChainProof | null = null
      if (item.txHash && item.blockNumber !== undefined) {
        proof = { hash: item.decisionHash, txHash: item.txHash, blockNumber: item.blockNumber }
      } else {
        proof = await this.broadcaster.findKnownProof(item)
        if (proof) {
          if (!await this.outbox.recordKnownProof(item.intentId, owner, proof)) throw new Error("known_proof_persist_failed")
        } else {
          let persistedBeforeBroadcast = false
          proof = await this.broadcaster.broadcast(item, async prepared => {
            if (!await this.outbox.recordKnownProof(item.intentId, owner, prepared)) throw new Error("known_proof_persist_failed")
            persistedBeforeBroadcast = true
          })
          if (!persistedBeforeBroadcast) throw new Error("broadcaster_did_not_persist_before_send")
        }
      }

      const result = this.reconciler.reconcileConfirmedProof(item.intentId, proof)
      if (!result.reconciled) throw new Error(result.error ?? "reconciliation_failed")
      if (!await this.outbox.complete(item.intentId, owner)) throw new Error("outbox_ack_failed")
      return { status: "confirmed", intentId: item.intentId, attempts: item.attempts }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const exhausted = item.attempts >= this.maxAttempts
      const backoff = Math.min(15 * 60_000, 30_000 * (2 ** Math.max(0, item.attempts - 1)))
      let canDeadLetter = exhausted
      if (exhausted) {
        const failed = this.reconciler.reconcileFailedProof(item.intentId)
        canDeadLetter = failed.reconciled
      }
      await this.outbox.retry(item.intentId, owner, message, now + backoff, canDeadLetter)
      return { status: canDeadLetter ? "dead_letter" : "retry_scheduled", intentId: item.intentId, attempts: item.attempts }
    }
  }
}

/** RI-BANK-28 is deliberately not authorized to broadcast or sign. */
export class DisabledOnChainProofBroadcaster implements OnChainProofBroadcaster {
  async findKnownProof(): Promise<ConfirmedOnChainProof | null> { return null }
  async broadcast(_item: OnChainProofOutboxItem, _persistKnownProof: (proof: ConfirmedOnChainProof) => Promise<void>): Promise<ConfirmedOnChainProof> {
    throw new Error("onchain_broadcast_not_authorized")
  }
}
