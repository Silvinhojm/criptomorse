import { createHash, randomUUID } from "node:crypto"

import type { Redis } from "@upstash/redis"

import {
  cronAuditEntryKvKey,
  cronAuditIndexKvKey,
  cronAuthorizedRoutesKvKey,
  cronKillSwitchKvKey,
  cronLeaseKvKey,
  cronMainnetConfirmedKvKey,
  cronPlanKvKey,
} from "@/lib/kv"

export type CronRiskBox = "A" | "B"
export type CronPlanStatus = "ready" | "processing" | "completed" | "blocked" | "failed"

export interface CronTradingPlanInput {
  id: string
  network: string
  fromToken: string
  toToken: string
  strategy: string
  riskBox: CronRiskBox
  amountUsd: number
}

export interface CronTradingPlan extends CronTradingPlanInput {
  status: CronPlanStatus
  materialFingerprint: string
  createdAt: number
  updatedAt: number
  attempts: number
  leaseOwner?: string
  lastReason?: string
  txHash?: string
}

export interface CronRouteAuthorization {
  routeIdentity: string
  materialFingerprint: string
  manualDispatchRef: string
  authorizedAt: number
}

export interface CronAuditEvent {
  id: string
  timestamp: number
  invocationId: string
  planId?: string
  mode: "mode_1" | "mode_2"
  outcome: string
  reason: string
  txHash?: string
  source?: "manual-test"
  actor?: string
  manualDispatchRef?: string
  payload?: Record<string, string | boolean>
  synthetic?: boolean
}

export interface CronTradingStateStore {
  getKillSwitch(): Promise<boolean>
  setKillSwitch(enabled: boolean): Promise<void>
  getMainnetConfirmed(): Promise<boolean>
  setMainnetConfirmed(enabled: boolean): Promise<void>
  getPlan(): Promise<CronTradingPlan | null>
  savePlan(input: CronTradingPlanInput, now?: number): Promise<CronTradingPlan>
  authorizeCurrentRoute(planId: string, manualDispatchRef: string, now?: number): Promise<CronRouteAuthorization>
  isRouteAuthorized(plan: CronTradingPlan): Promise<boolean>
  claimPlan(planId: string, owner: string, now?: number): Promise<CronTradingPlan | null>
  transitionPlan(
    planId: string,
    owner: string,
    status: Exclude<CronPlanStatus, "ready" | "processing">,
    reason: string,
    txHash?: string,
    now?: number,
  ): Promise<boolean>
  appendAudit(event: Omit<CronAuditEvent, "id">): Promise<CronAuditEvent>
}

const CRON_AUDIT_RETENTION_SECONDS = 30 * 24 * 60 * 60
const CRON_LEASE_MS = 60_000

export function cronRouteIdentity(plan: Pick<CronTradingPlanInput, "network" | "fromToken" | "toToken" | "strategy">): string {
  return `${plan.network}:${plan.fromToken}->${plan.toToken}:${plan.strategy}`
}

export function cronMaterialFingerprint(plan: CronTradingPlanInput): string {
  const material = JSON.stringify({
    network: plan.network,
    fromToken: plan.fromToken,
    toToken: plan.toToken,
    strategy: plan.strategy,
    riskBox: plan.riskBox,
    amountUsd: plan.amountUsd,
  })
  return createHash("sha256").update(material).digest("hex")
}

function routeField(plan: Pick<CronTradingPlanInput, "network" | "fromToken" | "toToken" | "strategy">): string {
  return createHash("sha256").update(cronRouteIdentity(plan)).digest("hex")
}

