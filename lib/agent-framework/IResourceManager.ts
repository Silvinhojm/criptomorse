export interface ResourceRequest {
  id: string
  agentId: string
  resourceType: string
  resourceId: string
  amount: number
  priority: number
  requestedAt: number
}

export interface ResourceGrant {
  authorized: boolean
  reason: string
  queuePosition: number
  grantedAt?: number
  expiresAt?: number
}

export interface ResourceState {
  available: number
  locked: number
  locks: Record<string, { lockedBy: string; lockedAt: number }>
  queue: ResourceRequest[]
}

export interface IResourceManager {
  readonly name: string
  request(req: ResourceRequest): ResourceGrant
  release(resourceKey: string): void
  releaseAll(agentId?: string): void
  getState(resourceType?: string): ResourceState
  getAvailable(resourceType: string, resourceId: string): number
}
