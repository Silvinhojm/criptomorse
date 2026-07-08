import { NextRequest, NextResponse } from "next/server"
import { ethers } from "ethers"
import { DECISION_ANCHOR_ABI } from "@/lib/decision-anchor-abi"

const ARC_RPC = "https://rpc.testnet.arc.network"
const DEFAULT_ANCHOR = "0x7813e04338dc9d6b7676843a52152c57438cc7b2"

export async function POST(req: NextRequest) {
  try {
    const { hash, metadataURI } = await req.json()
    if (!hash || !metadataURI) {
      return NextResponse.json({ error: "hash and metadataURI required" }, { status: 400 })
    }

    const pk = process.env.PRIVATE_KEY || process.env.PRIVATE_KEY_STRESS
    if (!pk) {
      return NextResponse.json({ error: "no private key configured on server" }, { status: 500 })
    }

    const anchorAddress = process.env.DECISION_ANCHOR_ADDRESS || DEFAULT_ANCHOR
    const provider = new ethers.JsonRpcProvider(ARC_RPC)
    const signer = new ethers.Wallet(pk, provider)
    const contract = new ethers.Contract(anchorAddress, DECISION_ANCHOR_ABI, signer)

    let gasLimit: bigint
    try {
      const estimated = await contract.anchor.estimateGas(hash, metadataURI)
      gasLimit = estimated * 130n / 100n
    } catch {
      gasLimit = 200000n
    }

    const tx = await contract.anchor(hash, metadataURI, { gasLimit })
    const receipt = await tx.wait()
    if (!receipt || receipt.status === 0) {
      return NextResponse.json({ error: "anchor transaction reverted" }, { status: 500 })
    }

    console.log(`[API anchor-decision] ✅ tx:${tx.hash} block:${receipt.blockNumber} hash:${hash.slice(0, 18)}...`)

    return NextResponse.json({
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      hash,
    })
  } catch (e) {
    const msg = (e as Error).message
    console.error("[API anchor-decision] Error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
