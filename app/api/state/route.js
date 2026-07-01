import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), ".data");
const STATE_FILE = path.join(DATA_DIR, "trader-state.json");

function ensureDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}

function readState() {
  try {
    ensureDir();
    if (!fs.existsSync(STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch { return null; }
}

function writeState(state) {
  try {
    ensureDir();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (e) {
    console.warn("[state] write failed:", e.message);
  }
}

export async function GET() {
  const state = readState();
  return Response.json(state || { totalProfit: 0, lastAction: "" });
}

export async function POST(req) {
  const body = await req.json();
  const state = { totalProfit: body.totalProfit ?? 0, lastAction: body.lastAction || "" };
  writeState(state);
  return Response.json(state);
}