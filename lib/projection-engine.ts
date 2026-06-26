export interface ProjectionPeriod {
  label: string;
  days: number;
  hours: number;
}

export interface ProjectionRow {
  period: string;
  projectedTrades: number;
  projectedProfit: number;
  projectedROI: number;
  actualTrades: number;
  actualProfit: number;
  actualROI: number;
  accuracy: number;
}

export interface ProjectionResult {
  rows: ProjectionRow[];
  totalProjectedProfit: number;
  totalActualProfit: number;
  avgProfitPerTrade: number;
  tradesPerDay: number;
  winRate: number;
  apyProjected: number;
  apyActual: number;
  firstTradeDate: string;
  hoursActive: number;
  totalVolume: number;
}

const PERIODS: ProjectionPeriod[] = [
  { label: '1 Dia', days: 1, hours: 24 },
  { label: '7 Dias', days: 7, hours: 168 },
  { label: '30 Dias', days: 30, hours: 720 },
  { label: '90 Dias', days: 90, hours: 2160 },
  { label: '1 Ano', days: 365, hours: 8760 },
];

export function calculateProjection(
  trades: { profit: number; amount: number; timestamp: number; status: string }[],
  initialCapital: number
): ProjectionResult {
  const completed = trades.filter(t => t.status === 'completed');
  if (completed.length === 0) {
    return {
      rows: PERIODS.map(p => ({
        period: p.label, projectedTrades: 0, projectedProfit: 0,
        projectedROI: 0, actualTrades: 0, actualProfit: 0, actualROI: 0, accuracy: 0,
      })),
      totalProjectedProfit: 0, totalActualProfit: 0,
      avgProfitPerTrade: 0, tradesPerDay: 0, winRate: 0,
      apyProjected: 0, apyActual: 0,
      firstTradeDate: '-', hoursActive: 0, totalVolume: 0,
    };
  }

  const timestamps = completed.map(t => t.timestamp).sort((a, b) => a - b);
  const firstTrade = timestamps[0];
  const lastTrade = timestamps[timestamps.length - 1];
  const now = Date.now();
  const msActive = now - firstTrade;
  const hoursActive = Math.max(msActive / 3600000, 1);
  const daysActive = hoursActive / 24;

  const totalProfit = completed.reduce((s, t) => s + t.profit, 0);
  const totalVolume = completed.reduce((s, t) => s + t.amount, 0);
  const wins = completed.filter(t => t.profit > 0).length;
  const winRate = (wins / completed.length) * 100;

  const tradesPerDay = completed.length / daysActive;
  const avgProfitPerTrade = totalProfit / completed.length;

  const conservativeAvgProfit = avgProfitPerTrade * (winRate / 100);

  const rows: ProjectionRow[] = PERIODS.map(p => {
    const projectedTrades = tradesPerDay * p.days;
    const projectedProfit = projectedTrades * conservativeAvgProfit;
    const projectedROI = initialCapital > 0 ? (projectedProfit / initialCapital) * 100 : 0;

    const actualRatio = Math.min(p.days / daysActive, 1);
    const actualTrades = Math.round(completed.length * actualRatio);
    const actualProfit = totalProfit * actualRatio;
    const actualROI = initialCapital > 0 ? (actualProfit / initialCapital) * 100 : 0;

    const accuracy = projectedProfit !== 0
      ? Math.min(100, Math.max(0, 100 - Math.abs((projectedProfit - actualProfit) / projectedProfit) * 100))
      : 100;

    return {
      period: p.label,
      projectedTrades: Math.round(projectedTrades),
      projectedProfit,
      projectedROI,
      actualTrades,
      actualProfit,
      actualROI,
      accuracy,
    };
  });

  const totalProjectedProfit = rows[rows.length - 1].projectedProfit;
  const totalActualProfit = totalProfit;
  const apyProjected = initialCapital > 0
    ? ((1 + totalProjectedProfit / initialCapital) ** (365 / daysActive) - 1) * 100
    : 0;
  const apyActual = initialCapital > 0
    ? ((1 + totalActualProfit / initialCapital) ** (365 / daysActive) - 1) * 100
    : 0;

  return {
    rows,
    totalProjectedProfit,
    totalActualProfit,
    avgProfitPerTrade,
    tradesPerDay,
    winRate,
    apyProjected,
    apyActual,
    firstTradeDate: new Date(firstTrade).toLocaleDateString('pt-BR'),
    hoursActive: Math.round(hoursActive * 10) / 10,
    totalVolume,
  };
}
