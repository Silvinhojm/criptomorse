// scripts/deployBatchExecutorArc.js
// Deploy do BatchExecutor na Arc Testnet
// Uso: npx hardhat run scripts/deployBatchExecutorArc.js --network arc_testnet
// Ou: node scripts/deployBatchExecutorArc.js (com .env configurado)

const { ethers } = require("ethers");

const ARC_RPC = "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = 5042002;

async function main() {
  const privateKey = process.env.PRIVATE_KEY || process.env.PRIVATE_KEY_STRESS;
  if (!privateKey || privateKey.length < 64) {
    console.error("❌ PRIVATE_KEY ou PRIVATE_KEY_STRESS não configurada no .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(ARC_RPC);
  const wallet = new ethers.Wallet(privateKey, provider);
  const address = await wallet.getAddress();
  console.log(`🔑 Deployer: ${address}`);
  console.log(`💰 Balance: ${ethers.formatEther(await provider.getBalance(address))} ARC`);

  const abi = [
    "constructor()",
    "function submitBatch(address[],address[],address[],bytes[],uint256[],uint256[],uint256[]) returns (uint256)",
    "function executeBatch(uint256) returns (uint256,uint256)",
    "function estimateBatch(address[],bytes[]) view returns (bool[],bytes[])",
    "event BatchSubmitted(uint256,uint256,address)",
    "event BatchExecuted(uint256,uint256,uint256)",
    "event OrderExecuted(uint256,uint256,bool,uint256)",
  ];

  const bytecode = "0x"; // placeholder — será substituído pelo bytecode compilado

  // NOTA: Para deploy real, compile com Hardhat primeiro:
  // npx hardhat compile
  // Depois leia o artifact:
  // const artifact = require("../artifacts/contracts/BatchExecutor.sol/BatchExecutor.json");
  // const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();

  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  console.log(`✅ BatchExecutor deployado em: ${contractAddress}`);
  console.log(`🔗 Explorer: https://testnet.arcscan.app/address/${contractAddress}`);

  // Salva o endereço para uso no sistema
  const fs = require("fs");
  const envPath = ".env.local";
  let envContent = "";
  try {
    envContent = fs.readFileSync(envPath, "utf8");
  } catch {
    envContent = "";
  }
  if (envContent.includes("NEXT_PUBLIC_BATCH_EXECUTOR_ADDRESS")) {
    envContent = envContent.replace(
      /NEXT_PUBLIC_BATCH_EXECUTOR_ADDRESS=.*/,
      `NEXT_PUBLIC_BATCH_EXECUTOR_ADDRESS=${contractAddress}`
    );
  } else {
    envContent += `\nNEXT_PUBLIC_BATCH_EXECUTOR_ADDRESS=${contractAddress}\n`;
  }
  fs.writeFileSync(envPath, envContent);
  console.log(`📝 Endereço salvo em .env.local`);
}

main().catch((error) => {
  console.error("❌ Erro no deploy:", error);
  process.exit(1);
});
