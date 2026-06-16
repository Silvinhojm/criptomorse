type CircuitBreakerState = {
  isPanicActive: boolean;
  panicReason: string | null;
  panicTimestamp: string | null;
  consecutiveLosses: number;
  maxLossesBeforePanic: number;
  totalLoss: number;
  totalProfit: number;
  maxDrawdownPercent: number;
  isTestnet: boolean;
};

const initialState: CircuitBreakerState = {
  isPanicActive: false,
  panicReason: null,
  panicTimestamp: null,
  consecutiveLosses: 0,
  maxLossesBeforePanic: 5,
  totalLoss: 0,
  totalProfit: 0,
  maxDrawdownPercent: 10,
  isTestnet: false,
};

let state: CircuitBreakerState = { ...initialState };

export function getCircuitBreakerState(): CircuitBreakerState {
  return { ...state };
}

export function setTestnetMode(isTestnet: boolean): void {
  state.isTestnet = isTestnet;
  if (isTestnet) {
    state.maxLossesBeforePanic = 20;
    state.maxDrawdownPercent = 50;
    console.log(`🧪 Modo testnet: circuit breaker relaxado (max ${state.maxLossesBeforePanic} perdas, ${state.maxDrawdownPercent}% drawdown)`);
  } else {
    state.maxLossesBeforePanic = 5;
    state.maxDrawdownPercent = 10;
  }
}

export function recordTradeResult(profit: number): CircuitBreakerState {
  if (isNaN(profit)) return { ...state };

  // Em testnet: perdas de até $0.50 são ignoradas (LI.FI reverts, fees simuladas)
  if (state.isTestnet && profit < 0 && Math.abs(profit) <= 0.50) {
    console.log(`🧪 Testnet: perda $${Math.abs(profit).toFixed(4)} ignorada`);
    return { ...state };
  }

  if (profit < 0) {
    state.consecutiveLosses++;
    state.totalLoss += Math.abs(profit);
    console.log(`📉 Perda: $${Math.abs(profit).toFixed(4)} | Consecutivas: ${state.consecutiveLosses} | Total perda: $${state.totalLoss.toFixed(4)}`);
  } else {
    state.consecutiveLosses = 0;
    state.totalProfit += profit;
    console.log(`📈 Lucro: $${profit.toFixed(4)} | Total lucro: $${state.totalProfit.toFixed(4)}`);
  }
  // Só verifica drawdown em mainnet (testnet: perdas não são reais)
  if (!state.isTestnet) {
    const totalInvested = state.totalLoss + state.totalProfit;
    const drawdown = totalInvested > 0 ? (state.totalLoss / totalInvested) * 100 : 0;
    if (drawdown >= state.maxDrawdownPercent && !state.isPanicActive) {
      activatePanic(`Drawdown de ${drawdown.toFixed(1)}% (limite: ${state.maxDrawdownPercent}%)`);
    }
  }
  if (state.consecutiveLosses >= state.maxLossesBeforePanic && !state.isPanicActive) {
    activatePanic(`${state.consecutiveLosses} perdas consecutivas`);
  }
  return { ...state };
}

export function recordError(agentName: string, errorType: string): CircuitBreakerState {
  state.consecutiveLosses++;
  console.log(`⚠️ Erro registrado para ${agentName}: ${errorType}`);
  console.log(`📊 Erros consecutivos: ${state.consecutiveLosses}`);
  if (state.consecutiveLosses >= state.maxLossesBeforePanic && !state.isPanicActive) {
    activatePanic(`Erros consecutivos: ${state.consecutiveLosses} erros`);
  }
  return { ...state };
}

export function blockIfPanicked(): boolean {
  if (state.isPanicActive) {
    console.warn(`🚨 Circuit breaker bloqueou trade. Pânico ativo desde ${state.panicTimestamp} — motivo: ${state.panicReason}`);
    return true;
  }
  return false;
}

export function activatePanic(reason: string): void {
  state.isPanicActive = true;
  state.panicReason = reason;
  state.panicTimestamp = new Date().toISOString();
  state.consecutiveLosses = 0;
  console.error('🚨 MODO PÂNICO ATIVADO! 🚨 Motivo: ' + reason);
}

export function resumeFromPanic(): void {
  const wasTestnet = state.isTestnet;
  state = { ...initialState };
  if (wasTestnet) setTestnetMode(true);
  console.log('✅ Sistema retomado do modo pânico');
}

export function resetCircuitBreaker(): void {
  const wasTestnet = state.isTestnet;
  state = { ...initialState };
  if (wasTestnet) setTestnetMode(true);
  console.log('🔄 Circuit breaker resetado');
}
