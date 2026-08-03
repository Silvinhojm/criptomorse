import { JsonRpcProvider, Transaction, id } from "ethers"

import { KmsEvmSigner } from "@/lib/kms/kms-evm-signer"
import {
  createVercelOidcKmsClient,
  readVercelOidcKmsEnvironment,
} from "@/lib/kms/vercel-oidc-kms"
import { isValidBearerRequest } from "@/lib/security/cron-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const EXPECTED_RI_BANK_32_ADDRESS = "0x88993E37Ed022C56F83f67C74d33C783E8e49C75"
const ARC_TESTNET_CHAIN_ID = 5_042_002
const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network"
const ARC_TESTNET_EXPLORER = "https://testnet.arcscan.app"

type ProofAction = "verify-signature" | "send-arc-testnet-transaction"

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.VERCEL_ENV !== "production") {
    return json({ ok: false, error: "production_only" }, 403)
  }
  if (!isValidBearerRequest(request.headers.get("authorization"), "RI_BANK_32_TEST_SECRET")) {
    return json({ ok: false, error: "unauthorized" }, 401)
  }

  let action: ProofAction
  try {
    const body = await request.json() as { action?: unknown }
    if (body.action !== "verify-signature" && body.action !== "send-arc-testnet-transaction") {
      return json({ ok: false, error: "invalid_action" }, 400)
    }
    action = body.action
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400)
  }

  try {
    const env = readVercelOidcKmsEnvironment()
    if (env.expectedAddress.toLowerCase() !== EXPECTED_RI_BANK_32_ADDRESS.toLowerCase()) {
      return json({ ok: false, error: "unexpected_configured_signer" }, 412)
    }

    const client = await createVercelOidcKmsClient(env)
    const signer = new KmsEvmSigner({
      client,
      keyId: env.keyArn,
      expectedAddress: EXPECTED_RI_BANK_32_ADDRESS,
    })
    const address = await signer.getAddress()

    if (action === "verify-signature") {
      const digest = id("RI-BANK-32 AWS KMS EVM signer proof 2026-08-03")
      const signature = await signer.signDigest(digest)
      return json({
        ok: true,
        action,
        address,
        addressMatches: address === EXPECTED_RI_BANK_32_ADDRESS,
        digest,
        signature,
      })
    }

    const provider = new JsonRpcProvider(ARC_TESTNET_RPC, ARC_TESTNET_CHAIN_ID, { staticNetwork: true })
    const network = await provider.getNetwork()
    if (network.chainId !== BigInt(ARC_TESTNET_CHAIN_ID)) {
      throw new Error(`Arc RPC chainId mismatch: ${network.chainId}`)
    }

    const balance = await provider.getBalance(address)
    const fee = await provider.getFeeData()
    const configuredNonceText = process.env.RI_BANK_32_TEST_NONCE?.trim()
    if (!configuredNonceText || !/^\d+$/.test(configuredNonceText)) {
      return json({ ok: false, error: "fixed_test_nonce_required" }, 503)
    }
    const configuredNonce = Number(configuredNonceText)
    if (!Number.isSafeInteger(configuredNonce)) {
      return json({ ok: false, error: "invalid_fixed_test_nonce" }, 503)
    }
    const pendingNonce = await provider.getTransactionCount(address, "pending")
    if (pendingNonce > configuredNonce) {
      return json({ ok: false, error: "test_transaction_nonce_already_consumed" }, 409)
    }
    if (pendingNonce < configuredNonce) {
      return json({ ok: false, error: "fixed_test_nonce_is_in_the_future" }, 412)
    }
    const gasLimit = 21_000n
    const unsigned = Transaction.from({
      type: 2,
      chainId: ARC_TESTNET_CHAIN_ID,
      nonce: configuredNonce,
      to: address,
      value: 0,
      gasLimit,
      maxFeePerGas: fee.maxFeePerGas ?? fee.gasPrice,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 0,
      data: "0x",
    })
    const maximumGasCost = gasLimit * (unsigned.maxFeePerGas ?? 0n)
    if (balance < maximumGasCost) {
      return json({
        ok: false,
        error: "insufficient_arc_testnet_faucet_balance",
        address,
        balance: balance.toString(),
        requiredMaximum: maximumGasCost.toString(),
      }, 402)
    }

    const rawTransaction = await signer.signTransaction(unsigned)
    const tx = await provider.broadcastTransaction(rawTransaction)
    const receipt = await tx.wait(1)
    if (!receipt) throw new Error("Arc transaction was not confirmed")

    const evidence = {
      state: "confirmed",
      address,
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      chainId: ARC_TESTNET_CHAIN_ID,
      explorerUrl: `${ARC_TESTNET_EXPLORER}/tx/${receipt.hash}`,
      confirmedAt: new Date().toISOString(),
    }
    return json({ ok: true, action, ...evidence })
  } catch (error) {
    console.error("[RI-BANK-32] KMS proof failed", error)
    return json({
      ok: false,
      error: "kms_proof_failed",
      detail: error instanceof Error ? error.message : "unknown error",
    }, 500)
  }
}
