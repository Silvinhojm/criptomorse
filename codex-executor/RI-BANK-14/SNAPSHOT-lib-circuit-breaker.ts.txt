import {
  saveCircuitBreakerState,
  loadCircuitBreakerStateInitial,
  loadCircuitBreakerStateFresh,
  cbCounterOp,
} from "./persistence";
import { SafetyGuard } from './agent-framework/safety-guard'

// ─── ICircuitBreaker Interface ────────────────────────────────────────────────
// Interface unificada para todos os circuit breakers do sistema.
// Cada implementação tem sua própria política de limiar e timeout.

export interface ICircuitBreaker {
  recordSuccess(): void
  recordFailure(reason?: string): void
  isOpen(): boolean
  getName(): string
  getStatus(): { open: boolean; consecutiveFailures: number; cooldownUntil: number | null }
}

// ─── RouteCircuitBreaker ──────────────────────────────────────────────────────
// Monitora saúde de uma rota específica (LI.FI, DEX direto, etc).
// Abre após 5 falhas consecutivas, cooldown de 20 minutos.
// Implementado via SafetyGuard genérico do agent-framework.

export class RouteCircuitBreaker implements ICircuitBreaker {
  private guard: SafetyGuard
  private routeName: string

  constructor(routeName: string) {
    this.routeName = routeName
    this.guard = new SafetyGuard({
      name: routeName,
      maxFailures: 5,
      cooldownMs: 20 * 60 * 1000,
      onTrigger: (msg) => console.warn(`🔇 ${msg}`),
      onRecover: () => console.log(`✅ ${routeName} recuperado do cooldown`),
    })
  }

  recordSuccess(): void {
    this.guard.recordSuccess()
  }

  recordFailure(reason?: string): void {
    console.warn(`🗺️ ${this.routeName}: erro #${this.guard.getStatus().consecutiveFailures + 1}${reason ? ` — ${reason}` : ''}`)
    this.guard.recordFailure(reason)
  }

  isOpen(): boolean {
    return this.guard.isOpen()
  }

  getName(): string { return this.routeName }
  getStatus(): { open: boolean; consecutiveFailures: number; cooldownUntil: number | null } {
    const s = this.guard.getStatus()
    return { open: s.isOpen, consecutiveFailures: s.consecutiveFailures, cooldownUntil: s.cooldownUntil }
  }
}

// ─── FinancialCircuitBreaker ──────────────────────────────────────────────────
// Monitora saúde financeira (lucro/prejuízo). Abre após perdas consecutivas
// ou drawdown acima do limite. Delega ao state global do circuit-breaker.ts.

export class FinancialCircuitBreaker implements ICircuitBreaker {
  getName(): string { return 'Financial' }

  recordSuccess(): void {
    // recordTradeResult com lucro positivo já zera consecutiveLosses
  }

  recordFailure(reason?: string): void {
    // ICircuitBreaker.recordFailure is sync by interface contract (shared
    // with RouteCircuitBreaker, out of scope for this migration) — fire the
    // now-async recordError() without awaiting, but never swallow a
    // failure: attach a logged .catch instead of letting it become an
    // unhandled rejection.
    recordError('FinancialCircuitBreaker', reason ?? 'perda financeira')
      .catch((e) => console.error('[FinancialCircuitBreaker] recordFailure persist failed:', e))
  }

  isOpen(): boolean {
    return blockIfPanicked()
  }

  getStatus(): { open: boolean; consecutiveFailures: number; cooldownUntil: number | null } {
    const s = getCircuitBreakerState()
    return { open: s.isPanicActive, consecutiveFailures: s.consecutiveLosses, cooldownUntil: null }
  }
}

// Instâncias singleton
export const lifiRouteCB = new RouteCircuitBreaker('LI.FI')
export const dexDirectRouteCB = new RouteCircuitBreaker('DEX_Direto')
export const financialCB = new FinancialCircuitBreaker()

export type RouteHealth = {
  consecutiveErrors: number;
  cooldownUntil: number | null;
};

export type CircuitBreakerState = {
  isPanicActive: boolean;
  panicReason: string | null;
  panicTimestamp: string | null;
  consecutiveLosses: number;
  maxLossesBeforePanic: number;
  totalLoss: number;
  totalProfit: number;
  maxDrawdownPercent: number;
  isTestnet: boolean;
  peakNetEquity: number;
  routeHealth: Record<string, RouteHealth>;
};

const MAX_ROUTE_ERRORS_BEFORE_COOLDOWN = 5;
const COOLDOWN_DURATION_MS = 20 * 60 * 1000; // 20 minutos

