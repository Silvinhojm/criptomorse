type CircuitBreakerState = {
  isPanicActive: boolean;
  panicReason: string | null;
  panicTimestamp: string | null;
  consecutiveLosses: number;
  maxLossesBeforePanic: number;
};

const initialState: CircuitBreakerState = {
  isPanicActive: false,
  panicReason: null,
  panicTimestamp: null,
  consecutiveLosses: 0,
  maxLossesBeforePanic: 5,
};

let state: CircuitBreakerState = { ...initialState };

export function getCircuitBreakerState(): CircuitBreakerState {
  return { ...state };
}

export function recordError(agentName: string, errorType: string): CircuitBreakerState {
  state.consecutiveLosses++;
  console.log(⚠️ Erro registrado para : );
  console.log(📊 Erros consecutivos: /);
  if (state.consecutiveLosses >= state.maxLossesBeforePanic && !state.isPanicActive) {
    activatePanic(Erros consecutivos:  erros);
  }
  return { ...state };
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
