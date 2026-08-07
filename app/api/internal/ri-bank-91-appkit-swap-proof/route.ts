import { EthersAdapter } from "@circle-fin/adapter-ethers-v6"
import { AppKit, Blockchain } from "@circle-fin/app-kit"
import { JsonRpcProvider, Contract } from "ethers"

import { KmsEthersSigner } from "@/lib/kms/kms-ethers-signer"
import { KmsEvmSigner } from "@/lib/kms/kms-evm-signer"
import {
  createVercelOidcKmsClient,
  readVercelOidcKmsEnvironment,
} from "@/lib/kms/vercel-oidc-kms"
import { isValidBearerRequest } from "@/lib/security/cron-auth"

// RI-BANK-91 — proof on-chain do caminho real do App Kit: EthersAdapter
// envolvendo o KmsEthersSigner (KMS) fazendo um swap USDC→EURC na Arc
// testnet. Rota de uso único: chamada manualmente, resultado reportado,
// depois REMOVIDA (compromisso RI-BANK-42) — nunca utilizada em produção.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const EXPECTED_ADDRESS = "0x88993E37Ed022C56F83f67C74d33C783E8e49C75"
const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network"
const ARC_CHAIN_ID = 5_042_002
const ARC_TESTNET_EXPLORER = "https://testnet.arcscan.app"
const USDC = "0x3600000000000000000000000000000000000000"
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
const POOL = "0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb"

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

// Chain definition registrada manualmente para a Arc Testnet, espelhando os
// campos que o SDK espera (EVMChainDefinition). Mantida local para que esta
// rota de prova não dependa de nenhum registry global do kit. O `chain` usa o
// enum Blockchain do app-kit (que o adapter-ethers-v6 também consome em
// runtime), pois o repo agora roda app-kit@1.11.0.
function arcTestnetChain() {
  return {
    chain: Blockchain.Arc_Testnet,
    name: "Arc Testnet",
    type: "evm" as const,
    chainId: ARC_CHAIN_ID,
    nativeCurrency: { name: "Arc", symbol: "ARC", decimals: 18 },
    isTestnet: true,
    explorerUrl: "https://testnet.arcscan.app",
    rpcEndpoints: [ARC_TESTNET_RPC],
    eurcAddress: EURC,
    usdcAddress: USDC,
    usdtAddress: null,
    cctp: null,
  }
}

/** Cotação read-only do nosso GenericAMMPair (USDC/EURC) via x*y=k com fee 0,3%. */
async function poolReadQuote(provider: JsonRpcProvider) {
  const pool = new Contract(
    POOL,
    [
      "function reserve0() view returns (uint256)",
      "function reserve1() view returns (uint256)",
      "function token0() view returns (address)",
      "function token1() view returns (address)",
    ],
    provider,
  )
  const [t0, , r0, r1] = await Promise.all([pool.token0(), pool.token1(), pool.reserve0(), pool.reserve1()])
  const t0IsUsdc = t0.toLowerCase() === USDC.toLowerCase()
  const reserveIn = t0IsUsdc ? r0 : r1
  const reserveOut = t0IsUsdc ? r1 : r0
  const inAmt = BigInt(Math.round(0.1 * 1e6))
  const feeBps = 300n
  const amtInAfterFee = (inAmt * (10000n - feeBps)) / 10000n
  const amtOut = (reserveOut * amtInAfterFee) / (reserveIn + amtInAfterFee)
  return {
    token0: t0,
    reserve0Raw: r0.toString(),
    reserve1Raw: r1.toString(),
    poolQuoteEurcPer0_1Usdc: Number(amtOut) / 1e6,
  }
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.VERCEL_ENV !== "production") {
    return json({ ok: false, error: "production_only" }, 403)
  }
  if (!isValidBearerRequest(request.headers.get("authorization"), "ADMIN_PANIC_KEY")) {
    return json({ ok: false, error: "unauthorized" }, 401)
  }

  let body: { tokenIn?: string; tokenOut?: string; amountIn?: string }
  try {
    body = await request.json() as { tokenIn?: string; tokenOut?: string; amountIn?: string }
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400)
  }
  const tokenIn = body.tokenIn ?? "USDC"
  const tokenOut = body.tokenOut ?? "EURC"
  const amountIn = body.amountIn ?? "0.1"

  try {
    const env = readVercelOidcKmsEnvironment()
    if (env.expectedAddress.toLowerCase() !== EXPECTED_ADDRESS.toLowerCase()) {
      return json({ ok: false, error: "unexpected_configured_signer" }, 412)
    }

    const client = await createVercelOidcKmsClient(env)
    const kmsEvm = new KmsEvmSigner({
      client,
      keyId: env.keyArn,
      expectedAddress: EXPECTED_ADDRESS,
    })
    const provider = new JsonRpcProvider(ARC_TESTNET_RPC, ARC_CHAIN_ID, { staticNetwork: true })
    const signer = new KmsEthersSigner(kmsEvm, provider)
    const address = await signer.getAddress()

    let poolQuote: unknown
    try {
      poolQuote = await poolReadQuote(provider)
    } catch (e) {
      poolQuote = { error: (e as Error)?.message ?? String(e) }
    }

    const adapter = new EthersAdapter(
      {
        signer,
        getProvider: ({ chain }) =>
          new JsonRpcProvider(chain?.rpcEndpoints?.[0] ?? ARC_TESTNET_RPC),
      },
      {
        addressContext: "user-controlled",
        supportedChains: [arcTestnetChain()],
      },
    )

    const kit = new AppKit()

    const result = await kit.swap({
      from: { adapter, chain: "Arc_Testnet" },
      tokenIn,
      tokenOut,
      amountIn,
    })

    const txHash = (result as any)?.steps?.[0]?.values?.txHash ?? (result as any)?.txHash
    return json({
      ok: true,
      address,
      tokenIn,
      tokenOut,
      amountIn,
      swapResult: result,
      txHash: txHash ?? null,
      explorerUrl: txHash ? `${ARC_TESTNET_EXPLORER}/tx/${txHash}` : null,
      poolQuote,
    })
  } catch (error) {
    console.error("[RI-BANK-91] AppKit swap failed", error)
    return json({
      ok: false,
      error: "appkit_swap_failed",
      detail: error instanceof Error ? error.message : "unknown error",
    }, 500)
  }
}