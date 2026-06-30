import { NextResponse } from "next/server"
import { contractRegistry } from "@/lib/contract-registry"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const network = searchParams.get("network") || undefined
  const tag = searchParams.get("tag") || undefined

  let contracts = tag
    ? contractRegistry.getByTag(tag, network)
    : contractRegistry.getAll(network)

  // Stripped para JSON (sem ABI completa por padrão — grande)
  const includeAbi = searchParams.get("abi") === "true"
  const result = contracts.map(c => ({
    name: c.name,
    symbol: c.symbol,
    address: c.address,
    network: c.network,
    description: c.description,
    source: c.source,
    explorerUrl: c.explorerUrl,
    deployTx: c.deployTx,
    deployBlock: c.deployBlock,
    tags: c.tags,
    metadata: c.metadata,
    ...(includeAbi ? { abi: c.abi } : {}),
  }))

  return NextResponse.json({
    count: result.length,
    network: network || "all",
    contracts: result,
  })
}