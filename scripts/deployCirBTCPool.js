// scripts/deployCirBTCPool.js
// Deploy GenericAMMPair (USDC→cirBTC) na Arc testnet com endereço oficial Circle
// Uso: node scripts/deployCirBTCPool.js
// Pré-requisito: PRIVATE_KEY no .env.local com USDC na Arc testnet

const { ethers } = require("ethers");
require("dotenv").config({ path: ".env.local" });

const ARC_RPC = "https://rpc.testnet.arc.network";
const USDC_ARC = "0x3600000000000000000000000000000000000000";
const CIRBTC_ARC = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF";

const LIQ_USDC = 10_000_000n;   // 10 USDC
const LIQ_CIRBTC = 0n;          // 0 — pool vazia, só deploy

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY não definida no .env.local");

  const provider = new ethers.JsonRpcProvider(ARC_RPC);
  const wallet = new ethers.Wallet(pk, provider);
  console.log(`👤 Deployer: ${wallet.address}`);
  console.log(`🔗 USDC: ${USDC_ARC}`);
  console.log(`🔗 cirBTC (oficial Circle): ${CIRBTC_ARC}`);

  const solc = require("solc");
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(
    path.join(__dirname, "..", "contracts", "GenericAMMPair.sol"), "utf8"
  );

  const input = {
    language: "Solidity",
    sources: { "GenericAMMPair.sol": { content: source } },
    settings: {
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
      optimizer: { enabled: true, runs: 200 },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const contract = output.contracts["GenericAMMPair.sol"]["GenericAMMPair"];
  if (!contract) {
    console.error(JSON.stringify(output.errors, null, 2));
    throw new Error("Compilação falhou");
  }

  const abi = contract.abi;
  const bytecode = "0x" + contract.evm.bytecode.object;

  const Factory = new ethers.ContractFactory(abi, bytecode, wallet);
  console.log(`\n🚀 Deployando pool USDC→cirBTC...`);
  const pool = await Factory.deploy(USDC_ARC, CIRBTC_ARC);
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(`✅ Pool: ${poolAddr}`);
  console.log(`📜 https://testnet.arcscan.app/address/${poolAddr}`);

  const t0 = await pool.token0();
  const t1 = await pool.token1();
  const r0 = await pool.reserve0();
  const r1 = await pool.reserve1();
  console.log(`   token0: ${t0} (${t0.toLowerCase() === USDC_ARC.toLowerCase() ? "USDC" : "?"})`);
  console.log(`   token1: ${t1} (${t1.toLowerCase() === CIRBTC_ARC.toLowerCase() ? "cirBTC" : "?"})`);
  console.log(`   Reserves: ${r0.toString()}, ${r1.toString()}`);

  if (LIQ_USDC > 0n) {
    console.log(`\n💧 Adicionando ${ethers.formatUnits(LIQ_USDC, 6)} USDC...`);
    const erc20 = ["function approve(address,uint256) returns (bool)"];
    const usdc = new ethers.Contract(USDC_ARC, erc20, wallet);
    const approveTx = await usdc.approve(poolAddr, LIQ_USDC);
    await approveTx.wait();
    console.log(`   ✅ approve USDC: ${approveTx.hash}`);
    const tx = await pool.addLiquidity(LIQ_USDC, LIQ_CIRBTC);
    await tx.wait();
    console.log(`   ✅ addLiquidity: ${tx.hash}`);
    const nr0 = await pool.reserve0();
    const nr1 = await pool.reserve1();
    console.log(`   Reserves após: ${ethers.formatUnits(nr0, 6)} USDC | ${ethers.formatUnits(nr1, 8)} cirBTC`);
  }

  // Instruções para configurar no código
  console.log(`\n📝 Adicione esta linha em arc-direct-swap.ts AMM_PAIRS:
  '0x3600000000000000000000000000000000000000:${CIRBTC_ARC.toLowerCase()}': '${poolAddr.toLowerCase()}',
  '${CIRBTC_ARC.toLowerCase()}:0x3600000000000000000000000000000000000000': '${poolAddr.toLowerCase()}',`);

  console.log(`\n📝 Adicione esta linha em route-verifier.ts KNOWN_POOLS[ARC_CHAIN_ID]:
  { address: '${poolAddr.toLowerCase()}', token0: ARC_USDC, token1: ARC_CIRBTC, fee: 0.003, stablecoin: false },`);

  console.log(`\n🏁 Feito!`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
