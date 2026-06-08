// lib/circuit-breaker.ts
// 🛡️ Sistema de Segurança - Circuit Breaker para Agentes

export interface CircuitBreakerState {
  isPanicActive: boolean;
  panicReason: string | null;
  panicTimestamp: number | null;
  consecutiveLosses: number;
  maxLossesBeforePanic: number;
  frozenAgents: string[];
}

class CircuitBreaker {
  private state: CircuitBreakerState = {
    isPanicActive: false,
    panicReason: null,
    panicTimestamp: null,
    consecutiveLosses: 0,
    maxLossesBeforePanic: 5,
    frozenAgents: []
  };

  // 🚨 Ativar pânico manualmente (requer chave de admin)
  activatePanic(reason: string, adminKey?: string): { success: boolean; message: string } {
    // Verificar chave de administrador
    const validAdminKey = process.env.ADMIN_PANIC_KEY || 'arcflow-master-key-2024';
    
    if (adminKey && adminKey !== validAdminKey) {
      return { success: false, message: '🔒 Unauthorized: Invalid admin key' };
    }
    
    if (!adminKey) {
      return { success: false, message: '🔒 Admin key required to activate panic mode' };
    }
    
    this.state = {
      ...this.state,
      isPanicActive: true,
      panicReason: reason,
      panicTimestamp: Date.now(),
      frozenAgents: ['all']
    };
    
    console.log(`🔴 PANIC MODE ACTIVATED: ${reason}`);
    return { success: true, message: `🔴 Panic mode activated: ${reason}` };
  }

  // ✅ Desativar pânico (requer chave de admin)
  deactivatePanic(adminKey?: string): { success: boolean; message: string } {
    // Verificar chave de administrador
    const validAdminKey = process.env.ADMIN_PANIC_KEY || 'arcflow-master-key-2024';
    
    if (adminKey && adminKey !== validAdminKey) {
      return { success: false, message: '🔒 Unauthorized: Invalid admin key' };
    }
    
    if (!adminKey) {
      return { success: false, message: '🔒 Admin key required to deactivate panic mode' };
    }
    
    this.state = {
      ...this.state,
      isPanicActive: false,
      panicReason: null,
      panicTimestamp: null,
      consecutiveLosses: 0,
      frozenAgents: []
    };
    
    console.log('🟢 Panic mode deactivated');
    return { success: true, message: '🟢 Panic mode deactivated' };
  }

  // 📊 Reportar resultado de trade (detecção automática)
  reportTradeResult(agentId: string, profit: number): void {
    if (profit < 0) {
      this.state.consecutiveLosses++;
      console.log(`⚠️ Agent ${agentId} loss #${this.state.consecutiveLosses}`);
      
      if (this.state.consecutiveLosses >= this.state.maxLossesBeforePanic) {
        // Ativa pânico automaticamente (não precisa de chave)
        this.state = {
          ...this.state,
          isPanicActive: true,
          panicReason: `Auto-panic: ${this.state.consecutiveLosses} consecutive losses from ${agentId}`,
          panicTimestamp: Date.now(),
          frozenAgents: ['all']
        };
        console.log(`🔴 AUTO-PANIC ACTIVATED: ${this.state.consecutiveLosses} consecutive losses`);
      }
    } else {
      // Reset em caso de lucro
      if (this.state.consecutiveLosses > 0) {
        console.log(`✅ Agent ${agentId} profit - resetting loss counter`);
        this.state.consecutiveLosses = 0;
      }
    }
  }

  // 🔍 Verificar se um agente pode executar
  canAgentExecute(agentId: string): boolean {
    if (this.state.isPanicActive) {
      console.log(`🔴 Panic mode active - Agent ${agentId} frozen`);
      return false;
    }
    
    if (this.state.frozenAgents.includes(agentId) || this.state.frozenAgents.includes('all')) {
      console.log(`🧊 Agent ${agentId} is frozen`);
      return false;
    }
    
    return true;
  }

  // 📋 Obter estado atual
  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  // 🧊 Congelar agente específico (requer chave)
  freezeAgent(agentId: string, adminKey?: string): { success: boolean; message: string } {
    const validAdminKey = process.env.ADMIN_PANIC_KEY || 'arcflow-master-key-2024';
    
    if (adminKey !== validAdminKey) {
      return { success: false, message: '🔒 Admin key required' };
    }
    
    if (!this.state.frozenAgents.includes(agentId)) {
      this.state.frozenAgents.push(agentId);
      console.log(`🧊 Agent ${agentId} frozen by admin`);
      return { success: true, message: `Agent ${agentId} frozen` };
    }
    
    return { success: false, message: `Agent ${agentId} already frozen` };
  }

  // 🔓 Descongelar agente específico (requer chave)
  unfreezeAgent(agentId: string, adminKey?: string): { success: boolean; message: string } {
    const validAdminKey = process.env.ADMIN_PANIC_KEY || 'arcflow-master-key-2024';
    
    if (adminKey !== validAdminKey) {
      return { success: false, message: '🔒 Admin key required' };
    }
    
    this.state.frozenAgents = this.state.frozenAgents.filter(id => id !== agentId);
    console.log(`🔓 Agent ${agentId} unfrozen by admin`);
    return { success: true, message: `Agent ${agentId} unfrozen` };
  }

  // 🔑 Validar chave de admin
  validateAdminKey(key: string): boolean {
    const validAdminKey = process.env.ADMIN_PANIC_KEY || 'arcflow-master-key-2024';
    return key === validAdminKey;
  }
}

export const circuitBreaker = new CircuitBreaker();