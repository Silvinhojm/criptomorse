import { EthersAdapter } from "@circle-fin/adapter-ethers-v6"
import { CCTPV2BridgingProvider } from "@circle-fin/provider-cctp-v2"
import { AppKit } from "@circle-fin/app-kit"
import { Contract, JsonRpcProvider, formatEther, formatUnits } from "ethers"

import { KmsEthersSigner } from "@/lib/kms/kms-ethers-signer"
import { KmsEvmSigner } from "@/lib/kms/kms-evm-signer"
import {
  createVercelOidcKmsClient,
  readVercelOidcKmsEnvironment,
} from "@/lib/kms/vercel-oidc-kms"
import { isValidBearerRequest } from "@/lib/security/cron-auth"

// RI-BANK-94 — one-shot proof route: complete the CCTP mint MANUALLY.
//
// Contexto: o bridge USDC Base Sepolia → Arc Testnet falhou no paso final de
// mint porque o AppKit tenta "trocar de rede" no mesmo signer — que o
// KmsEthersSigner não suporta por design. O burn já foi executado e a
// atestação (IRIS) já está `complete`. Esta rota refaz apenas a etapa 4:
//
//   1. fetchAttestation(burnTxHash)      (idempotente, read-only IRIS)
//   2. provider.mint(...) → PreparedChainRequest (NÃO envia nada)
//   3. prepared.estimate()              → dry-run, próprio pra conferência
//   4. Somente com mode:"execute" (autorizado pelo operador) → prepare.execute()
//
// Single-use: chamada manualmente, remoída depois (RI-BANK-42).
// Guards: production-only + ADMIN_PANIC_KEY bearer. Sempre dry-run por padrão.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const EXPECTED_ADDRESS = "0x88993E37Ed022C56F83f67C74d33C783E8e49C75"
const BASE_SEPOLIA_RPC = "https://sepolia.base.org"
const BASE_SEPOLIA_CHAIN_ID = 84532
const BASE_SEPOLIA_EXPLORER = "https://base-sepolia.blockscout.com/tx"
const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network"
const ARC_CHAIN_ID = 5_042_002
const ARC_TESTNET_EXPLORER = "https://testnet.arcscan.app/tx"
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
const USDC_ARC = "0x3600000000000000000000000000000000000000"

const BURN_TX_HASH_ALLOWLIST = new Set([
  "0x36662bf86cded5a185f396b8cce2a72f6db76cd4beca1113a15559294dcf7ce0".toLowerCase(),
])

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]

