import type { SimulatedWalletState, SimulatedWalletId, MissionOutcome, SimulatedWalletEntry } from "./types"

/** Creates a new fictional wallet. Pure -- persists nothing. */
export function createSimulatedWallet(
  walletId: SimulatedWalletId,
  startingBalanceCents: number,
): SimulatedWalletState {
  return { walletId, balanceCents: startingBalanceCents, history: [] }
}

/**
 * Pure reducer: applies an already-evaluated mission outcome to wallet
 * state, returning a NEW state object. Never mutates `wallet`. Never reads
 * or writes storage -- persistence is the caller's responsibility.
 */
export function applyMissionOutcome(
  wallet: SimulatedWalletState,
  outcome: MissionOutcome,
): SimulatedWalletState {
  const entry: SimulatedWalletEntry = {
    entryId: `${String(outcome.scenarioId)}:${outcome.resolvedAt}`,
    scenarioId: outcome.scenarioId,
    deltaCents: outcome.financialResultCents,
    reason: outcome.lessonCode,
    occurredAt: outcome.resolvedAt,
  }
  return {
    walletId: wallet.walletId,
    balanceCents: wallet.balanceCents + outcome.financialResultCents,
    history: [...wallet.history, entry],
  }
}
