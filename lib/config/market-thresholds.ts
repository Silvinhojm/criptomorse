// Thresholds de liquidez mínima por ativo/rede
// Valores em unidades humanas (ex: 10 = $10 USDC na pool)
// Usado em checkRouteViaMulticall(minReserve0) para validar SELL de tokens voláteis
export const MIN_POOL_RESERVE: Record<string, Record<string, number>> = {
  arc: {
    cirBTC: 10,   // pool USDC/cirBTC precisa de ≥ $10 USDC de reserva para permitir SELL
    EURC: 5,
    USDC: 5,
  },
}

export const DEFAULT_MIN_RESERVE = 5

// Converte valor humano para raw units com decimais arbitrários
// Ex: toRawUnits(10, 6) → 10_000_000n (USDC)
// Ex: toRawUnits(1.5, 18) → 1_500_000_000_000_000_000n
export function toRawUnits(human: number, decimals: number): bigint {
  const [intPart, fracPart = ""] = human.toString().split(".")
  const padded = fracPart.padEnd(decimals, "0").slice(0, decimals)
  return BigInt(intPart + (padded || "0".repeat(decimals)))
}
