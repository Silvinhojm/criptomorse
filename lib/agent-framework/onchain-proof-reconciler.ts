import type { IAudit, AuditEntry } from "./IAudit"
import type { DecisionReport } from "./decision-report"
import type { IIntentPublisher } from "./intent-types"
import type { IDecisionEvidenceStore } from "./decision-evidence-store"

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
    private readonly intents: Pick<IIntentPublisher, "publish" | "getRecord" | "setDecisionReport">,
    private readonly audit: Pick<IAudit, "record" | "getById" | "updateEntry">,
    private readonly evidenceStore?: IDecisionEvidenceStore,
  ) {}

  reconcileConfirmedProof(intentId: string, proof: ConfirmedOnChainProof): Promise<ProofReconciliationResult> {
    return this.reconcile(intentId, {
      onChainHash: proof.hash,
      onChainTx: proof.txHash,
      onChainStatus: "confirmed",
    })
  }

  reconcileFailedProof(intentId: string): Promise<ProofReconciliationResult> {
    return this.reconcile(intentId, { onChainStatus: "failed" })
  }

  private async reconcile(
    intentId: string,
    patch: Pick<DecisionReport, "onChainStatus"> & Partial<Pick<DecisionReport, "onChainHash" | "onChainTx">>,
  ): Promise<ProofReconciliationResult> {
    if (this.evidenceStore) return this.reconcileDurable(intentId, patch)

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

  private async reconcileDurable(
    intentId: string,
    patch: Pick<DecisionReport, "onChainStatus"> & Partial<Pick<DecisionReport, "onChainHash" | "onChainTx">>,
  ): Promise<ProofReconciliationResult> {
    const current = await this.evidenceStore!.getDecisionReport(intentId)
    if (!current?.report.auditId) {
      return { reconciled: false, idempotent: false, error: "legacy_evidence_missing" }
    }
    const audit = await this.evidenceStore!.getAuditEntry(current.report.auditId)
    if (!audit) return { reconciled: false, idempotent: false, error: "legacy_evidence_missing" }

    const result = await this.evidenceStore!.reconcileProof(intentId, current.report.auditId, patch)
    if (!result.reconciled) return result

    const reportAfter = await this.evidenceStore!.getDecisionReport(intentId)
    const auditAfter = await this.evidenceStore!.getAuditEntry(current.report.auditId)
    if (!reportAfter || !auditAfter || !this.matches(reportAfter.report, auditAfter.entry, patch)) {
      return { reconciled: false, idempotent: false, error: "proof_write_verification_failed" }
    }

    // Cache hydration is compatibility-only. Redis is the canonical evidence.
    if (!this.intents.getRecord(intentId)) {
      await this.intents.publish({
        id: intentId,
        agentId: reportAfter.report.agentId,
        action: reportAfter.report.action,
        params: reportAfter.report.params,
        confidence: reportAfter.report.voting?.confidence ?? 0,
        timestamp: reportAfter.report.createdAt,
      })
    }
    this.intents.setDecisionReport(intentId, reportAfter.report)
    if (!this.audit.getById?.(auditAfter.entry.id)) this.audit.record(auditAfter.entry)
    else this.audit.updateEntry(auditAfter.entry.id, this.proofSnapshot(auditAfter.entry))
    return { reconciled: true, idempotent: result.idempotent }
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
