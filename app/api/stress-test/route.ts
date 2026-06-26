// app/api/stress-test/route.ts
import { NextResponse } from "next/server"
import { ethers } from "ethers"
import { NonceManager } from "@/lib/nonce-manager"

const ARC_RPC_URL = "https://rpc.testnet.arc.io"
const LI_FI_API = "https://li.quest/v1/quote"
const USDC_ARC = "0x3600000000000000000000000000000000000000"
const EURC_ARC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"

async function getLifiQuote(fromToken: string, toToken: string, amount: string, fromAddress: string) {
  const url = `${LI_FI_API}?fromChain=5042002&toChain=5042002&fromToken=${fromToken}&toToken=${toToken}&fromAmount=${amount}&fromAddress=${fromAddress}&toAddress=${fromAddress}&slippage=0.005`
  const res = await fetch(url, { headers: { Accept: "application/json" } })
  if (!res.ok) return null
  return res.json()
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const privateKey = process.env.PRIVATE_KEY
    
    if (!privateKey) {
      return NextResponse.json(
        { success: false, error: "PRIVATE_KEY não fornecida" },
        { status: 400 }
      )
    }

    const provider = new ethers.JsonRpcProvider(ARC_RPC_URL)
    const signer = new ethers.Wallet(privateKey, provider)
    const address = await signer.getAddress()
    const nonceManager = NonceManager.getInstance()
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
            const quote = await getLifiQuote(USDC_ARC, EURC_ARC, "1000000", address)
            if (quote?.transactionRequest) {
              const nonce = await nonceManager.getNonce(provider, 5042002, address)
              const tx = await signer.sendTransaction({ ...quote.transactionRequest, nonce })
              const receipt = await tx.wait()
              result = { success: true, txHash: receipt?.hash || tx.hash }
            } else {
              result = { success: false, txHash: "", error: "LI.FI sem rota para USDC→EURC na Arc" }
            }
            break
          }
          case "swap_EURC_USDC": {
            const quote = await getLifiQuote(EURC_ARC, USDC_ARC, "1000000", address)
            if (quote?.transactionRequest) {
              const nonce = await nonceManager.getNonce(provider, 5042002, address)
              const tx = await signer.sendTransaction({ ...quote.transactionRequest, nonce })
              const receipt = await tx.wait()
              result = { success: true, txHash: receipt?.hash || tx.hash }
            } else {
              result = { success: false, txHash: "", error: "LI.FI sem rota para EURC→USDC na Arc" }
            }
            break
          }
          case "transfer_memo": {
            const nonce = await nonceManager.getNonce(provider, 5042002, address)
            const tx = await signer.sendTransaction({
              to: address,
              value: 0,
              data: "0x",
              nonce,
            })
            result = { success: true, txHash: tx.hash }
            break
          }
          default:
            result = { success: false, txHash: "", error: "Operação desconhecida" }
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
