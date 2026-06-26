require('dotenv').config();
// scripts/deployERC8183Arc.js
// Deploy do ERC8183 (Job Marketplace) na Arc Testnet

const { createWalletClient, createPublicClient, http, parseEther } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { readFileSync } = require("fs");

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY nao definida no .env");

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const AGENT_IDENTITY_ADDRESS = "0xd2a801E60A0AB36Da3Fb17d4A7654b494bA8326B";

const ARC_CHAIN = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "ARC", symbol: "ARC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
};

const account = privateKeyToAccount(
  PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`
);

const walletClient = createWalletClient({
  account,
  chain: ARC_CHAIN,
  transport: http("https://rpc.testnet.arc.network"),
});

const publicClient = createPublicClient({
  chain: ARC_CHAIN,
  transport: http("https://rpc.testnet.arc.network"),
});

const abi = JSON.parse(
  readFileSync("./out/ERC8183/contracts_ERC8183_sol_ERC8183.abi", "utf8")
);
const bytecode = "0x" + readFileSync(
  "./out/ERC8183/contracts_ERC8183_sol_ERC8183.bin", "utf8"
).trim();

async function main() {
  console.log("Deploying ERC8183 (Job Marketplace) na Arc Testnet...");
  console.log("   Deployer:", account.address);
  console.log("   USDC:", USDC_ADDRESS);
  console.log("   AgentIdentity:", AGENT_IDENTITY_ADDRESS);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log("   Balance:", Number(balance) / 1e18, "ARC");

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [USDC_ADDRESS, AGENT_IDENTITY_ADDRESS],
  });

  console.log("   TX Hash:", hash);
  console.log("   Aguardando confirmacao...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const contractAddress = receipt.contractAddress;

  console.log("\nERC8183 deployado!");
  console.log("   Endereco:", contractAddress);
  console.log("   Block:", receipt.blockNumber);
  console.log("\n   Arcscan: https://testnet.arcscan.app/address/" + contractAddress);
  console.log("\n=== Salve no .env.local: ===");
  console.log(`NEXT_PUBLIC_ERC8183_ADDRESS=${contractAddress}`);
}

main().catch(console.error);
