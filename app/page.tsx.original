"use client";

import { useState, useCallback, useEffect } from "react";
import { ethers } from "ethers";
import { Toaster, toast } from "react-hot-toast";

import { RealAutomatedTrader } from "./components/RealAutomatedTrader";
import BitcoinTreasureHunter from "./components/BitcoinTreasureHunter";
import { BridgeWidget } from "./components/BridgeWidget";
import { NanopaymentDashboard } from "./components/NanopaymentDashboard";
import { TradingNanopaymentDashboard } from "./components/TradingNanopaymentDashboard";
import { NetworkSwitcher } from "./components/NetworkSwitcher";
import { JobsPanel } from "./components/JobsPanel";
import { SwapBridgeModal } from "./components/SwapBridgeModal";
import { ReceiveModal } from "./components/ReceiveModal";
import { AutoTradeControl } from "./components/AutoTradeControl";
import { ProfitPool } from "./components/ProfitPool";
import { MarketMonitor } from "./components/MarketMonitor";

import { quantumAgent, technicalAgent, synthesisAgent } from "../lib/multi-agent-system";
import { marketAgent } from "../lib/market-agent";
import { volumeAgent } from "../lib/volume-agent";
import newsAgent from "../lib/news-agent";

import {
  ARC_TESTNET,
  BLUE,
  ORANGE,
  GREEN,
  BORDER,
  ERC20_ABI,
  shortAddress,
  type WalletNetwork,
} from "@/lib/wallet-config";

declare global {
  interface Window {
    ethereum?: ethers.Eip1193Provider;
  }
}

interface TxHistory {
  to: string;
  amount: string;
  time: string;
  hash: string;
  network: string;
}

