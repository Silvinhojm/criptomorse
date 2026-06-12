// lib/storage.ts
// Sistema de persistência de dados com IndexedDB para ArcFlow

import { openDB, IDBPDatabase } from 'idb';

export interface TradeRecord {
  id?: number;
  txHash: string;
  type: 'BUY' | 'SELL';
  amount: number;
  amountReceived: number;
  profit: number;
  timestamp: number;
  explorerUrl: string;
  blockNumber: number;
  tool: string;
}

export interface ProfitPoolRecord {
  id?: number;
  total: number;
  lastUpdated: number;
  totalTrades: number;
  totalProfit: number;
  totalLosses: number;
}

export interface AgentBalanceRecord {
  agentId: string;
  balance: number;
  lastUpdated: number;
}

const DB_NAME = 'ArcFlowDB';
const DB_VERSION = 2;

let dbInstance: IDBPDatabase | null = null;

// Inicializar banco de dados
export async function initDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;
  
  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      console.log(`📀 Atualizando banco de dados de ${oldVersion} para ${newVersion}`);
      
      // Tabela de trades
      if (!db.objectStoreNames.contains('trades')) {
        const tradeStore = db.createObjectStore('trades', { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        tradeStore.createIndex('timestamp', 'timestamp');
        tradeStore.createIndex('txHash', 'txHash', { unique: true });
        tradeStore.createIndex('type', 'type');
        console.log('✅ Tabela "trades" criada');
      }
      
      // Tabela de profit pool
      if (!db.objectStoreNames.contains('profitPool')) {
        const profitStore = db.createObjectStore('profitPool', { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        profitStore.createIndex('lastUpdated', 'lastUpdated');
        console.log('✅ Tabela "profitPool" criada');
      }
      
      // Tabela de agent balances
      if (!db.objectStoreNames.contains('agentBalances')) {
        const agentStore = db.createObjectStore('agentBalances', { 
          keyPath: 'agentId' 
        });
        agentStore.createIndex('lastUpdated', 'lastUpdated');
        console.log('✅ Tabela "agentBalances" criada');
      }
    },
  });
  
  return dbInstance;
}

// ─── TRADES ─────────────────────────────────────────────────────────────

export async function saveTrade(trade: Omit<TradeRecord, 'id'>): Promise<number> {
  const db = await initDB();
  const id = await db.add('trades', {
    ...trade,
    timestamp: trade.timestamp || Date.now(),
  });
  console.log(`💾 Trade salvo no banco: ${trade.type} $${trade.amount} | Lucro: $${trade.profit}`);
  return id as number;
}

export async function getTrades(limit = 100, offset = 0): Promise<TradeRecord[]> {
  const db = await initDB();
  const index = db.transaction('trades').store.index('timestamp');
  
  // Pegar todos os trades ordenados por timestamp decrescente
  const allTrades = await index.getAll();
  const sortedTrades = allTrades.sort((a, b) => b.timestamp - a.timestamp);
  
  return sortedTrades.slice(offset, offset + limit);
}

export async function getAllTrades(): Promise<TradeRecord[]> {
  const db = await initDB();
  const allTrades = await db.getAll('trades');
  return allTrades.sort((a, b) => b.timestamp - a.timestamp);
}

export async function getTradeStats() {
  const trades = await getAllTrades();
  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => t.profit > 0).length;
  const losingTrades = trades.filter(t => t.profit < 0).length;
  const totalProfit = trades.reduce((sum, t) => sum + t.profit, 0);
  const avgProfit = totalTrades > 0 ? totalProfit / totalTrades : 0;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  
  return {
    totalTrades,
    winningTrades,
    losingTrades,
    totalProfit,
    avgProfit,
    winRate,
  };
}

export async function clearTrades(): Promise<void> {
  const db = await initDB();
  await db.clear('trades');
  console.log('🗑️ Histórico de trades limpo');
}

// ─── PROFIT POOL ────────────────────────────────────────────────────────

