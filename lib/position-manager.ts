// lib/position-manager.ts
// Gerenciamento de posicoes com fechamento inteligente
// Regra: após 1 minuto, se lucro >= mínimo por rede → fecha
// ETH: $0.05 | Demais redes: $0.002 (micro-trades)
// Nunca fecha no prejuízo — segura até ter lucro mínimo ou stop loss

import { realSwap, isStable, type NetworkKey, type TokenSymbol } from "./real-swap-executor";
import { pregão } from "./pregão";
import { gasPriceOracle } from "./gas-price-oracle";

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

const MAX_POSITION_AGE_MS = 12 * 60 * 60 * 1000;
const POSITIONS_STORAGE_KEY = "arcflow_open_positions";
const MAX_LOSS_PERCENT = -15;
const STALE_NO_PROFIT_MS = 4 * 60 * 60 * 1000;
const STALE_FORCE_CLOSE_MS = 30 * 60 * 1000; // 30min sem lucro → força fechamento

// Tempo mínimo antes de considerar fechamento com lucro
const MIN_PROFIT_HOLD_MS = 60 * 1000; // 1 minuto
// Lucro mínimo real desejado (já descontado gas + spread na abertura)
// Valor fixo de $0.02 — cobre taxas + spread em qualquer rede
// Se lucro líquido < $0.02, a posição não é fechada (evita prejuízo disfarçado)
const MIN_LUCRO_LIQUIDO_USD = 0.02

class PositionManager {
  private positions: Map<string, OpenPosition> = new Map();
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private onCloseCallbacks: Array<(position: OpenPosition) => void> = [];
  private onStaircaseCloseCallbacks: Array<(position: OpenPosition) => void> = [];

  constructor() {
    this.loadPositions();
  }

  onClose(cb: (position: OpenPosition) => void) {
    this.onCloseCallbacks.push(cb);
    return () => { this.onCloseCallbacks = this.onCloseCallbacks.filter(c => c !== cb) };
  }

  onStaircaseClose(cb: (position: OpenPosition) => void) {
    this.onStaircaseCloseCallbacks.push(cb);
    return () => { this.onStaircaseCloseCallbacks = this.onStaircaseCloseCallbacks.filter(c => c !== cb) };
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
    const priceOk = closePrice > 0 && pos.entryPrice > 0
      && Math.abs(closePrice - pos.entryPrice) / Math.max(closePrice, pos.entryPrice) < 0.999
    if (priceOk) {
      pos.profitPercent = ((closePrice - pos.entryPrice) / pos.entryPrice) * 100;
      pos.profitUsd = (closePrice - pos.entryPrice) * pos.amountBought;
    } else {
      pos.profitPercent = 0;
      pos.profitUsd = 0;
    }
    for (const cb of this.onCloseCallbacks) cb(pos);
    this.savePositions();
    console.log(`Posicao FECHADA: ${pos.boughtToken} lucro ${pos.profitPercent.toFixed(2)}% ($${pos.profitUsd.toFixed(4)})`);
    return pos;
  }

  async staircaseUpdate(id: string, currentPrice: number, _dropSteps?: number, _levels?: number[]): Promise<"hold" | "close"> {
    const pos = this.positions.get(id);
    if (!pos || pos.status !== "open") return "hold";

    const age = Date.now() - pos.entryTimestamp;

    pos.currentPrice = currentPrice;
    const profitPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    pos.currentProfitPercent = profitPercent;

    // Preço irreal (unknown token na testnet, fallback=1.0) — não fecha via staircase
    const priceUnreliable = currentPrice <= 0 || (profitPercent < -99 && pos.entryPrice > 0.01)
    if (priceUnreliable) return "hold";

    if (currentPrice > pos.highestPrice) {
      pos.highestPrice = currentPrice;
      pos.peakProfitPercent = profitPercent;
    }

    const currentProfitUsd = (currentPrice - pos.entryPrice) * pos.amountBought;

    // Stop loss: se perda > MAX_LOSS_PERCENT, fecha imediatamente
    if (profitPercent < MAX_LOSS_PERCENT) {
      pregão.adicionarLog(`🛑 Stop loss: ${pos.boughtToken} perdeu ${profitPercent.toFixed(2)}% (limite ${MAX_LOSS_PERCENT}%) — fechando`);
      return "close";
    }

    // Stale force close: 30min sem nunca lucrar → fecha para liberar vaga
    if (age > STALE_FORCE_CLOSE_MS && pos.peakProfitPercent <= 0) {
      pregão.adicionarLog(`⏰ ${pos.boughtToken}: ${(age / 60000).toFixed(0)}min sem lucro — forçando fechamento para liberar vaga`);
      return "close";
    }

    // Stale: nunca lucrou após N horas — segura, espera o mercado virar
    if (age > STALE_NO_PROFIT_MS && pos.peakProfitPercent <= 0) {
      pregão.adicionarLog(`⏰ ${pos.boughtToken}: ${(age / 3600000).toFixed(1)}h sem lucro — segurando (mercado pode virar)`);
      return "hold";
    }

    // Expirada: 12h+ e já viu lucro — força fechamento
    if (age > MAX_POSITION_AGE_MS && pos.peakProfitPercent > 0) {
      pregão.adicionarLog(`⌛ ${pos.boughtToken}: expirou ${(age / 3600000).toFixed(1)}h — forçando fechamento com lucro`);
      return "close";
    }

    // 🔒 Só fecha se lucro líquido >= $0.02 (cobre gas + spread + margem)
    // O Pregão é o único com autoridade de abrir/fechar posições
    if (age >= MIN_PROFIT_HOLD_MS && currentProfitUsd > 0) {
      const sellGasCost = await gasPriceOracle.getGasCost(pos.networkKey)
      const sellSpread = currentProfitUsd * 0.005
      const custoTotalVenda = sellGasCost + sellSpread
      const lucroLiquido = currentProfitUsd - custoTotalVenda

      if (lucroLiquido >= MIN_LUCRO_LIQUIDO_USD) {
        pregão.adicionarLog(`✅ ${pos.boughtToken}: lucro bruto $${currentProfitUsd.toFixed(4)} - custos (gas $${sellGasCost.toFixed(4)} + spread $${sellSpread.toFixed(4)}) = líquido $${lucroLiquido.toFixed(4)} — fechando (mín $${MIN_LUCRO_LIQUIDO_USD.toFixed(2)})`)
        for (const cb of this.onStaircaseCloseCallbacks) cb(pos);
        return "close";
      }
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

  getRecentTrades(n: number = 5): OpenPosition[] {
    return Array.from(this.positions.values())
      .sort((a, b) => (b.closeTimestamp ?? b.entryTimestamp) - (a.closeTimestamp ?? a.entryTimestamp))
      .slice(0, n)
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
    if (!coinId) {
      // Fallback: usa entryPrice de posição aberta como preço real
      for (const pos of this.positions.values()) {
        if (pos.boughtToken === token && pos.entryPrice > 0 && pos.status === "open") {
          this.priceCache.set(token, { price: pos.entryPrice, timestamp: Date.now() })
          return pos.entryPrice
        }
      }
      return 1.0;
    }

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

  public savePositions(): void {
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
