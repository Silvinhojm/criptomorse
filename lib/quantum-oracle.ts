// lib/quantum-oracle.ts - VERSÃO CORRIGIDA
// ORÁCULO QUÂNTICO PARA DECISÕES DE TRADING

import { agentMemory } from './agent-memory';

export interface QuantumState {
  spread: number;
  volatility: number;
  momentum: number;
  liquidity: number;
  hourConfidence: number;
  dayConfidence: number;
  trendStrength: number;
  marketPhase: 'accumulation' | 'markup' | 'distribution' | 'markdown';
}

export interface TradeDecision {
  shouldTrade: boolean;
  confidence: number;
  suggestedSize: number;
  reason: string;
  quantumScore: number;
  probabilities: {
    up: number;
    down: number;
    stable: number;
  };
  bestAction: 'buy' | 'sell' | 'wait';
}

export interface ActivePosition {
  id: string;
  type: 'buy' | 'sell';
  entrySpread: number;
  entryPrice: number;
  amount: number;
  currentProfit: number;
  maxProfit: number;
  openedAt: number;
  lastUpdated: number;
  confidence: number;
  status: 'open' | 'closing' | 'closed';
}

// Configurações do Oráculo
const ORACLE_CONFIG = {
  CONFIDENCE_THRESHOLD: 65,
  QUANTUM_ENTANGLEMENT_FACTOR: 0.7,
  STOP_LOSS: -0.50,
  TRAILING_STOP: 0.03,
  MAX_HOLD_TIME: 300000,
  DEFAULT_POSITION_SIZE: 8,
  MAX_POSITION_SIZE: 25,
};

class QuantumOracle {
  private history: QuantumState[] = [];
  private lastAnalysis: TradeDecision | null = null;
  private readonly CONFIDENCE_THRESHOLD = ORACLE_CONFIG.CONFIDENCE_THRESHOLD;
  private readonly QUANTUM_ENTANGLEMENT_FACTOR = ORACLE_CONFIG.QUANTUM_ENTANGLEMENT_FACTOR;
  
  analyzeQuantumState(currentSpread: number, historicalSpreads?: number[]): QuantumState {
    let volatility = 0.5;
    if (historicalSpreads && historicalSpreads.length > 5) {
      const mean = historicalSpreads.reduce((a, b) => a + b, 0) / historicalSpreads.length;
      const variance = historicalSpreads.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / historicalSpreads.length;
      volatility = Math.min(1.0, Math.sqrt(variance) * 10);
    }
    
    let momentum = 0;
    if (historicalSpreads && historicalSpreads.length > 3) {
      const recent = historicalSpreads.slice(-3);
      const older = historicalSpreads.slice(-6, -3);
      if (older.length > 0) {
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
        momentum = recentAvg - olderAvg;
      }
    }
    
    let marketPhase: 'accumulation' | 'markup' | 'distribution' | 'markdown' = 'accumulation';
    if (currentSpread < 0.2) marketPhase = 'markup';
    else if (currentSpread < 0.35) marketPhase = 'distribution';
    else if (currentSpread < 0.6) marketPhase = 'markdown';
    else marketPhase = 'accumulation';
    
    return {
      spread: currentSpread,
      volatility: Math.max(0.1, Math.min(1.0, volatility)),
      momentum: Math.max(-0.5, Math.min(0.5, momentum)),
      liquidity: 50 + (1 - currentSpread) * 40,
      hourConfidence: this.getHourConfidence(),
      dayConfidence: this.getDayConfidence(),
      trendStrength: 0.3 + Math.abs(momentum) * 2,
      marketPhase
    };
  }
  
  calculateProbabilities(state: QuantumState): { up: number; down: number; stable: number } {
    let upProb = 25, downProb = 25, stableProb = 50;
    
    if (state.spread > 0.6) {
      downProb += 25;
      stableProb += 5;
      upProb -= 10;
    } 
    else if (state.spread > 0.4) {
      upProb += 20;
      stableProb += 10;
      downProb -= 10;
    } 
    else if (state.spread > 0.2) {
      stableProb += 15;
      upProb += 5;
      downProb -= 5;
    }
    else {
      downProb += 15;
      stableProb += 5;
      upProb -= 10;
    }
    
    if (state.volatility > 0.7) {
      upProb += 10;
      downProb += 10;
      stableProb -= 20;
    }
    
    if (state.momentum > 0.05) upProb += 15;
    else if (state.momentum < -0.05) downProb += 15;
    
    const timeFactor = (state.hourConfidence + state.dayConfidence) / 200;
    upProb *= (0.8 + timeFactor);
    downProb *= (0.8 + timeFactor);
    
    const total = upProb + downProb + stableProb;
    return {
      up: Math.min(95, Math.max(5, (upProb / total) * 100)),
      down: Math.min(95, Math.max(5, (downProb / total) * 100)),
      stable: Math.min(95, Math.max(5, (stableProb / total) * 100))
    };
  }
  
