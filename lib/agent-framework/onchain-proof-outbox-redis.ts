import type { Redis } from "@upstash/redis"
import { onChainProofOutboxPrefix } from "@/lib/kv"
import type { OnChainProofOutbox, OnChainProofOutboxItem } from "./onchain-proof-outbox"

const CLAIM_LUA = `
local acquired = redis.call('SET', KEYS[3], ARGV[2], 'NX', 'PX', ARGV[3])
if not acquired then return nil end
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 1)
if #ids == 0 then redis.call('DEL', KEYS[3]); return nil end
local id = ids[1]
local key = KEYS[2] .. id
local status = redis.call('HGET', key, 'status')
if status ~= 'pending' and status ~= 'retry_wait' and status ~= 'reconciliation_pending' then
  redis.call('ZREM', KEYS[1], id)
  redis.call('DEL', KEYS[3])
  return nil
end
redis.call('HINCRBY', key, 'attempts', 1)
redis.call('HSET', key, 'status', 'processing', 'leaseOwner', ARGV[2])
redis.call('ZREM', KEYS[1], id)
return redis.call('HGETALL', key)
`

const TRANSITION_LUA = `
local owner = redis.call('HGET', KEYS[1], 'leaseOwner')
if owner ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'status', ARGV[2], 'lastError', ARGV[3], 'nextAttemptAt', ARGV[4])
redis.call('HDEL', KEYS[1], 'leaseOwner')
if redis.call('GET', KEYS[3]) == ARGV[1] then redis.call('DEL', KEYS[3]) end
if ARGV[2] == 'confirmed' or ARGV[2] == 'dead_letter' then
  redis.call('ZREM', KEYS[2], ARGV[5])
else
  redis.call('ZADD', KEYS[2], ARGV[4], ARGV[5])
end
return 1
`

const KNOWN_PROOF_LUA = `
if redis.call('HGET', KEYS[1], 'leaseOwner') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'txHash', ARGV[2], 'blockNumber', ARGV[3], 'status', 'reconciliation_pending')
return 1
`

export class RedisOnChainProofOutbox implements OnChainProofOutbox {
  private readonly prefix = onChainProofOutboxPrefix()
  constructor(private readonly redis: Redis) {}
  private get dueKey(): string { return `${this.prefix}:due` }
  private get leaseKey(): string { return `${this.prefix}:global-lease` }
  private itemKey(intentId: string): string { return `${this.prefix}:item:${intentId}` }

  async enqueue(item: Omit<OnChainProofOutboxItem, "attempts" | "status">): Promise<void> {
    const key = this.itemKey(item.intentId)
    const exists = await this.redis.exists(key)
    if (exists) return
    await this.redis.hset(key, this.encode({ ...item, attempts: 0, status: "pending" }))
    await this.redis.zadd(this.dueKey, { score: item.nextAttemptAt, member: item.intentId })
  }

  async claimDue(owner: string, now = Date.now()): Promise<OnChainProofOutboxItem | null> {
    const raw = await this.redis.eval(CLAIM_LUA, [this.dueKey, `${this.prefix}:item:`, this.leaseKey], [now, owner, 60_000])
    return this.parse(raw)
  }

  async recordKnownProof(intentId: string, owner: string, proof: { txHash: string; blockNumber: number }): Promise<boolean> {
    return Number(await this.redis.eval(KNOWN_PROOF_LUA, [this.itemKey(intentId)], [owner, proof.txHash, proof.blockNumber])) === 1
  }

  async complete(intentId: string, owner: string): Promise<boolean> {
    return this.transition(intentId, owner, "confirmed", "", Date.now())
  }

  async retry(intentId: string, owner: string, error: string, nextAttemptAt: number, exhausted: boolean): Promise<boolean> {
    const current = await this.get(intentId)
    const status = exhausted ? "dead_letter" : (current?.txHash ? "reconciliation_pending" : "retry_wait")
    return this.transition(intentId, owner, status, error.slice(0, 500), nextAttemptAt)
  }

  async get(intentId: string): Promise<OnChainProofOutboxItem | null> {
    return this.parse(await this.redis.hgetall(this.itemKey(intentId)))
  }

  private async transition(intentId: string, owner: string, status: string, error: string, nextAttemptAt: number): Promise<boolean> {
    return Number(await this.redis.eval(TRANSITION_LUA, [this.itemKey(intentId), this.dueKey, this.leaseKey], [owner, status, error, nextAttemptAt, intentId])) === 1
  }

  private encode(item: OnChainProofOutboxItem): Record<string, string | number> {
    const result: Record<string, string | number> = {
      intentId: item.intentId, decisionReportId: item.decisionReportId, auditId: item.auditId,
      decisionHash: item.decisionHash, compactPayload: item.compactPayload, attempts: item.attempts,
      nextAttemptAt: item.nextAttemptAt, lastError: item.lastError ?? "", status: item.status,
      txHash: item.txHash ?? "", blockNumber: item.blockNumber ?? "", leaseOwner: item.leaseOwner ?? "",
    }
    return result
  }

  private parse(raw: unknown): OnChainProofOutboxItem | null {
    if (!raw) return null
    let value: Record<string, unknown>
    if (Array.isArray(raw)) {
      value = {}
      for (let i = 0; i < raw.length; i += 2) value[String(raw[i])] = raw[i + 1]
    } else value = raw as Record<string, unknown>
    if (!value.intentId) return null
    const optional = (name: string) => value[name] === undefined || value[name] === "" ? undefined : String(value[name])
    return {
      intentId: String(value.intentId), decisionReportId: String(value.decisionReportId), auditId: String(value.auditId),
      decisionHash: String(value.decisionHash), compactPayload: String(value.compactPayload),
      attempts: Number(value.attempts), nextAttemptAt: Number(value.nextAttemptAt), lastError: optional("lastError"),
      status: String(value.status) as OnChainProofOutboxItem["status"], txHash: optional("txHash"),
      blockNumber: value.blockNumber === undefined || value.blockNumber === "" ? undefined : Number(value.blockNumber),
      leaseOwner: optional("leaseOwner"),
    }
  }
}