function normalizePlanInput(input: CronTradingPlanInput): CronTradingPlanInput {
  const normalized = {
    id: input.id.trim(),
    network: input.network.trim(),
    fromToken: input.fromToken.trim().toUpperCase(),
    toToken: input.toToken.trim().toUpperCase(),
    strategy: input.strategy.trim(),
    riskBox: input.riskBox,
    amountUsd: Number(input.amountUsd),
  }
  if (!normalized.id || !normalized.network || !normalized.fromToken || !normalized.toToken || !normalized.strategy) {
    throw new Error("cron_plan_required_field_missing")
  }
  if (normalized.fromToken === normalized.toToken) throw new Error("cron_plan_pair_must_differ")
  if (normalized.riskBox !== "A" && normalized.riskBox !== "B") throw new Error("cron_plan_invalid_risk_box")
  if (!Number.isFinite(normalized.amountUsd) || normalized.amountUsd <= 0) throw new Error("cron_plan_invalid_amount")
  return normalized
}

const CLAIM_PLAN_LUA = `
local currentId = redis.call('HGET', KEYS[1], 'id')
if currentId ~= ARGV[1] then return nil end
if redis.call('HGET', KEYS[1], 'status') ~= 'ready' then return nil end
local acquired = redis.call('SET', KEYS[2], ARGV[2], 'NX', 'PX', ARGV[4])
if not acquired then return nil end
redis.call('HINCRBY', KEYS[1], 'attempts', 1)
redis.call('HSET', KEYS[1], 'status', 'processing', 'leaseOwner', ARGV[2], 'updatedAt', ARGV[3])
return redis.call('HGETALL', KEYS[1])
`

const SAVE_PLAN_LUA = `
if redis.call('HGET', KEYS[1], 'status') == 'processing' then return 0 end
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1],
  'id', ARGV[1], 'network', ARGV[2], 'fromToken', ARGV[3], 'toToken', ARGV[4],
  'strategy', ARGV[5], 'riskBox', ARGV[6], 'amountUsd', ARGV[7], 'status', ARGV[8],
  'materialFingerprint', ARGV[9], 'createdAt', ARGV[10], 'updatedAt', ARGV[11],
  'attempts', ARGV[12], 'leaseOwner', '', 'lastReason', '', 'txHash', '')
return 1
`

const TRANSITION_PLAN_LUA = `
if redis.call('HGET', KEYS[1], 'id') ~= ARGV[1] then return 0 end
if redis.call('HGET', KEYS[1], 'status') ~= 'processing' then return 0 end
if redis.call('HGET', KEYS[1], 'leaseOwner') ~= ARGV[2] then return 0 end
redis.call('HSET', KEYS[1], 'status', ARGV[3], 'lastReason', ARGV[4], 'txHash', ARGV[5], 'updatedAt', ARGV[6])
redis.call('HDEL', KEYS[1], 'leaseOwner')
if redis.call('GET', KEYS[2]) == ARGV[2] then redis.call('DEL', KEYS[2]) end
return 1
`

const APPEND_AUDIT_LUA = `
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[5])
return 1
`

export class RedisCronTradingStateStore implements CronTradingStateStore {
  constructor(private readonly redis: Redis) {}

  async getKillSwitch(): Promise<boolean> {
    return String((await this.redis.get(cronKillSwitchKvKey())) ?? "0") === "1"
  }

  async setKillSwitch(enabled: boolean): Promise<void> {
    await this.redis.set(cronKillSwitchKvKey(), enabled ? "1" : "0")
  }

  async getMainnetConfirmed(): Promise<boolean> {
    return String((await this.redis.get(cronMainnetConfirmedKvKey())) ?? "0") === "1"
  }

  async setMainnetConfirmed(enabled: boolean): Promise<void> {
    await this.redis.set(cronMainnetConfirmedKvKey(), enabled ? "1" : "0")
  }

  async getPlan(): Promise<CronTradingPlan | null> {
    return parsePlan(await this.redis.hgetall<Record<string, unknown>>(cronPlanKvKey()))
  }

