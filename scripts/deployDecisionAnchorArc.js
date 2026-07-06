require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { createWalletClient, createPublicClient, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { readFileSync } = require("fs");

const PRIVATE_KEY = process.env.PRIVATE_KEY_STRESS || process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY_STRESS ou PRIVATE_KEY nao definida");

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
  readFileSync("./out/DecisionAnchor/contracts_DecisionAnchor_sol_DecisionAnchor.abi", "utf8")
);
const bytecode = "0x" + readFileSync(
  "./out/DecisionAnchor/contracts_DecisionAnchor_sol_DecisionAnchor.bin", "utf8"
).trim();

async function main() {
  console.log("Deploying DecisionAnchor na Arc Testnet...");
  console.log("   Deployer:", account.address);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log("   Balance:", Number(balance) / 1e18, "ARC");

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [],
  });

  console.log("   TX Hash:", hash);
  console.log("   Aguardando confirmacao...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const contractAddress = receipt.contractAddress;

  console.log("\nDecisionAnchor deployado!");
  console.log("   Endereco:", contractAddress);
  console.log("   Block:", receipt.blockNumber);
  console.log("\n   Arcscan: https://testnet.arcscan.app/address/" + contractAddress);
  console.log("\n=== Salve no .env.local: ===");
  console.log(`NEXT_PUBLIC_DECISION_ANCHOR_ADDRESS=${contractAddress}`);
}

main().catch(console.error);
