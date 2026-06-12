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
import { realSwap } from "@/lib/real-swap-executor";

interface SwapBridgeModalProps {
  account: string;
  onClose: () => void;
  currentNetwork: WalletNetwork;
  onComplete?: () => void;
}

const AVAILABLE_TOKENS = [
  { symbol: "USDC", name: "USD Coin", icon: "💵" },
  { symbol: "EURC", name: "Euro Coin", icon: "💶" },
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
  const [toToken, setToToken] = useState("EURC");
  const [swapAmount, setSwapAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [targetNetwork, setTargetNetwork] = useState<WalletNetwork>(BASE_MAINNET);
  const [bridgeToken, setBridgeToken] = useState("USDC");
  const [txHash, setTxHash] = useState<string>("");

  // 🔥 FUNÇÃO PARA SWAP DIRETO VIA API LI.FI
  const handleSwapDirect = async () => {
    const amount = parseFloat(swapAmount);
    
    if (isNaN(amount) || amount <= 0) {
      toast.error("Digite um valor válido (ex: 5 ou 5.50)");
      return;
    }
    
    // Verificar se é um swap válido (USDC ↔ EURC)
    const isValidSwap = (fromToken === "USDC" && toToken === "EURC") || 
                        (fromToken === "EURC" && toToken === "USDC");
    
    if (!isValidSwap) {
      toast.error("Swap suportado apenas entre USDC e EURC");
      return;
    }
    
    const action = fromToken === "USDC" && toToken === "EURC" ? "BUY" : "SELL";
    
    setIsProcessing(true);
    setTxHash("");
    
    try {
      toast.loading(`🔄 Executando swap de ${amount.toFixed(4)} ${fromToken} → ${toToken}...`, { 
        id: "swap",
        duration: 30000,
      });
      
      const result = await realSwap.executeSwap(action, amount, (msg) => {
        console.log("📡", msg);
        toast.loading(msg, { id: "swap" });
      });
      
      if (result.success) {
        toast.success(result.message, { id: "swap", duration: 8000 });
        setTxHash(result.txHash);
        
        // Abrir explorer em nova aba
        if (result.explorerUrl) {
          setTimeout(() => {
            toast.success(`🔗 Ver transação: ${result.txHash.slice(0, 10)}...`, { 
              id: "swap-link",
              duration: 10000,
              icon: "🔗",
            });
          }, 1000);
        }
        
        if (onComplete) setTimeout(onComplete, 3000);
        setTimeout(() => onClose(), 5000);
      } else {
        toast.error(result.message, { id: "swap", duration: 5000 });
      }
    } catch (error: any) {
      console.error("Erro no swap:", error);
      toast.error(`❌ Erro: ${error.message?.slice(0, 100) || "Erro desconhecido"}`, { 
        id: "swap",
        duration: 5000,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Bridge usando Jumper (mantido igual)
  const getBridgeUrl = () => {
    const fromTokenAddress = getTokenAddress(currentNetwork, bridgeToken);
    const toTokenAddress = getTokenAddress(targetNetwork, bridgeToken);
    const amountNum = parseFloat(swapAmount);
    if (isNaN(amountNum) || amountNum <= 0) return "";
    
    // Bridge usa Jumper com 6 decimais (padrão)
    const amountInWei = Math.floor(amountNum * 1_000_000);
    
    return `https://jumper.exchange/?fromChain=${currentNetwork.chainId}&fromToken=${fromTokenAddress}&toChain=${targetNetwork.chainId}&toToken=${toTokenAddress}&integrator=arcflow${account ? `&toAddress=${account}` : ""}&fromAmount=${amountInWei}`;
  };

  const handleBridge = async () => {
    const amount = parseFloat(swapAmount);
    
    if (isNaN(amount) || amount <= 0) {
      toast.error("Digite um valor válido (ex: 5 ou 5.50)");
      return;
    }
    
    setIsProcessing(true);
    try {
      toast.loading(`🌉 Preparando bridge de ${amount.toFixed(2)} ${bridgeToken}...`, { id: "bridge" });
      await new Promise((resolve) => setTimeout(resolve, 500));
      
      const url = getBridgeUrl();
      if (url) {
        window.open(url, "_blank");
        toast.success(`🌉 Bridge de ${amount.toFixed(2)} ${bridgeToken} aberta no Jumper!`, { id: "bridge" });
      } else {
        toast.error("Erro ao gerar URL da bridge", { id: "bridge" });
      }
      
      if (onComplete) setTimeout(onComplete, 3000);
      setTimeout(() => onClose(), 2000);
    } catch (error: any) {
      toast.error(`Erro: ${error.message?.slice(0, 80)}`, { id: "bridge" });
    } finally {
      setIsProcessing(false);
    }
  };

  const getEstimatedOutput = () => {
    if (!swapAmount || parseFloat(swapAmount) <= 0) return "";
    const amount = parseFloat(swapAmount);
    // Estimativa simplificada (1:1 para USDC/EURC)
    if (fromToken === "USDC" && toToken === "EURC") {
      return `≈ ${amount.toFixed(4)} EURC`;
    } else if (fromToken === "EURC" && toToken === "USDC") {
      return `≈ ${amount.toFixed(4)} USDC`;
    }
    return "";
  };

  const canSwap = () => {
    const amount = parseFloat(swapAmount);
    const isReversible = (fromToken === "USDC" && toToken === "EURC") || 
                         (fromToken === "EURC" && toToken === "USDC");
    return !isProcessing && !isNaN(amount) && amount > 0 && isReversible;
  };

  const canBridge = () => {
    const amount = parseFloat(swapAmount);
    return !isProcessing && !isNaN(amount) && amount > 0;
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
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
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
            🔄 Swap (Direto)
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
            style={{
              background: "none",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              color: "#6b7280",
            }}
          >
            ×
          </button>
        </div>

        {mode === "swap" ? (
          <>
            <h3 style={{ margin: "0 0 16px 0", fontSize: 16 }}>
              🔄 Swap Direto em {currentNetwork.shortName}
            </h3>
            
            <div style={{ 
              background: "#dbeafe", 
              borderRadius: 12, 
              padding: 12, 
              marginBottom: 16,
              fontSize: 12,
              color: "#1e40af"
            }}>
              ⚡ Swap executado diretamente na blockchain via LI.FI<br/>
              ✅ Transação real com confirmação on-chain
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>
                De:
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {AVAILABLE_TOKENS.map((token) => (
                  <button
                    key={token.symbol}
                    onClick={() => {
                      setFromToken(token.symbol);
                      if (token.symbol === "USDC") setToToken("EURC");
                      else setToToken("USDC");
                    }}
                    style={{
                      flex: 1,
                      padding: 10,
                      background: fromToken === token.symbol ? BLUE : "#e5e7eb",
                      color: fromToken === token.symbol ? "#fff" : "#374151",
                      border: "none",
                      borderRadius: 10,
                      cursor: "pointer",
                      fontWeight: fromToken === token.symbol ? 600 : 400,
                    }}
                  >
                    {token.icon} {token.symbol}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ textAlign: "center", marginBottom: 12, fontSize: 20 }}>↓</div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>
                Para:
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  style={{
                    flex: 1,
                    padding: 10,
                    background: BLUE,
                    color: "#fff",
                    border: "none",
                    borderRadius: 10,
                    fontWeight: 600,
                  }}
                >
                  {toToken === "USDC" ? "💵 USDC" : "💶 EURC"}
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>
                Valor:
              </label>
              <input
                type="number"
                step="0.01"
                value={swapAmount}
                onChange={(e) => setSwapAmount(e.target.value)}
                placeholder="0.00"
                style={{
                  width: "100%",
                  padding: 12,
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  boxSizing: "border-box",
                  fontSize: 16,
                }}
              />
              {swapAmount && parseFloat(swapAmount) > 0 && (
                <div style={{ fontSize: 12, color: "#10b981", marginTop: 6 }}>
                  ✅ {parseFloat(swapAmount).toFixed(4)} {fromToken} → {getEstimatedOutput()}
                </div>
              )}
            </div>

            {txHash && (
              <div style={{ 
                background: "#e5e7eb", 
                borderRadius: 10, 
                padding: 10, 
                marginBottom: 16,
                fontSize: 11,
                wordBreak: "break-all"
              }}>
                🔗 TX: {txHash.slice(0, 16)}...
                <a 
                  href={`${currentNetwork.explorer}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: BLUE, marginLeft: 8, textDecoration: "none" }}
                >
                  Ver no Explorer →
                </a>
              </div>
            )}

            <button
              onClick={handleSwapDirect}
              disabled={!canSwap()}
              style={{
                width: "100%",
                background: ORANGE,
                color: "#fff",
                padding: 14,
                borderRadius: 14,
                border: "none",
                cursor: canSwap() ? "pointer" : "not-allowed",
                fontWeight: 600,
                opacity: canSwap() ? 1 : 0.5,
              }}
            >
              {isProcessing 
                ? "⏳ Processando transação..." 
                : !swapAmount || parseFloat(swapAmount) <= 0 
                  ? "💰 Digite um valor" 
                  : `🔄 Swappar ${parseFloat(swapAmount).toFixed(2)} ${fromToken} → ${toToken}`}
            </button>

            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 12, textAlign: "center" }}>
              ⚡ Taxa de rede (gas) será cobrada em {currentNetwork.nativeCurrency.symbol}<br/>
              ✅ Confirmação leva ~15-30 segundos
            </p>
          </>
        ) : (
          <>
            <h3 style={{ margin: "0 0 16px 0", fontSize: 16 }}>🌉 Bridge Cross-Chain (Jumper)</h3>

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
                step="0.01"
                value={swapAmount}
                onChange={(e) => setSwapAmount(e.target.value)}
                placeholder="0.00"
                style={{
                  width: "100%",
                  padding: 12,
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  boxSizing: "border-box",
                  fontSize: 16,
                }}
              />
              {swapAmount && parseFloat(swapAmount) > 0 && (
                <div style={{ fontSize: 12, color: "#10b981", marginTop: 6 }}>
                  ✅ {parseFloat(swapAmount).toFixed(2)} {bridgeToken}
                </div>
              )}
            </div>

            <div style={{ background: "#fef3c7", borderRadius: 12, padding: 12, marginBottom: 20 }}>
              <p style={{ fontSize: 12, margin: 0, color: "#92400e" }}>
                ⚠️ Você será redirecionado para o Jumper Exchange para completar a bridge.
              </p>
            </div>

            <button
              onClick={handleBridge}
              disabled={!canBridge()}
              style={{
                width: "100%",
                background: GREEN,
                color: "#fff",
                padding: 14,
                borderRadius: 14,
                border: "none",
                cursor: canBridge() ? "pointer" : "not-allowed",
                fontWeight: 600,
                opacity: canBridge() ? 1 : 0.5,
              }}
            >
              {isProcessing
                ? "⏳ Processando..."
                : !swapAmount || parseFloat(swapAmount) <= 0
                  ? "💰 Digite um valor"
                  : `🌉 Bridge ${parseFloat(swapAmount).toFixed(2)} ${bridgeToken} → ${targetNetwork.shortName}`}
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