// lib/position-manager.ts
// Gerenciamento de posicoes com trailing stop dinâmico
// Garante 50-100% do lucro conforme cresce, fechando com trailing stop progressivo
//
// Staircase (escada de lucro): sobe degrau por degrau, fecha se cair 2 degraus do pico.
// Ex: lucro sobe 3%→5%→8%, se cair de 8% para 5% (2 degraus) → fecha garantindo ~5%.

import { realSwap, type SwapResult, type NetworkKey, type TokenSymbol } from "./real-swap-executor";
import { saveTradeHistory, loadTradeHistory } from "./persistence";

export interface OpenPosition {
  id: string;
  networkKey: NetworkKey;
  boughtToken: TokenSymbol;
  paidToken: TokenSymbol;
  amountBought: number;
  amountPaid: number;
  entryPrice: number;
  entryTimestamp: number;
  peakProfitPercent: number;
  highestPrice: number;
  currentPrice: number;
  currentProfitPercent: number;
  status: "open" | "closed" | "stopped";
  closePrice?: number;
  closeTimestamp?: number;
  profitUsd?: number;
  profitPercent?: number;
  staircaseLevel?: number;
}

// Idade maxima da posicao (12h) — forca fechamento para liberar capital
const MAX_POSITION_AGE_MS = 12 * 60 * 60 * 1000;
const POSITIONS_STORAGE_KEY = "arcflow_open_positions";

// Degraus da escada de lucro (%)
// A cada novo degrau atingido, o lucro mínimo garantido sobe.
// Se cair 2 degraus abaixo do pico, a posição fecha automaticamente.
const PROFIT_LEVELS = [0, 3, 5, 8, 10, 15, 20, 30, 50, 70, 100];

function getLevelIndex(profitPercent: number, levels?: number[]): number {
  const list = levels ?? PROFIT_LEVELS;
  for (let i = list.length - 1; i >= 0; i--) {
    if (profitPercent >= list[i]) return i;
  }
  return 0;
}

// Trail levels: as regras de fechamento ficam mais rigidas conforme o lucro cresce
// "quanto maior o lucro, menor a porcentagem de fechamento"
const TRAIL_RULES = [
  { minProfit: 0,    maxProfit: 3,    trailDrop: 80  }, // lucro < 3%: permite cair 80% do pico
  { minProfit: 3,    maxProfit: 5,    trailDrop: 65  },
  { minProfit: 5,    maxProfit: 10,   trailDrop: 50  }, // 50% do lucro garantido
  { minProfit: 10,   maxProfit: 20,   trailDrop: 45  },
  { minProfit: 20,   maxProfit: 30,   trailDrop: 40  },
  { minProfit: 30,   maxProfit: 50,   trailDrop: 35  },
  { minProfit: 50,   maxProfit: 70,   trailDrop: 30  }, // 70% do lucro garantido
  { minProfit: 70,   maxProfit: 100,  trailDrop: 25  },
  { minProfit: 100,  maxProfit: 200,  trailDrop: 20  }, // 80% do lucro garantido
  { minProfit: 200,  maxProfit: Infinity, trailDrop: 15 }, // 85% do lucro garantido
];

function getTrailDrop(peakProfitPercent: number): number {
  for (const rule of TRAIL_RULES) {
    if (peakProfitPercent >= rule.minProfit && peakProfitPercent < rule.maxProfit) {
      return rule.trailDrop;
    }
  }
  return 50;
}

class PositionManager {
  private positions: Map<string, OpenPosition> = new Map();
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private onCloseCallback: ((position: OpenPosition) => void) | null = null;
  private onStaircaseCloseCallback: ((position: OpenPosition) => void) | null = null;

  constructor() {
    this.loadPositions();
  }

  onClose(cb: (position: OpenPosition) => void) {
    this.onCloseCallback = cb;
  }

  onStaircaseClose(cb: (position: OpenPosition) => void) {
    this.onStaircaseCloseCallback = cb;
  }

