import type { ICompliance, ComplianceCheck, CompliancePolicy } from "./ICompliance"
import type { AgentProposal } from "./IAgent"

export { type ComplianceCheck, type CompliancePolicy, type ICompliance }

export class Compliance implements ICompliance {
  readonly name: string
  private policies: Map<string, CompliancePolicy> = new Map()

  constructor(name: string) {
    this.name = name
  }

  registerPolicy(policy: CompliancePolicy): void {
    this.policies.set(policy.name, policy)
  }

  unregisterPolicy(name: string): void {
    this.policies.delete(name)
  }

  check(proposal: AgentProposal, context?: Record<string, unknown>): ComplianceCheck[] {
    const results: ComplianceCheck[] = []
    for (const policy of this.policies.values()) {
      const check = policy.check(proposal, context ?? {})
      results.push(check)
    }
    return results
  }

  getPolicies(): CompliancePolicy[] {
    return Array.from(this.policies.values())
  }

  allPass(proposal: AgentProposal, context?: Record<string, unknown>): boolean {
    return this.check(proposal, context).every(c => c.passed)
  }
}
