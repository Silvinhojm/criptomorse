import { ethers } from "ethers"

import { realSwap, NETWORKS } from "../real-swap-executor"

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

// RI-BANK-62 configured real backup RPCs for `arc`, but RI-BANK-63 found the
// fallback loop's break condition (`newBalances.size > 0`) was true after
// the very first attempt regardless of whether it actually succeeded — the
// native-token entry is always written (even 0-on-failure), so
// `rpcsParaTentar`'s backups (net.rpcUrl, then BACKUP_RPCS.arc) were
// structurally unreachable. This test simulates a primary provider that
// fails on every ERC20 call and confirms the loop now proceeds to try the
// next entry (a BACKUP_RPCS.arc URL) instead of giving up immediately, and
// that the balance read via that backup ends up correct.
async function run(): Promise<void> {
  const originalVercelUrl = process.env.VERCEL_URL
  process.env.VERCEL_URL = "arcflow-ri-bank-63.vercel.app"
  const originalFetch = globalThis.fetch

  const address = "0x88993E37Ed022C56F83f67C74d33C783E8e49C75"
  expect(NETWORKS.arc.rpcUrl !== "https://rpc.blockdaemon.testnet.arc.io", "sanity check: this backup URL must differ from the primary")
  const expectedBackupUrl = "https://rpc.blockdaemon.testnet.arc.io"

  // Primary provider: every call fails, permanently — not a transient blip
  // (RI-BANK-50's retry would recover from those). This forces
  // anyProviderSucceeded to stay false after '__PROVIDER__', which is
  // exactly the condition that used to (incorrectly) still break the loop.
  const failingProvider = new ethers.JsonRpcProvider();
  (failingProvider as any)._send = async () => {
    throw Object.assign(new Error("simulated total primary RPC failure"), { code: "CALL_EXCEPTION" })
  }

  let proxyCalledWithBackupUrl = false
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    expect(url.startsWith("https://arcflow-ri-bank-63.vercel.app/api/rpc-proxy"), `proxy fetch must be absolute, got ${url}`)
    const body = JSON.parse(String(init?.body ?? "{}"))
    const req = body.body

    // Only the genuine backup URL responds successfully — net.rpcUrl (the
    // primary, reached via the proxy path before BACKUP_RPCS.arc in
    // rpcsParaTentar) also fails, so this test proves a real BACKUP_RPCS.arc
    // entry is reached, not just a different transport to the same URL.
    if (body.rpcUrl !== expectedBackupUrl) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: req?.id ?? 1, error: { message: "simulated failure (not the backup URL)" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    proxyCalledWithBackupUrl = true

    const data = req.params?.[0]?.data as string | undefined
    let result = "0x0"
    if (req.method === "eth_call" && data?.startsWith("0x70a08231")) {
      result = "0x0000000000000000000000000000000000000000000000000000000001312af3" // 19_999_475
    } else if (req.method === "eth_call" && data?.startsWith("0x313ce567")) {
      result = "0x0000000000000000000000000000000000000000000000000000000000000006" // 6 decimals
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id ?? 1, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch

  try {
    const dummySigner = ethers.Wallet.createRandom().connect(failingProvider)
    const ok = await realSwap.initializeWithServerSigner(address, "arc", dummySigner, failingProvider)
    expect(ok, "initializeWithServerSigner should still return true (balance failure is not fatal)")

    await realSwap.refreshAllBalances()

    expect(proxyCalledWithBackupUrl, "the loop must reach a BACKUP_RPCS.arc URL when the primary provider fails entirely — it used to stop right after '__PROVIDER__' regardless of success")

    const balance = realSwap.getBalance("USDC")
    expect(balance === 19.999475, `expected the backup RPC to recover USDC balance 19.999475, got ${balance}`)

    const source = realSwap.getLastBalanceSource()
    expect(source !== "signer provider", `balanceSource should reflect the backup, not the failed primary, got "${source}"`)
    expect(source !== "none (all rpcsParaTentar failed)", `balanceSource must not report total failure when a backup succeeded, got "${source}"`)

    console.log("RI_BANK_63_BREAK_CONDITION_REACHES_BACKUP=PASS")
    console.log("RI_BANK_63_BACKUP_RECOVERS_CORRECT_BALANCE=PASS")
  } finally {
    globalThis.fetch = originalFetch
    if (originalVercelUrl === undefined) delete process.env.VERCEL_URL
    else process.env.VERCEL_URL = originalVercelUrl
  }
}

run()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    // Throwaway ethers.JsonRpcProvider instances keep background
    // network-detection timers alive without an explicit exit.
    process.exit(process.exitCode ?? 0)
  })