  decideTrade(currentSpread: number, historicalSpreads?: number[]): TradeDecision {
    const state = this.analyzeQuantumState(currentSpread, historicalSpreads);
    const probabilities = this.calculateProbabilities(state);
    
    this.history.push(state);
    if (this.history.length > 100) this.history.shift();
    
    let confidence = 50;
    let bestAction: 'buy' | 'sell' | 'wait' = 'wait';
    let reason = '';
    
    if (probabilities.down > 55 && currentSpread > 0.4) {
      confidence = probabilities.down;
      bestAction = 'sell';
      reason = `Oráculo Quântico: ${probabilities.down.toFixed(0)}% de queda (spread=${currentSpread.toFixed(2)})`;
    } 
    else if (probabilities.up > 55 && currentSpread > 0.25) {
      confidence = probabilities.up;
      bestAction = 'buy';
      reason = `Oráculo Quântico: ${probabilities.up.toFixed(0)}% de alta (spread=${currentSpread.toFixed(2)})`;
    } 
    else if (probabilities.stable > 60) {
      bestAction = 'wait';
      confidence = probabilities.stable;
      reason = `Oráculo Quântico: ${probabilities.stable.toFixed(0)}% de estabilidade → aguardar`;
    }
    else {
      bestAction = 'wait';
      confidence = 50;
      reason = `Oráculo Quântico: Incerteza (↑${probabilities.up.toFixed(0)}% ↓${probabilities.down.toFixed(0)}% →${probabilities.stable.toFixed(0)}%)`;
    }
    
    // ============================================================
    // CORREÇÃO: getWeight com fallback seguro
    // ============================================================
    let memoryWeight = 100;
    try {
      if (agentMemory && typeof (agentMemory as any).getWeight === 'function') {
        memoryWeight = (agentMemory as any).getWeight('Agente Quântico');
      }
    } catch (e) {
      memoryWeight = 100;
    }
    
    confidence = confidence * (memoryWeight / 100);
    confidence = Math.min(95, Math.max(20, Math.round(confidence)));
    
    const suggestedSize = this.calculatePositionSize(confidence);
    
    const decision: TradeDecision = {
      shouldTrade: confidence > this.CONFIDENCE_THRESHOLD && bestAction !== 'wait',
      confidence,
      suggestedSize,
      reason,
      quantumScore: Math.round(confidence),
      probabilities,
      bestAction
    };
    
    this.lastAnalysis = decision;
    return decision;
  }
  
  private calculatePositionSize(confidence: number): number {
    const minSize = 5;
    const maxSize = ORACLE_CONFIG.MAX_POSITION_SIZE;
    const confidenceFactor = (confidence - 50) / 50;
    return Math.round(minSize + (maxSize - minSize) * Math.min(1, Math.max(0, confidenceFactor)));
  }
  
  getQuantumMomentumScore(historicalSpreads?: number[]): number {
    if (!historicalSpreads || historicalSpreads.length < 5) {
      return 50;
    }
    
    const recent = historicalSpreads.slice(-3);
    const older = historicalSpreads.slice(-6, -3);
    
    if (older.length === 0) return 50;
    
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    
    const momentum = ((recentAvg - olderAvg) / olderAvg) * 100;
    let score = 50 + momentum * 10;
    return Math.min(95, Math.max(5, Math.round(score)));
  }
  
  private getHourConfidence(): number {
    const hour = new Date().getUTCHours();
    if (hour >= 13 && hour <= 17) return 90;
    if (hour >= 8 && hour <= 12) return 70;
    if (hour >= 18 && hour <= 22) return 60;
    return 40;
  }
  
  private getDayConfidence(): number {
    const day = new Date().getUTCDay();
    if (day >= 1 && day <= 5) return 80;
    return 30;
  }
  
  async getAgentDecision(spread: number, historicalSpreads?: number[]): Promise<{
    action: 'buy' | 'sell' | 'wait';
    confidence: number;
    reasoning: string;
    positionSize?: number;
  }> {
    const decision = this.decideTrade(spread, historicalSpreads);
    
    return {
      action: decision.bestAction,
      confidence: decision.confidence,
      reasoning: decision.reason,
      positionSize: decision.suggestedSize
    };
  }
  
  getLastAnalysis(): TradeDecision | null {
    return this.lastAnalysis;
  }
  
  getHistory(): QuantumState[] {
    return [...this.history];
  }
  
  reset(): void {
    this.history = [];
    this.lastAnalysis = null;
  }
}

// ============================================================
// GERENCIADOR DE POSIÇÕES QUÂNTICO
// ============================================================
class QuantumPositionManager {
  private activePositions: Map<string, ActivePosition> = new Map();
  private closedPositions: ActivePosition[] = [];
  private readonly STOP_LOSS = ORACLE_CONFIG.STOP_LOSS;
  private readonly TRAILING_STOP = ORACLE_CONFIG.TRAILING_STOP;
  private readonly MAX_HOLD_TIME = ORACLE_CONFIG.MAX_HOLD_TIME;
  
