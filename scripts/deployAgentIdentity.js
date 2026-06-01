import 'dotenv/config';
// scripts/deployAgentIdentity.js
// Deploy do AgentIdentity (ERC-8004) na Base Mainnet via viem
// Uso: node scripts/deployAgentIdentity.js

import { createWalletClient, createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { execSync } from "child_process";

// ── Config ─────────────────────────────────
const PRIVATE_KEY = process.env.PRIVATE_KEY; // nunca commitar!
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY não definida no .env");

const account = privateKeyToAccount(`0x${PRIVATE_KEY}`);

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
});

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
});

// ── ABI + Bytecode (compilado com forge/hardhat) ──
// Após rodar: forge build --out out --contracts contracts/
const artifact = JSON.parse(
  readFileSync("./out/AgentIdentity.sol/AgentIdentity.json", "utf8")
);

async function main() {
  console.log("🚀 Deploying AgentIdentity (ERC-8004) na Base...");
  console.log("   Deployer:", account.address);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log("   Balance:", Number(balance) / 1e18, "ETH");

  // Deploy
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [],
  });

  console.log("   TX Hash:", hash);
  console.log("   Aguardando confirmação...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const contractAddress = receipt.contractAddress;

  console.log("\n✅ AgentIdentity deployado!");
  console.log("   Endereço:", contractAddress);
  console.log("   Block:", receipt.blockNumber);
  console.log(
    "\n   Basescan: https://basescan.org/address/" + contractAddress
  );

  // Registrar o agente principal
  console.log("\n🤖 Registrando agente principal...");
  const agentCardURI =
    "https://criptomorse-arc.vercel.app/api/agent-card";

  const registerHash = await walletClient.writeContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "registerAgent",
    args: [agentCardURI],
  });

  const regReceipt = await publicClient.waitForTransactionReceipt({
    hash: registerHash,
  });
  console.log("✅ Agente registrado! TX:", registerHash);
  console.log("   Agent ID: 1 (primeiro mint)");

  console.log("\n📋 Salve no .env:");
  console.log(`NEXT_PUBLIC_AGENT_IDENTITY_ADDRESS=${contractAddress}`);
}

main().catch(console.error);
