"use client";

import { toast } from "react-hot-toast";
import { BLUE, ORANGE, type WalletNetwork } from "@/lib/wallet-config";

interface ReceiveModalProps {
  account: string;
  onClose: () => void;
  network: WalletNetwork;
}

export function ReceiveModal({ account, onClose, network }: ReceiveModalProps) {
  const copy = () => {
    navigator.clipboard.writeText(account);
    toast.success("Endereço copiado!");
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div style={{ background: "#f2f3f5", borderRadius: 20, padding: 24, width: 340 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 4,
          }}
        >
          <h3 style={{ margin: 0 }}>
            Receber {network.isTestnet ? "USDC (Teste)" : "USDC"}
          </h3>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            background: "#fff",
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 12,
            wordBreak: "break-all",
            fontFamily: "monospace",
            fontSize: 11,
          }}
        >
          {account}
        </div>
        <button
          onClick={copy}
          style={{
            width: "100%",
            background: BLUE,
            color: "#fff",
            padding: 12,
            borderRadius: 12,
            border: "none",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          📋 Copiar endereço
        </button>
        {network.isTestnet && (
          <p style={{ fontSize: 10, color: ORANGE, marginTop: 12, textAlign: "center" }}>
            🧪 Rede de teste - USDC sem valor real
          </p>
        )}
      </div>
    </div>
  );
}
