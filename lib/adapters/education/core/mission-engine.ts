import type {
  MissionScenario,
  PlayerAction,
  MissionOutcome,
  SimulatedWalletState,
  PricePoint,
  LessonCode,
  RiskRecognitionSignal,
} from "./types"

/**
 * Precondition check -- can this action even be attempted against the
 * current wallet balance? Separate from evaluateMissionAction so the app
 * can validate before letting the player confirm, without duplicating the
 * evaluation logic itself.
 */
export function isActionAffordable(
  wallet: SimulatedWalletState,
  action: PlayerAction,
): { readonly affordable: true } | { readonly affordable: false; readonly reason: string } {
  if (action.kind === "DECLINE" || action.kind === "RESEARCH_THEN_DECLINE") return { affordable: true }
  if (action.amountCents <= 0) return { affordable: false, reason: "amountCents must be positive" }
  if (action.amountCents > wallet.balanceCents) return { affordable: false, reason: "amountCents exceeds wallet balance" }
  return { affordable: true }
}

function findPricePoint(trajectory: readonly PricePoint[], stepId: string): PricePoint {
  const point = trajectory.find((p) => String(p.stepId) === stepId)
  if (!point) throw new Error(`UNKNOWN_PRICE_STEP_ID: ${stepId}`)
  return point
}

/**
 * Deterministic financial result of exposing `amountCents` (x `leverageMultiplier`)
 * to the scenario's scripted price trajectory, exiting at `exitStepId`.
 *
 * At leverage 1 (spot), loss is mathematically bounded at -exposureCents
 * (price can never go below 0), matching real spot-market behavior.
 * At leverage > 1, a forced liquidation is checked along every step up to
 * the chosen exit: if price ever drops to or below `liquidationThreshold`
 * (relative to entry) before the exit point, the position is wiped to
 * -exposureCents at that earlier step instead of riding to `exitStepId`.
 */
function computeFinancialResultCents(
  scenario: MissionScenario,
  amountCents: number,
  leverageMultiplier: number,
  exitStepId: string,
): number {
  const trajectory = scenario.asset.priceTrajectory
  const entry = trajectory[0]
  if (!entry) throw new Error("EMPTY_PRICE_TRAJECTORY")
  const exposureCents = amountCents * leverageMultiplier

  if (leverageMultiplier > 1) {
    const exitIndex = trajectory.findIndex((p) => String(p.stepId) === exitStepId)
    if (exitIndex === -1) throw new Error(`UNKNOWN_PRICE_STEP_ID: ${exitStepId}`)
    for (let i = 1; i <= exitIndex; i += 1) {
      const ratio = trajectory[i]!.priceMultiplier / entry.priceMultiplier
      if (ratio <= scenario.asset.liquidationThreshold) {
        return -exposureCents
      }
    }
  }

  const exitPoint = findPricePoint(trajectory, exitStepId)
  const priceChangeRatio = exitPoint.priceMultiplier / entry.priceMultiplier - 1
  const rawResultCents = exposureCents * priceChangeRatio
  return Math.max(rawResultCents, -exposureCents)
}

/** Convenience for Rota Simples: the exit point is always the last scripted step. */
export function lastTrajectoryStepId(scenario: MissionScenario): string {
  const trajectory = scenario.asset.priceTrajectory
  const last = trajectory[trajectory.length - 1]
  if (!last) throw new Error("EMPTY_PRICE_TRAJECTORY")
  return String(last.stepId)
}

/**
 * Pure evaluation: same scenario + wallet + action + resolvedAt always
 * produces the same MissionOutcome. Never reads the clock, never generates
 * randomness, never touches storage.
 */
export function evaluateMissionAction(
  scenario: MissionScenario,
  wallet: SimulatedWalletState,
  action: PlayerAction,
  resolvedAt: number,
): MissionOutcome {
  const researchPerformed = action.kind === "RESEARCH_THEN_ACCEPT" || action.kind === "RESEARCH_THEN_DECLINE"

  if (action.kind === "DECLINE" || action.kind === "RESEARCH_THEN_DECLINE") {
    const lessonCode: LessonCode = researchPerformed ? "AVOIDED_BY_RESEARCH" : "AVOIDED_BY_INSTINCT_NO_RESEARCH"
    const riskRecognition: RiskRecognitionSignal = researchPerformed ? "FULL" : "PARTIAL"
    return {
      kind: "MISSION_RESOLVED",
      scenarioId: scenario.scenarioId,
      action,
      financialResultCents: 0,
      riskRecognition,
      researchPerformed,
      reservePreservedCents: wallet.balanceCents,
      lessonCode,
      resolvedAt,
    }
  }

  const financialResultCents = computeFinancialResultCents(
    scenario,
    action.amountCents,
    action.leverageMultiplier,
    String(action.exitStepId),
  )

  // Reachable today only via the negative branch: Rota Simples always exits
  // at the scripted rugpull step, which is deterministically a loss for
  // this scenario's data. The non-negative branch is defined for forward
  // compatibility with future scenarios whose scripted trajectory ends at
  // or above entry price -- it cannot be exercised by FRIEND_TIP_SCENARIO.
  const lessonCode: LessonCode = financialResultCents < 0
    ? (researchPerformed ? "LOST_TO_HYPE_DESPITE_RESEARCH" : "LOST_TO_HYPE_NO_RESEARCH")
    : "RESEARCHED_AND_INVESTED_WITH_REASON"
  const riskRecognition: RiskRecognitionSignal = researchPerformed ? "PARTIAL" : "NONE"

  return {
    kind: "MISSION_RESOLVED",
    scenarioId: scenario.scenarioId,
    action,
    financialResultCents,
    riskRecognition,
    researchPerformed,
    reservePreservedCents: wallet.balanceCents - action.amountCents,
    lessonCode,
    resolvedAt,
  }
}
