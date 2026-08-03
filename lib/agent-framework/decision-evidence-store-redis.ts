import type { Redis } from "@upstash/redis"
import {
  auditEvidenceIndexKvKey,
  auditEvidenceKvKey,
  decisionReportEvidenceIndexKvKey,
  decisionReportEvidenceKvKey,
} from "@/lib/kv"
import type { AuditEntry } from "./IAudit"
import type { DecisionReport } from "./decision-report"
import type {
  EvidenceReconcileResult,
  EvidenceWriteResult,
  IDecisionEvidenceStore,
  VersionedAuditEntry,
  VersionedDecisionReport,
} from "./decision-evidence-store"

export interface DecisionEvidenceRedisClient {
  eval<TArgs extends unknown[], TData = unknown>(script: string, keys: string[], args: TArgs): Promise<TData>
  hgetall<TData extends Record<string, unknown>>(key: string): Promise<TData | null>
}

const SAVE_CAS_LUA = `
local current = tonumber(redis.call('HGET', KEYS[1], 'version') or '0')
if current ~= tonumber(ARGV[1]) then return {0, current} end
local next = current + 1
redis.call('HSET', KEYS[1],
  'version', tostring(next), ARGV[7], ARGV[2], 'payload', ARGV[4],
  'createdAt', ARGV[5], 'updatedAt', ARGV[6])
if ARGV[8] ~= '' then redis.call('HSET', KEYS[1], ARGV[8], ARGV[3]) end
redis.call('ZADD', KEYS[2], ARGV[5], ARGV[2])
return {1, next}
`

const RECONCILE_LUA = `
local reportRaw = redis.call('HGET', KEYS[1], 'payload')
local auditRaw = redis.call('HGET', KEYS[2], 'payload')
if not reportRaw or not auditRaw then return {0, 'legacy_evidence_missing'} end
local okReport, report = pcall(cjson.decode, reportRaw)
local okAudit, audit = pcall(cjson.decode, auditRaw)
if not okReport or not okAudit then return {0, 'evidence_write_failed'} end
if report['auditId'] ~= ARGV[1] then return {0, 'audit_link_mismatch'} end
if ARGV[4] == 'confirmed' and report['onChainStatus'] == 'confirmed' then
  if report['onChainHash'] ~= ARGV[2] or report['onChainTx'] ~= ARGV[3] then
    return {0, 'confirmed_proof_conflict'}
  end
end
local already = report['onChainStatus'] == ARGV[4] and audit['onChainStatus'] == ARGV[4]
if ARGV[2] ~= '' then already = already and report['onChainHash'] == ARGV[2] and audit['onChainHash'] == ARGV[2] end
if ARGV[3] ~= '' then already = already and report['onChainTx'] == ARGV[3] and audit['onChainTx'] == ARGV[3] end
if already then return {1, 'idempotent'} end
report['onChainStatus'] = ARGV[4]
audit['onChainStatus'] = ARGV[4]
if ARGV[2] ~= '' then report['onChainHash'] = ARGV[2]; audit['onChainHash'] = ARGV[2] end
if ARGV[3] ~= '' then report['onChainTx'] = ARGV[3]; audit['onChainTx'] = ARGV[3] end
local reportVersion = tonumber(redis.call('HGET', KEYS[1], 'version') or '0') + 1
local auditVersion = tonumber(redis.call('HGET', KEYS[2], 'version') or '0') + 1
redis.call('HSET', KEYS[1], 'version', tostring(reportVersion), 'payload', cjson.encode(report), 'updatedAt', ARGV[5])
redis.call('HSET', KEYS[2], 'version', tostring(auditVersion), 'payload', cjson.encode(audit), 'updatedAt', ARGV[5])
return {1, 'updated'}
`

export class RedisDecisionEvidenceStore implements IDecisionEvidenceStore {
  constructor(private readonly redis: DecisionEvidenceRedisClient | Redis) {}

  async getDecisionReport(intentId: string): Promise<VersionedDecisionReport | null> {
    const raw = await this.redis.hgetall<Record<string, unknown>>(decisionReportEvidenceKvKey(intentId))
    if (!raw?.payload) return null
    return { version: Number(raw.version), report: this.parseJson<DecisionReport>(raw.payload) }
  }

