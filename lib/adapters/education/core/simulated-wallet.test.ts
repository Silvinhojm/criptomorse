import { createSimulatedWallet, applyMissionOutcome } from "./simulated-wallet"
import { evaluateMissionAction, lastTrajectoryStepId } from "./mission-engine"
import { FRIEND_TIP_SCENARIO } from "./scenario-catalog"
import type { SimulatedWalletId, PlayerAction } from "./types"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

export function runSimulatedWalletTests(): void {
  const wallet = createSimulatedWallet("w1" as SimulatedWalletId, FRIEND_TIP_SCENARIO.startingBalanceCents)
  expect(wallet.balanceCents === 250_000, "initial balance must match startingBalanceCents")
  expect(wallet.history.length === 0, "new wallet must have empty history")

  const action: PlayerAction = { kind: "ACCEPT_TIP", amountCents: 150_000, leverageMultiplier: 1, exitStepId: lastTrajectoryStepId(FRIEND_TIP_SCENARIO) as any }
  const outcome = evaluateMissionAction(FRIEND_TIP_SCENARIO, wallet, action, 5000)

  const updated = applyMissionOutcome(wallet, outcome)
  expect(updated.balanceCents === wallet.balanceCents + outcome.financialResultCents, "balance must reflect financialResultCents exactly")
  expect(updated.history.length === 1, "one entry must be appended")
  expect(updated.history[0]!.deltaCents === outcome.financialResultCents, "history entry delta must match outcome")
  expect(updated.history[0]!.reason === outcome.lessonCode, "history entry reason must match outcome lessonCode")

  // --- Purity: original wallet object must be untouched ---
  expect(wallet.balanceCents === 250_000, "original wallet balance must not mutate")
  expect(wallet.history.length === 0, "original wallet history must not mutate")
  expect(updated !== wallet, "applyMissionOutcome must return a new object, not the same reference")
  expect(updated.history !== wallet.history, "history array must be a new array, not mutated in place")

  // --- Determinism of the reducer itself ---
  const updated2 = applyMissionOutcome(wallet, outcome)
  expect(updated.balanceCents === updated2.balanceCents, "applying the same outcome twice must produce the same balance")

  // --- Sequential application accumulates correctly ---
  const declineOutcome = evaluateMissionAction(FRIEND_TIP_SCENARIO, updated, { kind: "DECLINE" }, 6000)
  const afterDecline = applyMissionOutcome(updated, declineOutcome)
  expect(afterDecline.balanceCents === updated.balanceCents, "DECLINE outcome must not change balance")
  expect(afterDecline.history.length === 2, "history must accumulate across multiple applications")
}

runSimulatedWalletTests()
