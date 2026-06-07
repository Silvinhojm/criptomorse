// lib/learning-trader.ts - VERSÃO CORRIGIDA E INTEGRADA
// APRENDIZADO CONTÍNUO BASEADO EM SIMULAÇÕES

import { agentMemory } from './agent-memory';
import { quantumOracle } from './quantum-oracle';
import { volumeAgent } from './volume-agent';
import { marketAgent } from './market-agent';

export interface SimulatedTrade {
  id: string;
  pair: string;
  type: 'buy' | 'sell';
  entryPrice: number;
  entrySpread: number;
  amount: number;
  simulatedAt: number;
  predictedOutcome: 'up' | 'down' | 'stable';
  confidence: number;
  actualOutcome?: 'up' | 'down' | 'stable';
  actualProfit?: number;
  learned: boolean;
  agentContributions?: Record<string, { action: string; confidence: number }>;
}

export interface LearningStats {
  totalSimulations: number;
  successfulPredictions: number;
  accuracy: number;
  avgProfitWhenRight: number;
  avgLossWhenWrong: number;
  bestTimeframe: string;
  worstTimeframe: string;
}

export interface ExecutionDecision {
  execute: boolean;
  reason: string;
  adjustedConfidence: number;
  suggestedSize?: number;
}

class LearningTrader {
  private simulations: SimulatedTrade[] = [];
  private accuracyHistory: number[] = [];
  private profitHistory: number[] = [];
  private readonly LEARNING_WINDOW = 5 * 60 * 1000; // 5 minutos
  private readonly PROFIT_THRESHOLD = 0.05; // $0.05 para executar real
  private readonly MIN_SIMULATIONS_TO_LEARN = 10;
  
