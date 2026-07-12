export interface PolicyEngineConfig {
  rules: PolicyRule[]
  minimumConfidence?: MinimumConfidencePolicyConfig
}

export interface PolicyRule {
  name: string
  enabled: boolean
  description: string
  networkOverrides?: Record<string, boolean>
}

export interface MinimumConfidenceNetworkOverride {
  enabled?: boolean
  threshold?: number
}

export interface MinimumConfidencePolicyConfig {
  enabled: boolean
  threshold: number
  networkOverrides?: Record<string, MinimumConfidenceNetworkOverride>
}

export interface EffectiveMinimumConfidencePolicy {
  enabled: boolean
  threshold: number
  network?: string
  source: "default" | "network_override"
}

const DEFAULT_MINIMUM_CONFIDENCE: MinimumConfidencePolicyConfig = {
  enabled: true,
  threshold: 10,
}

const DEFAULT_RULES: PolicyRule[] = [
  {
    name: "allowSyntheticRoutes",
    enabled: true,
    description: "Permite rotas sintéticas (stable→stable sem AMM) — seguro apenas em testnet",
    networkOverrides: { polygon: false, ethereum: false, base: false, arbitrum: false },
  },
  {
    name: "allowDirectStressTransactions",
    enabled: true,
    description: "Permite transações diretas sem LI.FI/DEX — seguro apenas em testnet",
    networkOverrides: { polygon: false, ethereum: false, base: false, arbitrum: false },
  },
  {
    name: "requireMinimumConfidence",
    enabled: true,
    description: "Confiança mínima do agente para propor trade",
  },
  {
    name: "requireVotingConsensus",
    enabled: true,
    description: "Exige consenso de votação para executar",
  },
  {
    name: "allowKnowledgeOverride",
    enabled: true,
    description: "Permite que Knowledge Service modifique a confiança do agente",
  },
]

export class PolicyEngine {
  private rules: Map<string, PolicyRule> = new Map()
  private minimumConfidence: MinimumConfidencePolicyConfig = { ...DEFAULT_MINIMUM_CONFIDENCE }

  constructor(config?: Partial<PolicyEngineConfig>) {
    for (const rule of DEFAULT_RULES) {
      this.rules.set(rule.name, { ...rule })
    }
    if (config?.rules) {
      for (const rule of config.rules) {
        this.rules.set(rule.name, {
          ...rule,
          networkOverrides: rule.networkOverrides ? { ...rule.networkOverrides } : undefined,
        })
        if (rule.name === "requireMinimumConfidence") {
          this.minimumConfidence.enabled = rule.enabled
          this.minimumConfidence.networkOverrides = this._booleanOverridesToMinimumConfidence(rule.networkOverrides)
        }
      }
    }
    if (config?.minimumConfidence) this.setMinimumConfidencePolicy(config.minimumConfidence)
  }

  isAllowed(name: string, network?: string): boolean {
    if (name === "requireMinimumConfidence") {
      return this.getMinimumConfidencePolicy(network).enabled
    }
    const rule = this.rules.get(name)
    if (!rule) return false
    if (!rule.enabled) return false
    if (network && rule.networkOverrides && network in rule.networkOverrides) {
      return rule.networkOverrides[network]!
    }
    return true
  }

  setRule(name: string, rule: Partial<PolicyRule>): boolean {
    const existing = this.rules.get(name)
    if (!existing) return false
    Object.assign(existing, rule)
    if (rule.networkOverrides !== undefined) {
      existing.networkOverrides = { ...rule.networkOverrides }
    }
    if (name === "requireMinimumConfidence") {
      if (rule.enabled !== undefined) this.minimumConfidence.enabled = rule.enabled
      if (rule.networkOverrides !== undefined) {
        this.minimumConfidence.networkOverrides = this._booleanOverridesToMinimumConfidence(rule.networkOverrides)
      }
    }
    return true
  }

  getRule(name: string): PolicyRule | undefined {
    const rule = this.rules.get(name)
    if (!rule) return undefined
    return {
      ...rule,
      networkOverrides: rule.networkOverrides ? { ...rule.networkOverrides } : undefined,
    }
  }

  getAllRules(): PolicyRule[] {
    return Array.from(this.rules.values()).map(rule => ({
      ...rule,
      networkOverrides: rule.networkOverrides ? { ...rule.networkOverrides } : undefined,
    }))
  }

  enable(name: string): boolean {
    const rule = this.rules.get(name)
    if (!rule) return false
    rule.enabled = true
    if (name === "requireMinimumConfidence") this.minimumConfidence.enabled = true
    return true
  }

  disable(name: string): boolean {
    const rule = this.rules.get(name)
    if (!rule) return false
    rule.enabled = false
    if (name === "requireMinimumConfidence") this.minimumConfidence.enabled = false
    return true
  }

  setNetworkOverride(name: string, network: string, allowed: boolean): boolean {
    const rule = this.rules.get(name)
    if (!rule) return false
    if (!rule.networkOverrides) rule.networkOverrides = {}
    rule.networkOverrides[network] = allowed
    if (name === "requireMinimumConfidence") {
      if (!this.minimumConfidence.networkOverrides) this.minimumConfidence.networkOverrides = {}
      this.minimumConfidence.networkOverrides[network] = {
        ...(this.minimumConfidence.networkOverrides[network] ?? {}),
        enabled: allowed,
      }
    }
    return true
  }

  setMinimumConfidencePolicy(config: MinimumConfidencePolicyConfig): void {
    this._validateThreshold(config.threshold)
    for (const override of Object.values(config.networkOverrides ?? {})) {
      if (override.threshold !== undefined) this._validateThreshold(override.threshold)
    }

    this.minimumConfidence = {
      enabled: config.enabled,
      threshold: config.threshold,
      networkOverrides: config.networkOverrides
        ? Object.fromEntries(Object.entries(config.networkOverrides).map(([network, override]) => [network, { ...override }]))
        : undefined,
    }

    const rule = this.rules.get("requireMinimumConfidence")
    if (rule) {
      rule.enabled = config.enabled
      rule.networkOverrides = config.networkOverrides
        ? Object.fromEntries(Object.entries(config.networkOverrides)
          .filter(([, override]) => override.enabled !== undefined)
          .map(([network, override]) => [network, override.enabled!]))
        : undefined
    }
  }

  getMinimumConfidencePolicy(network?: string): EffectiveMinimumConfidencePolicy {
    const override = network ? this.minimumConfidence.networkOverrides?.[network] : undefined
    return {
      enabled: override?.enabled ?? this.minimumConfidence.enabled,
      threshold: override?.threshold ?? this.minimumConfidence.threshold,
      network,
      source: override ? "network_override" : "default",
    }
  }

  private _validateThreshold(threshold: number): void {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
      throw new RangeError(`Minimum confidence threshold must be a finite number between 0 and 100: ${threshold}`)
    }
  }

  private _booleanOverridesToMinimumConfidence(
    overrides?: Record<string, boolean>,
  ): Record<string, MinimumConfidenceNetworkOverride> | undefined {
    if (!overrides) return undefined
    return Object.fromEntries(Object.entries(overrides).map(([network, enabled]) => [network, { enabled }]))
  }
}
