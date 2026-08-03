import type { IAudit, AuditEntry } from "./IAudit"
import type { DecisionReport } from "./decision-report"
import type { IIntentPublisher } from "./intent-types"

export interface ConfirmedOnChainProof {
  hash: string
  txHash: string
  blockNumber: number
}

export interface ProofReconciliationResult {
  reconciled: boolean
  idempotent: boolean
  error?: string
}

/**
 * Single write path for DecisionReport + Audit on-chain proof state.
 * The queue item must only be acknowledged after this method returns success.
 */
export class OnChainProofReconciler {
  constructor(
    private readonly intents: Pick<IIntentPublisher, "getRecord" | "setDecisionReport">,
    private readonly audit: Pick<IAudit, "getById" | "updateEntry">,
  ) {}

  reconcileConfirmedProof(intentId: string, proof: ConfirmedOnChainProof): ProofReconciliationResult {
    return this.reconcile(intentId, {
      onChainHash: proof.hash,
      onChainTx: proof.txHash,
      onChainStatus: "confirmed",
    })
  }

  reconcileFailedProof(intentId: string): ProofReconciliationResult {
    return this.reconcile(intentId, { onChainStatus: "failed" })
  }

  private reconcile(
    intentId: string,
    patch: Pick<DecisionReport, "onChainStatus"> & Partial<Pick<DecisionReport, "onChainHash" | "onChainTx">>,
  ): ProofReconciliationResult {
    const current = this.intents.getRecord(intentId)?.decisionReport
    if (!current) return { reconciled: false, idempotent: false, error: "decision_report_not_found" }
    if (!current.auditId) return { reconciled: false, idempotent: false, error: "audit_id_missing" }
    if (!this.audit.getById) return { reconciled: false, idempotent: false, error: "audit_readback_unavailable" }
    const auditBefore = this.audit.getById(current.auditId)
    if (!auditBefore) return { reconciled: false, idempotent: false, error: "audit_entry_not_found" }

    if (patch.onChainStatus === "confirmed") {
      if (current.onChainStatus === "confirmed" &&
          (current.onChainHash !== patch.onChainHash || current.onChainTx !== patch.onChainTx)) {
        return { reconciled: false, idempotent: false, error: "confirmed_proof_conflict" }
      }
    }

    if (this.matches(current, auditBefore, patch)) {
      return { reconciled: true, idempotent: true }
    }

    const reportBefore = { ...current }
    const reportAfter: DecisionReport = { ...current, ...patch }
    if (!this.intents.setDecisionReport(intentId, reportAfter)) {
      return { reconciled: false, idempotent: false, error: "decision_report_write_failed" }
    }
    if (!this.audit.updateEntry(current.auditId, patch)) {
      this.intents.setDecisionReport(intentId, reportBefore)
      return { reconciled: false, idempotent: false, error: "audit_write_failed" }
    }

    const reportVerify = this.intents.getRecord(intentId)?.decisionReport
    const auditVerify = this.audit.getById(current.auditId)
    if (!reportVerify || !auditVerify || !this.matches(reportVerify, auditVerify, patch)) {
      this.intents.setDecisionReport(intentId, reportBefore)
      this.audit.updateEntry(current.auditId, this.proofSnapshot(auditBefore))
      return { reconciled: false, idempotent: false, error: "proof_write_verification_failed" }
    }
    return { reconciled: true, idempotent: false }
  }

  private matches(report: DecisionReport, audit: AuditEntry, patch: Partial<DecisionReport>): boolean {
    return report.onChainStatus === patch.onChainStatus &&
      audit.onChainStatus === patch.onChainStatus &&
      (patch.onChainHash === undefined || (report.onChainHash === patch.onChainHash && audit.onChainHash === patch.onChainHash)) &&
      (patch.onChainTx === undefined || (report.onChainTx === patch.onChainTx && audit.onChainTx === patch.onChainTx))
  }

  private proofSnapshot(entry: AuditEntry): Partial<Pick<AuditEntry, "onChainHash" | "onChainTx" | "onChainStatus">> {
    return { onChainHash: entry.onChainHash, onChainTx: entry.onChainTx, onChainStatus: entry.onChainStatus }
  }
}
