// app/components/MultiPairConsensusPanel.tsx
'use client';

import { useState, useEffect, useRef } from "react";
import {
  multiPairConsensus,
  POLYGON_PAIRS,
  ACTION_COLOR,
  type ConsensusRound,
  type PairAnalysis,
  type PairKey,
  type Vote
} from "@/lib/multi-pair-consensus";

interface Props {
  privateKey: string;
}

export function MultiPairConsensusPanel({ privateKey }: Props) {
  const [currentRound, setCurrentRound] = useState<ConsensusRound | null>(null);
  const [selectedPair, setSelectedPair] = useState<string>("BTC-USD");
  const [isListening, setIsListening] = useState(true);

  useEffect(() => {
    // Inicia o listener para novos rounds de consenso
    multiPairConsensus.onRound((round: ConsensusRound) => {
      console.log("Novo round de consenso:", round);
      setCurrentRound(round);
    });

    return () => {
      // Cleanup se necessário
    };
  }, []);

  if (!currentRound) {
    return (
      <div style={{ padding: 20, color: "#94a3b8", textAlign: "center" }}>
        🔄 Aguardando análise multi-par...
      </div>
    );
  }

  const selectedAnalysis = currentRound.pairAnalyses.find(
    (p: PairAnalysis) => p.pair === selectedPair
  );

  return (
    <div style={{ padding: "20px", background: "#0f172a", borderRadius: 12, color: "#e2e8f0" }}>
      <h3 style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        🔄 Consenso Multi-Par
        <span style={{ fontSize: 12, background: "#1e293b", padding: "4px 8px", borderRadius: 20 }}>
          Round {currentRound.id.split("_")[1]}
        </span>
      </h3>

      {/* Grid de cards por par */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, marginBottom: 24 }}>
        {Object.entries(POLYGON_PAIRS).map(([key, pairInfo]) => {
          const analysis = currentRound.pairAnalyses.find((p: PairAnalysis) => p.pair === key);
          if (!analysis) return null;
          
          const isSelected = selectedPair === key;
          
          return (
            <div
              key={key}
              onClick={() => setSelectedPair(key)}
              style={{
                padding: 12,
                borderRadius: 8,
                background: isSelected ? "#1e1b4b" : "#1e293b",
                border: `1px solid ${isSelected ? "#7c3aed" : analysis.consensusReached ? ACTION_COLOR[analysis.finalAction!] + "55" : "#1e293b"}`,
                cursor: "pointer",
                transition: "all 0.2s"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: 20, marginRight: 8 }}>{pairInfo.icon}</span>
                  <span style={{ fontWeight: 700 }}>{pairInfo.name}</span>
                  <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 8 }}>{key}</span>
                </div>
                {analysis.consensusReached && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: ACTION_COLOR[analysis.finalAction!], marginTop: 4 }}>
                    {analysis.finalAction === 'BUY' ? '📈 COMPRAR' : analysis.finalAction === 'SELL' ? '📉 VENDER' : '⏸️ HOLD'}
                  </div>
                )}
              </div>
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{analysis.confidence}%</div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>confiança</div>
              </div>
              <div style={{ fontSize: 11, marginTop: 8, color: "#cbd5e1" }}>
                {analysis.topReason}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detalhes do par selecionado */}
      {selectedAnalysis && (
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
          <h4 style={{ marginBottom: 12 }}>
            {POLYGON_PAIRS[selectedPair].icon} {POLYGON_PAIRS[selectedPair].name} - Votos dos Traders
          </h4>
          
          {selectedAnalysis.votes.map((vote: Vote) => (
            <div key={vote.traderId} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{vote.traderId}</span>
                <div>
                  <span style={{ fontSize: 12, color: ACTION_COLOR[vote.action], fontWeight: 700 }}>
                    {vote.action === 'BUY' ? '📈' : vote.action === 'SELL' ? '📉' : '⏸️'} {vote.action}
                  </span>
                  <span style={{ marginLeft: 8, fontSize: 12 }}>{vote.confidence}% conf.</span>
                </div>
              </div>
              <div style={{ background: "#0f172a", borderRadius: 99, height: 8, overflow: "hidden" }}>
                <div 
                  style={{ 
                    height: "100%", 
                    width: `${vote.confidence}%`, 
                    background: ACTION_COLOR[vote.action], 
                    borderRadius: 99, 
                    transition: "width 0.5s" 
                  }} 
                />
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                {vote.reason}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Consenso Global */}
      <div style={{ marginTop: 16, padding: 12, background: "#1e293b", borderRadius: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>🌍 Consenso Global</span>
          <span style={{ 
            background: currentRound.globalConsensus.action ? 
              ACTION_COLOR[currentRound.globalConsensus.action] : "#64748b",
            padding: "4px 12px",
            borderRadius: 20,
            fontSize: 12,
            fontWeight: 700
          }}>
            {currentRound.globalConsensus.action || "NEUTRO"}
          </span>
        </div>
        
        {currentRound.bestBuy && (
          <div style={{ marginTop: 12, fontSize: 13, color: "#10b981" }}>
            ✅ MELHOR COMPRA: {POLYGON_PAIRS[currentRound.bestBuy].icon} {currentRound.bestBuy}
            <span style={{ marginLeft: 8, fontSize: 11 }}>
              ({currentRound.pairAnalyses.find((p: PairAnalysis) => p.pair === currentRound.bestBuy)?.confidence}% conf.)
            </span>
          </div>
        )}
        
        {currentRound.bestSell && (
          <div style={{ marginTop: 8, fontSize: 13, color: "#ef4444" }}>
            ⚠️ MELHOR VENDA: {POLYGON_PAIRS[currentRound.bestSell].icon} {currentRound.bestSell}
            <span style={{ marginLeft: 8, fontSize: 11 }}>
              ({currentRound.pairAnalyses.find((p: PairAnalysis) => p.pair === currentRound.bestSell)?.confidence}% conf.)
            </span>
          </div>
        )}
        
        <div style={{ marginTop: 8, fontSize: 11, color: "#94a3b8" }}>
          Trades ativos: {currentRound.globalConsensus.activeTrades}
        </div>
      </div>
    </div>
  );
}