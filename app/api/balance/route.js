import { ethers } from "ethers";

const NETWORK_CONFIGS = {
  arc: {
    rpc: "https://rpc.testnet.arc.network",
    usdc: "0x3600000000000000000000000000000000000000",
  },
  base: {
    rpc: "https://mainnet.base.org",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  polygon: {
    rpc: "https://polygon.publicnode.com",
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  },
  ethereum: {
    rpc: "https://eth.llamarpc.com",
    usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  },
};

const ABI = ["function balanceOf(address) view returns (uint256)"];

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");
  const network = searchParams.get("network") || "arc";
  if (!address) return Response.json({ error: "address obrigatório" }, { status: 400 });

  const config = NETWORK_CONFIGS[network] || NETWORK_CONFIGS.arc;

  try {
    const provider = new ethers.JsonRpcProvider(config.rpc);
    const contract = new ethers.Contract(config.usdc, ABI, provider);
    const raw      = await contract.balanceOf(address);
    return Response.json({ balance: ethers.formatUnits(raw, 6), network });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}