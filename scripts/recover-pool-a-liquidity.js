// Pool A liquidity recovery helper.
//
// Default mode is dry-run and NEVER sends a transaction.
// Execution requires the explicit --execute flag and the correct signer key.
//
// Dry run:
//   node scripts/recover-pool-a-liquidity.js
//
// Execution, only after explicit approval:
//   node scripts/recover-pool-a-liquidity.js --execute
//
// Optional env vars:
//   ARC_RPC_URL=https://rpc.testnet.arc.network
//   POOL_A_RECOVERY_PRIVATE_KEY=<private key for 0xfa033D...>
//   PRIVATE_KEY_STRESS=<fallback private key for 0xfa033D...>

const { ethers } = require("ethers");
require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

const EXECUTE = process.argv.includes("--execute");

const ARC_RPC = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";

const POOL_A = "0x8cdc84f93F6a5413667354F8fB516959D682423c";
const USDC = "0x3600000000000000000000000000000000000000";
const CIRBTC = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF";
const LP_OWNER = "0xfa033D062d6ab8d49D611F5644d46f5380737dDA";
const LIQUIDITY_TO_REMOVE = 123501n;

const EXPECTED_USDC = 65.03;
const USDC_TOLERANCE = 0.25;

const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function paused() view returns (bool)",
  "function reserve0() view returns (uint256)",
  "function reserve1() view returns (uint256)",
  "function totalLiquidity() view returns (uint256)",
  "function liquidity(address) view returns (uint256)",
  "function removeLiquidity(uint256 liquidityAmount)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

