import { ethers } from "ethers";

const NETWORKS = {
  polygon: {
    chainId: 137, rpc: "https://polygon.publicnode.com",
    tokens: { USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", WETH: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", WMATIC: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270" },
  },
  base: {
    chainId: 8453, rpc: "https://mainnet.base.org",
    tokens: { USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", WETH: "0x4200000000000000000000000000000000000006", EURC: "0x60ef20Fed854B7e505bF07Fc4932BcA359191B9C", DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", WBTC: "0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b" },
  },
  arc: {
    chainId: 5042002, rpc: "https://rpc.testnet.arc.network",
    tokens: { USDC: "0x3600000000000000000000000000000000000000", WETH: "0x7E8861F97E1C77c27d23Be9b213F2eA81C2Cc36c" },
  },
};

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

const LI_FI_API = "https://li.quest/v1";

function getProvider(network) {
  const net = NETWORKS[network];
  if (!net) throw new Error(`Rede desconhecida: ${network}`);
  return new ethers.JsonRpcProvider(net.rpc);
}

function getSigner(network) {
  const pk = process.env.PRIVATE_KEY;
  if (!pk || pk.length < 64) throw new Error("PRIVATE_KEY nao configurada no .env");
  const key = pk.startsWith("0x") ? pk : "0x" + pk;
  return new ethers.Wallet(key, getProvider(network));
}

function toTokenUnits(amount, decimals) {
  return ethers.parseUnits(amount.toFixed(decimals), decimals).toString();
}

export async function POST(req) {
  try {
    const { fromToken, toToken, amountUsd, network } = await req.json();
    const net = NETWORKS[network];
    if (!net) return Response.json({ error: "Rede invalida" }, { status: 400 });

    const signer = getSigner(network);
    const address = await signer.getAddress();
    const fromDecimals = 6; // USDC/USDT/DAI tem 6 na Polygon
    const fromAmountRaw = toTokenUnits(amountUsd, fromDecimals);

    // 1. Buscar cotacao LI.FI
    const url = new URL(`${LI_FI_API}/quote`);
    url.searchParams.set("fromChain", net.chainId.toString());
    url.searchParams.set("toChain", net.chainId.toString());
    url.searchParams.set("fromToken", net.tokens[fromToken]);
    url.searchParams.set("toToken", net.tokens[toToken]);
    url.searchParams.set("fromAmount", fromAmountRaw);
    url.searchParams.set("fromAddress", address);
    url.searchParams.set("slippage", "0.005");
    url.searchParams.set("integrator", "ArcFlow");

    const quoteRes = await fetch(url.toString());
    if (!quoteRes.ok) return Response.json({ error: `LI.FI: ${quoteRes.status}` }, { status: 502 });

    const quote = await quoteRes.json();
    if (!quote?.transactionRequest) return Response.json({ error: "Nenhuma rota viavel" }, { status: 404 });

    // 2. Aprovar token se necessario
    const tokenContract = new ethers.Contract(net.tokens[fromToken], ERC20_ABI, signer);
    const allowance = await tokenContract.allowance(address, quote.transactionRequest.to);
    if (allowance < BigInt(fromAmountRaw)) {
      const approveTx = await tokenContract.approve(quote.transactionRequest.to, ethers.MaxUint256);
      await approveTx.wait();
    }

    // 3. Assinar e enviar transacao
    const tx = await signer.sendTransaction({
      to: quote.transactionRequest.to,
      data: quote.transactionRequest.data,
      value: BigInt(quote.transactionRequest.value ?? "0"),
      gasLimit: BigInt(quote.transactionRequest.gasLimit ?? "300000"),
    });

    const receipt = await tx.wait(1);
    if (!receipt || receipt.status === 0) {
      return Response.json({ error: "TX falhou on-chain" }, { status: 500 });
    }

    // 4. Calcular valor recebido on-chain
    const toContract = new ethers.Contract(net.tokens[toToken], ERC20_ABI, signer);
    const [toDecimals, toBalance] = await Promise.all([
      toContract.decimals(),
      toContract.balanceOf(address),
    ]);
    const toAmount = parseFloat(ethers.formatUnits(toBalance, toDecimals));

    const explorerUrl = `https://${network === "polygon" ? "polygonscan" : network === "base" ? "basescan" : "explorer.arc.network"}.com/tx/${tx.hash}`;

    return Response.json({
      success: true,
      txHash: tx.hash,
      explorerUrl,
      fromToken,
      toToken,
      fromAmount: amountUsd,
      toAmount,
      confirmed: true,
      blockNumber: receipt.blockNumber,
      message: `${fromToken}→${toToken} $${amountUsd} → ${toAmount.toFixed(6)}`,
    });
  } catch (err) {
    return Response.json({ error: err.message || "Erro interno" }, { status: 500 });
  }
}