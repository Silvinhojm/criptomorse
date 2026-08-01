import { PolicyEngine, type PolicyRule } from "../../agent-framework/policy-engine"

export const NO_REAL_ASSET_POLICY = "noRealAssetPolicy"
export const SIMULATED_WALLET_ONLY_POLICY = "simulatedWalletOnlyPolicy"

const EDUCATION_POLICY_RULES: PolicyRule[] = [
  {
    name: NO_REAL_ASSET_POLICY,
    enabled: true,
    description: "Blocks any education-domain proposal that references a real asset or reaches TradingAdapter execution.",
  },
  {
    name: SIMULATED_WALLET_ONLY_POLICY,
    enabled: true,
    description: "Requires every education-domain proposal to operate exclusively on SimulatedWalletState, never real custody.",
  },
]

/**
 * Fresh PolicyEngine pre-loaded with the two education-domain rules. Also
 * carries PolicyEngine's own framework defaults (allowSyntheticRoutes,
 * requireMinimumConfidence, etc.) -- those are trading-oriented and inert
 * for this domain, not a conflict.
 */
export function createEducationPolicyEngine(): PolicyEngine {
  return new PolicyEngine({ rules: EDUCATION_POLICY_RULES })
}
