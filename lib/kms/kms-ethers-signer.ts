import {
  AbstractSigner,
  Transaction,
  resolveAddress,
  resolveProperties,
  type Provider,
  type TransactionLike,
  type TransactionRequest,
} from "ethers"

import { KmsEvmSigner } from "@/lib/kms/kms-evm-signer"

/** Ethers adapter for the already-proved KmsEvmSigner. */
export class KmsEthersSigner extends AbstractSigner {
  constructor(
    private readonly kmsSigner: KmsEvmSigner,
    provider: Provider,
  ) {
    super(provider)
  }

  connect(provider: null | Provider): KmsEthersSigner {
    if (!provider) throw new Error("KMS signer requires a provider")
    return new KmsEthersSigner(this.kmsSigner, provider)
  }

  getAddress(): Promise<string> {
    return this.kmsSigner.getAddress()
  }

  async signTransaction(transaction: TransactionRequest): Promise<string> {
    const resolved = await resolveProperties(transaction)
    const to = resolved.to == null ? null : await resolveAddress(resolved.to, this.provider)
    const unsigned = Transaction.from({ ...resolved, to } as TransactionLike<string>)
    return this.kmsSigner.signTransaction(unsigned)
  }

  async signMessage(): Promise<string> {
    throw new Error("KMS cron signer only authorizes EVM transaction digests")
  }

  async signTypedData(): Promise<string> {
    throw new Error("KMS cron signer only authorizes EVM transaction digests")
  }
}
