// ═══════════════════════════════════════════════════════════════════════════════
// KnowledgeService — Camada de Cognição Compartilhada
// ═══════════════════════════════════════════════════════════════════════════════
//
// O KnowledgeService é o Single Source of Truth (SSOT) do framework. Todo agente
// consulta este serviço ANTES de gerar uma Intent, garantindo que decisões sejam
// baseadas em um contexto consistente e atualizado.
//
// ─── Arquitetura ───────────────────────────────────────────────────────────────
//
//  Antes (agente isolado):                Agora (cognição compartilhada):
//    Agente                                    Agente
//      │                                         │
//      ├── consulta RouteVerifier                 ▼
//      ├── consulta PoolProfiler          KnowledgeService.query()
//      ├── consulta GasOracle                    │
//      ├── consulta Chainlink              ├── PoolProfiler
//      └── gera proposta                   ├── RouteVerifier
//                                           ├── Chainlink
//  Problema: cada agente "pensava"          ├── GasOracle
//  sozinho, descobrindo erros só na         ├── VolatilityTracker
//  execução.                                ├── Accountant (histórico)
//                                           └── Reputation
//                                              │
//                                              ▼
//                                        KnowledgeReport
//                                        ├── canTrade
//                                        ├── 4 scores (liquidity, gas, route, market)
//                                        ├── riskScore (0-100)
//                                        ├── expectedValue
//                                        ├── confidenceModifier (-80% a +25%)
//                                        ├── warnings[]
//                                        └── recommendations[]
//
// ─── Fases de Evolução ─────────────────────────────────────────────────────────
//
//  Fase 1 — Knowledge Service Core   ✅  Este código. SSOT com cache TTL,
//                                       4 scores, confidenceModifier, riskScore,
//                                       expectedValue, recommendations.
//
//  Fase 2 — Pré-consulta de Agentes  ⬜  Todo agente consulta KnowledgeService
//                                       ANTES de gerar uma Intent. O agente recebe
//                                       o KnowledgeReport e decide se vale a pena
//                                       agir. Reduz drasticamente intents inúteis.
//
//  Fase 3 — Voting Ponderado         ⬜  O confidenceModifier do KnowledgeReport
//                                       ajusta o peso do voto de cada agente.
//                                       Intents com modifier negativo perdem força
//                                       naturalmente, sem precisar ser rejeitadas.
//
//  Fase 4 — Audit Completo           ⬜  O KnowledgeReport é registrado no Audit
//                                       junto com cada decisão. Permite responder:
//                                       "Por que essa operação foi executada?
//                                       Quais informações estavam disponíveis?
//                                       O agente ignorou alertas?"
//
//  Fase 5 — Prova On-Chain           ⬜  Apenas o hash do KnowledgeReport é
//                                       publicado on-chain junto com a Intent.
//                                       Prova que a decisão foi baseada naquele
//                                       estado sem armazenar dados na blockchain.
//
//  Fase 6 — Memory Service           🔮  Novo componente que responde "o que
//                                       aprendemos com situações parecidas?"
//                                       Padrões de mercado, sequências de falhas,
//                                       estratégias que funcionaram, correlações
//                                       entre ativos, horários de melhor performance.
//                                       O Knowledge responde "como está agora";
//                                       o Memory responde "o que aprendemos".
//
// ─── Decisões Arquiteturais (consolidadas de avaliação de IA) ──────────────────
//
//  1. KnowledgeReport como "linguagem comum" — todos os componentes do framework
//     (agentes, coordinator, voting, audit) falam a mesma língua.
//     ✅ IMPLEMENTADO — report padronizado com scores, modifier, warnings.
//
//  2. Consulta paralela a todas as fontes — Promise.all reduz latência do ciclo
//     de decisão. Nenhum agente espera mais do que o necessário.
//     ✅ IMPLEMENTADO — gas, pools e volatilidade em paralelo.
//
//  3. ConfidenceModifier como segunda camada — o agente pensa sozinho, mas o
//     framework diz "você está otimista demais" e ajusta a confiança.
//     ✅ IMPLEMENTADO — modifier cumulativo com cap -80% a +25%.
//
//  4. riskScore + expectedValue — impede operações tecnicamente possíveis mas
//     economicamente ruins (ex: lucro esperado 0.15% não compensa gas).
//     ✅ IMPLEMENTADO — riskScore composto dos 4 scores; expectedValue estimado
//     por marketScore e tipo de par (estável vs volátil).
//
//  5. recommendations[] — transforma o serviço de "guardião" em "consultor".
//     O agente não só sabe que algo está errado, mas O QUE FAZER.
//     ✅ IMPLEMENTADO — recomendações acionáveis derivadas de warnings/scores.
//
//  6. Memory Service (futuro) — separação entre "estado atual" (Knowledge) e
//     "experiência acumulada" (Memory). Recomendado pela IA como próximo grande
//     salto arquitetural após as 5 fases.
//     ⬜ PENDENTE — aguardando Fases 2-5.
//
//  7. Diagrama ARC Agent Framework (recomendado pela IA para pitch técnico):
//
//                     ARC Agent Framework
//                          │
//            ┌─────────────┼─────────────┐
//            │             │             │
//        Knowledge    Identity    Reputation
//            │             │             │
//            └──────┬──────┴──────┬───────┘
//                   │             │
//                Intent        Voting
//                   │             │
//                   └──────┬──────┘
//                          │
//                     Coordinator
//                          │
//                     Execution
//                          │
//                       Audit
//                          │
//                  On-chain Proof
// ═══════════════════════════════════════════════════════════════════════════════

