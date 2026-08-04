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
    // RI-BANK-58 — ethers hands this method a real `Transaction` class
    // instance here (AbstractSigner.sendTransaction() does
    // `Transaction.from(pop)` then calls `this.signTransaction(txObj)`).
    // Transaction instances expose every field (chainId, to, data, nonce,
    // gasLimit, ...) as prototype getters, not own enumerable properties.
    // resolveProperties() below uses Object.keys(value) internally, which
    // does not see prototype getters — so it silently resolved to `{}` for
    // a Transaction instance, and every field then defaulted, including
    // chainId: 0 (rejected by the Arc Testnet node as "invalid chain ID").
    // RI-BANK-32's proof route never hit this: it called
    // KmsEvmSigner.signTransaction() directly with a hand-built
    // Transaction.from({...}) instance, bypassing this adapter entirely.
    // Transaction.from() itself reads fields via direct property access
    // (tx.to, tx.chainId, ...), so it works correctly on an instance —
    // unlike resolveProperties()'s Object.keys().
    if (transaction instanceof Transaction) {
      const unsigned = Transaction.from(transaction)
      return this.kmsSigner.signTransaction(unsigned)
    }

    // Plain TransactionRequest object (may still contain unresolved
    // Promises, e.g. an ENS name for `to`) — original behavior preserved.
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
