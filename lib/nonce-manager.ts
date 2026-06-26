import { ethers } from "ethers"

type NonceKey = string

interface NonceState {
  nextNonce: number
  timestamp: number
}

export class NonceManager {
  private static instance: NonceManager
  private nonceMap = new Map<NonceKey, NonceState>()
  private lockMap = new Map<NonceKey, Promise<number>>()
  private NONCE_EXPIRY = 120_000 // 2 minutos

  static getInstance(): NonceManager {
    if (!NonceManager.instance) {
      NonceManager.instance = new NonceManager()
    }
    return NonceManager.instance
  }

  private key(chainId: number, address: string): NonceKey {
    return `${chainId}:${address.toLowerCase()}`
  }

  async getNonce(
    provider: ethers.Provider,
    chainId: number,
    address: string,
  ): Promise<number> {
    const k = this.key(chainId, address)

    const previous = this.lockMap.get(k) ?? Promise.resolve(0)
    const current = previous.then(async () => {
      const state = this.nonceMap.get(k)
      const now = Date.now()

      if (!state || now - state.timestamp > this.NONCE_EXPIRY) {
        const onChain = await provider.getTransactionCount(address)
        this.nonceMap.set(k, { nextNonce: onChain, timestamp: now })
        return onChain
      }

      const onChain = await provider.getTransactionCount(address)
      const nextNonce = Math.max(state.nextNonce, onChain)
      this.nonceMap.set(k, { nextNonce: nextNonce + 1, timestamp: now })
      return nextNonce
    })

    this.lockMap.set(k, current)
    return current
  }

  resetNonce(chainId: number, address: string): void {
    const k = this.key(chainId, address)
    this.nonceMap.delete(k)
    this.lockMap.delete(k)
  }

  clear(): void {
    this.nonceMap.clear()
    this.lockMap.clear()
  }
}