  // Abrir posicao apos comprar token volatil (ex: USDC -> WETH)
  openPosition(
    networkKey: NetworkKey,
    boughtToken: TokenSymbol,
    paidToken: TokenSymbol,
    amountBought: number,
    amountPaid: number,
    entryPrice: number
  ): OpenPosition {
    const id = `pos_${networkKey}_${boughtToken}_${Date.now()}`;
    const pos: OpenPosition = {
      id,
      networkKey,
      boughtToken,
      paidToken,
      amountBought,
      amountPaid,
      entryPrice,
      entryTimestamp: Date.now(),
      peakProfitPercent: 0,
      highestPrice: entryPrice,
      currentPrice: entryPrice,
      currentProfitPercent: 0,
      status: "open",
      staircaseLevel: 0,
    };
    this.positions.set(id, pos);
    this.savePositions();
    console.log(`Posicao ABERTA: ${boughtToken} @ $${entryPrice.toFixed(4)} (${id})`);
    return pos;
  }

  // Fechar posicao manualmente
  closePosition(id: string, closePrice: number): OpenPosition | null {
    const pos = this.positions.get(id);
    if (!pos || pos.status !== "open") return null;
    pos.status = "closed";
    pos.closePrice = closePrice;
    pos.closeTimestamp = Date.now();
    pos.profitPercent = ((closePrice - pos.entryPrice) / pos.entryPrice) * 100;
    pos.profitUsd = (closePrice - pos.entryPrice) * pos.amountBought;
    this.onCloseCallback?.(pos);
    this.savePositions();
    console.log(`Posicao FECHADA: ${pos.boughtToken} lucro ${pos.profitPercent.toFixed(2)}% ($${pos.profitUsd.toFixed(4)})`);
    return pos;
  }

  // Atualizar preco de uma posicao, retorna acao recomendada
  updatePrice(id: string, currentPrice: number): "hold" | "close" {
    const pos = this.positions.get(id);
    if (!pos || pos.status !== "open") return "hold";

    // Forcar fechamento se posicao estiver estagnada apos N horas
    const age = Date.now() - pos.entryTimestamp;
    if (age > MAX_POSITION_AGE_MS && pos.peakProfitPercent < 2) {
      console.log(`Posicao estagnada ha ${(age / 3600000).toFixed(1)}h, forcando fechamento (${pos.boughtToken})`);
      return "close";
    }

    pos.currentPrice = currentPrice;
    const profitPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    pos.currentProfitPercent = profitPercent;

    if (currentPrice > pos.highestPrice) {
      pos.highestPrice = currentPrice;
      pos.peakProfitPercent = profitPercent;
    }

    const trailDrop = getTrailDrop(pos.peakProfitPercent);
    const stopPrice = pos.highestPrice * (1 - trailDrop / 100);
    const stopProfitPercent = ((stopPrice - pos.entryPrice) / pos.entryPrice) * 100;

    const lockedProfit = pos.peakProfitPercent * (1 - trailDrop / 100);

    if (profitPercent <= stopProfitPercent && pos.peakProfitPercent > 2) {
      console.log(`Trailing stop acionado: pico ${pos.peakProfitPercent.toFixed(2)}%, drop ${trailDrop}%, fechando em ${profitPercent.toFixed(2)}% (garantido ${lockedProfit.toFixed(2)}%)`);
      return "close";
    }

    if (pos.peakProfitPercent > 2) {
      console.log(`Posicao ${pos.boughtToken}: ${profitPercent.toFixed(2)}% (pico: ${pos.peakProfitPercent.toFixed(2)}%, stop: ${stopProfitPercent.toFixed(2)}%, garantido: ${lockedProfit.toFixed(2)}%)`);
    }

    return "hold";
  }

