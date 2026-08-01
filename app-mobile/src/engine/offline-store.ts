import AsyncStorage from "@react-native-async-storage/async-storage"
import type { SimulatedWalletState } from "../education-core/types"

/**
 * Local persistence of the player's simulated wallet (balance + mission
 * history). This is the ONLY place in the app that touches AsyncStorage --
 * screens never call AsyncStorage directly, keeping the storage format
 * changeable in one spot.
 *
 * Deliberately does NOT import anything from lib/agent-framework/* or
 * education-adapter.ts -- only the pure core's types, matching the
 * boundary designed in the Stage 1 report (see metro.config.js for the
 * matching module-resolution side of this boundary).
 */

const WALLET_STORAGE_KEY = "@arcflow_education/wallet_v1"

export async function loadWalletState(): Promise<SimulatedWalletState | null> {
  try {
    const raw = await AsyncStorage.getItem(WALLET_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SimulatedWalletState
  } catch {
    // Corrupt or unreadable local data must never crash the app -- treat
    // it as "no saved progress" and let the caller start fresh.
    return null
  }
}

export async function saveWalletState(state: SimulatedWalletState): Promise<void> {
  await AsyncStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(state))
}

export async function clearWalletState(): Promise<void> {
  await AsyncStorage.removeItem(WALLET_STORAGE_KEY)
}
