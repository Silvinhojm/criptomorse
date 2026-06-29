// scripts/deployAMMArc.js
// Deploy GenericAMMPair (Uniswap V2-style) na Arc testnet
// Uso: node scripts/deployAMMArc.js
// Pré-requisito: PRIVATE_KEY no .env.local

const { ethers } = require("ethers");
require("dotenv").config({ path: ".env.local" });

const ARC_RPC = "https://rpc.testnet.arc.network";
const USDC_ARC = "0x3600000000000000000000000000000000000000";
const EURC_ARC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
const RPC_FALLBACKS = ["https://testnet.arc.network/rpc"];

const PAIRS = [
  { name: "USDC→EURC", token0: USDC_ARC, token1: EURC_ARC, liq0: 50_000_000n, liq1: 46_300_000n },
];

async function getProvider() {
  for (const url of [ARC_RPC, ...RPC_FALLBACKS]) {
    try {
      const p = new ethers.JsonRpcProvider(url, { chainId: 5042002, name: "arc-testnet" });
      await p.getBlockNumber();
      return p;
    } catch {
      continue;
    }
  }
  throw new Error("Nenhum RPC Arc disponível");
}

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY não definida no .env.local");

  const provider = await getProvider();
  const wallet = new ethers.Wallet(pk, provider);
  const deployer = wallet.address;
  const bal = await provider.getBalance(deployer);
  console.log(`👤 Deployer: ${deployer}`);
  console.log(`💰 Balance: ${ethers.formatEther(bal)} ARC\n`);

  // Compilar
  console.log("🔨 Compilando GenericAMMPair (flattened)...");
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
  console.log(`✅ Compilado — bytecode: ${bytecode.length} chars\n`);

  const Factory = new ethers.ContractFactory(abi, bytecode, wallet);

  for (const pair of PAIRS) {
    console.log(`🚀 Deployando ${pair.name}...`);
    const pool = await Factory.deploy(pair.token0, pair.token1);
    await pool.waitForDeployment();
    const poolAddr = await pool.getAddress();
    console.log(`✅ ${pair.name}: ${poolAddr}`);
    console.log(`📜 Explorer: https://testnet.arcscan.app/address/${poolAddr}`);

    const t0 = await pool.token0();
    const t1 = await pool.token1();
    console.log(`   token0: ${t0}`);
    console.log(`   token1: ${t1}`);

    // Verificar reserves iniciais (devem ser 0)
    const r0 = await pool.reserve0();
    const r1 = await pool.reserve1();
    console.log(`   Reserves: ${r0.toString()}, ${r1.toString()}`);

    // Adicionar liquidez
    console.log(`\n💧 Adicionando liquidez — ${pair.liq0.toString()} token0 + ${pair.liq1.toString()} token1...`);

    // Aprovar tokens para o pool
    const erc20Abi = ["function approve(address,uint256) returns (bool)"];
    const usdc = new ethers.Contract(pair.token0, erc20Abi, wallet);
    const eurc = new ethers.Contract(pair.token1, erc20Abi, wallet);

    const approve0 = await usdc.approve(poolAddr, pair.liq0);
    await approve0.wait();
    console.log(`   ✅ approve token0: ${approve0.hash}`);

    const approve1 = await eurc.approve(poolAddr, pair.liq1);
    await approve1.wait();
    console.log(`   ✅ approve token1: ${approve1.hash}`);

    const tx = await pool.addLiquidity(pair.liq0, pair.liq1);
    await tx.wait();
    console.log(`   ✅ addLiquidity: ${tx.hash}`);

    const nr0 = await pool.reserve0();
    const nr1 = await pool.reserve1();
    console.log(`   Reserves após: ${nr0.toString()}, ${nr1.toString()}`);
    console.log(`   Preço: ${(Number(nr1) / Number(nr0)).toFixed(6)} EURC/USDC\n`);
  }

  console.log("🏁 Deploy concluído!");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
