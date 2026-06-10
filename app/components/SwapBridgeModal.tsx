"use client";

import { useState } from "react";
import { toast } from "react-hot-toast";
import {
  BLUE,
  ORANGE,
  GREEN,
  BORDER,
  BASE_MAINNET,
  BRIDGE_TARGET_NETWORKS,
  type WalletNetwork,
} from "@/lib/wallet-config";

interface SwapBridgeModalProps {
  account: string;
  onClose: () => void;
  currentNetwork: WalletNetwork;
  onComplete?: () => void;
}

const AVAILABLE_TOKENS = [
  { symbol: "USDC", name: "USD Coin", icon: "💵" },
  { symbol: "EURC", name: "Euro Coin", icon: "💶" },
  { symbol: "USDT", name: "Tether", icon: "🪙" },
  { symbol: "DAI", name: "Dai", icon: "🏦" },
];

function getTokenAddress(network: WalletNetwork, tokenSymbol: string): string {
  if (tokenSymbol === "USDC") return network.usdc;
  if (tokenSymbol === "EURC") return network.eurc;
  return network.usdc;
}

export function SwapBridgeModal({
  account,
  onClose,
  currentNetwork,
  onComplete,
}: SwapBridgeModalProps) {
  const [mode, setMode] = useState<"swap" | "bridge">("swap");
  const [fromToken, setFromToken] = useState("USDC");
  const [toToken, setToToken] = useState("USDC");
  const [swapAmount, setSwapAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [targetNetwork, setTargetNetwork] = useState<WalletNetwork>(BASE_MAINNET);
  const [bridgeToken, setBridgeToken] = useState("USDC");

  const getSwapUrl = () => {
    const fromTokenAddress = getTokenAddress(currentNetwork, fromToken);
    const toTokenAddress = getTokenAddress(currentNetwork, toToken);
    const amountInWei = parseFloat(swapAmount) * 1000000 || 0;
    return `https://jumper.exchange/?fromChain=${currentNetwork.chainId}&fromToken=${fromTokenAddress}&toChain=${currentNetwork.chainId}&toToken=${toTokenAddress}&integrator=arcflow${account ? `&toAddress=${account}` : ""}&fromAmount=${amountInWei}`;
  };

  const getBridgeUrl = () => {
    const fromTokenAddress = getTokenAddress(currentNetwork, bridgeToken);
    const toTokenAddress = getTokenAddress(targetNetwork, bridgeToken);
    const amountInWei = parseFloat(swapAmount) * 1000000 || 0;
    return `https://jumper.exchange/?fromChain=${currentNetwork.chainId}&fromToken=${fromTokenAddress}&toChain=${targetNetwork.chainId}&toToken=${toTokenAddress}&integrator=arcflow${account ? `&toAddress=${account}` : ""}&fromAmount=${amountInWei}`;
  };

  const handleSwap = async () => {
    if (!swapAmount || parseFloat(swapAmount) <= 0) {
      toast.error("Digite um valor válido");
      return;
    }
    setIsProcessing(true);
    try {
      toast.loading("Preparando swap...", { id: "swap" });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      window.open(getSwapUrl(), "_blank");
      toast.success("Redirecionando para LI.FI para concluir!", { id: "swap" });
      if (onComplete) setTimeout(onComplete, 3000);
      onClose();
    } catch {
      toast.error("Erro ao processar", { id: "swap" });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBridge = async () => {
    if (!swapAmount || parseFloat(swapAmount) <= 0) {
      toast.error("Digite um valor válido");
      return;
    }
    setIsProcessing(true);
    try {
      toast.loading("Preparando bridge...", { id: "bridge" });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      window.open(getBridgeUrl(), "_blank");
      toast.success("Redirecionando para LI.FI para fazer bridge!", { id: "bridge" });
      if (onComplete) setTimeout(onComplete, 3000);
      onClose();
    } catch {
      toast.error("Erro ao processar bridge", { id: "bridge" });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
      }}
    >
      <div
        style={{
          background: "#f2f3f5",
          borderRadius: 20,
          padding: 24,
          width: 520,
          maxWidth: "90%",
          maxHeight: "85%",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          <button
            onClick={() => setMode("swap")}
            style={{
              flex: 1,
              padding: "10px",
              background: mode === "swap" ? BLUE : "#e5e7eb",
              color: mode === "swap" ? "#fff" : "#374151",
              border: "none",
              borderRadius: 10,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            🔄 Swap na {currentNetwork.shortName}
          </button>
          <button
            onClick={() => setMode("bridge")}
            style={{
              flex: 1,
              padding: "10px",
              background: mode === "bridge" ? BLUE : "#e5e7eb",
              color: mode === "bridge" ? "#fff" : "#374151",
              border: "none",
              borderRadius: 10,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            🌉 Bridge (Cross-Chain)
          </button>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}
          >
            ×
          </button>
        </div>

        {mode === "swap" ? (
          <>
            <h3 style={{ margin: "0 0 16px 0", fontSize: 16 }}>
              🔄 Swap em {currentNetwork.shortName}
            </h3>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>
                De:
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {AVAILABLE_TOKENS.map((token) => (
                  <button
                    key={token.symbol}
                    onClick={() => setFromToken(token.symbol)}
                    style={{
                      flex: 1,
                      padding: 10,
                      background: fromToken === token.symbol ? BLUE : "#e5e7eb",
                      color: fromToken === token.symbol ? "#fff" : "#374151",
                      border: "none",
                      borderRadius: 10,
                      cursor: "pointer",
                    }}
                  >
                    {token.icon} {token.symbol}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ textAlign: "center", marginBottom: 12 }}>↓</div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>
                Para:
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {AVAILABLE_TOKENS.map((token) => (
                  <button
                    key={token.symbol}
                    onClick={() => setToToken(token.symbol)}
                    style={{
                      flex: 1,
                      padding: 10,
                      background: toToken === token.symbol ? BLUE : "#e5e7eb",
                      color: toToken === token.symbol ? "#fff" : "#374151",
                      border: "none",
                      borderRadius: 10,
                      cursor: "pointer",
                    }}
                  >
                    {token.icon} {token.symbol}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>
                Valor:
              </label>
              <input
                type="number"
                value={swapAmount}
                onChange={(e) => setSwapAmount(e.target.value)}
                placeholder="0.00"
                style={{
                  width: "100%",
                  padding: 12,
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  boxSizing: "border-box",
                }}
              />
            </div>

            <button
              onClick={handleSwap}
              disabled={isProcessing}
              style={{
                width: "100%",
                background: ORANGE,
                color: "#fff",
                padding: 14,
                borderRadius: 14,
                border: "none",
                cursor: isProcessing ? "not-allowed" : "pointer",
                fontWeight: 600,
                opacity: isProcessing ? 0.7 : 1,
              }}
            >
              {isProcessing ? "Processando..." : `🔄 Swappar ${fromToken} → ${toToken}`}
            </button>
          </>
        ) : (
          <>
            <h3 style={{ margin: "0 0 16px 0", fontSize: 16 }}>🌉 Bridge Cross-Chain</h3>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>
                Rede de origem:
              </label>
              <div
                style={{
                  background: "#fff",
                  borderRadius: 10,
                  padding: 12,
                  border: `1px solid ${BORDER}`,
                }}
              >
                <span>
                  {currentNetwork.icon} {currentNetwork.name}
                </span>
                {currentNetwork.isTestnet && (
                  <span style={{ fontSize: 11, color: ORANGE, marginLeft: 8 }}>(TESTNET)</span>
                )}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>
                Rede de destino:
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {BRIDGE_TARGET_NETWORKS.map((net) => (
                  <button
                    key={net.chainId}
                    onClick={() => setTargetNetwork(net)}
                    style={{
                      flex: 1,
                      padding: 10,
                      background: targetNetwork.chainId === net.chainId ? GREEN : "#e5e7eb",
                      color: targetNetwork.chainId === net.chainId ? "#fff" : "#374151",
                      border: "none",
                      borderRadius: 10,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <span>{net.icon}</span> {net.shortName}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>
                Token:
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {AVAILABLE_TOKENS.map((token) => (
                  <button
                    key={token.symbol}
                    onClick={() => setBridgeToken(token.symbol)}
                    style={{
                      flex: 1,
                      padding: 10,
                      background: bridgeToken === token.symbol ? BLUE : "#e5e7eb",
                      color: bridgeToken === token.symbol ? "#fff" : "#374151",
                      border: "none",
                      borderRadius: 10,
                      cursor: "pointer",
                    }}
                  >
                    {token.icon} {token.symbol}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>
                Valor:
              </label>
              <input
                type="number"
                value={swapAmount}
                onChange={(e) => setSwapAmount(e.target.value)}
                placeholder="0.00"
                style={{
                  width: "100%",
                  padding: 12,
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ background: "#fef3c7", borderRadius: 12, padding: 12, marginBottom: 20 }}>
              <p style={{ fontSize: 12, margin: 0, color: "#92400e" }}>
                ⚠️ <strong>Importante:</strong> Bridge de {currentNetwork.shortName} →{" "}
                {targetNetwork.shortName}
                {currentNetwork.isTestnet && !targetNetwork.isTestnet && (
                  <span> (Testnet → Mainnet)</span>
                )}
              </p>
            </div>

            <button
              onClick={handleBridge}
              disabled={isProcessing}
              style={{
                width: "100%",
                background: GREEN,
                color: "#fff",
                padding: 14,
                borderRadius: 14,
                border: "none",
                cursor: isProcessing ? "not-allowed" : "pointer",
                fontWeight: 600,
                opacity: isProcessing ? 0.7 : 1,
              }}
            >
              {isProcessing
                ? "Processando..."
                : `🌉 Bridge ${swapAmount || "0"} ${bridgeToken} → ${targetNetwork.shortName}`}
            </button>
          </>
        )}

        <button
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 12,
            background: "#e5e7eb",
            color: "#374151",
            padding: 12,
            borderRadius: 14,
            border: "none",
            cursor: "pointer",
          }}
        >
          Fechar
        </button>
      </div>
    </div>
  );
}
