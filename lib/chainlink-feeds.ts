import { ethers } from "ethers"

interface FeedConfig {
  address: string
  decimals?: number
}

const CHAINLINK_FEEDS: Record<string, Record<string, FeedConfig>> = {
  polygon: {
    USDC:  { address: "0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7" },
    USDT:  { address: "0x0A6513e40db6EB1b165753AD52E80663aeA50545" },
    DAI:   { address: "0x4746DeC9e833A82EC7C2C1356372CcF2cfCd2F3" },
    WETH:  { address: "0xF9680D99D6C9589e2a93a78A04A279e509205945" },
    ETH:   { address: "0xF9680D99D6C9589e2a93a78A04A279e509205945" },
    WBTC:  { address: "0xc907E116054Ad103354f2D350FD25144358D57F6" },
    BTC:   { address: "0xc907E116054Ad103354f2D350FD25144358D57F6" },
    WMATIC:{ address: "0xAB594600376Ec9fD91F8e885dADF0CE036862dE0" },
    MATIC: { address: "0xAB594600376Ec9fD91F8e885dADF0CE036862dE0" },
    LINK:  { address: "0xb77fa460f0d9bd216d94a8a61f483ff0e15d48d3" },

  },
  // Arc testnet — feeds serão adicionados via Chainlink Scale
  arc: {},
}

const AGGREGATOR_V3_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]

export function hasChainlinkFeed(token: string, network: string): boolean {
  const feeds = CHAINLINK_FEEDS[network]
  return !!feeds && !!feeds[token]
}

export async function queryChainlinkPrice(
  token: string,
  network: string,
  rpcUrl: string,
): Promise<number | null> {
  const feed = CHAINLINK_FEEDS[network]?.[token]
  if (!feed) return null

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true })
    const contract = new ethers.Contract(feed.address, AGGREGATOR_V3_ABI, provider)
    const [, answer] = await contract.latestRoundData()
    if (answer <= 0n) return null
    const dec = feed.decimals ?? Number(await contract.decimals().catch(() => 8))
    return parseFloat(ethers.formatUnits(answer, dec))
  } catch {
    return null
  }
}
