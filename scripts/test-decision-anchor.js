// Testa o anchor on-chain no DecisionAnchor usando a wallet principal
// Uso: node scripts/test-anchor-decision.js
// Pré-requisito: PRIVATE_KEY no .env.local (wallet 0x77f5...)

const { ethers } = require("ethers");
require("dotenv").config({ path: ".env.local" });

const ARC_RPC = "https://rpc.testnet.arc.network";
const DECISION_ANCHOR_ADDRESS = process.env.NEXT_PUBLIC_DECISION_ANCHOR_ADDRESS || "0x7813e04338dc9d6b7676843a52152c57438cc7b2";

const DECISION_ANCHOR_ABI = [
  { type: "function", name: "anchor", stateMutability: "nonpayable",
    inputs: [{ name: "_hash", type: "bytes32" }, { name: "_metadataURI", type: "string" }],
    outputs: [{ name: "index", type: "uint256" }] },
  { type: "function", name: "totalReports", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "getReport", stateMutability: "view",
    inputs: [{ name: "_index", type: "uint256" }],
    outputs: [{ name: "hash", type: "bytes32" }, { name: "submitter", type: "address" }, { name: "timestamp", type: "uint256" }] },
  { type: "event", name: "ReportAnchored",
    inputs: [
      { indexed: true, name: "index", type: "uint256" },
      { indexed: true, name: "hash", type: "bytes32" },
      { indexed: true, name: "submitter", type: "address" },
      { indexed: false, name: "metadataURI", type: "string" },
    ], anonymous: false },
];

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY não definida no .env.local");

  const provider = new ethers.JsonRpcProvider(ARC_RPC);
  const wallet = new ethers.Wallet(pk, provider);

  console.log("🔑 Wallet:", wallet.address);
  console.log("📍 DecisionAnchor:", DECISION_ANCHOR_ADDRESS);

  const bal = await provider.getBalance(wallet.address);
  console.log("💰 Balance:", ethers.formatEther(bal), "ARC");

  // Check current total reports
  const contract = new ethers.Contract(DECISION_ANCHOR_ADDRESS, DECISION_ANCHOR_ABI, wallet);
  const before = await contract.totalReports();
  console.log(`📊 Reports before: ${before}`);

  // Create a test anchor
  const intentId = `test_intent_${Date.now()}`;
  const meta = JSON.stringify({
    decisionReportHash: "",
    intentId,
    agentId: "0x77f5C3A1079B86ef8490E7c5Ec1F9bcfbaAE5894",
    action: "test_anchor",
    status: "COMPLETED",
    executionTxHash: "",
    timestamp: Math.floor(Date.now() / 1000),
  });
  const hash = ethers.solidityPackedKeccak256(["string"], [meta]);

  console.log(`\n🔗 Anchoring intent "${intentId}"...`);
  console.log(`   hash: ${hash}`);

  const metaWithHash = JSON.stringify({
    decisionReportHash: hash,
    intentId,
    agentId: "0x77f5C3A1079B86ef8490E7c5Ec1F9bcfbaAE5894",
    action: "test_anchor",
    status: "COMPLETED",
    executionTxHash: "",
    timestamp: Math.floor(Date.now() / 1000),
  });

  const tx = await contract.anchor(hash, metaWithHash, { gasLimit: 200000 });
  console.log(`   tx: ${tx.hash}`);
  console.log("   Aguardando confirmação...");

  const receipt = await tx.wait();

  if (receipt.status === 0) throw new Error("anchor revertido");

  const after = await contract.totalReports();
  console.log(`\n✅ DECISION ANCHORED!`);
  console.log(`   Report index: ${after - 1n}`);
  console.log(`   Block: ${receipt.blockNumber}`);
  console.log(`   Tx: ${tx.hash}`);
  console.log(`   Hash: ${hash}`);
  console.log(`   ArcScan: https://testnet.arcscan.app/tx/${tx.hash}`);
  console.log(`   Contract: https://testnet.arcscan.app/address/${DECISION_ANCHOR_ADDRESS}`);

  // Read the report back
  const report = await contract.getReport(after - 1n);
  console.log(`\n📋 Report on-chain:`);
  console.log(`   hash: ${report.hash}`);
  console.log(`   submitter: ${report.submitter}`);
  console.log(`   timestamp: ${new Date(Number(report.timestamp) * 1000).toISOString()}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
