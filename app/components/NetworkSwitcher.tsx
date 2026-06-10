"use client";

import { useState } from "react";
import {
  WALLET_NETWORKS,
  ORANGE,
  GREEN,
  RED,
  type WalletNetwork,
} from "@/lib/wallet-config";

interface NetworkSwitcherProps {
  currentNetwork: WalletNetwork;
  onSwitch: (network: WalletNetwork) => void;
  isConnected: boolean;
}

export function NetworkSwitcher({
  currentNetwork,
  onSwitch,
  isConnected,
}: NetworkSwitcherProps) {
  const [showWarning, setShowWarning] = useState(false);
  const [pendingNetwork, setPendingNetwork] = useState<WalletNetwork | null>(null);

  const performSwitch = async (network: WalletNetwork) => {
    try {
      if (window.ethereum) {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: network.chainIdHex }],
        });
      }
    } catch (err: unknown) {
      const error = err as { code?: number };
      if (error.code === 4902 && window.ethereum) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: network.chainIdHex,
              chainName: network.name,
              rpcUrls: [network.rpc],
              nativeCurrency: network.nativeCurrency,
              blockExplorerUrls: [network.explorer],
            },
          ],
        });
      }
    }
    onSwitch(network);
    setShowWarning(false);
    setPendingNetwork(null);
  };

  const handleSwitch = async (network: WalletNetwork) => {
    if (!network.isTestnet && isConnected) {
      setPendingNetwork(network);
      setShowWarning(true);
      return;
    }
    await performSwitch(network);
  };

  return (
    <>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        {WALLET_NETWORKS.map((net) => (
          <button
            key={net.chainId}
            onClick={() => handleSwitch(net)}
            style={{
              padding: "4px 10px",
              borderRadius: 8,
              fontSize: 11,
              background:
                currentNetwork.chainId === net.chainId
                  ? net.isTestnet
                    ? ORANGE
                    : GREEN
                  : "rgba(255,255,255,0.15)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span>{net.icon}</span> {net.shortName}
            {net.isTestnet && <span style={{ fontSize: 8 }}>🧪</span>}
          </button>
        ))}
      </div>

      {showWarning && pendingNetwork && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 300,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: 28,
              width: 400,
              maxWidth: "90%",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h3 style={{ color: "#dc2626", marginBottom: 12 }}>Atenção! Dinheiro Real</h3>
            <p style={{ color: "#374151", marginBottom: 16 }}>
              Você está trocando para <strong>{pendingNetwork.name}</strong>, que opera com{" "}
              <strong style={{ color: RED }}>DINHEIRO REAL</strong>.
              {!pendingNetwork.isTestnet && (
                <>
                  <br />
                  <br />
                  ✅ Certifique-se que tem {pendingNetwork.nativeCurrency.symbol} para gas
                  <br />
                  ✅ Transações são irreversíveis
                  <br />✅ Comece com valores pequenos
                </>
              )}
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => performSwitch(pendingNetwork)}
                style={{
                  flex: 1,
                  background: pendingNetwork.isTestnet ? ORANGE : RED,
                  color: "#fff",
                  padding: 12,
                  borderRadius: 12,
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Sim, quero trocar
              </button>
              <button
                onClick={() => setShowWarning(false)}
                style={{
                  flex: 1,
                  background: "#e5e7eb",
                  color: "#374151",
                  padding: 12,
                  borderRadius: 12,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
