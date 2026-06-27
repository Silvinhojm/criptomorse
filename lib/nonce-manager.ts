// lib/nonce-manager.ts
// Gerenciador de nonce para evitar transações duplicadas em redes congestionadas
import { ethers } from "ethers"

export class NonceManager {
  private static instance: NonceManager
  private nonces: Map<string, number> = new Map()
  private lock: Promise<void> = Promise.resolve()
  private resolveLock: (() => void) | null = null

  static getInstance(): NonceManager {
    if (!NonceManager.instance) {
      NonceManager.instance = new NonceManager()
    }
    return NonceManager.instance
  }

  async getNonce(
    provider: ethers.Provider,
    chainId: number,
    address: string
  ): Promise<number> {
    const prev = this.lock
    this.lock = new Promise(resolve => { this.resolveLock = resolve })
    await prev
    try {
      const key = `${chainId}:${address.toLowerCase()}`
      const onChain = await provider.getTransactionCount(address, "pending")
      const tracked = this.nonces.get(key) ?? 0
      const nonce = Math.max(onChain, tracked)
      this.nonces.set(key, nonce + 1)
      return nonce
    } finally {
      this.resolveLock?.()
    }
  }

  resetNonce(chainId: number, address: string): void {
    const key = `${chainId}:${address.toLowerCase()}`
    this.nonces.delete(key)
  }
}
