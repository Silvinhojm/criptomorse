import { createPublicKey } from "node:crypto"

import {
  GetPublicKeyCommand,
  KMSClient,
  SignCommand,
} from "@aws-sdk/client-kms"
import { secp256k1 } from "@noble/curves/secp256k1"
import {
  Signature,
  Transaction,
  computeAddress,
  getAddress,
  getBytes,
  hexlify,
  recoverAddress,
  toBeHex,
} from "ethers"

const KMS_KEY_SPEC = "ECC_SECG_P256K1"
const KMS_KEY_USAGE = "SIGN_VERIFY"
const KMS_SIGNING_ALGORITHM = "ECDSA_SHA_256"

export interface KmsEvmSignerConfig {
  client: KMSClient
  keyId: string
  expectedAddress: string
}

export interface EvmDigestSignature {
  r: string
  s: string
  yParity: 0 | 1
  v: 27 | 28
  serialized: string
}

/**
 * Minimal EVM signer backed by a non-exportable AWS KMS secp256k1 key.
 * It intentionally has no provider or trading integration; callers must
 * explicitly build a complete unsigned transaction before asking it to sign.
 */
export class KmsEvmSigner {
  private readonly client: KMSClient
  private readonly keyId: string
  private readonly expectedAddress: string
  private address: string | null = null

  constructor(config: KmsEvmSignerConfig) {
    if (!config.keyId) throw new Error("KMS keyId is required")
    this.client = config.client
    this.keyId = config.keyId
    this.expectedAddress = getAddress(config.expectedAddress)
  }

  async getAddress(): Promise<string> {
    if (this.address) return this.address

    const response = await this.client.send(new GetPublicKeyCommand({ KeyId: this.keyId }))
    if (!response.PublicKey) throw new Error("KMS GetPublicKey returned no public key")
    if (response.KeySpec !== KMS_KEY_SPEC) {
      throw new Error(`Unexpected KMS KeySpec: ${response.KeySpec ?? "missing"}`)
    }
    if (response.KeyUsage !== KMS_KEY_USAGE) {
      throw new Error(`Unexpected KMS KeyUsage: ${response.KeyUsage ?? "missing"}`)
    }
    if (!response.SigningAlgorithms?.includes(KMS_SIGNING_ALGORITHM)) {
      throw new Error(`KMS key does not allow ${KMS_SIGNING_ALGORITHM}`)
    }

    const derived = deriveEvmAddressFromSpki(response.PublicKey)
    if (derived !== this.expectedAddress) {
      throw new Error(`KMS address mismatch: expected ${this.expectedAddress}, derived ${derived}`)
    }

    this.address = derived
    return derived
  }

  async signDigest(digest: Uint8Array | string): Promise<EvmDigestSignature> {
    const digestBytes = getBytes(digest)
    if (digestBytes.length !== 32) throw new Error("KMS EVM digest must be exactly 32 bytes")

    const expectedAddress = await this.getAddress()
    const response = await this.client.send(new SignCommand({
      KeyId: this.keyId,
      Message: digestBytes,
      MessageType: "DIGEST",
      SigningAlgorithm: KMS_SIGNING_ALGORITHM,
    }))
    if (!response.Signature) throw new Error("KMS Sign returned no signature")

    // AWS returns ASN.1 DER. Noble performs strict DER parsing and EIP-2 low-S
    // normalization; recovery below determines the Ethereum y parity.
    const parsed = secp256k1.Signature.fromDER(response.Signature).normalizeS()
    const r = toBeHex(parsed.r, 32)
    const s = toBeHex(parsed.s, 32)
    const digestHex = hexlify(digestBytes)

    for (const yParity of [0, 1] as const) {
      const candidate = Signature.from({ r, s, yParity })
      if (recoverAddress(digestHex, candidate) === expectedAddress) {
        return {
          r,
          s,
          yParity,
          v: yParity === 0 ? 27 : 28,
          serialized: candidate.serialized,
        }
      }
    }

    throw new Error("KMS signature cannot recover the expected EVM address")
  }

  async signTransaction(unsigned: Transaction): Promise<string> {
    if (unsigned.signature) throw new Error("Transaction must be unsigned")
    if (unsigned.from && getAddress(unsigned.from) !== await this.getAddress()) {
      throw new Error("Transaction from address does not match KMS signer")
    }

    const signature = await this.signDigest(unsigned.unsignedHash)
    unsigned.signature = Signature.from(signature)
    return unsigned.serialized
  }
}

export function deriveEvmAddressFromSpki(spkiDer: Uint8Array): string {
  const key = createPublicKey({
    key: Buffer.from(spkiDer),
    format: "der",
    type: "spki",
  })
  const jwk = key.export({ format: "jwk" })
  if (jwk.kty !== "EC" || jwk.crv !== "secp256k1" || !jwk.x || !jwk.y) {
    throw new Error("KMS public key is not an EC secp256k1 key")
  }

  const x = Buffer.from(jwk.x, "base64url")
  const y = Buffer.from(jwk.y, "base64url")
  if (x.length !== 32 || y.length !== 32) throw new Error("Invalid secp256k1 public key coordinates")
  return computeAddress(hexlify(Buffer.concat([Buffer.from([4]), x, y])))
}