  async getAuditEntry(auditId: string): Promise<VersionedAuditEntry | null> {
    const raw = await this.redis.hgetall<Record<string, unknown>>(auditEvidenceKvKey(auditId))
    if (!raw?.payload) return null
    return { version: Number(raw.version), entry: this.parseJson<AuditEntry>(raw.payload) }
  }

  async saveDecisionReport(intentId: string, report: DecisionReport): Promise<EvidenceWriteResult> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.getDecisionReport(intentId)
      const candidate = current ? this.mergeReport(current.report, report) : report
      const result = await this.saveCas(
        decisionReportEvidenceKvKey(intentId), decisionReportEvidenceIndexKvKey(),
        current?.version ?? 0, intentId, candidate.id, candidate.createdAt, candidate,
        "intentId", "decisionReportId",
      )
      if (result.saved) return result
    }
    return { saved: false, error: "decision_report_cas_exhausted" }
  }

  async saveAuditEntry(entry: AuditEntry): Promise<EvidenceWriteResult> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.getAuditEntry(entry.id)
      const candidate = current ? this.mergeAudit(current.entry, entry) : entry
      const result = await this.saveCas(
        auditEvidenceKvKey(entry.id), auditEvidenceIndexKvKey(),
        current?.version ?? 0, entry.id, "", candidate.timestamp, candidate,
        "auditId", "",
      )
      if (result.saved) return result
    }
    return { saved: false, error: "audit_cas_exhausted" }
  }

  async reconcileProof(
    intentId: string,
    auditId: string,
    patch: Pick<DecisionReport, "onChainStatus"> & Partial<Pick<DecisionReport, "onChainHash" | "onChainTx">>,
  ): Promise<EvidenceReconcileResult> {
    const raw = await this.redis.eval(
      RECONCILE_LUA,
      [decisionReportEvidenceKvKey(intentId), auditEvidenceKvKey(auditId)],
      [auditId, patch.onChainHash ?? "", patch.onChainTx ?? "", patch.onChainStatus, Date.now()],
    ) as unknown
    const result = Array.isArray(raw) ? raw : []
    if (Number(result[0]) === 1) return { reconciled: true, idempotent: result[1] === "idempotent" }
    const error = String(result[1] ?? "evidence_write_failed") as EvidenceReconcileResult["error"]
    return { reconciled: false, idempotent: false, error }
  }

  private async saveCas(
    key: string, indexKey: string, expectedVersion: number, entityId: string,
    secondaryId: string, createdAt: number, payload: unknown,
    entityField: "intentId" | "auditId", secondaryField: "decisionReportId" | "",
  ): Promise<EvidenceWriteResult> {
    const raw = await this.redis.eval(SAVE_CAS_LUA, [key, indexKey], [
      expectedVersion, entityId, secondaryId, JSON.stringify(payload), createdAt, Date.now(),
      entityField, secondaryField,
    ]) as unknown
    const result = Array.isArray(raw) ? raw : []
    return Number(result[0]) === 1
      ? { saved: true, version: Number(result[1]) }
      : { saved: false, version: Number(result[1]), error: "version_conflict" }
  }

  private parseJson<T>(value: unknown): T {
    if (typeof value === "string") return JSON.parse(value) as T
    return value as T
  }

  private mergeReport(current: DecisionReport, incoming: DecisionReport): DecisionReport {
    const merged: DecisionReport = {
      ...current,
      ...incoming,
      createdAt: current.createdAt,
      auditId: incoming.auditId ?? current.auditId,
      execution: current.execution || incoming.execution
        ? { ...(current.execution ?? {}), ...(incoming.execution ?? {}) } as DecisionReport["execution"]
        : undefined,
    }
    if (current.onChainStatus === "confirmed") {
      merged.onChainStatus = "confirmed"
      merged.onChainHash = current.onChainHash
      merged.onChainTx = current.onChainTx
    }
    if (current.execution?.canonicalSettlement === true && merged.execution) {
      merged.execution = { ...merged.execution, ...current.execution }
    }
    return merged
  }

  private mergeAudit(current: AuditEntry, incoming: AuditEntry): AuditEntry {
    const merged = { ...current, ...incoming, timestamp: current.timestamp }
    if (current.onChainStatus === "confirmed") {
      merged.onChainStatus = "confirmed"
      merged.onChainHash = current.onChainHash
      merged.onChainTx = current.onChainTx
    }
    return merged
  }
}
