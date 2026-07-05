// scripts/deployCirBTCPool.js
// Deploy GenericAMMPair USDC→cirBTC na Arc testnet + add liquidity
// Uso: node scripts/deployCirBTCPool.js
// Pré-requisito: PRIVATE_KEY no .env.local + tokens do faucet

const { ethers } = require("ethers");
require("dotenv").config({ path: ".env.local" });

const ARC_RPC = "https://rpc.testnet.arc.network";
const RPC_FALLBACKS = ["https://testnet.arc.network/rpc"];

// Endereços Arc testnet
const USDC_ARC = "0x3600000000000000000000000000000000000000";
const CIRBTC_ARC = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF";

// ABIs
const PAIR_ABI = [
  "function reserve0() view returns (uint256)",
  "function reserve1() view returns (uint256)",
  "function addLiquidity(uint256,uint256) returns (uint256)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function totalLiquidity() view returns (uint256)",
];
const ERC20 = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
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

async function fetchBtcPrice() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.bitcoin.usd;
  } catch {
    // Fallback: preço hardcoded (~real)
    return 63000;
  }
}

async function main() {
  const pk = process.env.PRIVATE_KEY_STRESS || process.env.PRIVATE_KEY;
  if (!pk) {
    console.error("❌ Nenhuma chave privada encontrada.");
    console.error("   Prioridade: PRIVATE_KEY_STRESS > PRIVATE_KEY");
    console.error("   Adicione uma delas ao .env.local:");
    console.error('   PRIVATE_KEY_STRESS=0x... (recomendado para testnet)');
    process.exit(1);
  }
  console.log(`   🔑 Usando ${process.env.PRIVATE_KEY_STRESS ? 'PRIVATE_KEY_STRESS' : 'PRIVATE_KEY'}`);

  const provider = await getProvider();
  const wallet = new ethers.Wallet(pk, provider);
  const deployer = wallet.address;

  console.log(`\n👤 Wallet: ${deployer}`);

  // Ler saldos
  const usdc = new ethers.Contract(USDC_ARC, ERC20, provider);
  const cirbtc = new ethers.Contract(CIRBTC_ARC, ERC20, provider);

  const balUSDC = await usdc.balanceOf(deployer);
  const balCIRBTC = await cirbtc.balanceOf(deployer);
  const decUSDC = await usdc.decimals();
  const decCIRBTC = await cirbtc.decimals();

  console.log(`💰 USDC:   ${ethers.formatUnits(balUSDC, decUSDC)}`);
  console.log(`💰 cirBTC: ${ethers.formatUnits(balCIRBTC, decCIRBTC)}`);

  if (balUSDC <= 0n || balCIRBTC <= 0n) {
    console.log("\n❌ Saldo insuficiente! Pego tokens no faucet:");
    console.log("   https://faucet.circle.com/");
    console.log(`   Wallet: ${deployer}`);
    console.log("   Rede: Arc Testnet");
    console.log("   USDC: 20 por request (a cada 2h)");
    console.log("   cirBTC: 0.0001 por request (a cada 2h)");
    process.exit(1);
  }

  // Preço BTC como proxy para cirBTC
  const btcPrice = await fetchBtcPrice();
  console.log(`\n📊 BTC price: $${btcPrice.toLocaleString()}`);

  // Calcular valores em USD
  const balUSDC_num = Number(ethers.formatUnits(balUSDC, decUSDC));
  const balCIRBTC_num = Number(ethers.formatUnits(balCIRBTC, decCIRBTC));
  const cirValueUSD = balCIRBTC_num * btcPrice;

  console.log(`   USDC:   $${balUSDC_num.toFixed(2)}`);
  console.log(`   cirBTC: ${balCIRBTC_num.toFixed(6)} × $${btcPrice} = $${cirValueUSD.toFixed(2)}`);

  // Calcular liquidez balanceada (valor igual dos dois lados)
  let liqUSDC, liqCIRBTC;
  if (cirValueUSD >= balUSDC_num) {
    // Mais valor em cirBTC — usar todo USDC, cirBTC proporcional
    liqUSDC = balUSDC_num;
    liqCIRBTC = liqUSDC / btcPrice;
  } else {
    // Mais valor em USDC — usar todo cirBTC, USDC proporcional
    liqCIRBTC = balCIRBTC_num;
    liqUSDC = liqCIRBTC * btcPrice;
  }

  // Normalizar raw amounts (contrato checa ratio ~50:50, ignora decimals)
  const du = Number(decUSDC);
  const dc = Number(decCIRBTC);
  let liqUSDC_BN = ethers.parseUnits(liqUSDC.toFixed(Math.min(du, 6)), du);
  let liqCIRBTC_BN = ethers.parseUnits(liqCIRBTC.toFixed(Math.min(dc, 8)), dc);

  // Se raw amounts muito desbalanceados (decimais diferentes), normalizar
  const rawRatio = Number(liqUSDC_BN * 100n / (liqUSDC_BN + liqCIRBTC_BN));
  if (rawRatio > 80) {
    // USDC domina — reduzir USDC pra match cirBTC raw
    liqUSDC_BN = liqCIRBTC_BN;
    liqUSDC = Number(ethers.formatUnits(liqUSDC_BN, du));
    liqCIRBTC = Number(ethers.formatUnits(liqCIRBTC_BN, dc));
  } else if (rawRatio < 20) {
    // cirBTC domina — reduzir cirBTC pra match USDC raw
    liqCIRBTC_BN = liqUSDC_BN;
    liqCIRBTC = Number(ethers.formatUnits(liqCIRBTC_BN, dc));
    liqUSDC = Number(ethers.formatUnits(liqUSDC_BN, du));
  }

  console.log(`\n💧 Liquidez planejada:`);
  console.log(`   USDC:   ${ethers.formatUnits(liqUSDC_BN, du)} ($${liqUSDC.toFixed(2)})`);
  console.log(`   cirBTC: ${ethers.formatUnits(liqCIRBTC_BN, dc)} ($${liqUSDC.toFixed(2)})`);

  // Deploy
  console.log(`\n🔨 Compilando GenericAMMPair...`);
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
  console.log(`   ✅ Compilado (bytecode: ${(bytecode.length / 2).toLocaleString()} bytes)`);

  const Factory = new ethers.ContractFactory(abi, bytecode, wallet);

  console.log(`\n🚀 Deployando GenericAMMPair USDC→cirBTC...`);
  const pool = await Factory.deploy(USDC_ARC, CIRBTC_ARC);
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(`   ✅ Pool: ${poolAddr}`);
  console.log(`   📜 Explorer: https://testnet.arcscan.app/address/${poolAddr}`);

  // Verificar
  const t0 = await pool.token0();
  const t1 = await pool.token1();
  console.log(`   token0: ${t0}`);
  console.log(`   token1: ${t1}`);

  // Approve
  console.log(`\n💸 Aprovando tokens...`);
  const walletUsdc = new ethers.Contract(USDC_ARC, ERC20, wallet);
  const walletCir = new ethers.Contract(CIRBTC_ARC, ERC20, wallet);

  const txApprove0 = await walletUsdc.approve(poolAddr, liqUSDC_BN);
  await txApprove0.wait();
  console.log(`   ✅ approve USDC: ${txApprove0.hash}`);

  const txApprove1 = await walletCir.approve(poolAddr, liqCIRBTC_BN);
  await txApprove1.wait();
  console.log(`   ✅ approve cirBTC: ${txApprove1.hash}`);

  // Add liquidity
  console.log(`\n💧 Adicionando liquidez...`);
  const txAdd = await pool.addLiquidity(liqUSDC_BN, liqCIRBTC_BN);
  await txAdd.wait();
  console.log(`   ✅ addLiquidity: ${txAdd.hash}`);

  // Verificar reserves
  const r0 = await pool.reserve0();
  const r1 = await pool.reserve1();
  const totalLiq = await pool.totalLiquidity();
  const price = r0 > 0n ? Number(r1) / Number(r0) : 0;

  console.log(`\n📊 Pool criada com sucesso!`);
  console.log(`   Endereço: ${poolAddr}`);
  console.log(`   Reserve USDC:   ${ethers.formatUnits(r0, decUSDC)}`);
  console.log(`   Reserve cirBTC: ${ethers.formatUnits(r1, decCIRBTC)}`);
  console.log(`   Preço: ${(1 / price / btcPrice * 100).toFixed(2)}% do BTC`); // cirBTC price in USDC
  console.log(`   Total Liquidity: ${ethers.formatUnits(totalLiq, 18)}`);

  console.log(`\n🏁 Pool deployada! Copie o endereço acima para atualizar o route-verifier.`);
  console.log(`   ${poolAddr}`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
