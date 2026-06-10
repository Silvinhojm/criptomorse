"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "react-hot-toast";
import { AgentDashboard } from "./AgentDashboard";
import { quantumAgent, technicalAgent, synthesisAgent } from "@/lib/multi-agent-system";
import { agentMemory } from "@/lib/agent-memory";
import { votingSystem, type AgentVote } from "@/lib/voting-system";
import { marketAgent } from "@/lib/market-agent";
import { volumeAgent } from "@/lib/volume-agent";
import { tradingStrategies } from "@/lib/trading-strategies";
import newsAgent, { enhancedMarketAnalyzer } from "@/lib/news-agent";
import type { NewsSentiment } from "@/lib/news-agent";
import { GAS_PER_TRADE, ORANGE, GREEN, type WalletNetwork } from "@/lib/wallet-config";

interface AutoTradeControlProps {
  account: string;
  onTradeExecuted: (profit: number) => void;
  network: WalletNetwork;
}

export function AutoTradeControl({
  account,
  onTradeExecuted,
  network,
}: AutoTradeControlProps) {
  const [isActive, setIsActive] = useState(false);
  const [tradeCount, setTradeCount] = useState(0);
  const [grossProfit, setGrossProfit] = useState(0);
  const [lastTrade, setLastTrade] = useState<{ profit: number; time: string } | null>(null);
  const [tradeSize, setTradeSize] = useState(network.isTestnet ? 30 : 10);
  const [quantumAnalysis, setQuantumAnalysis] = useState("");
  const [marketSentiment, setMarketSentiment] = useState<NewsSentiment | null>(null);
  const [agentScores, setAgentScores] = useState<
    ReturnType<typeof quantumAgent.getScore>[]
  >([]);
  const [votingStats, setVotingStats] = useState({
    totalVotes: 0,
    avgConfidence: 0,
    winRate: 0,
  });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const priceHistory = useRef<number[]>([1.0, 1.001, 0.999, 1.002, 1.0]);

  const updateMarketSentiment = useCallback(async () => {
    const analysis = await enhancedMarketAnalyzer.getCompleteMarketAnalysis();
    setMarketSentiment(analysis.sentiment);
    return analysis.sentiment;
  }, []);

  const consultAgents = useCallback(async (currentPrice: number, prices: number[]) => {
    await enhancedMarketAnalyzer.getCompleteMarketAnalysis();

    quantumAgent.updateMarketState(currentPrice, prices);
    const quantumOpinion = quantumAgent.decide(currentPrice);

    const indicators = technicalAgent.calculateIndicators(prices);
    const indicatorsArray = Array.isArray(indicators) ? indicators : Object.values(indicators);
    const numericIndicators = indicatorsArray.map((val: unknown) => {
      if (typeof val === "string") {
        if (val === "up") return 1;
        if (val === "down") return -1;
        return 0;
      }
      return val as number;
    });
    const technicalOpinion = technicalAgent.decide(numericIndicators, currentPrice);

    const newsDecision = await newsAgent.decide();
    const newsOpinion = {
      agentName: newsAgent.getScore().agentName,
      action: newsDecision.action,
      confidence: newsDecision.confidence,
      reason: newsDecision.reason,
    };

    await marketAgent.updateMarketInsights();
    const marketOpinion = marketAgent.getAdvice();

    const volumeAnalysis = volumeAgent.analyzeVolume(1000000, 2, 5);
    const volumeOpinion = {
      agentName: volumeAgent.getScore().agentName,
      action: volumeAnalysis.action,
      confidence: volumeAnalysis.confidence,
      reason: volumeAnalysis.reason,
    };

    const synthesisOpinion = synthesisAgent.decide(
      quantumOpinion,
      technicalOpinion,
      newsOpinion,
      marketOpinion
    );

    const votes: AgentVote[] = [
      {
        agentName: quantumOpinion.agentName,
        action: quantumOpinion.action,
        confidence: quantumOpinion.confidence,
        weight: 1,
        color: "#a78bfa",
        icon: "🌌",
      },
      {
        agentName: technicalOpinion.agentName,
        action: technicalOpinion.action,
        confidence: technicalOpinion.confidence,
        weight: 1,
        color: "#00d4aa",
        icon: "📊",
      },
      {
        agentName: newsOpinion.agentName,
        action: newsOpinion.action as AgentVote["action"],
        confidence: newsOpinion.confidence,
        weight: 0.8,
        color: "#f97316",
        icon: "📰",
      },
      {
        agentName: marketOpinion.agentName,
        action: marketOpinion.action,
        confidence: marketOpinion.confidence,
        weight: 0.9,
        color: "#f97316",
        icon: "📈",
      },
      {
        agentName: volumeOpinion.agentName,
        action: volumeOpinion.action,
        confidence: volumeOpinion.confidence,
        weight: 0.9,
        color: "#f97316",
        icon: "📊",
      },
      {
        agentName: synthesisOpinion.agentName,
        action: synthesisOpinion.action,
        confidence: synthesisOpinion.confidence,
        weight: 1.2,
        color: "#fbbf24",
        icon: "🧠",
      },
    ];

    const voteResult = votingSystem.vote(votes);
    const votingStatsData = votingSystem.getStats();
    setVotingStats(votingStatsData);

    const scores = [
      quantumAgent.getScore(),
      technicalAgent.getScore(),
      newsAgent.getScore(),
      marketAgent.getScore(),
      volumeAgent.getScore(),
      synthesisAgent.getScore(),
    ];
    setAgentScores(scores);

    setQuantumAnalysis(
      `🌌 Quântico: ${quantumOpinion.action} (${quantumOpinion.confidence}%) | 📊 Técnico: ${technicalOpinion.action} (${technicalOpinion.confidence}%) | 📰 Notícias: ${newsOpinion.action} (${newsOpinion.confidence}%) | ⚖️ FINAL: ${voteResult.action.toUpperCase()} (${voteResult.confidence}%)`
    );

    return { decision: voteResult };
  }, []);

  const executeTrade = useCallback(async () => {
    if (!account) return;
    try {
      const currentMockPrice = 1.0 + Math.random() * 0.02;
      priceHistory.current = [...priceHistory.current.slice(-30), currentMockPrice];

      const { decision } = await consultAgents(currentMockPrice, priceHistory.current);

      const deliberation = await tradingStrategies.deliberate(
        { action: decision.action, confidence: decision.confidence },
        async () => ({ action: decision.action, confidence: decision.confidence })
      );

      if (deliberation.shouldTrade) {
        const won = Math.random() > 0.4;
        setTradeCount((prev) => prev + 1);
        const profit = tradeSize * 0.01;
        setGrossProfit((prev) => prev + profit);
        setLastTrade({ profit, time: new Date().toLocaleTimeString() });
        onTradeExecuted(profit);

        agentMemory.update("Quantum", won, quantumAgent.getScore().avgConfidence);
        agentMemory.update("Technical", won, technicalAgent.getScore().avgConfidence);
        agentMemory.update("Synthesis", won, synthesisAgent.getScore().avgConfidence);

        votingSystem.recordResult(won);

        toast.success(
          `💰 TRADE ${network.isTestnet ? "🧪 TESTE" : "💰 REAL"} | ${deliberation.action.toUpperCase()} | Lucro: $${profit.toFixed(4)}`
        );
      }
    } catch (error) {
      console.error("Erro no trade:", error);
    }
  }, [account, tradeSize, consultAgents, onTradeExecuted, network]);

  const toggleAutoTrade = () => {
    if (!account) {
      toast.error("Conecte a carteira primeiro");
      return;
    }
    if (isActive) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setIsActive(false);
      toast("⏹️ Auto-Trade parado");
    } else {
      setIsActive(true);
      updateMarketSentiment();
      toast.success(
        `🌌 Auto-Trade iniciado em ${network.isTestnet ? "TESTNET" : "MAINNET"}! Trade: $${tradeSize}`
      );
      setTimeout(() => executeTrade(), 2000);
      intervalRef.current = setInterval(executeTrade, 60000);
    }
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div
      style={{
        marginTop: "16px",
        padding: "16px",
        background: "linear-gradient(135deg, #0a0a2e 0%, #1a1a4e 100%)",
        borderRadius: "16px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "24px" }}>🌌</span>
          <span style={{ fontWeight: "bold", color: "#8b5cf6" }}>Multi-Agent System</span>
          <span
            style={{
              fontSize: "9px",
              background: network.isTestnet ? ORANGE : GREEN,
              padding: "2px 6px",
              borderRadius: 10,
              color: "#fff",
            }}
          >
            {network.isTestnet ? "🧪 TESTNET" : "💰 REAL"}
          </span>
          {isActive && (
            <span
              style={{
                fontSize: "10px",
                background: "#22c55e",
                color: "#fff",
                padding: "2px 8px",
                borderRadius: "20px",
              }}
            >
              🤖 ATIVO
            </span>
          )}
        </div>
        <button
          onClick={toggleAutoTrade}
          style={{
            padding: "8px 20px",
            background: isActive ? "#ef4444" : "#8b5cf6",
            border: "none",
            borderRadius: "20px",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          {isActive ? "⏹️ PARAR" : "🤖 INICIAR"}
        </button>
      </div>

      {marketSentiment && (
        <div
          style={{
            marginBottom: "8px",
            padding: "8px",
            background: "rgba(0,0,0,0.4)",
            borderRadius: "8px",
            fontSize: "11px",
            textAlign: "center",
          }}
        >
          📰 Sentimento:{" "}
          <span
            style={{
              color:
                marketSentiment.bias === "positive"
                  ? "#4ade80"
                  : marketSentiment.bias === "negative"
                    ? "#ef4444"
                    : "#fbbf24",
            }}
          >
            {marketSentiment.bias.toUpperCase()} ({marketSentiment.score})
          </span>
        </div>
      )}

      <AgentDashboard agentScores={agentScores} votingStats={votingStats} />

      {quantumAnalysis && (
        <div
          style={{
            marginBottom: "12px",
            padding: "8px",
            background: "rgba(139, 92, 246, 0.15)",
            borderRadius: "8px",
            fontSize: "9px",
            color: "#a78bfa",
            textAlign: "center",
          }}
        >
          {quantumAnalysis}
        </div>
      )}

      <div style={{ marginBottom: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
          <span style={{ fontSize: "11px", color: "#94a3b8" }}>💰 Valor por trade:</span>
          <span style={{ fontSize: "13px", color: "#a78bfa", fontWeight: "bold" }}>
            ${tradeSize} USDC
          </span>
        </div>
        <input
          type="range"
          min={5}
          max={network.isTestnet ? 100 : 25}
          step={1}
          value={tradeSize}
          onChange={(e) => setTradeSize(Number(e.target.value))}
          style={{ width: "100%" }}
        />
        {!network.isTestnet && (
          <div style={{ fontSize: "9px", color: "#fbbf24", marginTop: 4 }}>
            ⚠️ Limite de segurança: $25 por trade em Mainnet
          </div>
        )}
      </div>

      <div
        style={{
          background: "rgba(0,0,0,0.3)",
          borderRadius: "12px",
          padding: "12px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
          <span style={{ fontSize: "11px", color: "#94a3b8" }}>Lucro Bruto:</span>
          <span style={{ fontSize: "12px", color: "#fbbf24" }}>${grossProfit.toFixed(4)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: "13px", color: "#4ade80", fontWeight: "bold" }}>
            LUCRO LÍQUIDO:
          </span>
          <span style={{ fontSize: "16px", color: "#22c55e", fontWeight: "bold" }}>
            ${(grossProfit - tradeCount * GAS_PER_TRADE).toFixed(4)}
          </span>
        </div>
      </div>

      <div style={{ color: "#fff", fontSize: "13px", marginTop: "8px" }}>
        <div>
          💰 Trades:{" "}
          <span style={{ fontWeight: "bold", color: "#a78bfa" }}>{tradeCount}</span>
        </div>
        {lastTrade && (
          <div style={{ fontSize: "11px" }}>🕐 Último: ${lastTrade.profit.toFixed(4)}</div>
        )}
      </div>
    </div>
  );
}