  async savePlan(input: CronTradingPlanInput, now = Date.now()): Promise<CronTradingPlan> {
    const normalized = normalizePlanInput(input)
    const plan: CronTradingPlan = {
      ...normalized,
      status: "ready",
      materialFingerprint: cronMaterialFingerprint(normalized),
      createdAt: now,
      updatedAt: now,
      attempts: 0,
    }
    const saved = Number(await this.redis.eval(SAVE_PLAN_LUA, [cronPlanKvKey()], [
      plan.id, plan.network, plan.fromToken, plan.toToken, plan.strategy, plan.riskBox,
      plan.amountUsd, plan.status, plan.materialFingerprint, plan.createdAt, plan.updatedAt, plan.attempts,
    ])) === 1
    if (!saved) throw new Error("cron_plan_processing")
    return plan
  }

  async authorizeCurrentRoute(planId: string, manualDispatchRef: string, now = Date.now()): Promise<CronRouteAuthorization> {
    const plan = await this.getPlan()
    if (!plan || plan.id !== planId) throw new Error("cron_plan_not_found_or_stale")
    const dispatchRef = manualDispatchRef.trim()
    if (!dispatchRef) throw new Error("manual_dispatch_ref_required")
    const authorization: CronRouteAuthorization = {
      routeIdentity: cronRouteIdentity(plan),
      materialFingerprint: plan.materialFingerprint,
      manualDispatchRef: dispatchRef,
      authorizedAt: now,
    }
    await this.redis.hset(cronAuthorizedRoutesKvKey(), { [routeField(plan)]: JSON.stringify(authorization) })
    return authorization
  }

  async isRouteAuthorized(plan: CronTradingPlan): Promise<boolean> {
    const raw = await this.redis.hget<unknown>(cronAuthorizedRoutesKvKey(), routeField(plan))
    if (!raw) return false
    const parsed = typeof raw === "string" ? JSON.parse(raw) as CronRouteAuthorization : raw as CronRouteAuthorization
    return parsed.routeIdentity === cronRouteIdentity(plan) && parsed.materialFingerprint === plan.materialFingerprint
  }

  async claimPlan(planId: string, owner: string, now = Date.now()): Promise<CronTradingPlan | null> {
    const raw = await this.redis.eval(CLAIM_PLAN_LUA, [cronPlanKvKey(), cronLeaseKvKey()], [planId, owner, now, CRON_LEASE_MS])
    return parsePlan(raw)
  }

  async transitionPlan(
    planId: string,
    owner: string,
    status: Exclude<CronPlanStatus, "ready" | "processing">,
    reason: string,
    txHash = "",
    now = Date.now(),
  ): Promise<boolean> {
    return Number(await this.redis.eval(
      TRANSITION_PLAN_LUA,
      [cronPlanKvKey(), cronLeaseKvKey()],
      [planId, owner, status, reason.slice(0, 500), txHash, now],
    )) === 1
  }

  async appendAudit(event: Omit<CronAuditEvent, "id">): Promise<CronAuditEvent> {
    const complete = { ...event, id: randomUUID() }
    await this.redis.eval(
      APPEND_AUDIT_LUA,
      [cronAuditEntryKvKey(complete.id), cronAuditIndexKvKey()],
      [JSON.stringify(complete), complete.timestamp, complete.id, CRON_AUDIT_RETENTION_SECONDS,
        complete.timestamp - CRON_AUDIT_RETENTION_SECONDS * 1000],
    )
    return complete
  }
}

export class MemoryCronTradingStateStore implements CronTradingStateStore {
  killSwitch = false
  mainnetConfirmed = false
  plan: CronTradingPlan | null = null
  authorizations = new Map<string, CronRouteAuthorization>()
  audits: CronAuditEvent[] = []

  async getKillSwitch(): Promise<boolean> { return this.killSwitch }
  async setKillSwitch(enabled: boolean): Promise<void> { this.killSwitch = enabled }
  async getMainnetConfirmed(): Promise<boolean> { return this.mainnetConfirmed }
  async setMainnetConfirmed(enabled: boolean): Promise<void> { this.mainnetConfirmed = enabled }
  async getPlan(): Promise<CronTradingPlan | null> { return this.plan ? { ...this.plan } : null }