const initialState: CircuitBreakerState = {
  isPanicActive: false,
  panicReason: null,
  panicTimestamp: null,
  consecutiveLosses: 0,
  maxLossesBeforePanic: 5,
  totalLoss: 0,
  totalProfit: 0,
  // RI-BANK-14: backstop de emergência, acima do máximo configurável
  // pelas caixas (50%). As caixas são a primeira linha de defesa.
  maxDrawdownPercent: 60,
  isTestnet: false,
  peakNetEquity: 0,
  routeHealth: {},
};

// RI-BANK-5 Stage 2B — this initial value is intentionally the FAST,
// possibly-stale, in-memory source of truth used by every synchronous
// read in this file (getCircuitBreakerState, blockIfPanicked, isOpen,
// getStatus). It can only be populated synchronously from localStorage
// (browser) — server-side, Redis reads are always async, so a cold start
// begins from `initialState` until something calls
// getCircuitBreakerStateFresh() (e.g. the /api/cron/trigger endpoint,
// which does this before every gate check). This is the same
// fast-vs-fresh split RI-BANK-4 already established; it now also applies
// to every mutating function below, since real persistence is network I/O.
let state: CircuitBreakerState = loadCircuitBreakerStateInitial<CircuitBreakerState>({ ...initialState });
// Se o panic estava ativo no F5, mantém — segurança
if (state.isPanicActive) {
  console.warn(`🔁 Circuit breaker restaurado do F5: pânico ativo desde ${state.panicTimestamp}`);
}

export function getCircuitBreakerState(): CircuitBreakerState {
  return { ...state };
}

// RI-BANK-4/5 — a warm serverless instance keeps this module loaded (and
// `state` cached in memory) across invocations, so relying on the
// module-level `state` alone can show a stale value if panic was toggled by
// a *different* invocation/process since this one last touched Redis. Any
// code that needs the current, real answer to "is panic active right now"
// (the /api/cron/trigger endpoint in particular) must call this instead of
// getCircuitBreakerState().
export async function getCircuitBreakerStateFresh(): Promise<CircuitBreakerState> {
  state = await loadCircuitBreakerStateFresh({ ...state });
  return { ...state };
}

// Used only by the /api/circuit-breaker/state sync route: the browser is
// the one place recordTradeResult()/activatePanic() can run without ever
// reaching this server process directly (client-side trading loop), so it
// posts its resulting state here to be mirrored to Redis. Merges known
// fields only — never trusts an arbitrary posted shape wholesale.
export async function syncCircuitBreakerStateFromClient(posted: Partial<CircuitBreakerState>): Promise<void> {
  if (!posted || typeof posted !== "object") return;
  const known: (keyof CircuitBreakerState)[] = [
    "isPanicActive", "panicReason", "panicTimestamp", "consecutiveLosses",
    "maxLossesBeforePanic", "totalLoss", "totalProfit", "maxDrawdownPercent",
    "isTestnet", "peakNetEquity", "routeHealth",
  ];
  const next = { ...state };
  for (const key of known) {
    if (key in posted) (next as any)[key] = (posted as any)[key];
  }
  state = next;
  // Absolute fields (this function never receives a delta, only a final
  // snapshot from the client) go through the wholesale save. The 3
  // delta-owned counters also need to land in Redis as an authoritative
  // absolute value here (the client doesn't know about HINCRBY), so we set
  // them explicitly via cbCounterOp("set", ...) rather than silently
  // leaving Redis's counters out of sync with what the client just posted.
  await cbCounterOp("set", {
    consecutiveLosses: next.consecutiveLosses,
    totalLoss: next.totalLoss,
    totalProfit: next.totalProfit,
  });
  await saveCircuitBreakerState(state);
}

