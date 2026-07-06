import type { AgentProposal } from "./IAgent"

export interface ComplianceCheck {
  passed: boolean
  reason: string
  rule: string
  details?: string
}

export interface CompliancePolicy {
  name: string
  description: string
  check: (proposal: AgentProposal, context: Record<string, unknown>) => ComplianceCheck
}

export interface ICompliance {
  readonly name: string
  registerPolicy(policy: CompliancePolicy): void
  unregisterPolicy(name: string): void
  check(proposal: AgentProposal, context?: Record<string, unknown>): ComplianceCheck[]
  getPolicies(): CompliancePolicy[]
}
