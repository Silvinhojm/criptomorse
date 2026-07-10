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

import { ethers } from "ethers"
import { poolProfiler } from "../pool-profiler"
import { hasSellRoute, isRouteBlocked, STABLECOINS } from "../route-verifier"
import { gasPriceOracle, type GasContext } from "../gas-price-oracle"
import { accountant } from "../accountant"
import { volatilityTracker } from "../volatility-tracker"
import { pairPriceFeed } from "../pair-price-feed"
import { hasChainlinkFeed } from "../chainlink-feeds"
import { NETWORKS, type NetworkKey, realSwap } from "../real-swap-executor"
import { MIN_POOL_RESERVE, DEFAULT_MIN_RESERVE } from "../config/market-thresholds"
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

// ── Arc V2 known pools ────────────────────────────────────────────
// GenericAMMPair (Uniswap V2-style) pools on Arc testnet.
// Not discoverable via V3 factory — read reserves directly via RPC.
const ARC_V2_POOLS = [
  { token0: "0x3600000000000000000000000000000000000000", token1: "0x89b50855aa3be2f677cd6303cec089b5f319d72a", address: "0xa1e418d16c969fdb9482716c7e2bd3d31872ebfb" },
  { token0: "0x3600000000000000000000000000000000000000", token1: "0xf0c4a4ce82a5746abaad9425360ab04fbba432bf", address: "0x185556c077c95fc07498fed4d4faf03b6ee30c5c" },
]

const V2_RESERVE_ABI = [
  "function reserve0() view returns (uint256)",
  "function reserve1() view returns (uint256)",
]

export class KnowledgeService {
  private cache = new Map<string, CacheEntry>()

  constructor() {
    this._load()
  }