export async function setTestnetMode(isTestnet: boolean): Promise<void> {
  const modeChanged = state.isTestnet !== isTestnet;
  state.isTestnet = isTestnet;
  // Auto-resume se pânico veio de drawdown em mainnet mas agora estamos em testnet
  if (isTestnet && state.isPanicActive) {
    await resumeFromPanic();
    return;
  }
  // RI-BANK-11 Trilha A (achado A3): totalProfit/totalLoss/peakNetEquity são
  // contadores únicos, compartilhados independente de isTestnet. Sem este
  // reset, atividade de um modo "vaza" para o cálculo de drawdown do outro
  // assim que a rede muda de volta — comprovado por
  // lib/security/ri-bank-11-trilha-a-drawdown-verification.test.ts (A3):
  // uma perda de $80 em testnet, seguida de troca para mainnet, disparava
  // um pânico de "75% de drawdown" baseado em números que não tinham
  // relação nenhuma com a atividade real em mainnet. Reseta o baseline só
  // numa transição de modo de verdade (nunca a cada chamada no mesmo modo
  // — isso apagaria o histórico de drawdown de uma sessão só por
  // stop/start do ciclo na mesma rede).
  if (modeChanged) {
    state.totalProfit = 0;
    state.totalLoss = 0;
    state.peakNetEquity = 0;
    state.consecutiveLosses = 0;
    await cbCounterOp("set", { consecutiveLosses: 0, totalLoss: 0, totalProfit: 0 });
  }
  if (isTestnet) {
    state.maxLossesBeforePanic = 20;
    // Espelha mainnet. O gate de drawdown continua desativado em testnet;
    // manter o mesmo número evita exibir um limite menor que o backstop real.
    state.maxDrawdownPercent = 60;
    console.log(`🧪 Modo testnet: circuit breaker relaxado (max ${state.maxLossesBeforePanic} perdas, ${state.maxDrawdownPercent}% drawdown)`);
  } else {
    state.maxLossesBeforePanic = 5;
    state.maxDrawdownPercent = 60;
  }
  await saveCircuitBreakerState(state);
}

// RI-BANK-11 Trilha A (achado A4b): recordTradeResult() lê e escreve o
// `state` de módulo em vários pontos separados por `await`. Comprovado por
// lib/security/ri-bank-11-trilha-a-drawdown-verification.test.ts (A4b) que
// chamadas concorrentes de verdade (cenário real: lib/pregão.ts dispara os
// listeners de onOrdem sem await — múltiplas ordens podem estar "em voo" ao
// mesmo tempo, confirmado também na verificação ao vivo do RI-BANK-8
// Estágio 5) podem fazer o reset de `consecutiveLosses` de um evento de
// lucro sobrescrever o incremento de uma perda concorrente — reproduzido
// em 30/30 tentativas antes deste fix. A fila abaixo serializa as chamadas
// DENTRO deste processo (o mesmo módulo `state` só existe aqui) — não
// resolve nem precisa resolver concorrência ENTRE processos/instâncias
// diferentes, porque essa camada já é coberta pelos incrementos atômicos
// do Redis (HINCRBY/HINCRBYFLOAT em cbCounterOp) para os 3 campos delta;
// o que faltava proteger era a leitura+escrita do espelho em memória deste
// processo entre um await e outro.
let recordTradeResultQueue: Promise<unknown> = Promise.resolve();

