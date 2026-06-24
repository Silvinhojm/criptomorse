// app/api/stress-test/route.ts
import { NextResponse } from "next/server"
import { ethers } from "ethers"
import { realSwap } from "@/lib/real-swap-executor"

const ARC_RPC_URL = "https://rpc.testnet.arc.io"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const privateKey = body.privateKey || process.env.PRIVATE_KEY
    
    if (!privateKey) {
      return NextResponse.json(
        { success: false, error: "PRIVATE_KEY não fornecida" },
        { status: 400 }
      )
    }

    // Cria provider diretamente para a Arc Testnet
    const provider = new ethers.JsonRpcProvider(ARC_RPC_URL)
    
    const signer = new ethers.Wallet(privateKey, provider)
    const address = await signer.getAddress()
    console.log(`🔑 Stress Test signer: ${address}`)

    const results = []
    const operations = ["swap_USDC_EURC", "swap_EURC_USDC", "transfer_memo"]
    
    for (let i = 0; i < 5; i++) {
      const op = operations[i % operations.length]
      const startTime = Date.now()
      try {
        let result
        switch (op) {
          case "swap_USDC_EURC": {
            // Simula swap (Arc testnet não tem DEX real)
            result = { success: false, txHash: "", error: "Arc Testnet: sem DEX real disponivel" }
            break
          }
          case "swap_EURC_USDC": {
            result = { success: false, txHash: "", error: "Arc Testnet: sem DEX real disponivel" }
            break
          }
          case "transfer_memo": {
            // Transferência simples
            const tx = await signer.sendTransaction({
              to: address,
              value: 0,
              data: "0x"
            })
            result = { success: true, txHash: tx.hash }
            break
          }
        }
        results.push({
          operation: op,
          txHash: result.txHash || "",
          success: result.success || false,
          duration: Date.now() - startTime,
          error: result.error || undefined
        })
      } catch (error) {
        results.push({
          operation: op,
          txHash: "",
          success: false,
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    const total = results.length
    const success = results.filter(r => r.success).length
    const failed = total - success

    return NextResponse.json({
      success: true,
      result: { total, success, failed, results }
    })
  } catch (error) {
    console.error("❌ Stress Test API error:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: "Use POST para executar o stress test"
  })
}