  async query(request: KnowledgeRequest): Promise<KnowledgeReport> {
    const syncRoutes = this._checkRoutes(request)

    const [gasCtx, pools, vol] = await Promise.all([
      this._getGasContext(request.network),
      this._getPools(request),
      this._getVolatility(request),
    ])

    const history = this._getHistory(request.agent)
    const repScore = frameworkReputation.getScore(request.agent)

    const liquidityScore = this._liquidityScore(pools, request)
    const gasScore = this._gasScore(gasCtx.gasCostUsd)
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
      gasContext: {
        network: gasCtx.network,
        gasPriceGwei: gasCtx.gasPriceGwei,
        nativePrice: gasCtx.nativePrice,
        gasCostUsd: gasCtx.gasCostUsd,
        fallbackUsed: gasCtx.fallbackUsed,
      },
      warnings,
      recommendations,
      sources: {
        liquidity: true,
        route: syncRoutes.toRoute || syncRoutes.fromRoute,
        gas: gasCtx.gasCostUsd > 0,
        price: hasChainlinkFeed(request.pair.from, request.network) || hasChainlinkFeed(request.pair.to, request.network),
        history: history.score > 0,
        reputation: repScore > 0,
      },
      timestamp: Date.now(),
    }
  }

  // ── Internal query methods ──────────────────────────────────────────────

  private async _getGasContext(network: string): Promise<GasContext> {
    const cached = this.cache.get(cacheKey("gas", network)) as { data: GasContext; ts: number } | undefined
    if (cached && Date.now() - cached.ts < TTLS.gas) return cached.data
    const ctx = await gasPriceOracle.getGasContext(network as NetworkKey).catch(() => ({
      network: network as NetworkKey,
      gasPriceGwei: 0,
      nativePrice: 1,
      gasCostUsd: 0.01,
      timestamp: Date.now(),
      fallbackUsed: true,
    }))
    this.cache.set(cacheKey("gas", network), { data: ctx, ts: Date.now() })
    return ctx
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
          if (pools.length > 0) {
            const maxLiq = Math.max(...pools.map(p => Number(p.liquidity)))
            if (maxLiq <= 0) return 10
            const score = Math.min(100, Math.round(Math.log10(maxLiq) * 10))
            return Math.max(score, pools.length * 25)
          }
        } catch {
          /* poolProfiler unavailable — try V2 fallback */
        }
        // V2 pool fallback for networks without V3 factory (e.g. Arc testnet)
        if (request.network === "arc") {
          return this._getArcV2Score(fromAddr, toAddr)
        }
        return 0
      }
    )
  }

  /** Read real reserves from GenericAMMPair (V2-style) pools on Arc.
   *  Returns a liquidity score based on USD reserve depth of the stablecoin side.
   *
   *  Error handling guarantees:
   *  - Pool not found          → 0 (no pool → blocked)
   *  - Provider unavailable    → 0 (no RPC → blocked)
   *  - RPC call fails/timeout  → 0 (read failure → blocked)
   *  - reserve0/reserve1 0     → 0 (empty pool → blocked)
   *  - Token order unknown     → 0 (can't resolve depth → blocked)
   *  - Below actionable depth  → 0 (dust → blocked)
   *  - All paths return 0      → canTrade stays false
   *  - No exception escapes    → Coordinator/caller never crashes
   *
   *  Minimum actionable reserve is determined per-token from existing
   *  MIN_POOL_RESERVE config (e.g. cirBTC → $10) or DEFAULT_MIN_RESERVE ($5).
   *  This is the same conservative threshold already used by agentes-do-pregão
   *  for SELL validation. */
  private async _getArcV2Score(fromAddr: string, toAddr: string): Promise<number> {
    // ── 1. Pool address lookup ──────────────────────────────────────────────
    // Matches bidirectionally: token0↔token1 order is irrelevant.
    const pool = ARC_V2_POOLS.find(p =>
      (p.token0 === fromAddr && p.token1 === toAddr) ||
      (p.token0 === toAddr && p.token1 === fromAddr)
    )
    if (!pool) return 0

    // ── 2. RPC provider ─────────────────────────────────────────────────────
    const provider = realSwap.getProvider()
    if (!provider) return 0

    // ── 3. Read on-chain reserves ───────────────────────────────────────────
    // eth_call — read-only, no gas, no signing, no state change.
    const contract = new ethers.Contract(pool.address, V2_RESERVE_ABI, provider)
    let reserve0: bigint
    let reserve1: bigint
    try {
      reserve0 = await contract.reserve0()
      reserve1 = await contract.reserve1()
    } catch {
      return 0
    }

    // ── 4. Both Arc V2 pools have USDC as token0 (6 decimals, ~$1 each) ──
    // reserve0 = USDC raw amount, reserve1 = volatile token raw amount.
    // Use reserve0 as USD depth proxy.
    if (reserve0 <= 0n) return 0

    const usdDepth = Number(reserve0) / 1_000_000

    // ── 5. Belt-and-suspenders: conversion safety ───────────────────────────
    if (usdDepth <= 0) return 0

    // ── 6. Minimum actionable reserve ───────────────────────────────────────
    // Use existing MIN_POOL_RESERVE config (the same threshold used by
    // agentes-do-pregão for SELL validation) to prevent dust from passing.
    // For cirBTC: $10; for EURC/USDC: $5; unknown tokens: DEFAULT_MIN_RESERVE.
    // Only score ≥20 if reserves exceed this threshold.
    const minReserve = this._minActionableReserve(fromAddr, toAddr)
    if (usdDepth < minReserve) return 0

    // ── 7. Score tiers ──────────────────────────────────────────────────────
    if (usdDepth < 50) return 20
    if (usdDepth < 200) return 60
    return 80
  }

  /** Resolve the minimum actionable reserve USD for a pair on Arc.
   *  Checks MIN_POOL_RESERVE for each token in the pair, returns the
   *  highest threshold found, or DEFAULT_MIN_RESERVE as floor. */
  private _minActionableReserve(fromAddr: string, toAddr: string): number {
    let threshold = DEFAULT_MIN_RESERVE
    for (const addr of [fromAddr, toAddr]) {
      const sym = this._addrToSymbol(addr, "arc")
      if (sym) {
        const t = MIN_POOL_RESERVE.arc?.[sym]
        if (t && t > threshold) threshold = t
      }
    }
    return threshold
  }

  /** Reverse-map token address → symbol using NETWORKS config.
   *  Returns null if address is unknown on the given network. */
  private _addrToSymbol(address: string, network: string): string | null {
    const net = NETWORKS[network as NetworkKey]
    if (!net) return null
    const lowerAddr = address.toLowerCase()
    for (const [sym, addr] of Object.entries(net.tokens)) {
      if ((addr as string).toLowerCase() === lowerAddr) return sym
    }
    return null
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
