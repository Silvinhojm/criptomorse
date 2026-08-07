import { Contract, JsonRpcProvider } from "ethers"

import { KmsEthersSigner } from "@/lib/kms/kms-ethers-signer"
import { KmsEvmSigner } from "@/lib/kms/kms-evm-signer"
import {
  createVercelOidcKmsClient,
  readVercelOidcKmsEnvironment,
} from "@/lib/kms/vercel-oidc-kms"
import { isValidBearerRequest } from "@/lib/security/cron-auth"

// RI-BANK-93 — one-shot proof route: add liquidity to our own
// GenericAMMPair (USDC/EURC) on Arc testnet via the KMS signer.
// Sequence: approve(USDC) → approve(EURC) → addLiquidity(67.861581, 60.0).
// Authorized explicitly by the operator (copia4.txt + B1). Route is
// single-use: removed after the test (RI-BANK-42 commitment).
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const EXPECTED_ADDRESS = "0x88993E37Ed022C56F83f67C74d33C783E8e49C75"
const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network"
const ARC_CHAIN_ID = 5_042_002
const ARC_TESTNET_EXPLORER = "https://testnet.arcscan.app"
const USDC = "0x3600000000000000000000000000000000000000"
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
const POOL = "0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb"

// RI-BANK-93 — approved amounts (operator choice B1, 06/08):
// 67.861581 USDC + 60.000000 EURC — exact pool ratio (0.88415 EUR/USDC),
// no price distortion. Sequence: approve(USDC) → approve(EURC) →
// addLiquidity(67861581, 60000000).
const AMOUNT0 = 67_861_581n // USDC (6 decimals)
const AMOUNT1 = 60_000_000n // EURC (6 decimals)

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]

const POOL_ABI = [
  "function addLiquidity(uint256 amount0, uint256 amount1)",
  "function reserve0() view returns (uint256)",
  "function reserve1() view returns (uint256)",
  "function totalLiquidity() view returns (uint256)",
  "function liquidity(address) view returns (uint256)",
]

export async function POST(request: Request): Promise<Response> {
  if (process.env.VERCEL_ENV !== "production") {
    return json({ ok: false, error: "production_only" }, 403)
  }
  if (!isValidBearerRequest(request.headers.get("authorization"), "ADMIN_PANIC_KEY")) {
    return json({ ok: false, error: "unauthorized" }, 401)
  }

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
    const provider = new JsonRpcProvider(ARC_TESTNET_RPC, ARC_CHAIN_ID, {
      staticNetwork: true,
    })
    const signer = new KmsEthersSigner(kmsEvm, provider)
    const address = await signer.getAddress()

    const usdc = new Contract(USDC, ERC20_ABI, signer)
    const eurc = new Contract(EURC, ERC20_ABI, signer)
    const pool = new Contract(POOL, POOL_ABI, signer)

    const report: Record<string, unknown> = { address, pool: POOL, usdc: USDC, eurc: EURC }
    const txHashes: string[] = []

    // Step 1-2: approvals (skipped when allowance already covers the amount)
    const before: Record<string, unknown> = {}
    const allowances = await Promise.all([
      usdc.allowance(address, POOL),
      eurc.allowance(address, POOL),
    ])
    before.usdcAllowance = allowances[0].toString()
    before.eurcAllowance = allowances[1].toString()

    if (allowances[0] < AMOUNT0) {
      const tx = await usdc.approve(POOL, AMOUNT0)
      await tx.wait()
      txHashes.push(tx.hash)
      report.usdcApproveTx = tx.hash
    } else {
      report.usdcApproveTx = "skipped (allowance sufficient)"
    }

    if (allowances[1] < AMOUNT1) {
      const tx = await eurc.approve(POOL, AMOUNT1)
      await tx.wait()
      txHashes.push(tx.hash)
      report.eurcApproveTx = tx.hash
    } else {
      report.eurcApproveTx = "skipped (allowance sufficient)"
    }

    // Step 3: addLiquidity
    const reservesBefore = await Promise.all([pool.reserve0(), pool.reserve1()])
    const liquidityBefore = await pool.liquidity(address)
    const totalLiquidityBefore = await pool.totalLiquidity()
    before.reserve0 = reservesBefore[0].toString()
    before.reserve1 = reservesBefore[1].toString()
    before.signerLiquidity = liquidityBefore.toString()
    before.totalLiquidity = totalLiquidityBefore.toString()

    const addTx = await pool.addLiquidity(AMOUNT0, AMOUNT1)
    await addTx.wait()
    txHashes.push(addTx.hash)
    report.addLiquidityTx = addTx.hash

    // Post-state: real reserves + signer liquidity
    const [reserve0After, reserve1After, liquidityAfter, totalLiquidityAfter] =
      await Promise.all([
        pool.reserve0(),
        pool.reserve1(),
        pool.liquidity(address),
        pool.totalLiquidity(),
      ])

    return json({
      ok: true,
      ...report,
      before,
      after: {
        reserve0: reserve0After.toString(),
        reserve1: reserve1After.toString(),
        reserve0Human: Number(reserve0After) / 1e6,
        reserve1Human: Number(reserve1After) / 1e6,
        signerLiquidity: liquidityAfter.toString(),
        signerLiquidityMinted:
          Number(liquidityAfter) - Number(liquidityBefore),
        totalLiquidity: totalLiquidityAfter.toString(),
      },
      txHashes,
      explorerUrls: txHashes.map(
        (h) => `${ARC_TESTNET_EXPLORER}/tx/${h}`,
      ),
    })
  } catch (error) {
    console.error("[RI-BANK-93] addLiquidity failed", error)
    return json(
      {
        ok: false,
        error: "add_liquidity_failed",
        detail: error instanceof Error ? error.message : "unknown error",
      },
      500,
    )
  }
}
