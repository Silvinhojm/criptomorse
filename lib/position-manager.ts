// lib/position-manager.ts
// Gerenciamento de posicoes com trailing stop dinâmico
// Garante 50-100% do lucro conforme cresce, fechando com trailing stop progressivo
//
// Staircase (escada de lucro): sobe degrau por degrau, fecha se cair 2 degraus do pico.
// Ex: lucro sobe 3%→5%→8%, se cair de 8% para 5% (2 degraus) → fecha garantindo ~5%.

import { realSwap, isStable, type SwapResult, type NetworkKey, type TokenSymbol } from "./real-swap-executor";
import { pregão } from "./pregão";
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
const PROFIT_LEVELS = [0, 4, 7, 10, 14, 18, 24, 32, 42, 55, 70, 90, 115];

// Stop loss máximo — se o lucro cair abaixo disto, fecha imediatamente
const MAX_LOSS_PERCENT = -15;

// Tempo máximo sem nenhum lucro — se a posição nunca passou de 0% após N horas, fecha
const STALE_NO_PROFIT_MS = 4 * 60 * 60 * 1000;

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
  { minProfit: 0,    maxProfit: 4,    trailDrop: 70  }, // lucro < 4%: caiu 70% do pico → fecha (garante 30%)
  { minProfit: 4,    maxProfit: 7,    trailDrop: 55  },
  { minProfit: 7,    maxProfit: 12,   trailDrop: 45  }, // 55% do lucro garantido
  { minProfit: 12,   maxProfit: 18,   trailDrop: 40  },
  { minProfit: 18,   maxProfit: 26,   trailDrop: 35  },
  { minProfit: 26,   maxProfit: 38,   trailDrop: 30  },
  { minProfit: 38,   maxProfit: 52,   trailDrop: 25  }, // 75% do lucro garantido
  { minProfit: 52,   maxProfit: 72,   trailDrop: 22  },
  { minProfit: 72,   maxProfit: 100,  trailDrop: 18  }, // 82% do lucro garantido
  { minProfit: 100,  maxProfit: Infinity, trailDrop: 12 }, // 88% do lucro garantido
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

    const age = Date.now() - pos.entryTimestamp;

    pos.currentPrice = currentPrice;
    const profitPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    pos.currentProfitPercent = profitPercent;

    if (currentPrice > pos.highestPrice) {
      pos.highestPrice = currentPrice;
      pos.peakProfitPercent = profitPercent;
    }

    // Stop loss: se perda > MAX_LOSS_PERCENT, fecha
    if (profitPercent < MAX_LOSS_PERCENT) {
      console.log(`🛑 Stop loss acionado: ${pos.boughtToken} perda de ${profitPercent.toFixed(2)}% (limite: ${MAX_LOSS_PERCENT}%)`);
      return "close";
    }

    // Stale close: se nunca teve lucro após N horas, espera mais (só fecha se já lucrou)
    if (age > STALE_NO_PROFIT_MS && pos.peakProfitPercent <= 0) {
      console.log(`⏰ Posicao estagnada sem lucro ha ${(age / 3600000).toFixed(1)}h — segurando (${pos.boughtToken})`);
      return "hold";
    }

    // Forcar fechamento se posicao estiver muito antiga (só se já viu lucro)
    if (age > MAX_POSITION_AGE_MS && pos.peakProfitPercent > 0) {
      console.log(`⌛ Posicao expirada ha ${(age / 3600000).toFixed(1)}h, forcando fechamento (${pos.boughtToken})`);
      return "close";
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

    pos.currentPrice = currentPrice;
    const profitPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    pos.currentProfitPercent = profitPercent;

    if (currentPrice > pos.highestPrice) {
      pos.highestPrice = currentPrice;
      pos.peakProfitPercent = profitPercent;
    }

    // Stop loss: se perda > MAX_LOSS_PERCENT, fecha
    if (profitPercent < MAX_LOSS_PERCENT) {
      console.log(`🛑 Staircase stop loss: ${pos.boughtToken} perda de ${profitPercent.toFixed(2)}% (limite: ${MAX_LOSS_PERCENT}%)`);
      return "close";
    }

    // Stale close: se nunca teve lucro após N horas, espera mais (só fecha se já lucrou)
    if (age > STALE_NO_PROFIT_MS && pos.peakProfitPercent <= 0) {
      console.log(`⏰ Staircase stale: ${pos.boughtToken} sem lucro ha ${(age / 3600000).toFixed(1)}h — segurando (nunca lucrou)`);
      return "hold";
    }

    // Forcar fechamento se posicao estiver muito antiga (só se já viu lucro)
    if (age > MAX_POSITION_AGE_MS && pos.peakProfitPercent > 0) {
      console.log(`⌛ Staircase expirada: ${pos.boughtToken} aberta ha ${(age / 3600000).toFixed(1)}h, forcando fechamento`);
      return "close";
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
      const body = await res.json();
      const data = body.prices ?? body;
      const price = data[coinId] ?? 1.0;
      if (price > 0) {
        this.priceCache.set(token, { price, timestamp: Date.now() });
      }
      return price;
    } catch {
      return this.priceCache.get(token)?.price ?? 1.0;
    }
  }

  // Busca variação percentual 24h da CoinGecko
  async fetchTokenChange24h(token: TokenSymbol): Promise<{ change24h: number; variation24h: number }> {
    const coinIds: Record<string, string> = {
      WETH: "ethereum", WMATIC: "matic-network", ARB: "arbitrum",
      WBTC: "bitcoin", SOL: "solana",
    };
    const coinId = coinIds[token];
    if (!coinId) return { change24h: 0, variation24h: 2 };

    try {
      const res = await fetch(`/api/price?ids=${coinId}`);
      if (!res.ok) return { change24h: 0, variation24h: 2 };
      const body = await res.json();
      const changeData = body.change24h ?? {};
      const change24h = changeData[coinId] ?? 0;
      const variation24h = Math.abs(change24h);
      return { change24h, variation24h: Math.max(variation24h, 0.5) };
    } catch {
      return { change24h: 0, variation24h: 2 };
    }
  }

  // Escaneia saldos on-chain e cria posições órfãs para tokens não rastreados
  // Permite que o staircase venda tokens comprados antes da persistência existir
  async reconcileBalances(networkKey: NetworkKey, volatileTokens: TokenSymbol[]): Promise<void> {
    // Força refresh de saldos on-chain via RPC
    if (typeof realSwap.refreshAllBalances === "function") {
      await realSwap.refreshAllBalances()
    }

    for (const token of volatileTokens) {
      if (isStable(token)) continue

      const balance = realSwap.getBalance(token)
      pregão.adicionarLog(`🔍 reconcile: ${token} balance=${balance}`)

      if (balance <= 0) continue

      // Ignorar poeira (dust) — menos de $0.50 não vale o swap
      const tokenPrice = await this.fetchTokenPrice(token)
      const balanceUsd = balance * tokenPrice
      if (balanceUsd < 0.5) {
        pregão.adicionarLog(`🔍 reconcile: ${token} saldo $${balanceUsd.toFixed(2)} é poeira, ignorando`)
        continue
      }

      const alreadyOpen = this.getOpenPositions().some(
        p => p.boughtToken === token && p.networkKey === networkKey
      )
      if (alreadyOpen) {
        pregão.adicionarLog(`🔍 reconcile: ${token} já tem posição aberta, pulando`)
        continue
      }

      const pos = this.openPosition(
        networkKey,
        token,
        "USDC",
        balance,
        balanceUsd,
        tokenPrice
      )
      pregão.adicionarLog(`🧩 Posição órfã criada: ${balance.toFixed(4)} ${token} @ $${tokenPrice.toFixed(4)} na ${networkKey}`)
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

  // Remove posições fantasmas de redes onde o sistema não opera mais
  // Ex: Arc testnet, redes não configuradas no trading-pairs atual
  cleanupInactiveNetworks(activeNetworks: NetworkKey[]): number {
    const active = new Set(activeNetworks)
    let cleaned = 0
    for (const [id, pos] of this.positions) {
      if (pos.status === "open" && !active.has(pos.networkKey)) {
        this.positions.delete(id)
        cleaned++
      }
    }
    if (cleaned > 0) {
      this.savePositions()
      console.log(`🧹 Limpeza: ${cleaned} posições de redes inativas removidas`)
    }
    return cleaned
  }
}

export const positionManager = new PositionManager();
