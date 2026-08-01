import { Coordinator } from "../../agent-framework/coordinator"
import { Audit } from "../../agent-framework/audit"
import type { IAudit } from "../../agent-framework/IAudit"
import { EducationAdapter } from "./education-adapter"
import { createEducationPolicyEngine } from "./education-policy"
import { EducationKnowledgeResolver } from "./education-knowledge"
import { EducationIntentPublisher } from "./education-intent-publisher"
import type { PolicyEngine } from "../../agent-framework/policy-engine"

export type EducationCoordinatorBundle = {
  readonly coordinator: Coordinator
  readonly audit: IAudit
  readonly policyEngine: PolicyEngine
  readonly intentPublisher: EducationIntentPublisher
  readonly executor: EducationAdapter
}

/**
 * Assembles a self-contained Coordinator instance for the education domain
 * -- mirrors the pattern used by lib/agent-framework/singletons.ts for the
 * trading domain, but scoped entirely to this file. Does NOT touch or
 * import lib/agent-framework/singletons.ts, and is never registered into
 * the real frameworkCoordinator.
 */
export function createEducationCoordinator(): EducationCoordinatorBundle {
  const policyEngine = createEducationPolicyEngine()
  const audit = new Audit("education")
  const intentPublisher = new EducationIntentPublisher()
  const executor = new EducationAdapter(policyEngine)

  const coordinator = new Coordinator(
    { name: "EducationCoordinator", audit, policyEngine, intentPublisher, executor },
    {
      reputation: { getScore: () => 100 },
      knowledge: new EducationKnowledgeResolver(),
      settlementRegistry: { registerPending: (record) => record },
      settlementReplay: { replayForCorrelationId: () => {} },
    },
  )

  return { coordinator, audit, policyEngine, intentPublisher, executor }
}
