const fs = require("node:fs")
const path = require("node:path")

const routePath = path.join(process.cwd(), "app", "api", "stress-test", "route.ts")
const source = fs.readFileSync(routePath, "utf8")
const normalized = source.replace(/\s+/g, " ")
const failures = []

function forbid(label, pattern) {
  if (pattern.test(source)) failures.push(label)
}

forbid("body.privateKey is forbidden", /\bbody\s*\.\s*privateKey\b/)
forbid("requestBody.privateKey is forbidden", /\brequestBody\s*\.\s*privateKey\b/)
forbid("general PRIVATE_KEY fallback is forbidden", /process\s*\.\s*env\s*\.\s*PRIVATE_KEY\b(?!_STRESS)/)

const requestJsonBindings = [...source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+[A-Za-z_$][\w$]*\s*\.\s*json\s*\(\s*\)/g)]
for (const match of requestJsonBindings) {
  const binding = match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  if (new RegExp(`\\b${binding}\\s*\\.\\s*privateKey\\b`).test(source)) {
    failures.push(`privateKey from request.json() binding ${match[1]} is forbidden`)
  }
}

if (!/const\s+stressPrivateKey\s*=\s*process\s*\.\s*env\s*\.\s*PRIVATE_KEY_STRESS\b/.test(source)) {
  failures.push("dedicated PRIVATE_KEY_STRESS source is required")
}
if (!/new\s+ethers\s*\.\s*Wallet\s*\(\s*stressPrivateKey\s*,/.test(source)) {
  failures.push("Wallet must use only stressPrivateKey")
}
if (!normalized.includes("Stress test não configurado")) {
  failures.push("sanitized fail-closed response is required")
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exitCode = 1
} else {
  console.log("PASS: no client-supplied private key flow")
  console.log("PASS: no general PRIVATE_KEY fallback")
  console.log("PASS: signer source is PRIVATE_KEY_STRESS only")
  console.log("SEC0_STATIC_GUARD_ASSERTIONS=3")
}