export default function Home() {
  const [isClient, setIsClient] = useState(false);
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState(0n);
  const [decimals, setDecimals] = useState(6);
  const [tab, setTab] = useState<"send" | "history" | "jobs" | "bridge">("send");
  const [modal, setModal] = useState<"receive" | "swap" | "">("");
  const [history, setHistory] = useState<TxHistory[]>([]);
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [totalProfit, setTotalProfit] = useState(0);
  const [agentScores, setAgentScores] = useState<ReturnType<typeof quantumAgent.getScore>[]>(
    []
  );
  const [currentNetwork, setCurrentNetwork] = useState<WalletNetwork>(ARC_TESTNET);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const loadBalance = useCallback(
    async (addr: string) => {
      if (!addr || !window.ethereum) return;
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const usdc = new ethers.Contract(currentNetwork.usdc, ERC20_ABI, provider);
        const [bal, dec] = await Promise.all([
          usdc.balanceOf(addr),
          usdc.decimals().catch(() => 6),
        ]);
        setBalance(bal);
        setDecimals(Number(dec));
      } catch (e) {
        console.error("Erro ao buscar saldo:", e);
        setBalance(0n);
      }
    },
    [currentNetwork]
  );

  const connect = async () => {
    if (!window.ethereum) {
      toast.error("MetaMask não encontrado");
      return;
    }
    try {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: currentNetwork.chainIdHex }],
        });
      } catch (switchErr: unknown) {
        const err = switchErr as { code?: number };
        if (err.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: currentNetwork.chainIdHex,
                chainName: currentNetwork.name,
                rpcUrls: [currentNetwork.rpc],
                nativeCurrency: currentNetwork.nativeCurrency,
                blockExplorerUrls: [currentNetwork.explorer],
              },
            ],
          });
        }
      }

      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      setAccount(accounts[0]);
      toast.success(`Conectado à ${currentNetwork.name}!`);
      await loadBalance(accounts[0]);

      const scores = [
        quantumAgent.getScore(),
        technicalAgent.getScore(),
        newsAgent.getScore(),
        marketAgent.getScore(),
        volumeAgent.getScore(),
        synthesisAgent.getScore(),
      ];
      setAgentScores(scores);
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error("Erro ao conectar:", error);
      toast.error(err?.message?.slice(0, 80) || "Erro ao conectar");
    }
  };

  const send = async () => {
    if (!dest || !amount) {
      toast.error("Preencha os campos");
      return;
    }
    if (!window.ethereum) return;
    setSending(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const usdc = new ethers.Contract(currentNetwork.usdc, ERC20_ABI, signer);
      const parsed = ethers.parseUnits(amount, decimals);
      const tx = await usdc.transfer(dest, parsed);
      toast.loading("Aguardando confirmação...", { id: "tx" });
      await tx.wait();
      toast.success("Enviado!", { id: "tx" });
      setHistory((h) => [
        {
          to: dest,
          amount,
          time: new Date().toLocaleTimeString(),
          hash: tx.hash,
          network: currentNetwork.name,
        },
        ...h,
      ]);
      setDest("");
      setAmount("");
      await loadBalance(account);
    } catch (e: unknown) {
      const err = e as { reason?: string; message?: string };
      toast.error(err?.reason || err?.message?.slice(0, 60) || "Erro ao enviar");
    }
    setSending(false);
  };

  const handleNetworkSwitch = (newNetwork: WalletNetwork) => {
    setCurrentNetwork(newNetwork);
    setAccount("");
    setBalance(0n);
    toast.success(`🔄 Rede alterada para ${newNetwork.name}`);
  };

  const handleTradeExecuted = (profit: number) => {
    setTotalProfit((prev) => prev + profit);
  };

  const handleReinvest = (amt: number) => {
    toast.success(`💰 ${amt.toFixed(4)} USDC reinvestido!`);
  };

  const balanceDisplay = parseFloat(ethers.formatUnits(balance, decimals)).toFixed(2);

  if (!isClient) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#eef0f5",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        Carregando...
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#eef0f5",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <Toaster position="top-center" />
      <div
        style={{
          width: 550,
          borderRadius: 28,
          overflow: "hidden",
          boxShadow: "0 8px 40px rgba(0,0,0,0.13)",
        }}
      >
        <div
          style={{
            background: "linear-gradient(135deg, #3a6cc8 0%, #2952a3 100%)",
            padding: "20px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <NetworkSwitcher
              currentNetwork={currentNetwork}
              onSwitch={handleNetworkSwitch}
              isConnected={!!account}
            />
            {account ? (
              <span
                style={{
                  fontSize: 12,
                  background: "rgba(255,255,255,0.15)",
                  padding: "4px 10px",
                  borderRadius: 8,
                }}
              >
                🟢 {shortAddress(account)}
              </span>
            ) : (
              <button
                onClick={connect}
                style={{
                  fontSize: 12,
                  background: "rgba(255,255,255,0.25)",
                  color: "#fff",
                  border: "none",
                  padding: "4px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                Conectar
              </button>
            )}
          </div>

          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 4 }}>SALDO DISPONÍVEL</div>
            <div style={{ fontSize: 40, fontWeight: 700 }}>{balanceDisplay}</div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>USDC</div>
            {currentNetwork.isTestnet && (
              <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7 }}>
                🧪 USDC de teste - sem valor real
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-around",
              marginTop: 20,
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            {(
              [
                ["send", "✈️ Enviar"],
                ["receive", "📥 Receber"],
                ["bridge", "🔄 Bridge/Swap"],
                ["jobs", "💼 Jobs"],
                ["history", "📜 Histórico"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  if (key === "receive") setModal("receive");
                  else setTab(key);
                }}
                style={{
                  background:
                    (key === "receive" ? false : tab === key)
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(255,255,255,0.15)",
                  border: "none",
                  color: "#fff",
                  borderRadius: 12,
                  padding: "8px 10px",
                  cursor: "pointer",
                  fontSize: 11,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ background: "#fff", padding: 20, minHeight: 320 }}>
          {tab === "send" && (
            <div>
              <input
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                placeholder="Destino (0x...)"
                style={{
                  width: "100%",
                  padding: 10,
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  marginBottom: 12,
                  boxSizing: "border-box",
                }}
              />
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                placeholder="Valor"
                style={{
                  width: "100%",
                  padding: 10,
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  marginBottom: 12,
                  boxSizing: "border-box",
                }}
              />
              <button
                onClick={account ? send : connect}
                disabled={sending}
                style={{
                  width: "100%",
                  background: currentNetwork.isTestnet ? ORANGE : GREEN,
                  color: "#fff",
                  padding: 13,
                  borderRadius: 14,
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                {sending
                  ? "Enviando..."
                  : account
                    ? `Transferir USDC (${currentNetwork.shortName})`
                    : "Conectar carteira"}
              </button>
            </div>
          )}

          {tab === "bridge" && (
            <div>
              <div style={{ textAlign: "center", marginBottom: 16 }}>
                <span style={{ fontSize: 48 }}>🔄</span>
                <h3 style={{ margin: "8px 0", color: "#333" }}>Bridge / Swap</h3>
                <p style={{ fontSize: 12, color: "#6b7280" }}>
                  Swap na mesma rede ou Bridge entre redes diferentes
                </p>
              </div>
              <button
                onClick={() => setModal("swap")}
                style={{
                  width: "100%",
                  background: BLUE,
                  color: "#fff",
                  padding: 14,
                  borderRadius: 14,
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                🚀 Abrir Bridge / Swap (LI.FI)
              </button>
            </div>
          )}

          {tab === "jobs" &&
            (account ? (
              <JobsPanel account={account} network={currentNetwork} />
            ) : (
              <div style={{ textAlign: "center", color: "#9ca3af", padding: 40 }}>
                🔌 Conecte a carteira para ver os Jobs ERC-8183
              </div>
            ))}

          {tab === "history" && (
            <div>
              {history.length === 0 ? (
                <div style={{ textAlign: "center", color: "#9ca3af", paddingTop: 40 }}>
                  Nenhuma transação
                </div>
              ) : (
                history.map((h, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#f9fafb",
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 10,
                    }}
                  >
                    → {shortAddress(h.to)} -{h.amount} USDC
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>
                      {h.time} - {h.network}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {account && (
          <>
            <MarketMonitor />
            <AutoTradeControl
              account={account}
              onTradeExecuted={handleTradeExecuted}
              network={currentNetwork}
            />
            <ProfitPool
              totalProfit={totalProfit}
              onReinvest={handleReinvest}
              network={currentNetwork}
            />
            <BitcoinTreasureHunter
              onTreasureFound={(_value: number, fee: number) => {
                setTotalProfit((prev) => prev + fee);
              }}
              userAddress={account}
            />
            <BridgeWidget userAddress={account} />
            <RealAutomatedTrader
              account={account}
              currentNetwork={
                currentNetwork.id === "base"
                  ? "base"
                  : currentNetwork.id === "polygon"
                    ? "polygon"
                    : "arc"
              }
            />
            <NanopaymentDashboard
              agentScores={agentScores}
              network={currentNetwork}
              privateKey={process.env.NEXT_PUBLIC_PRIVATE_KEY}
            />
            <TradingNanopaymentDashboard
              network={currentNetwork}
              privateKey={process.env.NEXT_PUBLIC_PRIVATE_KEY}
            />
          </>
        )}

        <div
          style={{
            padding: "12px",
            borderTop: `1px solid ${BORDER}`,
            background: "#fff",
            fontSize: "10px",
            color: "#9ca3af",
            textAlign: "center",
          }}
        >
          🤖 Híbrido | {currentNetwork.isTestnet ? "🧪 TESTNET" : "💰 MAINNET"} |{" "}
          {currentNetwork.name} | TLAY Nanopayments | Bridge USDC
        </div>
      </div>

      {modal === "receive" && (
        <ReceiveModal account={account} onClose={() => setModal("")} network={currentNetwork} />
      )}
      {modal === "swap" && (
        <SwapBridgeModal
          account={account}
          onClose={() => setModal("")}
          currentNetwork={currentNetwork}
          onComplete={() => loadBalance(account)}
        />
      )}
    </div>
  );
}
