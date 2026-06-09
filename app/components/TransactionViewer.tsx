// app/components/TransactionViewer.tsx
"use client";

import { useState, useEffect } from "react";

interface Transaction {
  hash: string;
  type: string;
  amount: number;
  fromToken: string;
  toToken: string;
  status: string;
  timestamp: number;
  explorerUrl: string;
}

export function TransactionViewer({ account }: { account: string }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const loadTransactions = () => {
    const saved = localStorage.getItem('arcflow_transactions');
    if (saved) {
      setTransactions(JSON.parse(saved));
    }
  };

  useEffect(() => {
    loadTransactions();
    const interval = setInterval(loadTransactions, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ marginTop: 16, padding: 16, background: "#0f172a", borderRadius: 16, border: "1px solid #3a6cc8" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 24 }}>📜</span>
        <span style={{ fontWeight: "bold", color: "#3a6cc8" }}>HISTORICO DE TRANSACOES</span>
      </div>

      {transactions.length === 0 ? (
        <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 12, padding: 20 }}>
          Nenhuma transacao registrada.
          <br />Os robos vao aparecer aqui quando executarem trades!
        </div>
      ) : (
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
          {transactions.slice(0, 10).map((tx, i) => (
            <div key={i} style={{ padding: 12, borderBottom: "1px solid #1e293b", fontSize: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontWeight: "bold", color: "#fbbf24" }}>SWAP</span>
                <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 10, background: tx.status === "confirmed" ? "#10b981" : "#f59e0b", color: "#fff" }}>
                  {tx.status === "confirmed" ? "Confirmado" : "Pendente"}
                </span>
              </div>
              <div>{tx.amount} {tx.fromToken} → {tx.toToken}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                {new Date(tx.timestamp).toLocaleTimeString()}
                {tx.explorerUrl && (
                  <a href={tx.explorerUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#3a6cc8", marginLeft: 8, textDecoration: "none" }}>
                    Ver no ArcScan
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 9, color: "#475569", marginTop: 12, textAlign: "center" }}>
        As transacoes aparecem aqui quando os robos executam trades!
      </div>
    </div>
  );
}