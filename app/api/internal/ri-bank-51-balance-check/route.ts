import { JsonRpcProvider } from "ethers"

import { KmsEthersSigner } from "@/lib/kms/kms-ethers-signer"
import { KmsEvmSigner } from "@/lib/kms/kms-evm-signer"
import { createVercelOidcKmsClient, readVercelOidcKmsEnvironment } from "@/lib/kms/vercel-oidc-kms"
import { NETWORKS, realSwap } from "@/lib/real-swap-executor"
import { isValidCronAdminRequest } from "@/lib/security/cron-auth"

// RI-BANK-51 — read-only diagnostic: exercises the exact same
// initializeWithServerSigner() + refreshAllBalances() path the cron/manual
// -test KMS flow uses (the one fixed in RI-BANK-50), without ever reaching
// executeSwap(). No transaction can originate from this route.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

export async function GET(request: Request): Promise<Response> {
  if (process.env.VERCEL_ENV !== "production") {
    return json({ ok: false, error: "production_only" }, 403)
  }
  if (!isValidCronAdminRequest(request.headers.get("authorization"))) {
    return json({ ok: false, error: "unauthorized" }, 401)
  }

  try {
    const network = NETWORKS.arc
    const kmsEnvironment = readVercelOidcKmsEnvironment()
    const kmsClient = await createVercelOidcKmsClient(kmsEnvironment)
    const kmsSigner = new KmsEvmSigner({
      client: kmsClient,
      keyId: kmsEnvironment.keyArn,
      expectedAddress: kmsEnvironment.expectedAddress,
    })
    const provider = new JsonRpcProvider(network.rpcUrl, network.chainId)
    const ethersSigner = new KmsEthersSigner(kmsSigner, provider)
    const address = await ethersSigner.getAddress()

    const initialized = await realSwap.initializeWithServerSigner(address, "arc", ethersSigner, provider)
    if (!initialized) {
      return json({ ok: false, error: "balance_check_initialization_failed" }, 500)
    }

    // initializeWithServerSigner() already calls refreshAllBalances() once;
    // a second explicit call here gives the retry logic a fresh attempt and
    // makes the "source" reading reflect this specific diagnostic request
    // rather than a stale one from init.
    await realSwap.refreshAllBalances()

    return json({
      ok: true,
      address,
      network: "arc",
      balances: {
        USDC: realSwap.getBalance("USDC"),
        EURC: realSwap.getBalance("EURC"),
      },
      balanceSource: realSwap.getLastBalanceSource(),
      timestamp: Date.now(),
    })
  } catch (error) {
    console.error("[RI-BANK-51] balance check failed", error)
    return json({
      ok: false,
      error: "balance_check_failed",
      detail: error instanceof Error ? error.message : "unknown error",
    }, 500)
  }
}
