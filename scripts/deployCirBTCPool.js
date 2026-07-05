// scripts/deployCirBTCPool.js
// Deploy MintableERC20 (cirBTC) + GenericAMMPair USDC→cirBTC na Arc testnet
// Uso: node scripts/deployCirBTCPool.js
// Pré-requisito: PRIVATE_KEY no .env.local

const { ethers } = require("ethers");
require("dotenv").config({ path: ".env.local" });

const ARC_RPC = "https://rpc.testnet.arc.network";
const RPC_FALLBACKS = ["https://testnet.arc.network/rpc"];
const USDC_ARC = "0x3600000000000000000000000000000000000000";

const ERC20 = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

async function getProvider() {
  for (const url of [ARC_RPC, ...RPC_FALLBACKS]) {
    try {
      const p = new ethers.JsonRpcProvider(url, { chainId: 5042002, name: "arc-testnet" });
      await p.getBlockNumber();
      console.log(`  ✅ RPC: ${url}`);
      return p;
    } catch {
      continue;
    }
  }
  throw new Error("Nenhum RPC Arc disponível");
}

async function compileContract(fileName, contractName) {
  const solc = require("solc");
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(
    path.join(__dirname, "..", "contracts", fileName), "utf8"
  );
  const input = {
    language: "Solidity",
    sources: { [fileName]: { content: source } },
    settings: {
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
      optimizer: { enabled: true, runs: 200 },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const contract = output.contracts[fileName][contractName];
  if (!contract) {
    console.error(JSON.stringify(output.errors, null, 2));
    throw new Error("Compilação falhou");
  }
  return {
    abi: contract.abi,
    bytecode: "0x" + contract.evm.bytecode.object,
  };
}

async function main() {
  const pk = process.env.PRIVATE_KEY_STRESS || process.env.PRIVATE_KEY;
  if (!pk) {
    console.error("❌ Nenhuma chave privada encontrada.");
    console.error("   Adicione ao .env.local: PRIVATE_KEY_STRESS=0x...");
    process.exit(1);
  }
  console.log(`   🔑 Usando ${process.env.PRIVATE_KEY_STRESS ? 'PRIVATE_KEY_STRESS' : 'PRIVATE_KEY'}`);

  const provider = await getProvider();
  const wallet = new ethers.Wallet(pk, provider);
  const deployer = wallet.address;

  const balARC = await provider.getBalance(deployer);
  console.log(`\n👤 Wallet: ${deployer}`);
  console.log(`💰 ARC: ${ethers.formatEther(balARC)} (gás)`);

  // USDC balance
  const usdc = new ethers.Contract(USDC_ARC, ERC20, provider);
  const balUSDC = await usdc.balanceOf(deployer);
  const decUSDC = await usdc.decimals();
  console.log(`💰 USDC: ${ethers.formatUnits(balUSDC, decUSDC)}`);

  if (balUSDC < 1000000n) {
    console.log("\n❌ USDC insuficiente. Use o faucet:");
    console.log("   https://faucet.circle.com/");
    console.log(`   Wallet: ${deployer}`);
    process.exit(1);
  }

  // ──────────────────────────────────────────
  // 1. Deploy MintableERC20 (cirBTC)
  // ──────────────────────────────────────────
  console.log(`\n🔨 Compilando MintableERC20...`);
  const tokenArtifact = await compileContract("MintableERC20.sol", "MintableERC20");
  console.log(`   ✅ Compilado (bytecode: ${(tokenArtifact.bytecode.length / 2).toLocaleString()} bytes)`);

  // Mint 0.01 cirBTC (~$630 at $63k BTC) para liquidez
  const CIRBTC_DECIMALS = 8;
  const MINT_AMOUNT = ethers.parseUnits("0.01", CIRBTC_DECIMALS);

  const TokenFactory = new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, wallet);
  console.log(`\n🚀 Deployando MintableERC20 (cirBTC)...`);
  const token = await TokenFactory.deploy("Circle Wrapped Bitcoin", "cirBTC", CIRBTC_DECIMALS, MINT_AMOUNT);
  await token.waitForDeployment();
  const cirBTCAddr = await token.getAddress();
  console.log(`   ✅ cirBTC: ${cirBTCAddr}`);
  console.log(`   📜 Explorer: https://testnet.arcscan.app/address/${cirBTCAddr}`);

  // Verificar mint
  const balToken = await token.balanceOf(deployer);
  console.log(`   💰 Minted: ${ethers.formatUnits(balToken, CIRBTC_DECIMALS)} cirBTC`);

  // ──────────────────────────────────────────
  // 2. Deploy GenericAMMPair USDC→cirBTC
  // ──────────────────────────────────────────
  console.log(`\n🔨 Compilando GenericAMMPair...`);
  const pairArtifact = await compileContract("GenericAMMPair.sol", "GenericAMMPair");
  console.log(`   ✅ Compilado (bytecode: ${(pairArtifact.bytecode.length / 2).toLocaleString()} bytes)`);

  const PairFactory = new ethers.ContractFactory(pairArtifact.abi, pairArtifact.bytecode, wallet);

  console.log(`\n🚀 Deployando GenericAMMPair USDC→cirBTC...`);
  const pool = await PairFactory.deploy(USDC_ARC, cirBTCAddr);
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(`   ✅ Pool: ${poolAddr}`);
  console.log(`   📜 Explorer: https://testnet.arcscan.app/address/${poolAddr}`);

  const t0 = await pool.token0();
  const t1 = await pool.token1();
  console.log(`   token0: ${t0}`);
  console.log(`   token1: ${t1}`);

  // ──────────────────────────────────────────
  // 3. Approve + Add Liquidity
  // ──────────────────────────────────────────
  // Liquidez: $20 USDC + ~$20 cirBTC
  const LIQ_USDC = ethers.parseUnits("20", 6);
  const LIQ_CIRBTC = ethers.parseUnits("0.0003", 8); // ~$18.90 at $63k

  console.log(`\n💧 Liquidez planejada:`);
  console.log(`   USDC:   ${ethers.formatUnits(LIQ_USDC, 6)}`);
  console.log(`   cirBTC: ${ethers.formatUnits(LIQ_CIRBTC, 8)}`);

  const walletUsdc = new ethers.Contract(USDC_ARC, ERC20, wallet);
  const walletCir = new ethers.Contract(cirBTCAddr, ERC20, wallet);

  // USDC approve
  const txApprove0 = await walletUsdc.approve(poolAddr, LIQ_USDC);
  await txApprove0.wait();
  console.log(`   ✅ approve USDC: ${txApprove0.hash}`);

  // cirBTC approve
  const txApprove1 = await walletCir.approve(poolAddr, LIQ_CIRBTC);
  await txApprove1.wait();
  console.log(`   ✅ approve cirBTC: ${txApprove1.hash}`);

  // Add liquidity
  console.log(`\n💧 Adicionando liquidez...`);
  const txAdd = await pool.addLiquidity(LIQ_USDC, LIQ_CIRBTC);
  await txAdd.wait();
  console.log(`   ✅ addLiquidity: ${txAdd.hash}`);

  // Verificar reserves
  const r0 = await pool.reserve0();
  const r1 = await pool.reserve1();
  const totalLiq = await pool.totalLiquidity();

  console.log(`\n📊 Pool criada com sucesso!`);
  console.log(`   Endereço: ${poolAddr}`);
  console.log(`   Reserve USDC:   ${ethers.formatUnits(r0, 6)}`);
  console.log(`   Reserve cirBTC: ${ethers.formatUnits(r1, 8)}`);
  console.log(`   Total Liquidity: ${ethers.formatUnits(totalLiq, 18)}`);

  // ──────────────────────────────────────────
  // 4. Output para configuração
  // ──────────────────────────────────────────
  console.log(`\n══════════════════════════════════════`);
  console.log(`🏁 Pool deployada!`);
  console.log(`\nAtualizações necessárias no código:`);
  console.log(`──────────────────────────────────────`);
  console.log(`1. lib/arc-direct-swap.ts — adicionar pool:`);
  console.log(`   '${USDC_ARC.toLowerCase()}:${cirBTCAddr.toLowerCase()}': '${poolAddr}',`);
  console.log(`   '${cirBTCAddr.toLowerCase()}:${USDC_ARC.toLowerCase()}': '${poolAddr}',`);
  console.log(`\n2. lib/real-swap-executor.ts — adicionar EXECUTOR_TOKENS.arc:`);
  console.log(`   cirBTC: "${cirBTCAddr}",`);
  console.log(`\n3. lib/route-verifier.ts — adicionar KNOWN_POOLS:`);
  console.log(`   { tokenA: "${USDC_ARC}", tokenB: "${cirBTCAddr}", pool: "${poolAddr}", dex: "generic-amm" },`);
  console.log(`\n4. lib/networks.ts — atualizar decimals cirBTC Arc para 8`);
  console.log(`\n🐍 cirBTC address: ${cirBTCAddr}`);
  console.log(`   Pool address: ${poolAddr}`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
