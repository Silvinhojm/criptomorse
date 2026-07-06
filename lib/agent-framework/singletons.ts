import { Reputation } from "./reputation"
import { Audit } from "./audit"
import { IntentPublisher } from "./intent-publisher"
import { OnChainIntentPublisher } from "./onchain-intent-publisher"
import { KnowledgeService } from "./knowledge-service"

export const frameworkReputation = new Reputation("arcflow")
export const frameworkAudit = new Audit("arcflow")
export const frameworkIntents = new OnChainIntentPublisher(new IntentPublisher("arcflow"))
export const frameworkKnowledge = new KnowledgeService()
