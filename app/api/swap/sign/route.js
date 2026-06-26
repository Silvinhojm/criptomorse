import { ethers } from "ethers";

const NETWORK_RPCS = {
  137: "https://polygon.publicnode.com",
  8453: "https://mainnet.base.org",
  42161: "https://arb1.arbitrum.io/rpc",
  1: "https://eth.llamarpc.com",
  5042002: "https://rpc.testnet.arc.network",
};

function getSigner(chainId) {
  const raw = process.env.PRIVATE_KEY;
  if (!raw || raw.length < 64) return null;
  const pk = raw.startsWith("0x") ? raw : "0x" + raw;
  const rpc = NETWORK_RPCS[chainId];
  if (!rpc) return null;
  return new ethers.Wallet(pk, new ethers.JsonRpcProvider(rpc));
}

export async function POST(req) {
  try {
    const { tx, chainId } = await req.json();
    if (!tx || !chainId) return Response.json({ error: "tx e chainId obrigatorios" }, { status: 400 });

    const signer = getSigner(chainId);
    if (!signer) return Response.json({ error: "PRIVATE_KEY nao configurada ou rede sem suporte" }, { status: 503 });

    const signedTx = await signer.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value ?? "0"),
      gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
    });

    return Response.json({ hash: signedTx.hash });
  } catch (err) {
    return Response.json({ error: err.message || "Erro ao assinar" }, { status: 500 });
  }
}

export async function GET() {
  const hasKey = !!(process.env.PRIVATE_KEY && process.env.PRIVATE_KEY.length >= 64);
  return Response.json({ autoSignAvailable: hasKey });
}