import { poolProfiler } from "../pool-profiler"
import { hasSellRoute, isRouteBlocked, STABLECOINS } from "../route-verifier"
import { gasPriceOracle } from "../gas-price-oracle"
import { accountant } from "../accountant"
import { volatilityTracker } from "../volatility-tracker"
import { pairPriceFeed } from "../pair-price-feed"
import { hasChainlinkFeed } from "../chainlink-feeds"
import { NETWORKS, type NetworkKey } from "../real-swap-executor"
import { frameworkReputation } from "./singletons"
import type { KnowledgeRequest, KnowledgeReport } from "./knowledge-types"

const STABLE_SYMBOLS = new Set(["USDC", "USDT", "DAI", "EURC", "ARC"])

const STORAGE_KEY = "arcflow_knowledge"

interface CacheEntry {
  data: unknown
  ts: number
}

const TTLS = {
  liquidity: 25_000,
  route: 60_000,
  gas: 12_000,
  price: 7_000,
  history: 300_000,
  reputation: 60_000,
}

function cacheKey(type: string, ...parts: string[]): string {
  return `${type}:${parts.join(":")}`
}

function isStable(token: string): boolean {
  return STABLE_SYMBOLS.has(token.toUpperCase())
}

function resolveTokenAddress(token: string, network: string): string | null {
  const net = NETWORKS[network as NetworkKey]
  if (!net) return null
  const addr = net.tokens[token as keyof typeof net.tokens]
  return addr ? addr.toLowerCase() : null
}

export class KnowledgeService {
  private cache = new Map<string, CacheEntry>()

  constructor() {
    this._load()
  }

  async query(request: KnowledgeRequest): Promise<KnowledgeReport> {
    const syncRoutes = this._checkRoutes(request)

    const [gasCost, pools, vol] = await Promise.all([
      this._getGasCost(request.network),
      this._getPools(request),
      this._getVolatility(request),
    ])

    const history = this._getHistory(request.agent)
    const repScore = frameworkReputation.getScore(request.agent)

    const liquidityScore = this._liquidityScore(pools, request)
    const gasScore = this._gasScore(gasCost)
    const routeScore = this._routeScore(syncRoutes, request.action)
    const marketScore = this._marketScore(vol)

    const confidenceModifier = this._computeConfidenceModifier({
      liquidityScore, gasScore, routeScore, marketScore,
      agentWinRate: history.winRate,
      repScore,
    })

    const canTrade = liquidityScore >= 20 && routeScore >= 20 && gasScore > 0

    const warnings: string[] = []
    if (!canTrade) warnings.push("Condições de mercado desfavoráveis")
    if (syncRoutes.toBlocked || syncRoutes.fromBlocked) warnings.push("Rota bloqueada temporariamente")
    if (liquidityScore < 30) warnings.push("Liquidez baixa")
    if (gasScore < 30) warnings.push("Gas alto")
    if (routeScore < 30) warnings.push("Sem rota de venda confirmada")
    if (marketScore < 30) warnings.push("Condições de mercado instáveis")

    const riskScore = this._computeRiskScore({ liquidityScore, gasScore, routeScore, marketScore })
    const expectedValue = this._computeExpectedValue({ liquidityScore, gasScore, routeScore, marketScore, isStablePair: isStable(request.pair.from) || isStable(request.pair.to) })
    const recommendations = this._generateRecommendations({ warnings, liquidityScore, gasScore, routeScore, marketScore, confidenceModifier, canTrade, fromBlocked: syncRoutes.fromBlocked, toBlocked: syncRoutes.toBlocked })

    this._save()

    return {
      canTrade,
      reason: canTrade ? undefined : "Knowledge Service bloqueou operação",
      liquidity: liquidityScore,
      gasScore,
      routeScore,
      marketScore,
      riskScore,
      expectedValue,
      confidenceModifier,
      warnings,
      recommendations,
      sources: {
        liquidity: true,
        route: syncRoutes.toRoute || syncRoutes.fromRoute,
        gas: gasCost > 0,
        price: hasChainlinkFeed(request.pair.from, request.network) || hasChainlinkFeed(request.pair.to, request.network),
        history: history.score > 0,
        reputation: repScore > 0,
      },
      timestamp: Date.now(),
    }
  }