  // Staircase (escada de lucro): sobe degraus, fecha se cair N degraus do pico
  // Aceita níveis dinâmicos (do volatility tracker) ou usa o padrão PROFIT_LEVELS
  staircaseUpdate(id: string, currentPrice: number, dropSteps: number = 2, levels?: number[]): "hold" | "close" {
    const pos = this.positions.get(id);
    if (!pos || pos.status !== "open") return "hold";

    const profitLevels = levels ?? PROFIT_LEVELS;

    const age = Date.now() - pos.entryTimestamp;
    if (age > MAX_POSITION_AGE_MS && pos.peakProfitPercent < 2) {
      console.log(`Posicao estagnada ha ${(age / 3600000).toFixed(1)}h, forcando fechamento (${pos.boughtToken})`);
      return "close";
    }

    pos.currentPrice = currentPrice;
    const profitPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    pos.currentProfitPercent = profitPercent;

    if (currentPrice > pos.highestPrice) {
      pos.highestPrice = currentPrice;
      pos.peakProfitPercent = profitPercent;
    }

    const currentLevel = getLevelIndex(profitPercent, profitLevels);
    const peakLevel = pos.staircaseLevel ?? 0;

    if (currentLevel > peakLevel) {
      pos.staircaseLevel = currentLevel;
      const nivelNome = profitLevels[currentLevel] >= 100 ? "🚀" : "📈";
      console.log(`${nivelNome} Staircase ${pos.boughtToken}: subiu para nível ${currentLevel} (${profitLevels[currentLevel]}%${currentLevel >= profitLevels.length - 1 ? " — TETO!" : ""})`);
    }

    if (currentLevel <= peakLevel - dropSteps && peakLevel > 0) {
      const locked = profitLevels[Math.max(0, peakLevel - dropSteps + 1)];
      console.log(`🔒 Staircase fechou ${pos.boughtToken}: pico ${profitLevels[peakLevel]}%, caiu ${dropSteps} degraus → ${profitPercent.toFixed(2)}% (nível ${currentLevel}), lucro garantido ~${locked}%`);
      this.onStaircaseCloseCallback?.(pos);
      return "close";
    }

    if (peakLevel > 0) {
      console.log(`📊 Staircase ${pos.boughtToken}: ${profitPercent.toFixed(2)}% (nível ${currentLevel}, pico ${peakLevel}=${profitLevels[peakLevel]}%, fecha ≤${profitLevels[Math.max(0, peakLevel - dropSteps)]}%)`);
    }

    return "hold";
  }

  getOpenPositions(): OpenPosition[] {
    return Array.from(this.positions.values()).filter(p => p.status === "open");
  }

  getPosition(id: string): OpenPosition | undefined {
    return this.positions.get(id);
  }

  getAllPositions(): OpenPosition[] {
    return Array.from(this.positions.values());
  }

  // Buscar preco do token (cache 15s)
  async fetchTokenPrice(token: TokenSymbol): Promise<number> {
    const cached = this.priceCache.get(token);
    if (cached && Date.now() - cached.timestamp < 15000) return cached.price;

    const coinIds: Record<string, string> = {
      WETH: "ethereum", WMATIC: "matic-network", ARB: "arbitrum",
      WBTC: "bitcoin", SOL: "solana",
    };
    const coinId = coinIds[token];
    if (!coinId) return 1.0;

    try {
      const res = await fetch(`/api/price?ids=${coinId}`);
      if (!res.ok) return this.priceCache.get(token)?.price ?? 1.0;
      const data = await res.json();
      const price = data[coinId] ?? 1.0;
      if (price > 0) {
        this.priceCache.set(token, { price, timestamp: Date.now() });
      }
      return price;
    } catch {
      return this.priceCache.get(token)?.price ?? 1.0;
    }
  }

  // ─── Persistência ───

  private savePositions(): void {
    try {
      const open = this.getOpenPositions();
      localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(open));
    } catch { /* localStorage indisponível (SSR, etc.) */ }
  }

  private loadPositions(): void {
    try {
      const raw = localStorage.getItem(POSITIONS_STORAGE_KEY);
      if (!raw) return;
      const saved: OpenPosition[] = JSON.parse(raw);
      for (const pos of saved) {
        if (pos.status === "open") {
          this.positions.set(pos.id, pos);
        }
      }
      if (saved.length > 0) {
        console.log(`🧠 Posições restauradas do localStorage: ${saved.filter(p => p.status === "open").length} abertas`);
      }
    } catch { /* primeiro uso ou dados corrompidos */ }
  }
}

export const positionManager = new PositionManager();
