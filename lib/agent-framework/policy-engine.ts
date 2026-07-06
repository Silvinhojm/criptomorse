export interface PolicyEngineConfig {
  rules: PolicyRule[]
}

export interface PolicyRule {
  name: string
  enabled: boolean
  description: string
  networkOverrides?: Record<string, boolean>
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
    name: "enableAuditTrail",
    enabled: true,
    description: "Registra todas as decisões no Audit",
  },
  {
    name: "allowKnowledgeOverride",
    enabled: true,
    description: "Permite que Knowledge Service modifique a confiança do agente",
  },
]

export class PolicyEngine {
  private rules: Map<string, PolicyRule> = new Map()

  constructor(config?: Partial<PolicyEngineConfig>) {
    for (const rule of DEFAULT_RULES) {
      this.rules.set(rule.name, { ...rule })
    }
    if (config?.rules) {
      for (const rule of config.rules) {
        this.rules.set(rule.name, rule)
      }
    }
  }

  isAllowed(name: string, network?: string): boolean {
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
    return true
  }

  getRule(name: string): PolicyRule | undefined {
    return this.rules.get(name)
  }

  getAllRules(): PolicyRule[] {
    return Array.from(this.rules.values())
  }

  enable(name: string): boolean {
    const rule = this.rules.get(name)
    if (!rule) return false
    rule.enabled = true
    return true
  }

  disable(name: string): boolean {
    const rule = this.rules.get(name)
    if (!rule) return false
    rule.enabled = false
    return true
  }

  setNetworkOverride(name: string, network: string, allowed: boolean): boolean {
    const rule = this.rules.get(name)
    if (!rule) return false
    if (!rule.networkOverrides) rule.networkOverrides = {}
    rule.networkOverrides[network] = allowed
    return true
  }
}