interface MintCompletionInput {
  burnTransactionHash?: string
  mode?: "dry-run" | "execute"
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.VERCEL_ENV !== "production") {
    return json({ ok: false, error: "production_only" }, 403)
  }
  if (!isValidBearerRequest(request.headers.get("authorization"), "ADMIN_PANIC_KEY")) {
    return json({ ok: false, error: "unauthorized" }, 401)
  }

  let body: MintCompletionInput
  try {
    body = (await request.json()) as MintCompletionInput
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400)
  }
  const burnTxHash = (body.burnTransactionHash ?? "").trim().toLowerCase()
  if (!/^0x[0-9a-f]{64}$/.test(burnTxHash)) {
    return json({ ok: false, error: "invalid_burn_tx_hash" }, 400)
  }
  if (!BURN_TX_HASH_ALLOWLIST.has(burnTxHash)) {
    return json({ ok: false, error: "burn_tx_hash_not_in_allowlist" }, 403)
  }
  const mode = body.mode === "execute" ? "execute" : "dry-run"

  try {
    const env = readVercelOidcKmsEnvironment()
    if (env.expectedAddress.toLowerCase() !== EXPECTED_ADDRESS.toLowerCase()) {
      return json({ ok: false, error: "unexpected_configured_signer" }, 412)
    }

    // --- Providers / signer dedicado à Arc (sem troca de rede) ---
    const baseProvider = new JsonRpcProvider(BASE_SEPOLIA_RPC, BASE_SEPOLIA_CHAIN_ID, {
      staticNetwork: true,
    })
    const arcProvider = new JsonRpcProvider(ARC_TESTNET_RPC, ARC_CHAIN_ID, {
      staticNetwork: true,
    })
    const client = await createVercelOidcKmsClient(env)
    const kmsEvm = new KmsEvmSigner({
      client,
      keyId: env.keyArn,
      expectedAddress: EXPECTED_ADDRESS,
    })
    const baseSigner = new KmsEthersSigner(kmsEvm, baseProvider)
    const arcSigner = new KmsEthersSigner(kmsEvm, arcProvider)
    const address = await arcSigner.getAddress()

    // --- Definições canônicas de chain (com config CCTP v2) ---
    const kit = new AppKit()
    const bridgeChains = kit.getSupportedChains("bridge")
    const baseChain = bridgeChains.find(
      (c) => c.type === "evm" && c.chainId === BASE_SEPOLIA_CHAIN_ID,
    )
    const arcChain = bridgeChains.find((c) => c.type === "evm" && c.chainId === ARC_CHAIN_ID)
    if (!baseChain || !arcChain) {
      throw new Error("SDK não expõe Base_Sepolia ou Arc_Testnet como bridge chain")
    }

    const baseAdapter = new EthersAdapter(
      { signer: baseSigner, getProvider: () => baseProvider },
      { addressContext: "user-controlled", supportedChains: [baseChain] },
    )
    const arcAdapter = new EthersAdapter(
      { signer: arcSigner, getProvider: () => arcProvider },
      { addressContext: "user-controlled", supportedChains: [arcChain] },
    )

    // --- Pré-flight read-only de saldos ---
    const usdcBase = new Contract(USDC_BASE_SEPOLIA, ERC20_ABI, baseProvider)
    const usdcArc = new Contract(USDC_ARC, ERC20_ABI, arcProvider)
    const [ethBase, usdcBaseBal, usdcArcBal] = await Promise.all([
      baseProvider.getBalance(address),
      usdcBase.balanceOf(address),
      usdcArc.balanceOf(address),
    ])

    // --- Etapa 3 (idempotente): atestação existente pelo burnTxHash ---
    const provider = new CCTPV2BridgingProvider()
    const sourceCtx = { chain: baseChain, adapter: baseAdapter, address }

    const attestation = await provider.fetchAttestation(sourceCtx, burnTxHash, {
      maxRetries: 3,
      timeout: 5_000,
    })
    if (attestation.status !== "complete") {
      return json({
        ok: false,
        error: "attestation_not_complete",
        status: attestation.status,
      }, 409)
    }

    const decodedBody = attestation.decodedMessage?.decodedMessageBody
    const parsedAmount = decodedBody ? Number(decodedBody.amount) / 1e6 : null

    // --- Etapa 4: PREPARAR o mint (não envia nada) ---
    const destinationCtx = { chain: arcChain, adapter: arcAdapter, address }
    const prepared = await provider.mint(sourceCtx, destinationCtx, attestation)

    // --- dry-run por padrão: só estimate (simulação, sem enviar) ---
    const estimate = await prepared.estimate()

    const result: Record<string, unknown> = {
      ok: true,
      mode,
      address,
      burnTransactionHash: burnTxHash,
      attestation: {
        status: attestation.status,
        sourceDomain: attestation.decodedMessage?.sourceDomain,
        destinationDomain: attestation.decodedMessage?.destinationDomain,
        mintRecipient: attestation.decodedMessage?.decodedMessageBody?.mintRecipient,
        amountUsdc: parsedAmount,
        expirationBlock: attestation.decodedMessage?.decodedMessageBody?.expirationBlock,
        nonce: attestation.eventNonce,
        feeExecuted: attestation.decodedMessage?.decodedMessageBody?.feeExecuted,
        maxFee: attestation.decodedMessage?.decodedMessageBody?.maxFee,
      },
      balances: {
        baseSepolia: { eth: formatEther(ethBase), usdc: formatUnits(usdcBaseBal, 6) },
        arcTestnet: { usdc: formatUnits(usdcArcBal, 6) },
      },
      prepared: estimate,
    }

    if (mode === "execute") {
      // Autorização explícita do operador — envia o mint de verdade
      const txHash = await prepared.execute()
      const freshBal = await usdcArc.balanceOf(address)
      result["ok"] = true
      result["mintTransactionHash"] = txHash
      result["arcUsdcAfterMint"] = formatUnits(freshBal, 6)
      result["explorer"] = `${ARC_TESTNET_EXPLORER}/${txHash}`
    } else {
      result["notice"] =
        "dry-run concluída (estimate() pré-simuada). Nenhuma transação foi enviada. " +
        "Para executar o mint, chame de novo com mode:'execute'."
    }

    return json(result)
  } catch (error) {
    console.error("[RI-BANK-94] mint completion failed", error)
    return json({
      ok: false,
      error: "mint_completion_failed",
      detail: error instanceof Error ? error.message : "unknown error",
    }, 500)
  }
}