import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Wallet } from "ethers"

const ENV_PATH = resolve(".env.ri-bank-30.local")
const FORBIDDEN_ADDRESSES = new Set([
  "0x77f5c3a1079b86ef8490e7c5ec1f9bcfbaae5894",
  "0xfa033d062d6ab8d49d611f5644d46f5380737dda",
  "0xad42458a2e98e62453f4b54fa6e7511e0a303b6f",
])

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    return match ? [[match[1], match[2]]] : []
  }))
}

if (existsSync(ENV_PATH)) {
  const current = parseEnv(readFileSync(ENV_PATH, "utf8"))
  if (!current.RI_BANK_30_PRIVATE_KEY || !current.RI_BANK_30_WALLET_ADDRESS) {
    throw new Error("RI-BANK-30 env exists but is incomplete")
  }
  const derived = new Wallet(current.RI_BANK_30_PRIVATE_KEY).address
  if (derived.toLowerCase() !== current.RI_BANK_30_WALLET_ADDRESS.toLowerCase()) {
    throw new Error("RI-BANK-30 wallet address does not match its private key")
  }
  if (FORBIDDEN_ADDRESSES.has(derived.toLowerCase())) {
    throw new Error("RI-BANK-30 wallet is not exclusive")
  }
  console.log(`RI_BANK_30_WALLET_ADDRESS=${derived}`)
  console.log("RI_BANK_30_WALLET_REUSED=YES")
  process.exit(0)
}

const wallet = Wallet.createRandom()
if (FORBIDDEN_ADDRESSES.has(wallet.address.toLowerCase())) {
  throw new Error("Generated wallet unexpectedly matches an existing project wallet")
}

const prefix = `arcflow:ri-bank-30:test:${Date.now()}:${crypto.randomUUID()}`
writeFileSync(ENV_PATH, [
  `RI_BANK_30_PRIVATE_KEY=${wallet.privateKey}`,
  `RI_BANK_30_WALLET_ADDRESS=${wallet.address}`,
  "RI_BANK_30_ARC_RPC_URL=https://rpc.testnet.arc.io",
  "RI_BANK_30_CHAIN_ID=5042002",
  "RI_BANK_30_DECISION_ANCHOR_ADDRESS=0x7813e04338dc9d6b7676843a52152c57438cc7b2",
  `RI_BANK_30_REDIS_PREFIX=${prefix}`,
  "RI_BANK_30_ENVIRONMENT=test",
  "",
].join("\n"), { encoding: "utf8", mode: 0o600, flag: "wx" })

console.log(`RI_BANK_30_WALLET_ADDRESS=${wallet.address}`)
console.log("RI_BANK_30_WALLET_CREATED=YES")
console.log("RI_BANK_30_SECRET_PRINTED=NO")
