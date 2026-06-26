// scripts/deployMicroPoolArc.js
// Deploy de MicroPool na Arc testnet para USDC/EURC
// Uso: node scripts/deployMicroPoolArc.js

const { ethers } = require("ethers");
require("dotenv").config({ path: ".env.local" });

const ARC_RPC = "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = 5042002;
const USDC_ARC = "0x3600000000000000000000000000000000000000";
const EURC_ARC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

const MicroPoolABI = [
  "constructor(address,address)",
  "function addLiquidity(uint256,uint256,uint256,uint256,address) returns (uint256,uint256,uint256)",
  "function getReserves() view returns (uint256,uint256)",
  "function getPrice(address) view returns (uint256)",
  "function getPoolImbalance() view returns (int256)",
  "function swap(uint256,address,uint256,address) returns (uint256)",
];

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY não definida no .env.local");

  const provider = new ethers.JsonRpcProvider(ARC_RPC);
  const wallet = new ethers.Wallet(pk, provider);
  console.log(`👤 Deployer: ${wallet.address}`);

  // Compilar MicroPool.sol
  console.log("🔨 Compilando MicroPool.sol...");
  const solc = require("solc");
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "contracts", "MicroPool.sol"), "utf8");

  const input = {
    language: "Solidity",
    sources: { "MicroPool.sol": { content: source } },
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } }, optimizer: { enabled: true, runs: 200 } },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const contract = output.contracts["MicroPool.sol"]["MicroPool"];
  if (!contract) { console.error(JSON.stringify(output.errors, null, 2)); throw new Error("Compilação falhou"); }

  const abi = contract.abi;
  const bytecode = "0x" + contract.evm.bytecode.object;
  console.log("✅ Compilado — bytecode:", bytecode.length, "bytes");

  // Deploy
  console.log(`🚀 Deployando MicroPool com ${USDC_ARC.slice(0,10)}... / ${EURC_ARC.slice(0,10)}...`);
  const Factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const pool = await Factory.deploy(USDC_ARC, EURC_ARC);
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(`✅ MicroPool deployado em: ${poolAddr}`);
  console.log(`📜 Explorer: https://testnet.arcscan.app/address/${poolAddr}`);

  // Verificar
  const [r0, r1] = await pool.getReserves();
  console.log(`📊 Reserves iniciais: r0=${r0.toString()} r1=${r1.toString()}`);
  console.log(`💰 Preço: ${(await pool.getPrice(USDC_ARC)).toString()}`);
  console.log(`⚖️  Imbalanço: ${(await pool.getPoolImbalance()).toString()} bps`);

  // Adicionar liquidez ($50 USDC + $50 EURC)
  // Nota: É necessário aprovar USDC e EURC para o pool primeiro
  // Faucet necessário: https://faucet.circle.com (USDC + EURC na Arc)

  console.log("\n📋 Próximos passos manuais:");
  console.log("1. Aprovar USDC: pool.approve(USDC, poolAddr, amount)");
  console.log("2. Aprovar EURC: pool.approve(EURC, poolAddr, amount)");
  console.log("3. Adicionar liquidez: pool.addLiquidity(50e6, 50e6, 49e6, 49e6, wallet)");
  console.log(`\n💡 Para testar a matemática: swap $1 USDC causa ~4% price impact num pool de $100`);
  console.log(`   Pool de $100: trade de $1 → slippage ~4% — NÃO é lucrativo`);
  console.log(`   Pool de $1000: trade de $1 → slippage ~0.4% — marginal`);
  console.log(`   Pool de $5000: trade de $1 → slippage ~0.08% — viável`);

  return poolAddr;
}

main()
  .then(addr => { console.log(`\n🏁 MicroPool: ${addr}`); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
