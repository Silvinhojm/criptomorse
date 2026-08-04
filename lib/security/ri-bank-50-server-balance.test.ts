import { ethers } from "ethers"

import { realSwap } from "../real-swap-executor"

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

// RI-BANK-49/50 — live reproduction (scripts/ri-bank-50-repro.ts, run against
// the real Arc Testnet RPC) showed the public RPC intermittently throws
// ethers CALL_EXCEPTION ("missing revert data") on individual eth_call
// requests. A single transient failure used to zero out the whole balance
// read in server-side execution, because the only fallback path
// (fetch('/api/rpc-proxy')) used a relative URL that cannot resolve without
// window/origin. This test simulates that exact failure shape — without
// hitting the real network — and asserts both fixes hold:
//   1. A provider that fails N-1 times then succeeds must still produce the
//      correct balance (retry absorbs a transient blip).
//   2. When the primary path is exhausted and code falls back to the proxy
//      fetch in server context (no `window`), the request URL must be
//      absolute (VERCEL_URL-based), never relative.
async function run(): Promise<void> {
  const originalVercelUrl = process.env.VERCEL_URL
  process.env.VERCEL_URL = "arcflow-ri-bank-50.vercel.app"

  const address = "0x88993E37Ed022C56F83f67C74d33C783E8e49C75"
  const usdcAddress = "0x3600000000000000000000000000000000000000"

  // ── Test 1: transient failure on the primary provider is retried and recovers ──
  {
    let callAttempt = 0
    const flakyProvider = new ethers.JsonRpcProvider();
    (flakyProvider as any)._send = async function (payload: any) {
      const isBalanceCall = Array.isArray(payload)
        ? payload.some((p: any) => p?.method === "eth_call")
        : payload?.method === "eth_call"
      if (isBalanceCall) {
        callAttempt++
        if (callAttempt <= 2) {
          // Simulates the real ethers CALL_EXCEPTION observed live.
          throw Object.assign(new Error("missing revert data"), { code: "CALL_EXCEPTION" })
        }
      }
      const requests = Array.isArray(payload) ? payload : [payload]
      const responses = requests.map((req: any) => {
        if (req.method === "eth_call") {
          const data = req.params?.[0]?.data as string
          if (data?.startsWith("0x70a08231")) {
            // balanceOf → 19_999_475 raw units (6 decimals) = 19.999475
            return { id: req.id, jsonrpc: "2.0", result: "0x0000000000000000000000000000000000000000000000000000000001312af3" }
          }
          if (data?.startsWith("0x313ce567")) {
            return { id: req.id, jsonrpc: "2.0", result: "0x0000000000000000000000000000000000000000000000000000000000000006" }
          }
          return { id: req.id, jsonrpc: "2.0", result: "0x" }
        }
        if (req.method === "eth_getBalance") return { id: req.id, jsonrpc: "2.0", result: "0x0" }
        if (req.method === "eth_chainId") return { id: req.id, jsonrpc: "2.0", result: "0x4cef52" }
        return { id: req.id, jsonrpc: "2.0", result: "0x0" }
      })
      return Array.isArray(payload) ? responses : responses[0]
    }

    const dummySigner = ethers.Wallet.createRandom().connect(flakyProvider)
    const ok = await realSwap.initializeWithServerSigner(address, "arc", dummySigner, flakyProvider)
    expect(ok, "initializeWithServerSigner should succeed even with a flaky provider")

    await realSwap.refreshAllBalances()
    const balance = realSwap.getBalance("USDC")
    expect(balance === 19.999475, `expected retry to recover USDC balance 19.999475, got ${balance}`)
    expect(callAttempt >= 3, `expected at least 3 attempts (2 failures + 1 success), got ${callAttempt}`)
    console.log("RI_BANK_50_RETRY_RECOVERS_TRANSIENT_FAILURE=PASS")
  }

  // ── Test 2: server-side proxy fallback must use an absolute URL, never relative ──
  // Exercises _createProxyProvider's `_send` override directly (bypassing the
  // full balance-refresh pipeline, which drives real ethers network-detection
  // logic that a bare `{result: "0x0"}` mock can't satisfy). This isolates
  // exactly the fix under test: does the proxy fetch build an absolute URL
  // server-side, or does it fall back to a relative one?
  {
    const originalFetch = globalThis.fetch
    let requestedUrl = ""
    globalThis.fetch = (async (input: string | URL | Request) => {
      requestedUrl = String(input)
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    try {
      const proxyProvider = (realSwap as any)._createProxyProvider("https://rpc.testnet.arc.network", "arc")
      await (proxyProvider as any)._send({ method: "eth_call", params: [{ to: usdcAddress, data: "0x313ce567" }, "latest"] })
      expect(
        requestedUrl.startsWith("https://arcflow-ri-bank-50.vercel.app/api/rpc-proxy"),
        `server-side proxy request must be absolute, received "${requestedUrl}"`,
      )
      console.log("RI_BANK_50_ABSOLUTE_PROXY_URL=PASS")
    } finally {
      globalThis.fetch = originalFetch
    }
  }

  if (originalVercelUrl === undefined) delete process.env.VERCEL_URL
  else process.env.VERCEL_URL = originalVercelUrl
}

run()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    // Throwaway ethers.JsonRpcProvider instances created in this test keep
    // background network-detection timers alive; without an explicit exit
    // the process hangs after the assertions have already passed.
    process.exit(process.exitCode ?? 0)
  })