function sameAddress(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

function normalizePrivateKey(pk) {
  if (!pk) return null;
  return pk.startsWith("0x") ? pk : `0x${pk}`;
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function formatToken(amount, decimals) {
  return ethers.formatUnits(amount, decimals);
}

function expectedWithdrawal(reserve0, reserve1, totalLiquidity, liquidityAmount) {
  requireCondition(totalLiquidity > 0n, "totalLiquidity is zero");
  const amount0 = (liquidityAmount * reserve0) / totalLiquidity;
  const amount1 = (liquidityAmount * reserve1) / totalLiquidity;
  return { amount0, amount1 };
}

async function readState(provider) {
  const pool = new ethers.Contract(POOL_A, PAIR_ABI, provider);
  const usdc = new ethers.Contract(USDC, ERC20_ABI, provider);
  const cirbtc = new ethers.Contract(CIRBTC, ERC20_ABI, provider);

  const [
    code,
    token0,
    token1,
    paused,
    lpBalance,
    totalLiquidity,
    reserve0,
    reserve1,
    usdcDecimals,
    cirbtcDecimals,
    usdcSymbol,
    cirbtcSymbol,
    ownerGas,
    ownerUsdc,
    ownerCirbtc,
  ] = await Promise.all([
    provider.getCode(POOL_A),
    pool.token0(),
    pool.token1(),
    pool.paused(),
    pool.liquidity(LP_OWNER),
    pool.totalLiquidity(),
    pool.reserve0(),
    pool.reserve1(),
    usdc.decimals(),
    cirbtc.decimals(),
    usdc.symbol(),
    cirbtc.symbol(),
    provider.getBalance(LP_OWNER),
    usdc.balanceOf(LP_OWNER),
    cirbtc.balanceOf(LP_OWNER),
  ]);

  const expected = totalLiquidity > 0n
    ? expectedWithdrawal(reserve0, reserve1, totalLiquidity, LIQUIDITY_TO_REMOVE)
    : null;

  return {
    pool,
    usdc,
    cirbtc,
    code,
    token0,
    token1,
    paused,
    lpBalance,
    totalLiquidity,
    reserve0,
    reserve1,
    usdcDecimals,
    cirbtcDecimals,
    usdcSymbol,
    cirbtcSymbol,
    ownerGas,
    ownerUsdc,
    ownerCirbtc,
    expected,
  };
}

function printState(state) {
  console.log("Pool A recovery check");
  console.log("=====================");
  console.log(`Mode: ${EXECUTE ? "EXECUTION" : "DRY RUN"}`);
  console.log(`RPC: ${ARC_RPC}`);
  console.log(`Pool: ${POOL_A}`);
  console.log(`LP owner / required signer: ${LP_OWNER}`);
  console.log("");
  console.log("Contract state:");
  console.log(`  bytecode present: ${state.code !== "0x"}`);
  console.log(`  token0: ${state.token0}`);
  console.log(`  token1: ${state.token1}`);
  console.log(`  paused: ${state.paused}`);
  console.log(`  LP balance of owner: ${state.lpBalance.toString()}`);
  console.log(`  totalLiquidity: ${state.totalLiquidity.toString()}`);
  console.log(`  reserve0 raw: ${state.reserve0.toString()}`);
  console.log(`  reserve1 raw: ${state.reserve1.toString()}`);
  console.log("");
  console.log("Formatted balances:");
  console.log(`  reserve0: ${formatToken(state.reserve0, state.usdcDecimals)} ${state.usdcSymbol}`);
  console.log(`  reserve1: ${formatToken(state.reserve1, state.cirbtcDecimals)} ${state.cirbtcSymbol}`);
  console.log(`  owner gas: ${ethers.formatEther(state.ownerGas)} ARC`);
  console.log(`  owner USDC before: ${formatToken(state.ownerUsdc, state.usdcDecimals)} ${state.usdcSymbol}`);
  console.log(`  owner cirBTC before: ${formatToken(state.ownerCirbtc, state.cirbtcDecimals)} ${state.cirbtcSymbol}`);
  console.log("");
  console.log("Expected removeLiquidity output:");
  if (state.expected) {
    console.log(`  removeLiquidity(${LIQUIDITY_TO_REMOVE.toString()})`);
    console.log(`  expected token0: ${formatToken(state.expected.amount0, state.usdcDecimals)} ${state.usdcSymbol}`);
    console.log(`  expected token1: ${formatToken(state.expected.amount1, state.cirbtcDecimals)} ${state.cirbtcSymbol}`);
  } else {
    console.log("  not available: totalLiquidity is zero");
  }
}

async function verifyState(provider, state) {
  requireCondition(state.code !== "0x", "Pool A has no bytecode at expected address");
  requireCondition(sameAddress(state.token0, USDC), `Unexpected token0: ${state.token0}`);
  requireCondition(sameAddress(state.token1, CIRBTC), `Unexpected token1: ${state.token1}`);
  requireCondition(state.paused === false, "Pool is paused");
  requireCondition(state.lpBalance === LIQUIDITY_TO_REMOVE, `LP balance is ${state.lpBalance}, expected ${LIQUIDITY_TO_REMOVE}`);
  requireCondition(state.totalLiquidity === LIQUIDITY_TO_REMOVE, `totalLiquidity is ${state.totalLiquidity}, expected ${LIQUIDITY_TO_REMOVE}`);
  requireCondition(state.expected, "Expected withdrawal is unavailable");

  const expectedUsdc = Number(formatToken(state.expected.amount0, state.usdcDecimals));
  requireCondition(
    Math.abs(expectedUsdc - EXPECTED_USDC) <= USDC_TOLERANCE,
    `Expected USDC output ${expectedUsdc} is outside tolerance around ${EXPECTED_USDC}`
  );

  const callData = state.pool.interface.encodeFunctionData("removeLiquidity", [LIQUIDITY_TO_REMOVE]);
  await provider.call({ from: LP_OWNER, to: POOL_A, data: callData });
  console.log("");
  console.log(`Read-only eth_call simulation from ${LP_OWNER}: OK`);
}

async function executeRecovery(provider, state) {
  const pk = normalizePrivateKey(process.env.POOL_A_RECOVERY_PRIVATE_KEY || process.env.PRIVATE_KEY_STRESS);
  requireCondition(pk, "Execution requires POOL_A_RECOVERY_PRIVATE_KEY or PRIVATE_KEY_STRESS");

  const wallet = new ethers.Wallet(pk, provider);
  requireCondition(sameAddress(wallet.address, LP_OWNER), `Wrong signer ${wallet.address}; expected ${LP_OWNER}`);
  requireCondition(state.ownerGas > 0n, `Signer ${LP_OWNER} has no ARC gas balance`);
  const expectedBeforeExecution = state.expected;

  console.log("");
  console.log("Execution pre-checks passed.");
  console.log("Sending removeLiquidity transaction now...");

  const poolWithSigner = state.pool.connect(wallet);
  const tx = await poolWithSigner.removeLiquidity(LIQUIDITY_TO_REMOVE);
  console.log(`tx hash: ${tx.hash}`);

  const receipt = await tx.wait();
  requireCondition(receipt && receipt.status === 1, "removeLiquidity transaction failed or reverted");
  console.log(`confirmed in block: ${receipt.blockNumber}`);

  const after = await readState(provider);
  const recoveredUsdc = after.ownerUsdc - state.ownerUsdc;
  const recoveredCirbtc = after.ownerCirbtc - state.ownerCirbtc;

  console.log("");
  console.log("Recovery result:");
  console.log(`  expected USDC before tx: ${formatToken(expectedBeforeExecution.amount0, state.usdcDecimals)} ${state.usdcSymbol}`);
  console.log(`  expected cirBTC before tx: ${formatToken(expectedBeforeExecution.amount1, state.cirbtcDecimals)} ${state.cirbtcSymbol}`);
  console.log(`  recovered USDC: ${formatToken(recoveredUsdc, after.usdcDecimals)} ${after.usdcSymbol}`);
  console.log(`  recovered cirBTC: ${formatToken(recoveredCirbtc, after.cirbtcDecimals)} ${after.cirbtcSymbol}`);
  console.log(`  new LP balance: ${after.lpBalance.toString()}`);
  console.log(`  new totalLiquidity: ${after.totalLiquidity.toString()}`);
  console.log(`  new reserve0: ${formatToken(after.reserve0, after.usdcDecimals)} ${after.usdcSymbol}`);
  console.log(`  new reserve1: ${formatToken(after.reserve1, after.cirbtcDecimals)} ${after.cirbtcSymbol}`);
  console.log(`  ArcScan: https://testnet.arcscan.app/tx/${tx.hash}`);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(ARC_RPC);
  const state = await readState(provider);

  printState(state);
  await verifyState(provider, state);

  if (!EXECUTE) {
    console.log("");
    console.log("NO TRANSACTION SENT");
    console.log("Dry run complete. Add --execute only after explicit approval.");
    return;
  }

  await executeRecovery(provider, state);
}

main().catch((error) => {
  console.error("");
  console.error("Pool A recovery script failed:");
  console.error(error);
  process.exit(1);
});
