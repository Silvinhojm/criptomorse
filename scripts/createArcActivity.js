require('dotenv').config();
// scripts/createArcActivity.js
// Gera atividade on-chain para preencher os widgets do arcscan

const { createWalletClient, createPublicClient, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { readFileSync } = require("fs");

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY nao definida");

const AGENT_IDENTITY = "0xd2a801E60A0AB36Da3Fb17d4A7654b494bA8326B";
const ERC8183 = "0x319227cf1de5c61d11313af8226a8f5309fa70d9";

const ARC_CHAIN = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "ARC", symbol: "ARC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
};

const account = privateKeyToAccount(PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`);

const walletClient = createWalletClient({ account, chain: ARC_CHAIN, transport: http("https://rpc.testnet.arc.network") });
const publicClient = createPublicClient({ chain: ARC_CHAIN, transport: http("https://rpc.testnet.arc.network") });

const agentABI = JSON.parse(readFileSync("./out/AgentIdentity/contracts_AgentIdentity_sol_AgentIdentity.abi", "utf8"));
const erc8183ABI = JSON.parse(readFileSync("./out/ERC8183/contracts_ERC8183_sol_ERC8183.abi", "utf8"));

async function registerAgent(name, metadataURI) {
  console.log(`  Registrando agente: ${name}...`);
  const hash = await walletClient.writeContract({
    address: AGENT_IDENTITY,
    abi: agentABI,
    functionName: "registerAgent",
    args: [metadataURI],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  // Find AgentRegistered event for agentId
  let agentId = 0;
  for (const log of receipt.logs) {
    try {
      const topic = log.topics[0];
      // AgentRegistered = keccak256("AgentRegistered(uint256,address,string)") = 0x0d063c60...
      if (topic === "0x0d063c6022bff16d09991a9f91882ffa112f5fb2529136f65eb4c77bbd047e43") {
        agentId = Number(log.data ? "0x" + Buffer.from(log.data.slice(2), "hex").readBigUInt64BE(0).toString() : 0);
        // Actually, let me parse from topics (indexed agentId)
        if (log.topics[1]) {
          agentId = Number(BigInt(log.topics[1]));
        }
      }
    } catch {}
  }
  console.log(`    Agent #${agentId} registrado. TX: ${hash}`);
  return agentId;
}

async function createJob(provider, description, budget) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400 * 30); // 30 days
  console.log(`  Criando job: ${description}...`);
  const hash = await walletClient.writeContract({
    address: ERC8183,
    abi: erc8183ABI,
    functionName: "createJob",
    args: [provider, description, BigInt(budget), deadline],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`    Job criado. TX: ${hash}`);
  return hash;
}

async function main() {
  console.log("=== Gerando atividade on-chain na Arc Testnet ===\n");
  console.log("Deployer:", account.address);
  const balance = await publicClient.getBalance({ address: account.address });
  console.log("Balance:", Number(balance) / 1e18, "ARC\n");

  // 1. Registrar mais agentes
  console.log("--- 1. Registrando agentes adicionais ---");
  await registerAgent(
    "Morse Signal Agent",
    "https://criptomorse-arc.vercel.app/api/agent-card/" + account.address
  );
  await registerAgent(
    "Quantum Wave Oracle",
    "https://criptomorse-arc.vercel.app/api/agent-card/" + account.address
  );
  await registerAgent(
    "Volatility Staircase Guardian",
    "https://criptomorse-arc.vercel.app/api/agent-card/" + account.address
  );

  // 2. Criar jobs no marketplace
  console.log("\n--- 2. Criando jobs no ERC-8183 ---");
  const provider = account.address; // self for demo
  await createJob(provider, "Monitor USDC/EURC pair and execute arbitrage when spread > 0.5%", "10000000"); // 10 USDC (6 decimals)
  await createJob(provider, "Bridge 500 USDC from Polygon to Arc via CCTP", "5000000");
  await createJob(provider, "Execute DCA strategy: buy 10 EURC daily for 30 days", "3000000");
  await createJob(provider, "Monitor gas prices and execute swap when gas < 0.005 USDC", "2000000");
  await createJob(provider, "Run volatility analysis on cirBTC/USDC pair", "8000000");

  // 3. Verificar estado final
  console.log("\n--- 3. Estado final ---");
  const totalAgents = await publicClient.readContract({
    address: AGENT_IDENTITY, abi: agentABI, functionName: "totalAgents",
  });
  const totalJobs = await publicClient.readContract({
    address: ERC8183, abi: erc8183ABI, functionName: "totalJobs",
  });
  console.log(`Total agentes registrados: ${totalAgents}`);
  console.log(`Total jobs criados: ${totalJobs}`);
  console.log("\nArcscan:");
  console.log("  AgentIdentity: https://testnet.arcscan.app/address/" + AGENT_IDENTITY + "?tab=widgets");
  console.log("  ERC8183:       https://testnet.arcscan.app/address/" + ERC8183 + "?tab=widgets");
}

main().catch(console.error);
