import { EthersAdapter } from "@circle-fin/adapter-ethers-v6"
import { AppKit, TransferSpeed } from "@circle-fin/app-kit"
import { Contract, JsonRpcProvider, formatEther, formatUnits } from "ethers"

import { KmsEthersSigner } from "@/lib/kms/kms-ethers-signer"
import { KmsEvmSigner } from "@/lib/kms/kms-evm-signer"
import {
  createVercelOidcKmsClient,
  readVercelOidcKmsEnvironment,
} from "@/lib/kms/vercel-oidc-kms"
import { isValidBearerRequest } from "@/lib/security/cron-auth"

// RI-BANK-94 — one-shot proof route: bridge USDC via CCTP from Base Sepolia
// → Arc Testnet using kit.bridge() real path (EthersAdapter wrapping the
// KmsEthersSigner). Route is single-use: removed after the test
// (RI-BANK-42 commitment), authorized explicitly by the operator.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// The bridge waits for attestation + mint; allow the longest Vercel budget.
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

const DEFAULT_AMOUNT = "2"
const MAX_AMOUNT = 5

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

export async function POST(request: Request): Promise<Response> {
  if (process.env.VERCEL_ENV !== "production") {
    return json({ ok: false, error: "production_only" }, 403)
  }
  if (!isValidBearerRequest(request.headers.get("authorization"), "ADMIN_PANIC_KEY")) {
    return json({ ok: false, error: "unauthorized" }, 401)
  }

  let amount = DEFAULT_AMOUNT
  try {
    const body = (await request.json()) as { amount?: string }
    if (typeof body.amount === "string" && body.amount.trim() !== "") {
      const raw = body.amount.trim()
      if (!/^\d+(\.\d{1,6})?$/.test(raw)) {
        return json({ ok: false, error: "invalid_amount" }, 400)
      }
      if (parseFloat(raw) > MAX_AMOUNT) {
        return json({ ok: false, error: "amount_too_large", max: MAX_AMOUNT }, 400)
      }
      amount = raw
    }
  } catch {
    // body ausente → usa o default
  }

  try {
    const env = readVercelOidcKmsEnvironment()
    if (env.expectedAddress.toLowerCase() !== EXPECTED_ADDRESS.toLowerCase()) {
      return json({ ok: false, error: "unexpected_configured_signer" }, 412)
    }

    // Providers por chain (source = Base Sepolia, destino = Arc Testnet)
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
    const signer = new KmsEthersSigner(kmsEvm, baseProvider)
    const address = await signer.getAddress()

    // Pre-flight read-only: saldos na origem e no destino
    const usdcBase = new Contract(USDC_BASE_SEPOLIA, ERC20_ABI, baseProvider)
    const usdcArc = new Contract(USDC_ARC, ERC20_ABI, arcProvider)
    const [ethBase, usdcBaseBal, usdcArcBal] = await Promise.all([
      baseProvider.getBalance(address),
      usdcBase.balanceOf(address),
      usdcArc.balanceOf(address),
    ])
    const balances = {
      baseSepolia: { eth: formatEther(ethBase), usdc: formatUnits(usdcBaseBal, 6) },
      arcTestnet: { usdc: formatUnits(usdcArcBal, 6) },
    }

    // Definições canônicas de cadeia a partir do próprio SDK
    const kit = new AppKit()
    const bridgeChains = kit.getSupportedChains("bridge")
    const baseSepolia = bridgeChains.find(
      (c) => c.type === "evm" && c.chainId === BASE_SEPOLIA_CHAIN_ID,
    )
    const arcTestnet = bridgeChains.find((c) => c.type === "evm" && c.chainId === ARC_CHAIN_ID)
    if (!baseSepolia || !arcTestnet) {
      throw new Error("SDK não expõe Base_Sepolia ou Arc_Testnet como bridge chain")
    }

    const adapter = new EthersAdapter(
      {
        signer,
        getProvider: ({ chain }) =>
          new JsonRpcProvider(chain?.rpcEndpoints?.[0] ?? BASE_SEPOLIA_RPC),
      },
      { addressContext: "user-controlled", supportedChains: [baseSepolia, arcTestnet] },
    )

    // ⭐ RI-BANK-94 — bridge USDC Base Sepolia → Arc Testnet (CCTP v2)
    const result = await kit.bridge({
      from: { adapter, chain: "Base_Sepolia" },
      to: { adapter, chain: "Arc_Testnet" },
      amount,
      token: "USDC",
      config: {
        transferSpeed: TransferSpeed.FAST,
        batchTransactions: false, // KmsEthersSigner não suporta EIP-5792
        maxFee: "0.5",
      },
    })

    const rawSteps = (result as any)?.steps ?? []
    const steps = rawSteps.map((s: any) => ({
      name: s?.name ?? null,
      state: s?.state ?? null,
      txHash: s?.values?.txHash ?? s?.txHash ?? null,
      error: s?.error?.message ?? s?.errorMessage ?? null,
    }))
    const txHashes: string[] = steps
      .map((s: any) => s.txHash)
      .filter((h: unknown): h is string => typeof h === "string")
    const relayTxHash = (result as any)?.hash ?? txHashes[0] ?? null

    return json({
      ok: true,
      address,
      from: "Base_Sepolia",
      to: "Arc_Testnet",
      amount,
      token: "USDC",
      balances,
      steps,
      txHashes,
      txHash: relayTxHash,
      explorerUrls: {
        baseSepolia: txHashes.map((h) => `${BASE_SEPOLIA_EXPLORER}/${h}`),
        arc: txHashes.map((h) => `${ARC_TESTNET_EXPLORER}/${h}`),
      },
    })
  } catch (error) {
    console.error("[RI-BANK-94] kit.bridge failed", error)
    return json(
      {
        ok: false,
        error: "bridge_failed",
        detail: error instanceof Error ? error.message : "unknown error",
      },
      500,
    )
  }
}