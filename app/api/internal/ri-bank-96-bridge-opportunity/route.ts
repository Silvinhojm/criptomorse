import { NextRequest } from "next/server"

import {
  DEFAULT_TRADE_AMOUNT_USD,
  DEFAULT_TRANSIT_DRIFT_RATE,
  DEFAULT_TRANSIT_WINDOW_HOURS,
  evaluateBridgeOpportunity,
  type BridgeOpportunityInput,
} from "@/lib/bandit-bridge-opportunity"
import { isValidCronAdminRequest } from "@/lib/security/cron-auth"

// RI-BANK-96 — endpoint de consulta MANUAL (somente leitura) do sinal de
// ponte. Mesmo padrão das rotas de diagnóstico (ex: ri-bank-76-bandit-state):
// retorna se, com as condições passadas na query, "valeria a pena considerar
// uma ponte agora" — nunca gera, nunca autoriza, nunca executa um cron-plan.
// Nenhuma escrita em Redis, nenhum KMS, nenhuma chamada a
// executeCronPlanWithKms. O Bandit/cron NÃO são conectados a esta rota
// nesta etapa (RI-BANK-96).
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

/**
 * Preenche uma BridgeOpportunityInput a partir dos parâmetros de query.
 * Os custos reais observados em RI-BANK-94 entram como DEFAULT quando não
 * informados: feeCCTP ~0,00026 USDC; gas burn Base ~ $0? (testnet) e gas
 * mint Arc ~ $0? (testnet). Em produção, pernas = mainnet, os valores de
 * gas precisam ser informados na query (ou o preço/estado vira dirty).
 */
function parseInput(search: URLSearchParams): BridgeOpportunityInput {
  const num = (k: string, dflt: number): number => {
    const raw = search.get(k)
    if (raw === null || raw === "" || !Number.isFinite(Number(raw))) return dflt
    return Number(raw)
  }

  return {
    pairLabel: search.get("pair") ?? "USDC→EURC",
    sourceNetwork: search.get("source") ?? "arc",
    destinationNetwork: search.get("dest") ?? "base",
    priceSourceUsd: num("priceSourceUsd", 1.0),
    priceDestinationUsd: num("priceDestinationUsd", 1.0002),
    cctpFeeUsd: num("cctpFeeUsd", 0.00026), // maxFee observado (RI-BANK-94)
    gasSourceUsd: num("gasSourceUsd", 0.0), // testnet: custo desprezível
    gasDestinationUsd: num("gasDestinationUsd", 0.0), // testnet: custo desprezível
    transitWindowHours: num("transitHours", DEFAULT_TRANSIT_WINDOW_HOURS),
    transitDriftRatePerHour: search.get("driftPerHour")
      ? num("driftPerHour", DEFAULT_TRANSIT_DRIFT_RATE) / 100
      : DEFAULT_TRANSIT_DRIFT_RATE,
    tradeAmountUsd: num("amountUsd", DEFAULT_TRADE_AMOUNT_USD),
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!isValidCronAdminRequest(request.headers.get("authorization"))) {
    return json({ ok: false, error: "unauthorized" }, 401)
  }

  try {
    const search = new URL(request.url).searchParams
    const input = parseInput(search)
    const opportunity = evaluateBridgeOpportunity(input)

    return json({
      ok: true,
      readOnly: true,
      note: "sinal consultivo apenas — não gera/executa planos (RI-BANK-96)",
      input: {
        pair: input.pairLabel,
        source: input.sourceNetwork,
        destination: input.destinationNetwork,
        priceSourceUsd: input.priceSourceUsd,
        priceDestinationUsd: input.priceDestinationUsd,
        cctpFeeUsd: input.cctpFeeUsd,
        gasSourceUsd: input.gasSourceUsd,
        gasDestinationUsd: input.gasDestinationUsd,
        transitWindowHours: input.transitWindowHours,
        transitDriftRatePerHour: input.transitDriftRatePerHour,
        tradeAmountUsd: input.tradeAmountUsd,
      },
      result: opportunity,
      timestamp: Date.now(),
    })
  } catch (error) {
    console.error("[RI-BANK-96] bridge opportunity read failed", error)
    return json({
      ok: false,
      error: "bridge_opportunity_read_failed",
      detail: error instanceof Error ? error.message : "unknown error",
    }, 500)
  }
}

export async function POST(): Promise<Response> {
  return json({ error: "method_not_allowed" }, 405)
}