  openPosition(
    type: 'buy' | 'sell', 
    entrySpread: number, 
    amount: number, 
    confidence: number,
    entryPrice?: number
  ): string {
    const id = `pos_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const actualPrice = entryPrice || (type === 'buy' ? 1 - (entrySpread / 100) : 1 + (entrySpread / 100));
    
    const position: ActivePosition = {
      id, 
      type, 
      entrySpread,
      entryPrice: actualPrice,
      amount, 
      currentProfit: 0, 
      maxProfit: 0,
      openedAt: Date.now(), 
      lastUpdated: Date.now(), 
      confidence, 
      status: 'open'
    };
    
    this.activePositions.set(id, position);
    console.log(`🔮 Posição aberta: ${type.toUpperCase()} $${amount} @ spread ${entrySpread.toFixed(2)}%`);
    
    return id;
  }
  
  analyzePosition(positionId: string, currentSpread: number, currentPrice: number): {
    shouldClose: boolean; 
    reason: string; 
    profitToTake: number; 
    urgency: 'low' | 'medium' | 'high';
  } {
    const position = this.activePositions.get(positionId);
    if (!position) {
      return { shouldClose: false, reason: 'Posição não encontrada', profitToTake: 0, urgency: 'low' };
    }
    
    let currentProfit = 0;
    if (position.type === 'buy') {
      currentProfit = (currentPrice - position.entryPrice) * position.amount;
    } else {
      currentProfit = (position.entryPrice - currentPrice) * position.amount;
    }
    
    if (currentProfit > position.maxProfit) position.maxProfit = currentProfit;
    position.currentProfit = currentProfit;
    position.lastUpdated = Date.now();
    
    if (currentProfit < this.STOP_LOSS) {
      return { 
        shouldClose: true, 
        reason: `🛑 Stop loss: $${Math.abs(currentProfit).toFixed(4)}`, 
        profitToTake: currentProfit, 
        urgency: 'high' 
      };
    }
    
    const holdTime = Date.now() - position.openedAt;
    if (holdTime > this.MAX_HOLD_TIME && currentProfit > 0) {
      return { 
        shouldClose: true, 
        reason: `⏰ Tempo máximo (${Math.floor(holdTime / 1000)}s): lucro $${currentProfit.toFixed(4)}`, 
        profitToTake: currentProfit, 
        urgency: 'medium' 
      };
    }
    
    if (position.maxProfit > 0.03 && currentProfit <= position.maxProfit - this.TRAILING_STOP) {
      return { 
        shouldClose: true, 
        reason: `📉 Trailing stop: lucro máximo $${position.maxProfit.toFixed(4)} → atual $${currentProfit.toFixed(4)}`, 
        profitToTake: currentProfit, 
        urgency: 'high' 
      };
    }
    
    if (currentProfit > 0.15) {
      return { 
        shouldClose: true, 
        reason: `💰 Take profit: $${currentProfit.toFixed(4)} (${(currentProfit / position.amount * 100).toFixed(1)}%)`, 
        profitToTake: currentProfit, 
        urgency: 'high' 
      };
    }
    
    return { 
      shouldClose: false, 
      reason: `📊 Segurando: $${currentProfit.toFixed(4)} (${position.type === 'buy' ? 'alta' : 'baixa'})`, 
      profitToTake: currentProfit, 
      urgency: 'low' 
    };
  }
  
  closePosition(positionId: string): { profit: number; message: string; position?: ActivePosition } {
    const position = this.activePositions.get(positionId);
    if (!position) {
      return { profit: 0, message: 'Posição não encontrada' };
    }
    
    position.status = 'closed';
    this.closedPositions.push(position);
    this.activePositions.delete(positionId);
    
    const profitPercent = (position.currentProfit / position.amount) * 100;
    const emoji = position.currentProfit >= 0 ? '✅' : '❌';
    
    return { 
      profit: position.currentProfit, 
      message: `${emoji} Posição fechada: lucro $${position.currentProfit.toFixed(4)} (${profitPercent.toFixed(1)}%)`,
      position
    };
  }
  
  getActivePosition(): ActivePosition | null {
    const active = Array.from(this.activePositions.values());
    return active.length > 0 ? active[0] : null;
  }
  
  getAllActivePositions(): ActivePosition[] {
    return Array.from(this.activePositions.values());
  }
  
  getClosedPositions(limit: number = 10): ActivePosition[] {
    return this.closedPositions.slice(-limit);
  }
  
  getStats(): { totalTrades: number; winningTrades: number; totalProfit: number; winRate: number } {
    const closed = this.closedPositions;
    const winning = closed.filter(p => p.currentProfit > 0);
    const totalProfit = closed.reduce((sum, p) => sum + p.currentProfit, 0);
    
    return {
      totalTrades: closed.length,
      winningTrades: winning.length,
      totalProfit,
      winRate: closed.length > 0 ? (winning.length / closed.length) * 100 : 0
    };
  }
  
  reset(): void {
    this.activePositions.clear();
    this.closedPositions = [];
  }
}

// Exportar instâncias
export const quantumOracle = new QuantumOracle();
export const quantumPositionManager = new QuantumPositionManager();
export default quantumOracle;