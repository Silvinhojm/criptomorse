import { NextResponse } from "next/server"
import { accountant } from "@/lib/accountant"
import { limparVotos } from "@/lib/agentes-do-pregão"

export async function POST() {
  accountant.resetScores()
  limparVotos()
  return NextResponse.json({ success: true, message: "Scores e histórico de votos resetados" })
}
