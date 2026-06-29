// scripts/addLiquidityAMM.js
// Adiciona liquidez ao AMM USDC→EURC já deployado na Arc testnet
// Uso: node scripts/addLiquidityAMM.js

const { ethers } = require("ethers");
require("dotenv").config({ path: ".env.local" });

const POOL_ADDR = "0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb";
const USDC_ARC = "0x3600000000000000000000000000000000000000";
const EURC_ARC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
const ARC_RPC = "https://rpc.testnet.arc.network";

const LIQ0 = 17_280_000n;   // ~17.28 USDC (match EURC balance at 1.08 rate)
const LIQ1 = 16_000_000n;   // 16 EURC (wallet has 16.79)

const ABI = [
  "function reserve0() view returns (uint256)",
  "function reserve1() view returns (uint256)",
  "function addLiquidity(uint256,uint256) returns (uint256)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

const ERC20 = ["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"];

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY não definida");

  const provider = new ethers.JsonRpcProvider(ARC_RPC);
  const wallet = new ethers.Wallet(pk, provider);

  const pool = new ethers.Contract(POOL_ADDR, ABI, wallet);
  const usdc = new ethers.Contract(USDC_ARC, ERC20, wallet);
  const eurc = new ethers.Contract(EURC_ARC, ERC20, wallet);

  console.log(`👤 ${wallet.address}`);
  console.log(`🔗 Pool: ${POOL_ADDR}`);

  const bal0 = await usdc.balanceOf(wallet.address);
  const bal1 = await eurc.balanceOf(wallet.address);
  console.log(`💰 USDC: ${ethers.formatUnits(bal0, 6)} | EURC: ${ethers.formatUnits(bal1, 6)}`);

  const r0 = await pool.reserve0();
  const r1 = await pool.reserve1();
  console.log(`📊 Reserves atuais: ${ethers.formatUnits(r0, 6)} USDC | ${ethers.formatUnits(r1, 6)} EURC`);

  if (r0 > 0n) {
    console.log("✅ Pool já tem liquidez — pulando adição");
    return;
  }

  console.log(`\n💧 Adicionando ${ethers.formatUnits(LIQ0, 6)} USDC + ${ethers.formatUnits(LIQ1, 6)} EURC...`);

  const tx0 = await usdc.approve(POOL_ADDR, LIQ0);
  await tx0.wait();
  console.log(`   ✅ approve USDC: ${tx0.hash}`);

  const tx1 = await eurc.approve(POOL_ADDR, LIQ1);
  await tx1.wait();
  console.log(`   ✅ approve EURC: ${tx1.hash}`);

  const tx = await pool.addLiquidity(LIQ0, LIQ1);
  await tx.wait();
  console.log(`   ✅ addLiquidity: ${tx.hash}`);

  const nr0 = await pool.reserve0();
  const nr1 = await pool.reserve1();
  const ratio = Number(nr1) / Number(nr0);
  console.log(`📊 Reserves: ${ethers.formatUnits(nr0, 6)} USDC | ${ethers.formatUnits(nr1, 6)} EURC (ratio ${ratio.toFixed(4)})`);
  console.log(`🏁 Liquidez adicionada!`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
