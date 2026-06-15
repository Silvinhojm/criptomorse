type CircuitBreakerState = {
  isPanicActive: boolean;
  panicReason: string | null;
  panicTimestamp: string | null;
  consecutiveLosses: number;
  maxLossesBeforePanic: number;
  totalLoss: number;
  totalProfit: number;
  maxDrawdownPercent: number;
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
};

let state: CircuitBreakerState = { ...initialState };

export function getCircuitBreakerState(): CircuitBreakerState {
  return { ...state };
}

export function recordTradeResult(profit: number): CircuitBreakerState {
  if (isNaN(profit)) return { ...state };
  if (profit < 0) {
    state.consecutiveLosses++;
    state.totalLoss += Math.abs(profit);
    console.log(`📉 Perda: $${Math.abs(profit).toFixed(4)} | Consecutivas: ${state.consecutiveLosses} | Total perda: $${state.totalLoss.toFixed(4)}`);
  } else {
    state.consecutiveLosses = 0;
    state.totalProfit += profit;
    console.log(`📈 Lucro: $${profit.toFixed(4)} | Total lucro: $${state.totalProfit.toFixed(4)}`);
  }
  const totalInvested = state.totalLoss + state.totalProfit;
  const drawdown = totalInvested > 0 ? (state.totalLoss / totalInvested) * 100 : 0;
  if ((state.consecutiveLosses >= state.maxLossesBeforePanic || drawdown >= state.maxDrawdownPercent) && !state.isPanicActive) {
    if (state.consecutiveLosses >= state.maxLossesBeforePanic) {
      activatePanic(`${state.consecutiveLosses} perdas consecutivas`);
    } else {
      activatePanic(`Drawdown de ${drawdown.toFixed(1)}% (limite: ${state.maxDrawdownPercent}%)`);
    }
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
  state = { ...initialState };
  console.log('✅ Sistema retomado do modo pânico');
}

export function resetCircuitBreaker(): void {
  state = { ...initialState };
  console.log('🔄 Circuit breaker resetado');
}
