// lib/multi-pair-consensus.ts

export type Action = "BUY" | "SELL" | "HOLD";

export interface Vote {
  traderId: string;
  action: Action;
  confidence: number;
  reason: string;
}

export interface PairAnalysis {
  pair: string;
  votes: Vote[];
  consensusReached: boolean;
  finalAction: Action | null;
  confidence: number;
  topReason: string;
  timestamp: number;
}

export interface ConsensusRound {
  id: string;
  timestamp: number;
  pairAnalyses: PairAnalysis[];
  bestBuy: string | null;
  bestSell: string | null;
  globalConsensus: {
    action: Action | null;
    confidence: number;
    activeTrades: number;
  };
}

export interface PairKey {
  base: string;
  quote: string;
  symbol: string;
}

export const POLYGON_PAIRS: Record<string, PairKey & { icon: string; name: string }> = {
  "BTC-USD": {
    base: "BTC",
    quote: "USD",
    symbol: "BTC-USD",
    icon: "₿",
    name: "Bitcoin"
  },
  "ETH-USD": {
    base: "ETH",
    quote: "USD",
    symbol: "ETH-USD",
    icon: "Ξ",
    name: "Ethereum"
  },
  "MATIC-USD": {
    base: "MATIC",
    quote: "USD",
    symbol: "MATIC-USD",
    icon: "🔷",
    name: "Polygon"
  },
  "LINK-USD": {
    base: "LINK",
    quote: "USD",
    symbol: "LINK-USD",
    icon: "🔗",
    name: "Chainlink"
  },
  "AAVE-USD": {
    base: "AAVE",
    quote: "USD",
    symbol: "AAVE-USD",
    icon: "🟢",
    name: "Aave"
  },
  "UNI-USD": {
    base: "UNI",
    quote: "USD",
    symbol: "UNI-USD",
    icon: "🦄",
    name: "Uniswap"
  },
  "CRV-USD": {
    base: "CRV",
    quote: "USD",
    symbol: "CRV-USD",
    icon: "🔺",
    name: "Curve"
  }
};

export const ACTION_COLOR: Record<Action, string> = {
  BUY: "#10b981",
  SELL: "#ef4444",
  HOLD: "#f59e0b"
};

