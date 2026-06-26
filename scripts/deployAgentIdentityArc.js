require('dotenv').config();
// scripts/deployAgentIdentityArc.js
// Deploy do AgentIdentity (ERC-8004) na Arc Testnet via viem
// Uso: node scripts/deployAgentIdentityArc.js

const { createWalletClient, createPublicClient, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { readFileSync } = require("fs");

// ── Config ─────────────────────────────────
const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY não definida no .env");

const ARC_CHAIN = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "ARC", symbol: "ARC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
};

const account = privateKeyToAccount(PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`);

const walletClient = createWalletClient({
  account,
  chain: ARC_CHAIN,
  transport: http("https://rpc.testnet.arc.network"),
});

const publicClient = createPublicClient({
  chain: ARC_CHAIN,
  transport: http("https://rpc.testnet.arc.network"),
});

// ── ABI + Bytecode (compilado com npx solc) ──
const abi = JSON.parse(
  readFileSync("./out/AgentIdentity/contracts_AgentIdentity_sol_AgentIdentity.abi", "utf8")
);
const bytecode = "0x" + readFileSync(
  "./out/AgentIdentity/contracts_AgentIdentity_sol_AgentIdentity.bin", "utf8"
).trim();

async function main() {
  console.log("Deploying AgentIdentity (ERC-8004) na Arc Testnet...");
  console.log("   Deployer:", account.address);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log("   Balance:", Number(balance) / 1e18, "ARC");

  // Deploy
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [],
  });

  console.log("   TX Hash:", hash);
  console.log("   Aguardando confirmacao...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const contractAddress = receipt.contractAddress;

  console.log("\nAgentIdentity deployado!");
  console.log("   Endereco:", contractAddress);
  console.log("   Block:", receipt.blockNumber);
  console.log("\n   Arcscan: https://testnet.arcscan.app/address/" + contractAddress);

  // Registrar o agente principal
  console.log("\nRegistrando agente principal...");
  const agentCardURI =
    "https://criptomorse-arc.vercel.app/api/agent-card/" + account.address;

  const registerHash = await walletClient.writeContract({
    address: contractAddress,
    abi,
    functionName: "registerAgent",
    args: [agentCardURI],
  });

  const regReceipt = await publicClient.waitForTransactionReceipt({
    hash: registerHash,
  });
  console.log("Agente registrado! TX:", registerHash);
  console.log("   Agent ID: 1 (primeiro mint)");
  console.log("   Agent Card URI:", agentCardURI);

  console.log("\n=== Salve no .env.local: ===");
  console.log(`NEXT_PUBLIC_AGENT_IDENTITY_ADDRESS=${contractAddress}`);
  console.log("===========================");
}

main().catch(console.error);
