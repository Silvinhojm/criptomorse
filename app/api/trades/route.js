import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), ".data");
const TRADES_FILE = path.join(DATA_DIR, "trades.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readTrades() {
  ensureDir();
  if (!fs.existsSync(TRADES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(TRADES_FILE, "utf-8"));
  } catch { return []; }
}

function writeTrades(trades) {
  ensureDir();
  fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2), "utf-8");
}

export async function GET() {
  const trades = readTrades();
  return Response.json(trades);
}

export async function POST(req) {
  const body = await req.json();
  const { action, fromAmount, toAmount, profit, txHash, explorerUrl, fromToken, toToken, message, timestamp, confirmed } = body;
  if (!txHash) return Response.json({ error: "txHash obrigatório" }, { status: 400 });
  const trades = readTrades();
  const existing = trades.findIndex(t => t.txHash === txHash);
  const record = {
    id: body.id || `trade_${timestamp || Date.now()}`,
    action: action || "UNKNOWN",
    fromAmount: fromAmount || 0,
    toAmount: toAmount || 0,
    profit: profit ?? 0,
    txHash,
    explorerUrl: explorerUrl || "",
    fromToken: fromToken || "",
    toToken: toToken || "",
    message: message || "",
    timestamp: timestamp || Date.now(),
    confirmed: !!confirmed,
  };
  if (existing >= 0) {
    trades[existing] = { ...trades[existing], ...record };
  } else {
    trades.push(record);
  }
  writeTrades(trades.slice(-1000));
  return Response.json(record);
}