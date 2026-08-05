// RI-BANK-72 — extracted from real-swap-executor.ts so this can be reused
// by route-verifier.ts's pool-depth check (RI-BANK-70) without creating a
// circular import (real-swap-executor.ts already imports hasSellRoute etc.
// from route-verifier.ts, so the reverse import isn't possible). Same
// retry helper and backup-RPC list already validated for balance reads
// (RI-BANK-50/62/63) — this file is now the single source of truth for
// both, instead of route-verifier.ts having its own weaker, unvalidated
// copy (which is exactly what caused RI-BANK-71: hasSufficientPoolDepth()
// had a local 3-attempt/200ms retry against only the primary RPC, and hit
// the same intermittent Arc Testnet CALL_EXCEPTION flakiness that
// balance reads already solved for).

// RI-BANK-50 — o RPC público da Arc Testnet falha de forma intermitente em
// chamadas eth_call individuais (ethers CALL_EXCEPTION "missing revert data"),
// confirmado por reprodução local com log ao vivo. Sem retry, uma única
// falha transitória de rede zera o dado lido inteiro. `attempts` pequeno e
// `delayMs` curto bastam: o objetivo é absorver um blip pontual do RPC, não
// mascarar uma falha real e persistente (essa continua propagando o erro).
export async function withRetries<T>(fn: () => Promise<T>, attempts = 4, delayMs = 250): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      if (i < attempts - 1) await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

// RI-BANK-62 — para `arc`, os 3 provedores documentados oficialmente em
// docs.arc.io/arc/references/connect-to-arc (Blockdaemon, dRPC, QuickNode),
// validados individualmente (chainId 5042002 correto, saldo USDC correto,
// 6/6 chamadas espaçadas em 3s cada).
export const BACKUP_RPCS: Record<string, string[]> = {
  polygon: [
    "https://polygon.llamarpc.com",
    "https://polygon-rpc.com",
    "https://rpc-mainnet.maticvigil.com",
    "https://polygon-mainnet.g.alchemy.com/v2/demo",
    "https://rpc.ankr.com/polygon",
    "https://polygon.blockpi.network/v1/rpc/public",
    "https://1rpc.io/matic",
  ],
  base: [],
  arc: [
    "https://rpc.blockdaemon.testnet.arc.io",
    "https://rpc.drpc.testnet.arc.io",
    "https://rpc.quicknode.testnet.arc.io",
  ],
  ethereum: [
    "https://rpc.ankr.com/eth",
    "https://ethereum-rpc.publicnode.com",
  ],
  arbitrum: [
    "https://rpc.ankr.com/arbitrum",
    "https://arb1.arbitrum.io/rpc",
  ],
  sepolia: [
    "https://sepolia.gateway.tenderly.co",
    "https://ethereum-sepolia.publicnode.com",
  ],
}
