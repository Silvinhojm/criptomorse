import { createPublicKey } from "node:crypto"

import { GetPublicKeyCommand, KMSClient, SignCommand } from "@aws-sdk/client-kms"
import { secp256k1 } from "@noble/curves/secp256k1"
import { Transaction, computeAddress, getBytes, hexlify, id, recoverAddress } from "ethers"

import { KmsEvmSigner } from "../kms/kms-evm-signer"

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url")
}

function createFakeKms(privateKey: Uint8Array): KMSClient {
  const publicKey = secp256k1.getPublicKey(privateKey, false)
  const spki = createPublicKey({
    key: {
      kty: "EC",
      crv: "secp256k1",
      x: base64Url(publicKey.slice(1, 33)),
      y: base64Url(publicKey.slice(33, 65)),
    },
    format: "jwk",
  }).export({ format: "der", type: "spki" })

  return {
    async send(command: unknown) {
      if (command instanceof GetPublicKeyCommand) {
        return {
          PublicKey: new Uint8Array(spki),
          KeySpec: "ECC_SECG_P256K1",
          KeyUsage: "SIGN_VERIFY",
          SigningAlgorithms: ["ECDSA_SHA_256"],
        }
      }
      if (command instanceof SignCommand) {
        const input = command.input
        expect(input.MessageType === "DIGEST", "signer must send MessageType=DIGEST")
        expect(input.SigningAlgorithm === "ECDSA_SHA_256", "signer must use ECDSA_SHA_256")
        expect(input.Message?.length === 32, "signer must send one 32-byte digest")
        const signature = secp256k1.sign(input.Message, privateKey, { lowS: false })
        return { Signature: signature.toDERRawBytes() }
      }
      throw new Error("Unexpected fake KMS command")
    },
  } as unknown as KMSClient
}

export async function runRiBank32KmsEvmSignerVerification(): Promise<void> {
  const privateKey = getBytes("0x3b1f1c15923e2f64f1dcf4f48fe4b2de55f7197275e388a4c5360a39c0d1b424")
  const expectedAddress = computeAddress(hexlify(Buffer.from(secp256k1.getPublicKey(privateKey, false))))
  const signer = new KmsEvmSigner({
    client: createFakeKms(privateKey),
    keyId: "test-key",
    expectedAddress,
  })

  expect(await signer.getAddress() === expectedAddress, "SPKI must derive the expected EVM address")
  const digest = id("RI-BANK-32 deterministic local unit test")
  const signature = await signer.signDigest(digest)
  const secp256k1Order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
  expect(BigInt(signature.s) <= secp256k1Order / 2n, "signature s must be EIP-2 low-S")
  expect(recoverAddress(digest, signature) === expectedAddress, "signature must recover expected address")

  const tx = Transaction.from({
    type: 2,
    chainId: 5_042_002,
    nonce: 7,
    to: expectedAddress,
    value: 0,
    gasLimit: 21_000,
    maxFeePerGas: 1,
    maxPriorityFeePerGas: 0,
  })
  const raw = await signer.signTransaction(tx)
  const decoded = Transaction.from(raw)
  expect(decoded.from === expectedAddress, "signed transaction must recover KMS address")
  expect(decoded.chainId === 5_042_002n, "signed transaction must preserve Arc Testnet chainId")

  let mismatchBlocked = false
  try {
    const mismatch = new KmsEvmSigner({
      client: createFakeKms(privateKey),
      keyId: "test-key",
      expectedAddress: "0x0000000000000000000000000000000000000001",
    })
    await mismatch.getAddress()
  } catch (error) {
    mismatchBlocked = error instanceof Error && error.message.includes("address mismatch")
  }
  expect(mismatchBlocked, "address mismatch must fail closed before signing")

  console.log("ALL_RI_BANK_32_LOCAL_ASSERTIONS_PASSED=YES")
  console.log(`DERIVED_TEST_ADDRESS=${expectedAddress}`)
}

runRiBank32KmsEvmSignerVerification().catch(error => {
  console.error(error)
  process.exitCode = 1
})
