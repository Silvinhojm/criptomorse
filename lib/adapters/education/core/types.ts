type Nominal<Name extends string> = { readonly __eduNominal: Name }
type Opaque<Base, Name extends string> = Base & Nominal<Name>

export type MissionId = Opaque<string, "MissionId">
export type ScenarioId = Opaque<string, "ScenarioId">
export type SimulatedAssetId = Opaque<string, "SimulatedAssetId">
export type SimulatedWalletId = Opaque<string, "SimulatedWalletId">
export type ResearchHintId = Opaque<string, "ResearchHintId">
export type PriceStepId = Opaque<string, "PriceStepId">

/**
 * No field on this list may exist, on any type in this domain, at any
 * layer (core, adapter, app). Same compile-time guard pattern as
 * lib/agent-framework/types/f1e-client-dto.ts ClientServerOnlyGuards.
 */
export type NeverRealCustodyFields = {
  readonly privateKey?: never
  readonly realBalance?: never
  readonly custodyRef?: never
  readonly walletAddress?: never
  readonly signingKey?: never
  readonly seedPhrase?: never
}

export type PricePoint = {
  readonly stepId: PriceStepId
  readonly label: string
  /** Relative to entry price. 1.0 = entry price. */
  readonly priceMultiplier: number
}

export type CamiGuidanceMode = "DIRECT" | "FLAGS_ONLY"

/**
 * Static, author-written mentor-character content for a scenario. Purely
 * presentational data -- read and displayed by the app, never processed by
 * any rule. mission-engine.ts never reads this field: financialResultCents
 * and lessonCode are computed exactly the same whether or not the player
 * follows Cami's verdict.
 */
export type CamiGuidance = {
  readonly mode: CamiGuidanceMode
  /** Cami announces she's going to investigate, before the result is shown. */
  readonly introText: string
  /** Cami returns from investigating, introducing the flags found. */
  readonly returnText: string
  /** Warning signs found -- same role as the current raw "hints". */
  readonly flags: readonly string[]
  /** Only present in DIRECT mode -- Cami's explicit verdict/opinion. */
  readonly verdictText?: string
}

export type MissionScenario = {
  readonly scenarioId: ScenarioId
  readonly missionId: MissionId
  readonly title: string
  readonly narrative: string
  readonly startingBalanceCents: number
  readonly suggestedTipAmountCents: number
  readonly asset: {
    readonly assetId: SimulatedAssetId
    readonly displayName: string
    /**
     * The lure -- what a third party (e.g. a friend) promises, when the
     * scenario's narrative has that mechanic. Never the actual scripted
     * outcome. Optional (RI-EDU-3, 2026-07-25): only Mission 1 ("A dica do
     * amigo") has a third-party promise; scenarios about FOMO/volatility or
     * whale concentration have no equivalent narrative promise to record.
     * Never read by mission-engine.ts/simulated-wallet.ts -- purely
     * presentational data, safe to omit without any logic change.
     */
    readonly promisedMultiplier?: number
    /** Scripted, deterministic price path. Index 0 is always the entry point. */
    readonly priceTrajectory: readonly PricePoint[]
    /** Below this ratio (relative to entry), a leveraged position is liquidated. Inert at leverage 1. */
    readonly liquidationThreshold: number
  }
  readonly researchHintsAvailable: readonly ResearchHintId[]
  /** Optional: scenarios without this fall back to the raw hints list. */
  readonly camiGuidance?: CamiGuidance
}

export type PlayerAction =
  | { readonly kind: "ACCEPT_TIP"; readonly amountCents: number; readonly leverageMultiplier: number; readonly exitStepId: PriceStepId }
  | { readonly kind: "DECLINE" }
  | { readonly kind: "RESEARCH_THEN_ACCEPT"; readonly amountCents: number; readonly leverageMultiplier: number; readonly exitStepId: PriceStepId; readonly hintsViewed: readonly ResearchHintId[] }
  | { readonly kind: "RESEARCH_THEN_DECLINE"; readonly hintsViewed: readonly ResearchHintId[] }

export type RiskRecognitionSignal = "NONE" | "PARTIAL" | "FULL"

export type LessonCode =
  | "LOST_TO_HYPE_NO_RESEARCH"
  | "LOST_TO_HYPE_DESPITE_RESEARCH"
  | "AVOIDED_BY_RESEARCH"
  | "AVOIDED_BY_INSTINCT_NO_RESEARCH"
  | "RESEARCHED_AND_INVESTED_WITH_REASON"

export type MissionOutcome = NeverRealCustodyFields & {
  readonly kind: "MISSION_RESOLVED"
  readonly scenarioId: ScenarioId
  readonly action: PlayerAction
  /** Fictional cents. Can be negative. Never real money. */
  readonly financialResultCents: number
  readonly riskRecognition: RiskRecognitionSignal
  readonly researchPerformed: boolean
  /** Portion of the wallet balance that was never put at risk. */
  readonly reservePreservedCents: number
  readonly lessonCode: LessonCode
  /** Caller-supplied timestamp. Never Date.now() internally. */
  readonly resolvedAt: number
}

export type SimulatedWalletEntry = {
  readonly entryId: string
  readonly scenarioId: ScenarioId
  readonly deltaCents: number
  readonly reason: LessonCode
  readonly occurredAt: number
}

export type SimulatedWalletState = NeverRealCustodyFields & {
  readonly walletId: SimulatedWalletId
  readonly balanceCents: number
  readonly history: readonly SimulatedWalletEntry[]
}
