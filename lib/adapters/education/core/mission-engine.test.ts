import { evaluateMissionAction, isActionAffordable, lastTrajectoryStepId } from "./mission-engine"
import { createSimulatedWallet } from "./simulated-wallet"
import { FRIEND_TIP_SCENARIO } from "./scenario-catalog"
import type { PlayerAction, SimulatedWalletId } from "./types"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const wallet = createSimulatedWallet("w1" as SimulatedWalletId, FRIEND_TIP_SCENARIO.startingBalanceCents)
const exitStepId = lastTrajectoryStepId(FRIEND_TIP_SCENARIO) as any

function acceptAction(amountCents: number, researched: boolean): PlayerAction {
  return researched
    ? { kind: "RESEARCH_THEN_ACCEPT", amountCents, leverageMultiplier: 1, exitStepId, hintsViewed: [] }
    : { kind: "ACCEPT_TIP", amountCents, leverageMultiplier: 1, exitStepId }
}

export function runMissionEngineTests(): void {
  // --- Determinism ---
  const action = acceptAction(150_000, false)
  const r1 = evaluateMissionAction(FRIEND_TIP_SCENARIO, wallet, action, 1000)
  const r2 = evaluateMissionAction(FRIEND_TIP_SCENARIO, wallet, action, 1000)
  const r3 = evaluateMissionAction(FRIEND_TIP_SCENARIO, wallet, action, 1000)
  expect(JSON.stringify(r1) === JSON.stringify(r2) && JSON.stringify(r2) === JSON.stringify(r3), "determinism: 3 runs must be identical")

  // --- Rugpull always loses money for ACCEPT variants under Rota Simples ---
  expect(r1.financialResultCents < 0, "rugpull exit must be a loss")
  expect(r1.financialResultCents === 150_000 * (0.17 / 1.0 - 1), "financial result must match the formula exactly")

  // --- Proportionality: investing 5x should lose exactly 5x ---
  const small = evaluateMissionAction(FRIEND_TIP_SCENARIO, wallet, acceptAction(30_000, false), 1000)
  const big = evaluateMissionAction(FRIEND_TIP_SCENARIO, wallet, acceptAction(150_000, false), 1000)
  expect(big.financialResultCents === small.financialResultCents * 5, "150_000 invested must lose exactly 5x what 30_000 loses (proportional, not binary)")
  expect(Math.abs(big.financialResultCents) > Math.abs(small.financialResultCents), "investing more must hurt more")

  // --- Spot loss never exceeds the amount invested (leverage = 1) ---
  expect(Math.abs(big.financialResultCents) < 150_000, "spot loss must never exceed the invested amount")

  // --- lessonCode distinguishes research even with identical financial result ---
  const noResearch = evaluateMissionAction(FRIEND_TIP_SCENARIO, wallet, acceptAction(150_000, false), 1000)
  const withResearch = evaluateMissionAction(FRIEND_TIP_SCENARIO, wallet, acceptAction(150_000, true), 1000)
  expect(noResearch.financialResultCents === withResearch.financialResultCents, "market does not forgive research -- financial result must be identical")
  expect(noResearch.lessonCode === "LOST_TO_HYPE_NO_RESEARCH", "no-research acceptance must be LOST_TO_HYPE_NO_RESEARCH")
  expect(withResearch.lessonCode === "LOST_TO_HYPE_DESPITE_RESEARCH", "researched acceptance must be LOST_TO_HYPE_DESPITE_RESEARCH")
  expect(noResearch.lessonCode !== withResearch.lessonCode, "lessonCode must differ despite identical financialResultCents")

  // --- DECLINE variants: zero financial impact, full reserve preserved ---
  const declineNoResearch = evaluateMissionAction(FRIEND_TIP_SCENARIO, wallet, { kind: "DECLINE" }, 1000)
  expect(declineNoResearch.financialResultCents === 0, "DECLINE must have zero financial impact")
  expect(declineNoResearch.reservePreservedCents === wallet.balanceCents, "DECLINE must preserve the full balance")
  expect(declineNoResearch.lessonCode === "AVOIDED_BY_INSTINCT_NO_RESEARCH", "unresearched decline lesson code")

  const declineResearched = evaluateMissionAction(FRIEND_TIP_SCENARIO, wallet, { kind: "RESEARCH_THEN_DECLINE", hintsViewed: [] }, 1000)
  expect(declineResearched.lessonCode === "AVOIDED_BY_RESEARCH", "researched decline lesson code")
  expect(declineResearched.riskRecognition === "FULL", "researched decline must show full risk recognition")

  // --- reservePreservedCents accounting ---
  const partial = evaluateMissionAction(FRIEND_TIP_SCENARIO, wallet, acceptAction(100_000, false), 1000)
  expect(partial.reservePreservedCents === wallet.balanceCents - 100_000, "reservePreservedCents must equal balance minus invested amount")

  // --- isActionAffordable ---
  const tooMuch = isActionAffordable(wallet, acceptAction(wallet.balanceCents + 1, false))
  expect(tooMuch.affordable === false, "amount exceeding balance must be unaffordable")
  const zero = isActionAffordable(wallet, acceptAction(0, false))
  expect(zero.affordable === false, "zero amount must be unaffordable")
  const ok = isActionAffordable(wallet, acceptAction(1, false))
  expect(ok.affordable === true, "1 cent must be affordable against a non-trivial balance")
  const declineAffordable = isActionAffordable(wallet, { kind: "DECLINE" })
  expect(declineAffordable.affordable === true, "DECLINE is always affordable")

  // --- lastTrajectoryStepId ---
  expect(exitStepId === "rugpull", "Rota Simples must resolve exit to the last scripted step (rugpull)")
}

runMissionEngineTests()