export async function saveProfitPool(total: number, totalTrades: number, totalProfit: number, totalLosses: number = 0): Promise<number> {
  const db = await initDB();
  
  // Verificar se já existe um registro
  const existing = await db.getAll('profitPool');
  
  if (existing.length > 0) {
    // Atualizar o primeiro registro
    const id = existing[0].id!;
    await db.put('profitPool', {
      id,
      total,
      totalTrades,
      totalProfit,
      totalLosses,
      lastUpdated: Date.now(),
    });
    return id;
  } else {
    // Criar novo registro
    const id = await db.add('profitPool', {
      total,
      totalTrades,
      totalProfit,
      totalLosses,
      lastUpdated: Date.now(),
    });
    return id as number;
  }
}

export async function getProfitPool(): Promise<ProfitPoolRecord | null> {
  const db = await initDB();
  const all = await db.getAll('profitPool');
  return all.length > 0 ? all[0] : null;
}

export async function updateProfitPool(profitDelta: number): Promise<number> {
  const current = await getProfitPool();
  const newTotal = (current?.total || 0) + profitDelta;
  const newTotalTrades = (current?.totalTrades || 0) + 1;
  const newTotalProfit = (current?.totalProfit || 0) + (profitDelta > 0 ? profitDelta : 0);
  const newTotalLosses = (current?.totalLosses || 0) + (profitDelta < 0 ? Math.abs(profitDelta) : 0);
  
  await saveProfitPool(newTotal, newTotalTrades, newTotalProfit, newTotalLosses);
  return newTotal;
}

// ─── AGENT BALANCES ─────────────────────────────────────────────────────

export async function saveAgentBalance(agentId: string, balance: number): Promise<void> {
  const db = await initDB();
  await db.put('agentBalances', {
    agentId,
    balance,
    lastUpdated: Date.now(),
  });
}

export async function getAgentBalance(agentId: string): Promise<number | null> {
  const db = await initDB();
  const record = await db.get('agentBalances', agentId);
  return record?.balance || null;
}

export async function getAllAgentBalances(): Promise<AgentBalanceRecord[]> {
  const db = await initDB();
  return await db.getAll('agentBalances');
}

export async function updateAgentBalance(agentId: string, delta: number): Promise<number> {
  const current = await getAgentBalance(agentId) || 100;
  const newBalance = current + delta;
  await saveAgentBalance(agentId, newBalance);
  return newBalance;
}

// ─── UTILITÁRIOS ────────────────────────────────────────────────────────

export async function exportData(): Promise<string> {
  const trades = await getAllTrades();
  const profitPool = await getProfitPool();
  const agents = await getAllAgentBalances();
  
  const exportData = {
    trades,
    profitPool,
    agents,
    exportDate: new Date().toISOString(),
  };
  
  return JSON.stringify(exportData, null, 2);
}

export async function importData(jsonData: string): Promise<boolean> {
  try {
    const data = JSON.parse(jsonData);
    const db = await initDB();
    
    // Limpar dados existentes
    await db.clear('trades');
    await db.clear('profitPool');
    await db.clear('agentBalances');
    
    // Importar trades
    if (data.trades && Array.isArray(data.trades)) {
      for (const trade of data.trades) {
        await db.add('trades', trade);
      }
    }
    
    // Importar profit pool
    if (data.profitPool) {
      await db.add('profitPool', data.profitPool);
    }
    
    // Importar agentes
    if (data.agents && Array.isArray(data.agents)) {
      for (const agent of data.agents) {
        await db.put('agentBalances', agent);
      }
    }
    
    console.log('✅ Dados importados com sucesso!');
    return true;
  } catch (error) {
    console.error('❌ Erro ao importar dados:', error);
    return false;
  }
}

export async function getDatabaseInfo() {
  const trades = await getAllTrades();
  const profitPool = await getProfitPool();
  
  return {
    totalTrades: trades.length,
    totalProfit: profitPool?.totalProfit || 0,
    profitPoolTotal: profitPool?.total || 0,
    lastUpdated: profitPool?.lastUpdated || null,
    dbName: DB_NAME,
    dbVersion: DB_VERSION,
  };
}

export default {
  initDB,
  saveTrade,
  getTrades,
  getAllTrades,
  clearTrades,
  saveProfitPool,
  getProfitPool,
  updateProfitPool,
  saveAgentBalance,
  getAgentBalance,
  getAllAgentBalances,
  updateAgentBalance,
  exportData,
  importData,
  getDatabaseInfo,
};
