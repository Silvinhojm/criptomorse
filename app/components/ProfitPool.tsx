"use client";

import { type WalletNetwork } from "@/lib/wallet-config";

interface ProfitPoolProps {
  totalProfit: number;
  onReinvest: (amount: number) => void;
  network: WalletNetwork;
}

export function ProfitPool({ totalProfit, onReinvest, network }: ProfitPoolProps) {
  return (
    <div
      style={{
        marginTop: "12px",
        padding: "12px",
        background: "#fef3c7",
        borderRadius: "12px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>🏦 Bolsão de Lucros {network.isTestnet && "(Teste)"}</span>
        <span style={{ fontWeight: "bold", color: "#16a34a" }}>
          ${totalProfit.toFixed(4)}
        </span>
      </div>
      {totalProfit > 1 && (
        <button
          onClick={() => onReinvest(totalProfit * 0.7)}
          style={{
            width: "100%",
            marginTop: "8px",
            padding: "6px",
            background: "#f59e0b",
            border: "none",
            borderRadius: "8px",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          🔄 Reinvestir
        </button>
      )}
    </div>
  );
}
