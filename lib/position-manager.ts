// lib/position-manager.ts
// Gerenciamento de posicoes com trailing stop dinâmico
// Garante 50-100% do lucro conforme cresce, fechando com trailing stop progressivo

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

  onClose(cb: (position: OpenPosition) => void) {
    this.onCloseCallback = cb;
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
    };
    this.positions.set(id, pos);
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
    console.log(`Posicao FECHADA: ${pos.boughtToken} lucro ${pos.profitPercent.toFixed(2)}% ($${pos.profitUsd.toFixed(4)})`);
    return pos;
  }

  // Atualizar preco de uma posicao, retorna acao recomendada
  updatePrice(id: string, currentPrice: number): "hold" | "close" {
    const pos = this.positions.get(id);
    if (!pos || pos.status !== "open") return "hold";

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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      const data = await res.json();
      const price = data[coinId]?.usd ?? 1.0;
      this.priceCache.set(token, { price, timestamp: Date.now() });
      return price;
    } catch {
      return this.priceCache.get(token)?.price ?? 1.0;
    }
  }
}

export const positionManager = new PositionManager();
