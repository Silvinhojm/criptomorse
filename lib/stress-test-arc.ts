// lib/stress-test-arc.ts
// Versão simplificada para testar a Arc Testnet

import { ethers } from "ethers"
import { NonceManager } from "./nonce-manager"
import { realSwap } from "./real-swap-executor"

export interface StressTestResult {
  operation: string
  txHash: string
  success: boolean
  duration: number
  error?: string
}

export class StressTestArc {
  private results: StressTestResult[] = []
  private isRunning = false

  async run(transactions: number = 10): Promise<{ total: number; success: number; failed: number; results: StressTestResult[] }> {
    if (this.isRunning) {
      console.log("⚠️ Stress test já está rodando")
      return this.getSummary()
    }

    this.isRunning = true
    this.results = []

    console.log("")
    console.log("🚀 ========================================")
    console.log("🚀 INICIANDO STRESS TEST NA ARC TESTNET")
    console.log("🚀 ========================================")
    console.log(`📦 Total de transações: ${transactions}`)
    console.log("")

    for (let i = 0; i < transactions; i++) {
      const startTime = Date.now()
      const result: StressTestResult = {
        operation: "",
        txHash: "",
        success: false,
        duration: 0
      }

      try {
        const op = i % 3 === 0 ? "swap_USDC_EURC" : i % 3 === 1 ? "swap_EURC_USDC" : "transfer_memo"
        result.operation = op

        const txResult = await this._executeOperation(op)
        result.success = txResult.success
        result.txHash = txResult.txHash || ""
        result.duration = Date.now() - startTime
        result.error = txResult.error

        console.log(`  ${i + 1}/${transactions} ✅ ${op} → ${result.txHash.slice(0, 12)}... (${result.duration}ms)`)
      } catch (error) {
        result.success = false
        result.error = error instanceof Error ? error.message : String(error)
        result.duration = Date.now() - startTime
        console.log(`  ${i + 1}/${transactions} ❌ ${result.operation} falhou: ${result.error?.slice(0, 60)}`)
      }

      this.results.push(result)

      if (i < transactions - 1) {
        await this._sleep(500)
      }
    }

    this.isRunning = false
    const summary = this.getSummary()
    console.log("")
    console.log("✅ ========================================")
    console.log("✅ STRESS TEST CONCLUÍDO!")
    console.log("✅ ========================================")
    console.log(`📊 ${summary.success}/${summary.total} bem-sucedidas`)
    console.log(`❌ ${summary.failed} falhas`)
    console.log("✅ ========================================")

    return summary
  }

  private async _executeOperation(op: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const signer = await realSwap.getSigner()
      if (!signer) {
        return { success: false, error: "Signer não disponível - inicialize a carteira primeiro" }
      }
      if (!signer) {
        return { success: false, error: "Signer não disponível" }
      }

      switch (op) {
        case "swap_USDC_EURC": {
          const result = await realSwap.executeSwap("USDC", "EURC", 0.1)
          return { success: result.success, txHash: result.txHash }
        }
        case "swap_EURC_USDC": {
          const result = await realSwap.executeSwap("EURC", "USDC", 0.1)
          return { success: result.success, txHash: result.txHash }
        }
        case "transfer_memo": {
          const provider = await realSwap.getProvider()
          if (!provider) return { success: false, error: "No provider" }
          const address = await signer.getAddress()
          const net = await provider.getNetwork()
          const nonce = await NonceManager.getInstance().getNonce(provider, Number(net.chainId), address).catch(() => undefined)
          const tx = await signer.sendTransaction({
            to: address,
            value: 0,
            data: "0x",
            nonce,
          })
          return { success: true, txHash: tx.hash }
        }
        default:
          return { success: false, error: `Operação desconhecida: ${op}` }
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  getSummary(): { total: number; success: number; failed: number; results: StressTestResult[] } {
    const success = this.results.filter(r => r.success)
    return {
      total: this.results.length,
      success: success.length,
      failed: this.results.length - success.length,
      results: this.results
    }
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  reset(): void {
    this.results = []
    this.isRunning = false
  }
}

export const stressTestArc = new StressTestArc()
