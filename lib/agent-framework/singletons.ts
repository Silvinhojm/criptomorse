import { Reputation } from "./reputation"
import { Audit } from "./audit"
import { IntentPublisher } from "./intent-publisher"
import { OnChainIntentPublisher } from "./onchain-intent-publisher"
import { KnowledgeService } from "./knowledge-service"
import { Coordinator } from "./coordinator"
import { PolicyEngine } from "./policy-engine"
import { SettlementRegistry } from "./settlement-registry"

export const frameworkReputation = new Reputation("arcflow")
export const frameworkAudit = new Audit("arcflow")
export const frameworkIntents = new OnChainIntentPublisher(new IntentPublisher("arcflow"))
export const frameworkKnowledge = new KnowledgeService()
export const frameworkPolicy = new PolicyEngine()
export const frameworkSettlementRegistry = new SettlementRegistry()
export const frameworkCoordinator = new Coordinator({ name: "ArcCoordinator", audit: frameworkAudit, policyEngine: frameworkPolicy, intentPublisher: frameworkIntents })
