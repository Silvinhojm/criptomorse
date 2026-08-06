// RI-BANK-81 — fonte de câmbio externa e real (USD/EUR), independente de
// qualquer pool AMM. Usada para julgar se uma execução do Bandit foi
// lucrativa em termos de valor de mundo real, não da cotação distorcida de
// um pool de testnet com liquidez artificialmente baixa (RI-BANK-70/73/77
// já documentaram o quanto essa distorção é real: o pool USDC/EURC tem
// ~$18 de reserva total).
//
// Frankfurter (api.frankfurter.app) foi escolhido deliberadamente por ser
// uma API de câmbio dedicada (dados do Banco Central Europeu), não um
// agregador de preço de cripto — mais alinhado ao pedido explícito do
// ticket ("API de câmbio real USD/EUR") do que reaproveitar a cotação de
// EURC já usada em outro lugar do sistema (lib/sosovalue-price-agent.ts),
// que é uma fonte de preço de ativo cripto, não uma fonte de câmbio fiat
// dedicada. Não exige chave de API.

import { withRetries } from "./network-resilience"

const FRANKFURTER_URL = "https://api.frankfurter.app/latest?from=EUR&to=USD"

export interface ExternalForexRate {
  usdPerEur: number
  source: string
  fetchedAt: number
}

async function fetchRateOnce(): Promise<ExternalForexRate> {
  const res = await fetch(FRANKFURTER_URL, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`frankfurter_http_${res.status}`)
  const body = (await res.json()) as { rates?: { USD?: number } }
  const usdPerEur = body?.rates?.USD
  if (!usdPerEur || usdPerEur <= 0) throw new Error("frankfurter_missing_usd_rate")
  return { usdPerEur, source: "frankfurter.app (EUR→USD, ECB reference rate)", fetchedAt: Date.now() }
}

// Mesmo padrão de retry já validado (RI-BANK-50/62/72) para absorver um
// blip pontual de rede. Nunca fabrica uma taxa: se todas as tentativas
// falharem, propaga o erro. Um fallback silencioso de câmbio 1:1 aqui
// reintroduziria exatamente o tipo de distorção autorreferencial que este
// ticket existe para evitar -- é melhor não registrar um resultado do que
// registrar um resultado calculado com um número inventado.
export async function fetchExternalUsdEurRate(): Promise<ExternalForexRate> {
  return withRetries(fetchRateOnce, 3, 500)
}