  /**
   * 1. CRIAR SIMULAÇÃO PREDITIVA (com contribuições dos agentes)
   */
  createSimulation(
    pair: string,
    type: 'buy' | 'sell',
    currentPrice: number,
    currentSpread: number,
    amount: number,
    confidence: number,
    agentContributions?: Record<string, { action: string; confidence: number }>
  ): SimulatedTrade {
    // Usar aprendizado prévio para melhorar previsão
    const prediction = this.predictOutcome(currentSpread, confidence, type);
    
    const simulation: SimulatedTrade = {
      id: `sim_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      pair,
      type,
      entryPrice: currentPrice,
      entrySpread: currentSpread,
      amount,
      simulatedAt: Date.now(),
      predictedOutcome: prediction,
      confidence,
      learned: false,
      agentContributions
    };
    
    this.simulations.unshift(simulation);
    
    // Limitar tamanho do histórico
    if (this.simulations.length > 200) {
      this.simulations = this.simulations.slice(0, 200);
    }
    
    console.log(`🧪 [SIMULAÇÃO] ${pair} | ${type.toUpperCase()} | Previsão: ${prediction} | Confiança: ${confidence}% | Amount: $${amount}`);
    
    return simulation;
  }
  
  /**
   * 2. PREVER RESULTADO BASEADO EM DADOS HISTÓRICOS E APRENDIZADO
   */
  private predictOutcome(spread: number, confidence: number, type: 'buy' | 'sell'): 'up' | 'down' | 'stable' {
    // Obter taxa de acerto recente
    const recentAccuracy = this.getRecentAccuracy();
    const recentProfitAvg = this.getRecentProfitAvg();
    
    // Probabilidades base
    let upProb = 33, downProb = 33, stableProb = 34;
    
    // AJUSTE 1: Baseado no spread
    if (spread > 0.6) {
      downProb += 20;
      stableProb -= 10;
    } else if (spread > 0.4) {
      upProb += 15;
      stableProb += 5;
    } else if (spread > 0.2) {
      upProb += 10;
      stableProb += 10;
    } else {
      downProb += 10;
      stableProb += 5;
    }
    
    // AJUSTE 2: Baseado na confiança
    if (confidence > 75) {
      upProb += 10;
      downProb += 10;
    } else if (confidence < 45) {
      stableProb += 15;
    }
    
    // AJUSTE 3: Baseado no tipo de trade
    if (type === 'buy') {
      upProb += 5;
    } else {
      downProb += 5;
    }
    
    // AJUSTE 4: Baseado no aprendizado anterior (se houver dados suficientes)
    if (this.simulations.length >= this.MIN_SIMULATIONS_TO_LEARN) {
      const lastSuccessfulPattern = this.getLastSuccessfulPattern();
      if (lastSuccessfulPattern === 'up') upProb += 10;
      if (lastSuccessfulPattern === 'down') downProb += 10;
      
      // Ajustar pela acurácia recente
      if (recentAccuracy > 65) {
        const lastPrediction = this.getLastPrediction();
        if (lastPrediction === 'up') upProb += 15;
        if (lastPrediction === 'down') downProb += 15;
      }
    }
    
    // Normalizar (garantir que não fiquem negativos)
    upProb = Math.max(5, upProb);
    downProb = Math.max(5, downProb);
    stableProb = Math.max(5, stableProb);
    
    // Decisão final com peso do aprendizado
    const total = upProb + downProb + stableProb;
    const rand = Math.random() * total;
    
    let prediction: 'up' | 'down' | 'stable' = 'stable';
    if (rand < upProb) prediction = 'up';
    else if (rand < upProb + downProb) prediction = 'down';
    
    return prediction;
  }
  
  /**
   * 3. VALIDAR SIMULAÇÃO (após período de aprendizado)
   */
  validateSimulation(simulationId: string, currentPrice: number): { 
    profitable: boolean; 
    profit: number; 
    accuracyImprovement: number;
    wasCorrect: boolean;
  } {
    const sim = this.simulations.find(s => s.id === simulationId);
    if (!sim || sim.learned) {
      return { profitable: false, profit: 0, accuracyImprovement: 0, wasCorrect: false };
    }
    
    // Verificar se já passou tempo suficiente
    const elapsed = Date.now() - sim.simulatedAt;
    if (elapsed < this.LEARNING_WINDOW) {
      return { profitable: false, profit: 0, accuracyImprovement: 0, wasCorrect: false };
    }
    
    // Calcular resultado real
    let actualOutcome: 'up' | 'down' | 'stable';
    let profit = 0;
    
    const priceChangePercent = ((currentPrice - sim.entryPrice) / sim.entryPrice) * 100;
    const priceChangeAbs = currentPrice - sim.entryPrice;
    
    if (priceChangePercent > 0.1) actualOutcome = 'up';
    else if (priceChangePercent < -0.1) actualOutcome = 'down';
    else actualOutcome = 'stable';
    
    // Calcular lucro/perda da simulação
    if (sim.type === 'buy') {
      profit = priceChangeAbs * sim.amount;
    } else {
      profit = -priceChangeAbs * sim.amount;
    }
    
    const profitable = profit > 0;
    const wasCorrect = sim.predictedOutcome === actualOutcome;
    
    // Atualizar simulação
    sim.actualOutcome = actualOutcome;
    sim.actualProfit = profit;
    sim.learned = true;
    
    // Atualizar histórico de acertos
    this.accuracyHistory.push(wasCorrect ? 1 : 0);
    this.profitHistory.push(profit);
    
    // Manter apenas últimos 200 registros
    if (this.accuracyHistory.length > 200) this.accuracyHistory.shift();
    if (this.profitHistory.length > 200) this.profitHistory.shift();
    
    // CORREÇÃO: Registrar na memória persistente dos agentes (verificando se método existe)
    if (sim.agentContributions) {
      for (const [agentName, contribution] of Object.entries(sim.agentContributions)) {
        try {
          // Verificar se o método updateScore existe
          if (agentMemory && typeof (agentMemory as any).updateScore === 'function') {
            (agentMemory as any).updateScore(agentName, wasCorrect, profit);
          } else if (agentMemory && typeof (agentMemory as any).recordTrade === 'function') {
            (agentMemory as any).recordTrade(agentName, wasCorrect, profit);
          } else {
            // Método alternativo: apenas log
            console.log(`📝 [MEMÓRIA] ${agentName} | Acertou: ${wasCorrect} | Lucro: $${profit.toFixed(4)}`);
          }
        } catch (e) {
          console.warn(`⚠️ Erro ao atualizar memória do agente ${agentName}:`, e);
        }
      }
    }
    
    console.log(`📊 [VALIDAÇÃO] ${sim.pair} | Previsto: ${sim.predictedOutcome} | Real: ${actualOutcome} | Lucro: $${profit.toFixed(4)} | Acertou: ${wasCorrect ? '✅' : '❌'}`);
    
    return {
      profitable,
      profit,
      accuracyImprovement: wasCorrect ? 1 : 0,
      wasCorrect
    };
  }
  
  /**
   * 4. DECIDIR SE EXECUTA ORDEM REAL BASEADO NA SIMULAÇÃO
   */
  shouldExecuteReal(simulationId: string, marketContext?: any): ExecutionDecision {
    const sim = this.simulations.find(s => s.id === simulationId);
    if (!sim) {
      return { execute: false, reason: 'Simulação não encontrada', adjustedConfidence: 0 };
    }
    
    // Se ainda não foi validada, não executa
    if (!sim.learned) {
      return { execute: false, reason: 'Simulação ainda não validada (aguardando 5min)', adjustedConfidence: sim.confidence };
    }
    
    const accuracy = this.getRecentAccuracy();
    const wasProfitable = sim.actualProfit && sim.actualProfit > this.PROFIT_THRESHOLD;
    const avgProfitRecent = this.getRecentProfitAvg();
    
    // Critérios para execução:
    // 1. Simulação foi lucrativa (> $0.05)
    // 2. Taxa de acerto recente > 55%
    // 3. Confiança original > 60%
    // 4. Média de lucro recente > 0
    
    let execute = false;
    let reason = '';
    let adjustedConfidence = sim.confidence;
    
    if (wasProfitable && accuracy > 55 && sim.confidence > 60 && avgProfitRecent > 0) {
      execute = true;
      const boost = Math.min(0.3, accuracy / 100);
      adjustedConfidence = Math.min(95, sim.confidence * (1 + boost));
      reason = `✅ Simulação lucrativa ($${sim.actualProfit?.toFixed(4)}) + Acerto ${accuracy.toFixed(0)}% + Lucro médio $${avgProfitRecent.toFixed(4)}`;
    } 
    else if (wasProfitable && accuracy > 50) {
      execute = true;
      adjustedConfidence = Math.min(85, sim.confidence * 1.1);
      reason = `⚠️ Simulação lucrativa, mas acerto moderado (${accuracy.toFixed(0)}%)`;
    }
    else {
      const reasons = [];
      if (!wasProfitable) reasons.push(`simulação não lucrativa ($${sim.actualProfit?.toFixed(4)})`);
      if (accuracy <= 55) reasons.push(`acerto baixo (${accuracy.toFixed(0)}%)`);
      if (sim.confidence <= 60) reasons.push(`confiança baixa (${sim.confidence}%)`);
      if (avgProfitRecent <= 0) reasons.push(`média de lucro negativa`);
      reason = `❌ ${reasons.join(', ')}`;
    }
    
    return {
      execute,
      reason,
      adjustedConfidence: Math.round(adjustedConfidence),
      suggestedSize: execute ? this.calculateSuggestedSize(adjustedConfidence, sim.amount) : undefined
    };
  }
  
  private calculateSuggestedSize(confidence: number, originalAmount: number): number {
    // Ajusta tamanho baseado na confiança (entre 5 e 25)
    const minSize = 5;
    const maxSize = 25;
    const confidenceFactor = (confidence - 50) / 50; // 0-1
    let newSize = minSize + (maxSize - minSize) * confidenceFactor;
    newSize = Math.min(maxSize, Math.max(minSize, Math.round(newSize)));
    return newSize;
  }
  
  /**
   * 5. OBTER TAXA DE ACERTO RECENTE
   */
  getRecentAccuracy(windowSize: number = 20): number {
    if (this.accuracyHistory.length === 0) return 50;
    const recent = this.accuracyHistory.slice(-windowSize);
    const successes = recent.filter(a => a === 1).length;
    return (successes / recent.length) * 100;
  }
  
  /**
   * 6. OBTER MÉDIA DE LUCRO RECENTE
   */
  getRecentProfitAvg(windowSize: number = 20): number {
    if (this.profitHistory.length === 0) return 0;
    const recent = this.profitHistory.slice(-windowSize);
    const sum = recent.reduce((a, b) => a + b, 0);
    return sum / recent.length;
  }
  
  /**
   * 7. OBTER ESTATÍSTICAS DE APRENDIZADO
   */
  getLearningStats(): LearningStats {
    const validSimulations = this.simulations.filter(s => s.learned);
    const successfulPredictions = validSimulations.filter(s => s.predictedOutcome === s.actualOutcome).length;
    const profitableSimulations = validSimulations.filter(s => s.actualProfit && s.actualProfit > 0);
    const losingSimulations = validSimulations.filter(s => s.actualProfit && s.actualProfit <= 0);
    
    const avgProfitWhenRight = profitableSimulations.reduce((sum, s) => sum + (s.actualProfit || 0), 0) / (profitableSimulations.length || 1);
    const avgLossWhenWrong = losingSimulations.reduce((sum, s) => sum + (s.actualProfit || 0), 0) / (losingSimulations.length || 1);
    
    // Análise por horário (melhor/pior período)
    const hourStats: Record<number, { wins: number; total: number }> = {};
    for (const sim of validSimulations) {
      const hour = new Date(sim.simulatedAt).getHours();
      if (!hourStats[hour]) hourStats[hour] = { wins: 0, total: 0 };
      hourStats[hour].total++;
      if (sim.predictedOutcome === sim.actualOutcome) hourStats[hour].wins++;
    }
    
    let bestHour = 0, bestRate = 0;
    let worstHour = 0, worstRate = 100;
    for (const [hour, stats] of Object.entries(hourStats)) {
      const rate = (stats.wins / stats.total) * 100;
      if (rate > bestRate) { bestRate = rate; bestHour = parseInt(hour); }
      if (rate < worstRate) { worstRate = rate; worstHour = parseInt(hour); }
    }
    
    return {
      totalSimulations: validSimulations.length,
      successfulPredictions,
      accuracy: validSimulations.length > 0 ? (successfulPredictions / validSimulations.length) * 100 : 0,
      avgProfitWhenRight,
      avgLossWhenWrong: Math.abs(avgLossWhenWrong),
      bestTimeframe: `${bestHour}:00 (${bestRate.toFixed(0)}% acerto)`,
      worstTimeframe: `${worstHour}:00 (${worstRate.toFixed(0)}% acerto)`
    };
  }
  
  /**
   * 8. OBTER ÚLTIMA PREDIÇÃO BEM-SUCEDIDA
   */
  private getLastSuccessfulPattern(): 'up' | 'down' | 'stable' | null {
    const successful = this.simulations
      .filter(s => s.learned && s.predictedOutcome === s.actualOutcome && (s.actualProfit || 0) > 0)
      .slice(-1)[0];
    return successful?.predictedOutcome || null;
  }
  
  /**
   * 9. OBTER ÚLTIMA PREDIÇÃO
   */
  private getLastPrediction(): 'up' | 'down' | 'stable' {
    const last = this.simulations.filter(s => s.learned).slice(-1)[0];
    return last?.predictedOutcome || 'stable';
  }
  
  /**
   * 10. OBTER SIMULAÇÕES NÃO APRENDIDAS
   */
  getUnlearnedSimulations(): SimulatedTrade[] {
    return this.simulations.filter(s => !s.learned);
  }
  
  /**
   * 11. LIMPAR SIMULAÇÕES VELHAS
   */
  cleanupOldSimulations(maxAge: number = 30 * 60 * 1000): void {
    const now = Date.now();
    const beforeCount = this.simulations.length;
    this.simulations = this.simulations.filter(s => now - s.simulatedAt < maxAge);
    console.log(`🧹 Limpeza: ${beforeCount - this.simulations.length} simulações antigas removidas`);
  }
  
  /**
   * 12. RESETAR APRENDIZADO
   */
  reset(): void {
    this.simulations = [];
    this.accuracyHistory = [];
    this.profitHistory = [];
    console.log('🧠 Aprendizado resetado');
  }
  
  /**
   * 13. OBTER RELATÓRIO COMPLETO
   */
  getFullReport(): {
    stats: LearningStats;
    recentAccuracy: number;
    recentProfitAvg: number;
    pendingSimulations: number;
    totalSimulations: number;
  } {
    return {
      stats: this.getLearningStats(),
      recentAccuracy: this.getRecentAccuracy(),
      recentProfitAvg: this.getRecentProfitAvg(),
      pendingSimulations: this.getUnlearnedSimulations().length,
      totalSimulations: this.simulations.length
    };
  }
}

export const learningTrader = new LearningTrader();
export default learningTrader;