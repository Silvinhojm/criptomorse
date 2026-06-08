"use client";

import { useState, useEffect, useRef } from "react";

// Interface base do Tesouro (conforme a estrutura do seu projeto)
interface Treasure {
  id: string;
  x: number;
  y: number;
  value: number;
  found: boolean;
}

interface BitcoinTreasureHunterProps {
  onTreasureFound?: (value: number, fee: number) => void;
  userAddress?: string;
}

// Função auxiliar fictícia para geração de novos tesouros (ajuste se sua lógica for diferente)
const generateTreasures = (): Treasure[] => {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `treasure_${Date.now()}_${i}`,
    x: Math.floor(Math.random() * 100),
    y: Math.floor(Math.random() * 100),
    value: parseFloat((Math.random() * 0.05 + 0.001).toFixed(5)),
    found: false,
    // A propriedade 'dist' é injetada dinamicamente pelo loop/game engine
    dist: Math.floor(Math.random() * 30), 
  } as any));
};

export default function BitcoinTreasureHunter({ onTreasureFound, userAddress }: BitcoinTreasureHunterProps) {
  const [treasures, setTreasures] = useState<Treasure[]>([]);
  const [totalFound, setTotalFound] = useState(0);
  const [lastFound, setLastFound] = useState<Treasure | null>(null);
  const [isHunting, setIsHunting] = useState(false);
  
  // Referência para controlar o intervalo sem perder o escopo
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Inicializa a primeira leva de tesouros
  useEffect(() => {
    setTreasures(generateTreasures());
    return () => stopHunting(); // Garante a limpeza do loop caso o usuário saia da página
  }, []);

  const startHunting = () => {
    if (isHunting) return;
    setIsHunting(true);

    intervalRef.current = setInterval(() => {
      setTreasures(prev => {
        // Criamos uma lista interna para acumular o que foi achado nesta execução
        const foundTreasures: any[] = [];

        const updated = prev.map(t => {
          // Burlamos a falta da propriedade na interface original usando coerção para any
          if ((t as any).dist < 15 && !t.found) { 
            const fee = parseFloat((t.value * 0.1).toFixed(4));
            
            // Registramos o tesouro encontrado para ser despachado fora do loop de renderização
            foundTreasures.push({ ...t, fee });

            return { ...t, found: true };
          }
          return t;
        });

        // Executa todas as atualizações de estado de forma assíncrona e segura
        if (foundTreasures.length > 0) {
          setTimeout(() => {
            foundTreasures.forEach(t => {
              setTotalFound(p => p + t.value);
              setLastFound(t);
              if (onTreasureFound) {
                onTreasureFound(t.value, t.fee);
              }
            });
          }, 0);
        }

        // Se todos os tesouros do mapa foram coletados, gera uma nova rodada
        if (updated.every(t => t.found)) {
          setTimeout(() => setTreasures(generateTreasures()), 2000);
        }

        return updated;
      });
    }, 1500);
  };

  const stopHunting = () => {
    setIsHunting(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  return (
    <div style={{
      padding: "20px",
      background: "#1a1a1a",
      borderRadius: "12px",
      color: "white",
      marginTop: "20px",
      boxShadow: "0 4px 20px rgba(0,0,0,0.2)"
    }}>
      <h2 style={{ fontSize: "20px", marginBottom: "15px", color: "#f7931a" }}>
        🏴‍☠️ Caçador de Tesouros Bitcoin
      </h2>

      {userAddress && (
        <p style={{ fontSize: "12px", color: "#aaa", marginBottom: "15px" }}>
          Agente Conectado: <code style={{ color: "#86efac" }}>{userAddress}</code>
        </p>
      )}

      <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
        <button
          onClick={startHunting}
          disabled={isHunting}
          style={{
            flex: 1,
            padding: "10px",
            background: isHunting ? "#2e7d32" : "#4caf50",
            color: "white",
            border: "none",
            borderRadius: "6px",
            fontWeight: "bold",
            cursor: isHunting ? "not-allowed" : "pointer"
          }}
        >
          {isHunting ? "📡 Caçando..." : "🎯 Iniciar Caça"}
        </button>

        <button
          onClick={stopHunting}
          disabled={!isHunting}
          style={{
            flex: 1,
            padding: "10px",
            background: !isHunting ? "#c62828" : "#f44336",
            color: "white",
            border: "none",
            borderRadius: "6px",
            fontWeight: "bold",
            cursor: !isHunting ? "not-allowed" : "pointer"
          }}
        >
          Parar
        </button>
      </div>

      <div style={{ background: "#262626", padding: "15px", borderRadius: "8px", fontSize: "14px" }}>
        <div style={{ marginBottom: "8px" }}>
          🪙 <strong>Total Encontrado:</strong> {totalFound.toFixed(5)} BTC
        </div>
        {lastFound && (
          <div style={{ color: "#68d391", fontSize: "13px" }}>
            🎉 <strong>Último Achado:</strong> {lastFound.value} BTC (ID: {lastFound.id.slice(0, 12)}...)
          </div>
        )}
      </div>

      <div style={{ marginTop: "15px" }}>
        <h4 style={{ fontSize: "12px", color: "#777", marginBottom: "5px" }}>Radar de Proximidade:</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          {treasures.map(t => (
            <div key={t.id} style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              background: t.found ? "rgba(76, 175, 80, 0.1)" : "rgba(255, 255, 255, 0.05)",
              padding: "6px 10px",
              borderRadius: "4px",
              borderLeft: t.found ? "3px solid #4caf50" : "3px solid #ff9800"
            }}>
              <span>💎 Valor: {t.value} BTC</span>
              <span>Distância: {t.found ? "✓ Coletado" : `${(t as any).dist || 0}m`}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}