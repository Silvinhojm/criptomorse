import type { AuditEntry } from "./IAudit"
import type { DecisionReport } from "./decision-report"

export interface VersionedDecisionReport {
  version: number
  report: DecisionReport
}

export interface VersionedAuditEntry {
  version: number
  entry: AuditEntry
}

export interface EvidenceWriteResult {
  saved: boolean
  version?: number
  error?: string
}

export interface EvidenceReconcileResult {
  reconciled: boolean
  idempotent: boolean
  error?: "legacy_evidence_missing" | "audit_link_mismatch" | "confirmed_proof_conflict" | "evidence_write_failed"
}

export interface IDecisionEvidenceStore {
  getDecisionReport(intentId: string): Promise<VersionedDecisionReport | null>
  getAuditEntry(auditId: string): Promise<VersionedAuditEntry | null>
  saveDecisionReport(intentId: string, report: DecisionReport): Promise<EvidenceWriteResult>
  saveAuditEntry(entry: AuditEntry): Promise<EvidenceWriteResult>
  reconcileProof(
    intentId: string,
    auditId: string,
    patch: Pick<DecisionReport, "onChainStatus"> & Partial<Pick<DecisionReport, "onChainHash" | "onChainTx">>,
  ): Promise<EvidenceReconcileResult>
}

/** Shared-memory implementation for deterministic cold-start/concurrency tests. */
export class MemoryDecisionEvidenceStore implements IDecisionEvidenceStore {
  private reports = new Map<string, VersionedDecisionReport>()
  private audits = new Map<string, VersionedAuditEntry>()
  private serial: Promise<void> = Promise.resolve()

  private async locked<T>(operation: () => T): Promise<T> {
    let release!: () => void
    const previous = this.serial
    this.serial = new Promise<void>(resolve => { release = resolve })
    await previous
    try { return operation() } finally { release() }
  }

  async getDecisionReport(intentId: string): Promise<VersionedDecisionReport | null> {
    const value = this.reports.get(intentId)
    return value ? { version: value.version, report: structuredClone(value.report) } : null
  }

  async getAuditEntry(auditId: string): Promise<VersionedAuditEntry | null> {
    const value = this.audits.get(auditId)
    return value ? { version: value.version, entry: structuredClone(value.entry) } : null
  }

  saveDecisionReport(intentId: string, report: DecisionReport): Promise<EvidenceWriteResult> {
    return this.locked(() => {
      const current = this.reports.get(intentId)
      const candidate = structuredClone(report)
      if (current?.report.onChainStatus === "confirmed") {
        candidate.onChainStatus = "confirmed"
        candidate.onChainHash = current.report.onChainHash
        candidate.onChainTx = current.report.onChainTx
      }
      const version = (current?.version ?? 0) + 1
      this.reports.set(intentId, { version, report: candidate })
      return { saved: true, version }
    })
  }

  saveAuditEntry(entry: AuditEntry): Promise<EvidenceWriteResult> {
    return this.locked(() => {
      const current = this.audits.get(entry.id)
      const candidate = structuredClone(entry)
      if (current?.entry.onChainStatus === "confirmed") {
        candidate.onChainStatus = "confirmed"
        candidate.onChainHash = current.entry.onChainHash
        candidate.onChainTx = current.entry.onChainTx
      }
      const version = (current?.version ?? 0) + 1
      this.audits.set(entry.id, { version, entry: candidate })
      return { saved: true, version }
    })
  }

  reconcileProof(
    intentId: string,
    auditId: string,
    patch: Pick<DecisionReport, "onChainStatus"> & Partial<Pick<DecisionReport, "onChainHash" | "onChainTx">>,
  ): Promise<EvidenceReconcileResult> {
    return this.locked(() => {
      const reportValue = this.reports.get(intentId)
      const auditValue = this.audits.get(auditId)
      if (!reportValue || !auditValue) return { reconciled: false, idempotent: false, error: "legacy_evidence_missing" }
      if (reportValue.report.auditId !== auditId) return { reconciled: false, idempotent: false, error: "audit_link_mismatch" }
      if (patch.onChainStatus === "confirmed" && reportValue.report.onChainStatus === "confirmed" &&
          (reportValue.report.onChainHash !== patch.onChainHash || reportValue.report.onChainTx !== patch.onChainTx)) {
        return { reconciled: false, idempotent: false, error: "confirmed_proof_conflict" }
      }
      const already = reportValue.report.onChainStatus === patch.onChainStatus &&
        auditValue.entry.onChainStatus === patch.onChainStatus &&
        (patch.onChainHash === undefined || (reportValue.report.onChainHash === patch.onChainHash && auditValue.entry.onChainHash === patch.onChainHash)) &&
        (patch.onChainTx === undefined || (reportValue.report.onChainTx === patch.onChainTx && auditValue.entry.onChainTx === patch.onChainTx))
      if (already) return { reconciled: true, idempotent: true }
      this.reports.set(intentId, { version: reportValue.version + 1, report: { ...reportValue.report, ...patch } })
      this.audits.set(auditId, { version: auditValue.version + 1, entry: { ...auditValue.entry, ...patch } })
      return { reconciled: true, idempotent: false }
    })
  }
}
