// lib/persistence.ts - Persistência de dados local

export interface PersistedData {
  agentScores: any[];
  memoryStats: any;
  tradeHistory: any[];
  totalProfit: number;
  tradeCount: number;
  grossProfit: number;
  lastUpdated: number;
}

class PersistenceManager {
  private readonly STORAGE_KEY = 'criptomorse_data';
  
  // Salvar todos os dados
  saveData(data: Partial<PersistedData>): void {
    try {
      const existing = this.loadData();
      const merged = { ...existing, ...data, lastUpdated: Date.now() };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(merged));
      console.log('💾 Dados salvos com sucesso');
    } catch (error) {
      console.error('Erro ao salvar dados:', error);
    }
  }
  
  // Carregar todos os dados
  loadData(): PersistedData {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        console.log(`📂 Dados carregados: ${data.tradeCount || 0} trades, ${data.memoryStats?.totalTrades || 0} memórias`);
        return data;
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    }
    
    // Dados padrão
    return {
      agentScores: [],
      memoryStats: null,
      tradeHistory: [],
      totalProfit: 0,
      tradeCount: 0,
      grossProfit: 0,
      lastUpdated: Date.now()
    };
  }
  
  // Salvar histórico de trade
  saveTrade(trade: any): void {
    const data = this.loadData();
    data.tradeHistory = [trade, ...(data.tradeHistory || [])].slice(0, 100); // Últimos 100 trades
    data.tradeCount = (data.tradeCount || 0) + 1;
    data.totalProfit = (data.totalProfit || 0) + (trade.profit || 0);
    data.grossProfit = (data.grossProfit || 0) + (trade.grossProfit || 0);
    this.saveData(data);
  }
  
  // Salvar scores dos agentes
  saveAgentScores(scores: any[]): void {
    const data = this.loadData();
    data.agentScores = scores;
    this.saveData(data);
  }
  
  // Salvar memória
  saveMemory(memoryStats: any): void {
    const data = this.loadData();
    data.memoryStats = memoryStats;
    this.saveData(data);
  }
  
  // Limpar todos os dados
  clearAll(): void {
    localStorage.removeItem(this.STORAGE_KEY);
    console.log('🗑️ Todos os dados foram limpos');
  }
  
  // Exportar dados para backup
  exportData(): string {
    const data = this.loadData();
    return JSON.stringify(data, null, 2);
  }
  
  // Importar dados de backup
  importData(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
      console.log('📥 Dados importados com sucesso');
      return true;
    } catch (error) {
      console.error('Erro ao importar dados:', error);
      return false;
    }
  }
  
  // Verificar se há dados salvos
  hasData(): boolean {
    return localStorage.getItem(this.STORAGE_KEY) !== null;
  }
  
  // Obter estatísticas resumidas
  getStats(): { trades: number; profit: number; lastTrade: any } {
    const data = this.loadData();
    return {
      trades: data.tradeCount || 0,
      profit: data.totalProfit || 0,
      lastTrade: data.tradeHistory?.[0] || null
    };
  }
}

export const persistence = new PersistenceManager();