  async savePlan(input: CronTradingPlanInput, now = Date.now()): Promise<CronTradingPlan> {
    if (this.plan?.status === "processing") throw new Error("cron_plan_processing")
    const normalized = normalizePlanInput(input)
    this.plan = { ...normalized, status: "ready", materialFingerprint: cronMaterialFingerprint(normalized), createdAt: now, updatedAt: now, attempts: 0 }
    return { ...this.plan }
  }

  async authorizeCurrentRoute(planId: string, manualDispatchRef: string, now = Date.now()): Promise<CronRouteAuthorization> {
    if (!this.plan || this.plan.id !== planId) throw new Error("cron_plan_not_found_or_stale")
    if (!manualDispatchRef.trim()) throw new Error("manual_dispatch_ref_required")
    const authorization = {
      routeIdentity: cronRouteIdentity(this.plan), materialFingerprint: this.plan.materialFingerprint,
      manualDispatchRef: manualDispatchRef.trim(), authorizedAt: now,
    }
    this.authorizations.set(routeField(this.plan), authorization)
    return authorization
  }

  async isRouteAuthorized(plan: CronTradingPlan): Promise<boolean> {
    const auth = this.authorizations.get(routeField(plan))
    return auth?.routeIdentity === cronRouteIdentity(plan) && auth.materialFingerprint === plan.materialFingerprint
  }

  async claimPlan(planId: string, owner: string, now = Date.now()): Promise<CronTradingPlan | null> {
    if (!this.plan || this.plan.id !== planId || this.plan.status !== "ready") return null
    this.plan = { ...this.plan, status: "processing", leaseOwner: owner, attempts: this.plan.attempts + 1, updatedAt: now }
    return { ...this.plan }
  }

  async transitionPlan(
    planId: string,
    owner: string,
    status: Exclude<CronPlanStatus, "ready" | "processing">,
    reason: string,
    txHash = "",
    now = Date.now(),
  ): Promise<boolean> {
    if (!this.plan || this.plan.id !== planId || this.plan.status !== "processing" || this.plan.leaseOwner !== owner) return false
    this.plan = { ...this.plan, status, lastReason: reason, txHash: txHash || undefined, updatedAt: now }
    delete this.plan.leaseOwner
    return true
  }

  async appendAudit(event: Omit<CronAuditEvent, "id">): Promise<CronAuditEvent> {
    const complete = { ...event, id: randomUUID() }
    this.audits.push(complete)
    const cutoff = event.timestamp - CRON_AUDIT_RETENTION_SECONDS * 1000
    this.audits = this.audits.filter(item => item.timestamp > cutoff)
    return complete
  }
}

function parsePlan(raw: unknown): CronTradingPlan | null {
  if (!raw) return null
  let value: Record<string, unknown>
  if (Array.isArray(raw)) {
    value = {}
    for (let index = 0; index < raw.length; index += 2) value[String(raw[index])] = raw[index + 1]
  } else {
    value = raw as Record<string, unknown>
  }
  if (!value.id) return null
  const optional = (name: string) => value[name] === undefined || value[name] === "" ? undefined : String(value[name])
  return {
    id: String(value.id), network: String(value.network), fromToken: String(value.fromToken), toToken: String(value.toToken),
    strategy: String(value.strategy), riskBox: String(value.riskBox) as CronRiskBox, amountUsd: Number(value.amountUsd),
    status: String(value.status) as CronPlanStatus, materialFingerprint: String(value.materialFingerprint),
    createdAt: Number(value.createdAt), updatedAt: Number(value.updatedAt), attempts: Number(value.attempts),
    leaseOwner: optional("leaseOwner"), lastReason: optional("lastReason"), txHash: optional("txHash"),
  }
}