class MultiPairConsensus {
  private listeners: ((round: ConsensusRound) => void)[] = [];
  private currentRound: ConsensusRound | null = null;
  private roundInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startConsensusRounds();
  }

  private startConsensusRounds() {
    if (this.roundInterval) clearInterval(this.roundInterval);
    
    this.roundInterval = setInterval(() => {
      this.generateConsensusRound();
    }, 30000);

    setTimeout(() => this.generateConsensusRound(), 100);
  }

  private generateConsensusRound() {
    const pairAnalyses: PairAnalysis[] = [];
    const pairs = Object.keys(POLYGON_PAIRS);

    for (const pair of pairs) {
      const analysis = this.analyzePair(pair);
      pairAnalyses.push(analysis);
    }

    const buyCandidates = pairAnalyses
      .filter(a => a.finalAction === "BUY")
      .sort((a, b) => b.confidence - a.confidence);
    
    const sellCandidates = pairAnalyses
      .filter(a => a.finalAction === "SELL")
      .sort((a, b) => b.confidence - a.confidence);

    const allActions = pairAnalyses.map(a => a.finalAction).filter(a => a !== null);
    const buyCount = allActions.filter(a => a === "BUY").length;
    const sellCount = allActions.filter(a => a === "SELL").length;
    
    let globalAction: Action | null = null;
    if (buyCount > sellCount && buyCount > allActions.length / 2) {
      globalAction = "BUY";
    } else if (sellCount > buyCount && sellCount > allActions.length / 2) {
      globalAction = "SELL";
    }

    this.currentRound = {
      id: `round_${Date.now()}`,
      timestamp: Date.now(),
      pairAnalyses,
      bestBuy: buyCandidates[0]?.pair || null,
      bestSell: sellCandidates[0]?.pair || null,
      globalConsensus: {
        action: globalAction,
        confidence: globalAction ? 
          Math.max(
            (buyCount / allActions.length) * 100,
            (sellCount / allActions.length) * 100
          ) : 0,
        activeTrades: Math.floor(Math.random() * 5) + 1
      }
    };

    this.listeners.forEach(listener => listener(this.currentRound!));
  }

  private analyzePair(pair: string): PairAnalysis {
    const traders = ["QuantumTrader", "ArbitrageHunter", "ScalpingBot", "MarketMaker"];
    const votes: Vote[] = [];
    const marketBias = Math.random();
    
    for (const trader of traders) {
      let action: Action;
      let confidence: number;
      
      switch(trader) {
        case "QuantumTrader":
          action = marketBias > 0.6 ? "BUY" : marketBias < 0.4 ? "SELL" : "HOLD";
          confidence = 60 + Math.random() * 30;
          break;
        case "ArbitrageHunter":
          action = marketBias > 0.55 ? "BUY" : marketBias < 0.45 ? "SELL" : "HOLD";
          confidence = 70 + Math.random() * 25;
          break;
        case "ScalpingBot":
          action = Math.random() > 0.5 ? "BUY" : "SELL";
          confidence = 50 + Math.random() * 40;
          break;
        case "MarketMaker":
          action = marketBias > 0.65 ? "BUY" : marketBias < 0.35 ? "SELL" : "HOLD";
          confidence = 65 + Math.random() * 30;
          break;
        default:
          action = "HOLD";
          confidence = 50;
      }
      
      votes.push({
        traderId: trader,
        action,
        confidence: Math.floor(confidence),
        reason: this.generateReason(pair, action, trader)
      });
    }
    
    const actionCount = { BUY: 0, SELL: 0, HOLD: 0 };
    votes.forEach(v => actionCount[v.action]++);
    
    const majorityAction = Object.entries(actionCount)
      .sort((a, b) => b[1] - a[1])[0][0] as Action;
    
    const consensusReached = actionCount[majorityAction] >= 3;
    const avgConfidence = votes.reduce((sum, v) => sum + v.confidence, 0) / votes.length;
    const bestVote = votes.sort((a, b) => b.confidence - a.confidence)[0];
    
    return {
      pair,
      votes,
      consensusReached,
      finalAction: consensusReached ? majorityAction : null,
      confidence: Math.floor(avgConfidence),
      topReason: bestVote?.reason || "Análise em andamento",
      timestamp: Date.now()
    };
  }

  private generateReason(pair: string, action: Action, trader: string): string {
    const reasons = {
      BUY: [
        "Tendência de alta identificada",
        "Volume acima da média sugere acumulação",
        "RSI indicando oversold com reversão",
        "Cruzamento de médias móveis positivo",
        "Sentimento de mercado otimista"
      ],
      SELL: [
        "Resistência forte identificada",
        "Volume decrescente indica distribuição",
        "RSI em overbought com divergência",
        "Cruzamento de médias móveis negativo",
        "Sentimento de mercado pessimista"
      ],
      HOLD: [
        "Consolidação do mercado, aguardar definição",
        "Volatilidade baixa, sem sinal claro",
        "Indicadores mistos, manter posição",
        "Esperando confirmação da tendência",
        "Risco/retorno desfavorável no momento"
      ]
    };
    
    const traderPrefix = {
      QuantumTrader: "[Quantum]",
      ArbitrageHunter: "[Arbitrage]",
      ScalpingBot: "[Scalping]",
      MarketMaker: "[MM]"
    };
    
    const reasonList = reasons[action];
    const randomReason = reasonList[Math.floor(Math.random() * reasonList.length)];
    const prefix = traderPrefix[trader as keyof typeof traderPrefix];
    
    return `${prefix} ${randomReason} em ${pair}`;
  }

  onRound(callback: (round: ConsensusRound) => void) {
    this.listeners.push(callback);
    if (this.currentRound) {
      callback(this.currentRound);
    }
  }

  getCurrentRound(): ConsensusRound | null {
    return this.currentRound;
  }

  stop() {
    if (this.roundInterval) {
      clearInterval(this.roundInterval);
      this.roundInterval = null;
    }
  }
}

export const multiPairConsensus = new MultiPairConsensus();