  // ── Internal query methods ──────────────────────────────────────────────

  private async _getGasCost(network: string): Promise<number> {
    return this._withCache(cacheKey("gas", network), TTLS.gas, () =>
      gasPriceOracle.getGasCost(network as NetworkKey).catch(() => 0.01)
    )
  }

  private async _getPools(request: KnowledgeRequest): Promise<number> {
    const fromAddr = resolveTokenAddress(request.pair.from, request.network)
    const toAddr = resolveTokenAddress(request.pair.to, request.network)
    if (!fromAddr || !toAddr) return 0

    return this._withCache(
      cacheKey("liquidity", request.network, fromAddr, toAddr),
      TTLS.liquidity,
      async () => {
        if (isStable(request.pair.from) && isStable(request.pair.to)) return 80
        try {
          const pools = await poolProfiler.getPools(request.network as NetworkKey, fromAddr, toAddr)
          if (pools.length === 0) return 0
          const maxLiq = Math.max(...pools.map(p => Number(p.liquidity)))
          if (maxLiq <= 0) return 10
          const score = Math.min(100, Math.round(Math.log10(maxLiq) * 10))
          return Math.max(score, pools.length * 25)
        } catch {
          return 0
        }
      }
    )
  }

  private _checkRoutes(request: KnowledgeRequest): {
    fromRoute: boolean; toRoute: boolean
    fromBlocked: boolean; toBlocked: boolean
  } {
    const fromRoute = hasSellRoute(request.pair.from, request.network)
    const toRoute = hasSellRoute(request.pair.to, request.network)
    const fromBlocked = isRouteBlocked(request.pair.from, request.network)
    const toBlocked = isRouteBlocked(request.pair.to, request.network)
    return { fromRoute, toRoute, fromBlocked, toBlocked }
  }

  private async _getVolatility(request: KnowledgeRequest): Promise<{
    vol1h: number; trend: string; confMulti: number
  }> {
    const target = request.action === "BUY" ? request.pair.to : request.pair.from
    try {
      const snap = volatilityTracker.getVolatility(target)
      const confMulti = volatilityTracker.getConfidenceMultiplier(target)
      return {
        vol1h: snap.vol1h,
        trend: snap.trend,
        confMulti,
      }
    } catch {
      return { vol1h: 0, trend: "stable", confMulti: 1.0 }
    }
  }

  private _getHistory(agent: string): {
    winRate: number; totalTrades: number; score: number
  } {
    try {
      const s = accountant.getAgentScore(agent)
      if (!s || s.totalTrades < 3) return { winRate: 0, totalTrades: 0, score: 0 }
      return {
        winRate: s.winRate,
        totalTrades: s.totalTrades,
        score: s.score,
      }
    } catch {
      return { winRate: 0, totalTrades: 0, score: 0 }
    }
  }

  // ── Scoring ─────────────────────────────────────────────────────────────

  private _liquidityScore(pools: number, _request: KnowledgeRequest): number {
    return pools
  }

  private _gasScore(gasCost: number): number {
    if (gasCost <= 0) return 0
    if (gasCost < 0.003) return 100
    if (gasCost < 0.005) return 90
    if (gasCost < 0.01) return 80
    if (gasCost < 0.02) return 60
    if (gasCost < 0.05) return 40
    if (gasCost < 0.10) return 20
    return 10
  }

  private _routeScore(
    routes: { fromRoute: boolean; toRoute: boolean; fromBlocked: boolean; toBlocked: boolean },
    action: "BUY" | "SELL"
  ): number {
    const targetRoute = action === "BUY" ? routes.toRoute : routes.fromRoute
    const targetBlocked = action === "BUY" ? routes.toBlocked : routes.fromBlocked
    const otherRoute = action === "BUY" ? routes.fromRoute : routes.toRoute

    if (targetBlocked) return 0
    if (targetRoute) return 100
    if (otherRoute) return 50
    return 20
  }

  private _marketScore(vol: {
    vol1h: number; trend: string; confMulti: number
  }): number {
    if (vol.vol1h === 0 && vol.confMulti === 1.0) return 50
    let score = 60
    if (vol.trend === "falling") score += 15
    else if (vol.trend === "rising") score -= 15
    score = Math.round(score * vol.confMulti)
    return Math.max(0, Math.min(100, score))
  }

