"use client";

import { useState, useEffect, useRef } from "react";

interface BitcoinTreasureHunterProps {
  onTreasureFound: (value: number, fee: number) => void;
  userAddress: string;
}

interface Treasure {
  id: number;
  x: number;
  y: number;
  value: number;
  found: boolean;
}

export function BitcoinTreasureHunter({ onTreasureFound, userAddress }: BitcoinTreasureHunterProps) {
  const [isHunting, setIsHunting] = useState(false);
  const [treasures, setTreasures] = useState<Treasure[]>([]);
  const [totalFound, setTotalFound] = useState(0);
  const [hunterPos, setHunterPos] = useState({ x: 50, y: 50 });
  const [lastFound, setLastFound] = useState<Treasure | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const generateTreasures = () => {
    return Array.from({ length: 5 }, (_, i) => ({
      id: i,
      x: Math.random() * 80 + 10,
      y: Math.random() * 60 + 20,
      value: parseFloat((Math.random() * 0.05 + 0.001).toFixed(4)),
      found: false,
    }));
  };

  const startHunting = () => {
    if (!userAddress) return;
    setIsHunting(true);
    setTreasures(generateTreasures());
    intervalRef.current = setInterval(() => {
      setHunterPos({ x: Math.random() * 80 + 10, y: Math.random() * 60 + 20 });
      setTreasures(prev => {
        const updated = prev.map(t => {
          if (t.found) return t;
          const dist = Math.sqrt(
            Math.pow(t.x - hunterPos.x, 2) + Math.pow(t.y - hunterPos.y, 2)
          );
          if (dist < 15) {
            const fee = parseFloat((t.value * 0.1).toFixed(4));
            setTotalFound(p => p + t.value);
            setLastFound(t);
            onTreasureFound(t.value, fee);
            return { ...t, found: true };
          }
          return t;
        });
        if (updated.every(t => t.found)) {
          setTimeout(() => setTreasures(generateTreasures()), 2000);
        }
        return updated;
      });
    }, 1500);
  };

  const stopHunting = () => {
    setIsHunting(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  return (
    <div style={{ marginTop: "16px", padding: "16px", background: "linear-gradient(135deg, #1a1000 0%, #2a1800 100%)", borderRadius: "16px", border: "1px solid #f59e0b33" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "20px" }}>₿</span>
          <span style={{ fontWeight: "bold", color: "#f59e0b", fontSize: "13px" }}>Bitcoin Treasure Hunter</span>
          {isHunting && <span style={{ fontSize: "10px", background: "#f59e0b", color: "#000", padding: "2px 6px", borderRadius: "10px" }}>CAÇANDO</span>}
        </div>
        <button
          onClick={isHunting ? stopHunting : startHunting}
          style={{ padding: "6px 14px", background: isHunting ? "#ef4444" : "#f59e0b", border: "none", borderRadius: "20px", color: isHunting ? "#fff" : "#000", cursor: "pointer", fontSize: "12px", fontWeight: "bold" }}
        >
          {isHunting ? "⏹ Parar" : "🔍 Caçar"}
        </button>
      </div>

      {isHunting && (
        <div style={{ position: "relative", width: "100%", height: "100px", background: "rgba(0,0,0,0.5)", borderRadius: "12px", marginBottom: "10px", overflow: "hidden" }}>
          {/* Hunter */}
          <div style={{ position: "absolute", left: `${hunterPos.x}%`, top: `${hunterPos.y}%`, fontSize: "16px", transform: "translate(-50%, -50%)", transition: "all 0.5s ease" }}>🤖</div>
          {/* Treasures */}
          {treasures.map(t => (
            <div key={t.id} style={{ position: "absolute", left: `${t.x}%`, top: `${t.y}%`, fontSize: t.found ? "10px" : "14px", transform: "translate(-50%, -50%)", opacity: t.found ? 0.3 : 1 }}>
              {t.found ? "✓" : "₿"}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
        <div style={{ color: "#94a3b8" }}>
          Total encontrado: <span style={{ color: "#f59e0b", fontWeight: "bold" }}>${totalFound.toFixed(4)}</span>
        </div>
        {lastFound && (
          <div style={{ color: "#4ade80", fontSize: "10px" }}>
            +${lastFound.value.toFixed(4)} encontrado!
          </div>
        )}
      </div>
    </div>
  );
}
