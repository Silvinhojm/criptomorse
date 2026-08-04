import { Transaction } from "ethers"

import { KmsEthersSigner } from "../kms/kms-ethers-signer"
import type { KmsEvmSigner } from "../kms/kms-evm-signer"

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

// RI-BANK-57 reproduced, deterministically, that ethers hands
// KmsEthersSigner.signTransaction() a real `Transaction` class instance
// (built internally by AbstractSigner.sendTransaction() via
// `Transaction.from(pop)`), and that the old code's
// `resolveProperties(transaction)` — which uses `Object.keys(value)` — sees
// zero own enumerable properties on such an instance (everything is a
// prototype getter), silently producing `{}` and defaulting every field,
// including chainId → 0. That's what the Arc Testnet node rejected as
// "invalid chain ID". RI-BANK-58 fixes it by detecting a real Transaction
// instance and using Transaction.from(transaction), which reads fields via
// direct property access (not Object.keys) and therefore works correctly.
async function run(): Promise<void> {
  let captured: Transaction | null = null
  const fakeKmsSigner = {
    signTransaction: async (unsigned: Transaction) => {
      captured = unsigned
      return "0xfakeserialized"
    },
  } as unknown as KmsEvmSigner

  const fakeProvider: any = {
    getNetwork: async () => ({ chainId: 5042002n }),
  }

  const signer = new KmsEthersSigner(fakeKmsSigner, fakeProvider)

  // ── Case 1: a REAL Transaction class instance (the RI-BANK-57 scenario) ──
  const realTxInstance = Transaction.from({
    to: "0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb",
    data: "0x9f1d0f59",
    nonce: 7,
    gasLimit: 250000n,
    chainId: 5042002n,
    type: 2,
    maxFeePerGas: 41500000000n,
    maxPriorityFeePerGas: 1500000000n,
  })
  expect(Object.keys(realTxInstance).length === 0, "sanity check: Transaction instances must expose zero own enumerable keys (this is exactly what broke resolveProperties())")

  await signer.signTransaction(realTxInstance)
  expect(captured !== null, "signTransaction must reach the KMS signer")
  expect(captured!.chainId === 5042002n, `chainId must survive as 5042002n, got ${captured!.chainId}`)
  expect(captured!.to?.toLowerCase() === "0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb".toLowerCase(), `to must survive, got ${captured!.to}`)
  expect(captured!.data === "0x9f1d0f59", `data must survive, got ${captured!.data}`)
  expect(captured!.nonce === 7, `nonce must survive, got ${captured!.nonce}`)
  expect(captured!.gasLimit === 250000n, `gasLimit must survive, got ${captured!.gasLimit}`)
  console.log("RI_BANK_58_TRANSACTION_INSTANCE_FIELDS_PRESERVED=PASS")

  // ── Case 2: a plain object (original behavior must still work — no regression) ──
  captured = null
  await signer.signTransaction({
    to: "0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb",
    data: "0x9f1d0f59",
    nonce: 9,
    gasLimit: 300000n,
    chainId: 5042002n,
    type: 2,
    maxFeePerGas: 41500000000n,
    maxPriorityFeePerGas: 1500000000n,
  })
  expect(captured !== null, "signTransaction must reach the KMS signer for a plain object too")
  expect(captured!.chainId === 5042002n, `plain-object path: chainId must be 5042002n, got ${captured!.chainId}`)
  expect(captured!.nonce === 9, `plain-object path: nonce must be 9, got ${captured!.nonce}`)
  console.log("RI_BANK_58_PLAIN_OBJECT_PATH_STILL_WORKS=PASS")
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