  // ── Confidence Modifier ─────────────────────────────────────────────────

  private _computeConfidenceModifier(params: {
    liquidityScore: number
    gasScore: number
    routeScore: number
    marketScore: number
    agentWinRate: number
    repScore: number
  }): number {
    let modifier = 0

    if (params.liquidityScore < 20) modifier -= 25
    else if (params.liquidityScore < 40) modifier -= 10

    if (params.routeScore === 0) modifier -= 50
    else if (params.routeScore < 30) modifier -= 30

    if (params.gasScore < 30) modifier -= 15

    if (params.repScore < 20) modifier -= 30

    if (params.agentWinRate > 0) {
      if (params.agentWinRate < 40) modifier -= 15
      else if (params.agentWinRate > 70) modifier += 8
    }

    if (params.marketScore > 70) modifier += 12

    return Math.max(-80, Math.min(25, modifier))
  }

  // ── Risk Score ──────────────────────────────────────────────────────────

  private _computeRiskScore(params: {
    liquidityScore: number; gasScore: number; routeScore: number; marketScore: number
  }): number {
    const liqRisk = (100 - params.liquidityScore) * 0.3
    const routeRisk = (100 - params.routeScore) * 0.3
    const gasRisk = (100 - params.gasScore) * 0.2
    const marketRisk = (100 - params.marketScore) * 0.2
    return Math.round(liqRisk + routeRisk + gasRisk + marketRisk)
  }

  // ── Expected Value ──────────────────────────────────────────────────────

  private _computeExpectedValue(params: {
    liquidityScore: number; gasScore: number; routeScore: number; marketScore: number
    isStablePair: boolean
  }): number {
    if (params.routeScore < 20 || params.liquidityScore < 10) return 0
    const baseConfidence = (params.liquidityScore + params.routeScore + params.gasScore + params.marketScore) / 400
    if (baseConfidence <= 0) return 0
    const maxExpected = params.isStablePair ? 0.002 : 0.01
    return parseFloat((baseConfidence * maxExpected).toFixed(6))
  }

  // ── Recommendations ─────────────────────────────────────────────────────

  private _generateRecommendations(params: {
    warnings: string[]
    liquidityScore: number; gasScore: number; routeScore: number; marketScore: number
    confidenceModifier: number; canTrade: boolean
    fromBlocked: boolean; toBlocked: boolean
  }): string[] {
    const recs: string[] = []

    if (params.gasScore < 30) recs.push("Aguarde redução do gas antes de operar")
    if (params.liquidityScore < 20) recs.push("Reduza o volume da operação para evitar slippage excessivo")
    if (params.gasScore < 20) recs.push("Considere trocar para uma rede com gas mais baixo")
    if (params.fromBlocked || params.toBlocked) recs.push("Tente novamente em 30 minutos (cooldown de rota)")
    if (params.routeScore < 30 && !params.fromBlocked && !params.toBlocked) recs.push("Verifique se o par tem liquidez em outra rede")
    if (params.marketScore < 30) recs.push("Aguarde estabilização do mercado antes de operar")
    if (params.confidenceModifier < -50) recs.push("Considere não operar neste momento — condições desfavoráveis")

    if (recs.length === 0 && params.canTrade) {
      recs.push("Condições favoráveis para operar")
    }

    return recs
  }

  // ── Cache ───────────────────────────────────────────────────────────────

  private async _withCache<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.ts < ttl) return cached.data as T
    const data = await fn()
    this.cache.set(key, { data, ts: Date.now() })
    return data
  }

  invalidateCache(type?: string): void {
    if (type) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(type + ":")) this.cache.delete(key)
      }
    } else {
      this.cache.clear()
    }
    this._save()
  }

  // ── Persistência ────────────────────────────────────────────────────────

  private _save(): void {
    try {
      const obj: Record<string, { data: unknown; ts: number }> = {}
      for (const [key, entry] of this.cache) {
        obj[key] = { data: entry.data, ts: entry.ts }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
    } catch {
      /* localStorage indisponível ou cheio */
    }
  }

  private _load(): void {
    if (typeof window === "undefined") return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const obj = JSON.parse(raw) as Record<string, { data: unknown; ts: number }>
      const now = Date.now()
      const maxAge = Math.max(...Object.values(TTLS)) * 2
      for (const [key, entry] of Object.entries(obj)) {
        if (now - entry.ts < maxAge) {
          this.cache.set(key, { data: entry.data, ts: entry.ts })
        }
      }
    } catch {
      /* cache corrompido */
    }
  }
}