export function recordTradeResult(profit: number): Promise<CircuitBreakerState> {
  const run = () => recordTradeResultSerialized(profit);
  const result = recordTradeResultQueue.then(run, run);
  recordTradeResultQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function recordTradeResultSerialized(profit: number): Promise<CircuitBreakerState> {
  if (isNaN(profit)) return { ...state };

  // Em testnet: perdas de até $0.50 são ignoradas (LI.FI reverts, fees simuladas)
  if (state.isTestnet && profit < 0 && Math.abs(profit) <= 0.50) {
    console.log(`🧪 Testnet: perda $${Math.abs(profit).toFixed(4)} ignorada`);
    return { ...state };
  }

  if (profit < 0) {
    const result = await cbCounterOp("incr", { consecutiveLosses: 1, totalLoss: Math.abs(profit) });
    state.consecutiveLosses = result?.consecutiveLosses ?? (state.consecutiveLosses + 1);
    state.totalLoss = result?.totalLoss ?? (state.totalLoss + Math.abs(profit));
    console.log(`📉 Perda: $${Math.abs(profit).toFixed(4)} | Consecutivas: ${state.consecutiveLosses} | Total perda: $${state.totalLoss.toFixed(4)}`);
  } else {
    const result = await cbCounterOp("incr", { totalProfit: profit });
    state.totalProfit = result?.totalProfit ?? (state.totalProfit + profit);
    if (state.consecutiveLosses !== 0) {
      await cbCounterOp("set", { consecutiveLosses: 0 });
      state.consecutiveLosses = 0;
    }
    console.log(`📈 Lucro: $${profit.toFixed(4)} | Total lucro: $${state.totalProfit.toFixed(4)}`);
  }

  // Verifica perdas consecutivas
  if (state.consecutiveLosses >= state.maxLossesBeforePanic && !state.isPanicActive) {
    await activatePanic(`${state.consecutiveLosses} perdas consecutivas`);
    return { ...state };
  }

  // Drawdown baseado no pico de patrimônio líquido (só em mainnet)
  if (!state.isTestnet) {
    const netEquity = state.totalProfit - state.totalLoss;
    if (netEquity > state.peakNetEquity) {
      state.peakNetEquity = netEquity;
    }
    if (state.peakNetEquity > 0) {
      const drawdown = ((state.peakNetEquity - netEquity) / state.peakNetEquity) * 100;
      if (drawdown >= state.maxDrawdownPercent && !state.isPanicActive) {
        await activatePanic(`Drawdown de ${drawdown.toFixed(1)}% (limite: ${state.maxDrawdownPercent}%)`);
        return { ...state };
      }
    }
  }

  await saveCircuitBreakerState(state);
  return { ...state };
}

export async function recordError(agentName: string, errorType: string): Promise<CircuitBreakerState> {
  const result = await cbCounterOp("incr", { consecutiveLosses: 1 });
  state.consecutiveLosses = result?.consecutiveLosses ?? (state.consecutiveLosses + 1);
  console.log(`⚠️ Erro registrado para ${agentName}: ${errorType}`);
  console.log(`📊 Erros consecutivos: ${state.consecutiveLosses}`);
  if (state.consecutiveLosses >= state.maxLossesBeforePanic && !state.isPanicActive) {
    await activatePanic(`Erros consecutivos: ${state.consecutiveLosses} erros`);
  }
  return { ...state };
}

export async function recordRouteError(routeName: string): Promise<void> {
  if (!state.routeHealth[routeName]) {
    state.routeHealth[routeName] = { consecutiveErrors: 0, cooldownUntil: null };
  }
  const health = state.routeHealth[routeName];
  health.consecutiveErrors++;
  console.warn(`🗺️ Rota ${routeName}: erro #${health.consecutiveErrors}`);

  if (health.consecutiveErrors >= MAX_ROUTE_ERRORS_BEFORE_COOLDOWN && !health.cooldownUntil) {
    health.cooldownUntil = Date.now() + COOLDOWN_DURATION_MS;
    console.warn(`🔇 Rota ${routeName} em cooldown até ${new Date(health.cooldownUntil).toLocaleTimeString()}`);
  }
  await saveCircuitBreakerState(state);
}

export async function onRouteSuccess(routeName: string): Promise<void> {
  if (!state.routeHealth[routeName]) return;
  state.routeHealth[routeName] = { consecutiveErrors: 0, cooldownUntil: null };
  await saveCircuitBreakerState(state);
}

// Continua síncrona (leitura rápida em memória, chamada em hot path antes
// de decidir uma rota) — só dispara a persistência (limpar o cooldown
// expirado) em background, com erro sempre logado, nunca engolido.
export function isRouteDisabled(routeName: string): boolean {
  const health = state.routeHealth[routeName];
  if (!health || !health.cooldownUntil) return false;
  if (Date.now() >= health.cooldownUntil) {
    // Cooldown expirou — limpa e libera
    health.consecutiveErrors = 0;
    health.cooldownUntil = null;
    saveCircuitBreakerState(state).catch((e) => console.error("[circuit-breaker] isRouteDisabled persist failed:", e));
    console.log(`✅ Rota ${routeName} liberada do cooldown`);
    return false;
  }
  return true;
}

export function blockIfPanicked(): boolean {
  if (state.isPanicActive) {
    console.warn(`🚨 Circuit breaker bloqueou trade. Pânico ativo desde ${state.panicTimestamp} — motivo: ${state.panicReason}`);
    return true;
  }
  return false;
}

export async function activatePanic(reason: string): Promise<void> {
  state.isPanicActive = true;
  state.panicReason = reason;
  state.panicTimestamp = new Date().toISOString();
  state.consecutiveLosses = 0;
  await cbCounterOp("set", { consecutiveLosses: 0 });
  await saveCircuitBreakerState(state);
  console.error('🚨 MODO PÂNICO ATIVADO! 🚨 Motivo: ' + reason);
}

export async function resumeFromPanic(): Promise<void> {
  if (!state.isPanicActive) return;
  const wasTestnet = state.isTestnet;
  state = { ...initialState };
  await cbCounterOp("set", { consecutiveLosses: 0, totalLoss: 0, totalProfit: 0 });
  if (wasTestnet) {
    await setTestnetMode(true);
  } else {
    await saveCircuitBreakerState(state);
  }
  console.log('✅ Sistema retomado do modo pânico');
}

export async function resetCircuitBreaker(): Promise<void> {
  const wasTestnet = state.isTestnet;
  state = { ...initialState };
  await cbCounterOp("set", { consecutiveLosses: 0, totalLoss: 0, totalProfit: 0 });
  if (wasTestnet) {
    await setTestnetMode(true);
  } else {
    await saveCircuitBreakerState(state);
  }
  console.log('🔄 Circuit breaker resetado');
}
