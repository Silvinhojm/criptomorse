const fs = require("node:fs")
const path = require("node:path")
const ts = require("typescript")

const routePath = path.join(process.cwd(), "app", "api", "stress-test", "route.ts")
const source = fs.readFileSync(routePath, "utf8")
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: routePath,
}).outputText

let assertions = 0

function assert(label, condition) {
  assertions += 1
  if (!condition) throw new Error(`FAIL: ${label}`)
  console.log(`PASS: ${label}`)
}

function loadRoute(env) {
  const state = {
    providerCalls: 0,
    signerKeys: [],
    sendCalls: 0,
    requestJsonCalls: 0,
    logs: [],
    errors: [],
  }

  class MockProvider {
    constructor() {
      state.providerCalls += 1
    }
  }

  class MockWallet {
    constructor(privateKey) {
      state.signerKeys.push(privateKey)
    }

    async getAddress() {
      return "0x1111111111111111111111111111111111111111"
    }

    async sendTransaction() {
      state.sendCalls += 1
      return { hash: "0xmocked", wait: async () => ({ hash: "0xmocked" }) }
    }
  }

  const module = { exports: {} }
  const customRequire = (specifier) => {
    if (specifier === "next/server") {
      return {
        NextResponse: {
          json(body, init = {}) {
            return { body, status: init.status ?? 200 }
          },
        },
      }
    }
    if (specifier === "ethers") {
      return { ethers: { JsonRpcProvider: MockProvider, Wallet: MockWallet } }
    }
    if (specifier === "@/lib/nonce-manager") {
      return {
        NonceManager: {
          getInstance: () => ({ getNonce: async () => 1 }),
        },
      }
    }
    throw new Error(`Unexpected import: ${specifier}`)
  }

  const mockProcess = { env: { ...env } }
  const mockFetch = async () => ({ ok: false })
  const mockConsole = {
    log: (...args) => state.logs.push(args.join(" ")),
    error: (...args) => state.errors.push(args.join(" ")),
  }

  new Function("require", "module", "exports", "process", "fetch", "console", compiled)(
    customRequire,
    module,
    module.exports,
    mockProcess,
    mockFetch,
    mockConsole
  )

  const request = {
    async json() {
      state.requestJsonCalls += 1
      return { privateKey: "0xCLIENT_SUPPLIED_SECRET" }
    },
  }

  return { POST: module.exports.POST, request, state }
}

async function main() {
  const clientSecret = "0xCLIENT_SUPPLIED_SECRET"
  const operationalSecret = `0x${"a".repeat(64)}`

  const missing = loadRoute({ PRIVATE_KEY: operationalSecret })
  const missingResponse = await missing.POST(missing.request)
  const missingPublic = JSON.stringify(missingResponse)
  const missingLogs = [...missing.state.logs, ...missing.state.errors].join("\n")

  assert("T1 request body is not read", missing.state.requestJsonCalls === 0)
  assert("T2 missing dedicated key creates no provider", missing.state.providerCalls === 0)
  assert("T2 missing dedicated key creates no signer", missing.state.signerKeys.length === 0)
  assert("T2 missing dedicated key sends no transaction", missing.state.sendCalls === 0)
  assert("T2 missing dedicated key returns sanitized 503", missingResponse.status === 503 && missingResponse.body.error === "Stress test não configurado")
  assert("T4 operational PRIVATE_KEY is not used as fallback", !missing.state.signerKeys.includes(operationalSecret))
  assert("T5 client secret is absent from response", !missingPublic.includes(clientSecret))
  assert("T5 operational secret is absent from response", !missingPublic.includes(operationalSecret))
  assert("T5 secrets are absent from logs", !missingLogs.includes(clientSecret) && !missingLogs.includes(operationalSecret))

  const invalidSecret = "0xINVALID_STRESS_SECRET"
  const invalid = loadRoute({
    PRIVATE_KEY_STRESS: invalidSecret,
    PRIVATE_KEY: operationalSecret,
  })
  const invalidResponse = await invalid.POST(invalid.request)
  const invalidPublic = JSON.stringify(invalidResponse)
  const invalidLogs = [...invalid.state.logs, ...invalid.state.errors].join("\n")

  assert("T2 invalid dedicated key creates no provider", invalid.state.providerCalls === 0)
  assert("T2 invalid dedicated key creates no signer", invalid.state.signerKeys.length === 0)
  assert("T2 invalid dedicated key sends no transaction", invalid.state.sendCalls === 0)
  assert("T2 invalid dedicated key returns sanitized 503", invalidResponse.status === 503 && invalidResponse.body.error === "Stress test não configurado")
  assert("T5 invalid secret is absent from response and logs", !invalidPublic.includes(invalidSecret) && !invalidLogs.includes(invalidSecret))

  const dedicatedSecret = `0x${"b".repeat(64)}`
  const configured = loadRoute({
    PRIVATE_KEY_STRESS: dedicatedSecret,
    PRIVATE_KEY: operationalSecret,
  })
  const configuredResponse = await configured.POST(configured.request)
  const configuredPublic = JSON.stringify(configuredResponse)
  const configuredLogs = [...configured.state.logs, ...configured.state.errors].join("\n")

  assert("T1 configured request body is not read", configured.state.requestJsonCalls === 0)
  assert("T1 client key never creates signer", !configured.state.signerKeys.includes(clientSecret))
  assert("T3 signer is created exactly once", configured.state.signerKeys.length === 1)
  assert("T3 signer uses dedicated server key", configured.state.signerKeys[0] === dedicatedSecret)
  assert("T3 operational key does not replace dedicated key", !configured.state.signerKeys.includes(operationalSecret))
  assert("T3 all transaction sends are mocked", configured.state.sendCalls === 1 && configuredResponse.status === 200)
  assert("T5 dedicated secret is absent from response", !configuredPublic.includes(dedicatedSecret))
  assert("T5 client secret is absent from configured response", !configuredPublic.includes(clientSecret))
  assert("T5 secrets are absent from configured logs", !configuredLogs.includes(dedicatedSecret) && !configuredLogs.includes(clientSecret))

  console.log(`SEC0_TARGETED_TEST_ASSERTIONS=${assertions}`)
  console.log("REAL_TRANSACTION_EXECUTED=NO")
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
