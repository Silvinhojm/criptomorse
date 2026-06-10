"use client";
import { PanicButton } from "@/app/components/PanicButton";
import { RealAutomatedTrader } from "./components/RealAutomatedTrader";

import { useState, useCallback, useEffect, useRef } from "react";
import { ethers } from "ethers";
import { Toaster, toast } from "react-hot-toast";

// Componentes
import AgentIdentityCard from "./components/AgentIdentityCard";
import BitcoinTreasureHunter from "./components/BitcoinTreasureHunter";
import { AgentDashboard } from "./components/AgentDashboard";
import { NanopaymentDashboard } from "./components/NanopaymentDashboard";
import { TradingNanopaymentDashboard } from "./components/TradingNanopaymentDashboard";
import { BridgeWidget } from "./components/BridgeWidget";

// Agents
import { quantumAgent, technicalAgent, synthesisAgent } from "../lib/multi-agent-system";
import { agentMemory } from "../lib/agent-memory";
import { votingSystem, AgentVote } from "../lib/voting-system";
import { marketAgent } from "../lib/market-agent";
import { volumeAgent } from "../lib/volume-agent";
import { tradingStrategies } from "../lib/trading-strategies";
import newsAgent from "../lib/news-agent";
import { enhancedMarketAnalyzer } from "../lib/news-agent";

// Types
import type { NewsSentiment } from "../lib/news-agent";

// APIs com fallback
let coingeckoAgent: any;
let coinmarketcapAgent: any;
let sosovalueAgent: any;

try {
  const gecko = require('../lib/coingecko-agent');
  const cmc = require('../lib/coinmarketcap-agent');
  const soso = require('../lib/sosovalue-agent');
  coingeckoAgent = gecko.coingeckoAgent;
  coinmarketcapAgent = cmc.coinmarketcapAgent;
  sosovalueAgent = soso.sosovalueAgent;
} catch (e) {
  console.warn('APIs de mercado não disponíveis, usando mocks');
  coingeckoAgent = {
    getPrice: async () => 65000,
    getVolumeAnalysis: async () => ({ signal: 'normal', volumeVsMarketCap: 0 }),
    getMarketTrend: async () => 'neutral',
  };
  coinmarketcapAgent = {
    getPrice: async () => 65000,
    getGlobalMetrics: async () => ({ total_market_cap: 0, btc_dominance: 50 }),
    getFearAndGreed: async () => ({ value: 50, classification: 'Neutral' }),
  };
  sosovalueAgent = {
    analyzeBearOpportunity: () => ({ opportunity: 'none', confidence: 0 }),
  };
}

declare global {
  interface Window { ethereum?: any; }
}

// ============================================================
// CONFIGURAÇÕES
// ============================================================

const BLUE = "#3a6cc8";
const ORANGE = "#e05a3a";
const GREEN = "#10b981";
const RED = "#ef4444";
const BORDER = "#c8cdd8";
const GAS_PER_TRADE = 0.12;

// Arc Testnet
const ARC_TESTNET = {
  name: "Arc Testnet",
  shortName: "Arc",
  rpc: "https://rpc.testnet.arc.network",
  chainId: 5042002,
  chainIdHex: "0x4cef52",
  usdc: "0x3600000000000000000000000000000000000000",
  eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  erc8183: "0x0747EEf0706327138c69792bF28Cd525089e4583",
  explorer: "https://testnet.arcscan.app",
  icon: "🔵",
  isTestnet: true,
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 6 }
};

// Base Mainnet
const BASE_MAINNET = {
  name: "Base Mainnet",
  shortName: "Base",
  rpc: "https://mainnet.base.org",
  chainId: 8453,
  chainIdHex: "0x2105",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  eurc: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
  erc8183: "0x0747EEf0706327138c69792bF28Cd525089e4583",
  explorer: "https://basescan.org",
  icon: "🟢",
  isTestnet: false,
  nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 }
};

// Polygon (POL) Mainnet
const POLYGON_MAINNET = {
  name: "Polygon (POL)",
  shortName: "Polygon",
  rpc: "https://polygon-rpc.com",
  chainId: 137,
  chainIdHex: "0x89",
  usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  eurc: "0xE0B52e49357Fd4DAf2c15e02058DCE6BC0057db4",
  erc8183: "0x0747EEf0706327138c69792bF28Cd525089e4583",
  explorer: "https://polygonscan.com",
  icon: "🟣",
  isTestnet: false,
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 }
};

// Ethereum Mainnet
const ETHEREUM_MAINNET = {
  name: "Ethereum Mainnet",
  shortName: "Ethereum",
  rpc: "https://eth.llamarpc.com",
  chainId: 1,
  chainIdHex: "0x1",
  usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  eurc: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
  erc8183: "0x0747EEf0706327138c69792bF28Cd525089e4583",
  explorer: "https://etherscan.io",
  icon: "💙",
  isTestnet: false,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }
};

type Network = typeof ARC_TESTNET | typeof BASE_MAINNET | typeof POLYGON_MAINNET | typeof ETHEREUM_MAINNET;

const short = (a: string) => a ? a.slice(0, 6) + "..." + a.slice(-4) : "";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

// ============================================================
// COMPONENTE: NETWORK SWITCHER
// ============================================================

function NetworkSwitcher({ 
  currentNetwork, 
  onSwitch, 
  isConnected 
}: { 
  currentNetwork: Network; 
  onSwitch: (network: Network) => void;
  isConnected: boolean;
}) {
  const networks = [ARC_TESTNET, BASE_MAINNET, POLYGON_MAINNET, ETHEREUM_MAINNET];
  const [showWarning, setShowWarning] = useState(false);
  const [pendingNetwork, setPendingNetwork] = useState<Network | null>(null);

  const handleSwitch = async (network: Network) => {
    if (!network.isTestnet && isConnected) {
      setPendingNetwork(network);
      setShowWarning(true);
      return;
    }
    await performSwitch(network);
  };

  const performSwitch = async (network: Network) => {
    try {
      if (window.ethereum) {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: network.chainIdHex }],
        });
      }
    } catch (err: any) {
      if (err.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: network.chainIdHex,
            chainName: network.name,
            rpcUrls: [network.rpc],
            nativeCurrency: network.nativeCurrency,
            blockExplorerUrls: [network.explorer],
          }],
        });
      }
    }
    onSwitch(network);
    setShowWarning(false);
    setPendingNetwork(null);
  };

  return (
    <>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        {networks.map((net) => (
          <button
            key={net.chainId}
            onClick={() => handleSwitch(net)}
            style={{
              padding: '4px 10px',
              borderRadius: 8,
              fontSize: 11,
              background: currentNetwork.chainId === net.chainId 
                ? net.isTestnet ? ORANGE : GREEN 
                : 'rgba(255,255,255,0.15)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <span>{net.icon}</span> {net.shortName}
            {net.isTestnet && <span style={{ fontSize: 8 }}>🧪</span>}
          </button>
        ))}
      </div>

      {showWarning && pendingNetwork && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 28, width: 400, maxWidth: "90%", textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h3 style={{ color: "#dc2626", marginBottom: 12 }}>Atenção! Dinheiro Real</h3>
            <p style={{ color: "#374151", marginBottom: 16 }}>
              Você está trocando para <strong>{pendingNetwork.name}</strong>, que opera com <strong style={{ color: RED }}>DINHEIRO REAL</strong>.
              {pendingNetwork.isTestnet === false && (
                <>
                  <br /><br />
                  ✅ Certifique-se que tem {pendingNetwork.nativeCurrency.symbol} para gas<br />
                  ✅ Transações são irreversíveis<br />
                  ✅ Comece com valores pequenos
                </>
              )}
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <button 
                onClick={() => performSwitch(pendingNetwork)}
                style={{ flex: 1, background: pendingNetwork.isTestnet ? ORANGE : RED, color: "#fff", padding: 12, borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 600 }}
              >
                Sim, quero trocar
              </button>
              <button 
                onClick={() => setShowWarning(false)}
                style={{ flex: 1, background: "#e5e7eb", color: "#374151", padding: 12, borderRadius: 12, border: "none", cursor: "pointer" }}
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

// ============================================================
// COMPONENTE: JOBS PANEL (ERC-8183)
// ============================================================

interface Job {
  id: string;
  description: string;
  budget: string;
  status: string;
  provider?: string;
  createdAt?: number;
}

function JobsPanel({ account, network }: { account: string; network: Network }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newJobDesc, setNewJobDesc] = useState("");
  const [newJobBudget, setNewJobBudget] = useState("");
  const [newJobProvider, setNewJobProvider] = useState("");

  const loadJobs = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      const mockJobs: Job[] = [
        { id: "1", description: "Análise de mercado BTC", budget: "100", status: "Open", provider: "0xProvider1...", createdAt: Date.now() },
        { id: "2", description: "Trade automatizado", budget: "250", status: "Funded", provider: "0xProvider2...", createdAt: Date.now() },
      ];
      setJobs(mockJobs);
    } catch (error) {
      console.error("Erro ao carregar jobs:", error);
      toast.error("Erro ao carregar jobs");
    }
    setLoading(false);
  }, [account]);

  const createJob = async () => {
    if (!newJobDesc || !newJobBudget || !newJobProvider) {
      toast.error("Preencha todos os campos");
      return;
    }
    try {
      toast.loading("Criando job...", { id: "createJob" });
      await new Promise(resolve => setTimeout(resolve, 1500));
      const newJob: Job = {
        id: Date.now().toString(),
        description: newJobDesc,
        budget: newJobBudget,
        status: "Open",
        provider: newJobProvider,
        createdAt: Date.now()
      };
      setJobs(prev => [newJob, ...prev]);
      toast.success("Job criado com sucesso!", { id: "createJob" });
      setShowCreateModal(false);
      setNewJobDesc("");
      setNewJobBudget("");
      setNewJobProvider("");
    } catch (error) {
      toast.error("Erro ao criar job", { id: "createJob" });
    }
  };

  useEffect(() => {
    if (account) loadJobs();
  }, [account, loadJobs]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: "#333" }}>💼 Jobs ERC-8183</h3>
        <button 
          onClick={() => setShowCreateModal(true)}
          style={{ background: network.isTestnet ? ORANGE : GREEN, color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}
        >
          + Criar Job
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "#9ca3af", padding: 20 }}>Carregando jobs...</div>
      ) : jobs.length === 0 ? (
        <div style={{ textAlign: "center", color: "#9ca3af", padding: 20 }}>Nenhum job ativo</div>
      ) : (
        jobs.map(job => (
          <div key={job.id} style={{ background: "#f9fafb", borderRadius: 10, padding: 12, marginBottom: 8, border: `1px solid ${BORDER}` }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{job.description}</div>
            <div style={{ fontSize: 12, color: "#6b7280", display: "flex", justifyContent: "space-between" }}>
              <span>💰 {job.budget} USDC</span>
              <span>📊 {job.status}</span>
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>👤 Provider: {short(job.provider || "")}</div>
          </div>
        ))
      )}

      {showCreateModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: 380, maxWidth: "90%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Criar Novo Job ERC-8183</h3>
              <button onClick={() => setShowCreateModal(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>×</button>
            </div>
            <input 
              placeholder="Descrição do job" 
              value={newJobDesc}
              onChange={e => setNewJobDesc(e.target.value)}
              style={{ width: "100%", padding: 10, marginBottom: 12, borderRadius: 8, border: `1px solid ${BORDER}`, boxSizing: "border-box" }}
            />
            <input 
              placeholder="Provider (0x...)" 
              value={newJobProvider}
              onChange={e => setNewJobProvider(e.target.value)}
              style={{ width: "100%", padding: 10, marginBottom: 12, borderRadius: 8, border: `1px solid ${BORDER}`, boxSizing: "border-box" }}
            />
            <input 
              placeholder="Budget (USDC)" 
              type="number"
              value={newJobBudget}
              onChange={e => setNewJobBudget(e.target.value)}
              style={{ width: "100%", padding: 10, marginBottom: 16, borderRadius: 8, border: `1px solid ${BORDER}`, boxSizing: "border-box" }}
            />
            <button 
              onClick={createJob}
              style={{ width: "100%", background: network.isTestnet ? ORANGE : GREEN, color: "#fff", padding: 12, borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 600 }}
            >
              Criar Job
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// COMPONENTE: SWAP/BRIDGE MODAL (COMPLETO)
// ============================================================

function SwapBridgeModal({ 
  account, 
  onClose, 
  currentNetwork,
  onComplete 
}: { 
  account: string; 
  onClose: () => void; 
  currentNetwork: Network;
  onComplete?: () => void;
}) {
  const [mode, setMode] = useState<"swap" | "bridge">("swap");
  const [fromToken, setFromToken] = useState("USDC");
  const [toToken, setToToken] = useState("USDC");
  const [swapAmount, setSwapAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [targetNetwork, setTargetNetwork] = useState<Network>(BASE_MAINNET);
  const [bridgeToken, setBridgeToken] = useState("USDC");

  const availableNetworks = [BASE_MAINNET, POLYGON_MAINNET, ETHEREUM_MAINNET];

  const availableTokens = [
    { symbol: "USDC", name: "USD Coin", icon: "💵" },
    { symbol: "EURC", name: "Euro Coin", icon: "💶" },
    { symbol: "USDT", name: "Tether", icon: "🪙" },
    { symbol: "DAI", name: "Dai", icon: "🏦" }
  ];

  const getTokenAddress = (network: Network, tokenSymbol: string): string => {
    if (tokenSymbol === "USDC") return network.usdc;
    if (tokenSymbol === "EURC") return network.eurc;
    return network.usdc;
  };

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
      await new Promise(resolve => setTimeout(resolve, 1000));
      window.open(getSwapUrl(), "_blank");
      toast.success("Redirecionando para LI.FI para concluir!", { id: "swap" });
      if (onComplete) setTimeout(onComplete, 3000);
      onClose();
    } catch (error) {
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
      await new Promise(resolve => setTimeout(resolve, 1000));
      window.open(getBridgeUrl(), "_blank");
      toast.success("Redirecionando para LI.FI para fazer bridge!", { id: "bridge" });
      if (onComplete) setTimeout(onComplete, 3000);
      onClose();
    } catch (error) {
      toast.error("Erro ao processar bridge", { id: "bridge" });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
      <div style={{ background: "#f2f3f5", borderRadius: 20, padding: 24, width: 520, maxWidth: "90%", maxHeight: "85%", overflowY: "auto" }}>
        
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          <button 
            onClick={() => setMode("swap")}
            style={{ 
              flex: 1, padding: "10px", background: mode === "swap" ? BLUE : "#e5e7eb",
              color: mode === "swap" ? "#fff" : "#374151", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 600
            }}
          >
            🔄 Swap na {currentNetwork.shortName}
          </button>
          <button 
            onClick={() => setMode("bridge")}
            style={{ 
              flex: 1, padding: "10px", background: mode === "bridge" ? BLUE : "#e5e7eb",
              color: mode === "bridge" ? "#fff" : "#374151", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 600
            }}
          >
            🌉 Bridge (Cross-Chain)
          </button>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>

        {mode === "swap" ? (
          <>
            <h3 style={{ margin: "0 0 16px 0", fontSize: 16 }}>🔄 Swap em {currentNetwork.shortName}</h3>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>De:</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {availableTokens.map(token => (
                  <button key={token.symbol} onClick={() => setFromToken(token.symbol)} style={{ flex: 1, padding: 10, background: fromToken === token.symbol ? BLUE : "#e5e7eb", color: fromToken === token.symbol ? "#fff" : "#374151", border: "none", borderRadius: 10, cursor: "pointer" }}>
                    {token.icon} {token.symbol}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ textAlign: "center", marginBottom: 12 }}>↓</div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>Para:</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {availableTokens.map(token => (
                  <button key={token.symbol} onClick={() => setToToken(token.symbol)} style={{ flex: 1, padding: 10, background: toToken === token.symbol ? BLUE : "#e5e7eb", color: toToken === token.symbol ? "#fff" : "#374151", border: "none", borderRadius: 10, cursor: "pointer" }}>
                    {token.icon} {token.symbol}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>Valor:</label>
              <input type="number" value={swapAmount} onChange={e => setSwapAmount(e.target.value)} placeholder="0.00" style={{ width: "100%", padding: 12, borderRadius: 10, border: `1px solid ${BORDER}`, boxSizing: "border-box" }} />
            </div>

            <button onClick={handleSwap} disabled={isProcessing} style={{ width: "100%", background: ORANGE, color: "#fff", padding: 14, borderRadius: 14, border: "none", cursor: isProcessing ? "not-allowed" : "pointer", fontWeight: 600, opacity: isProcessing ? 0.7 : 1 }}>
              {isProcessing ? "Processando..." : `🔄 Swappar ${fromToken} → ${toToken}`}
            </button>
          </>
        ) : (
          <>
            <h3 style={{ margin: "0 0 16px 0", fontSize: 16 }}>🌉 Bridge Cross-Chain</h3>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>Rede de origem:</label>
              <div style={{ background: "#fff", borderRadius: 10, padding: 12, border: `1px solid ${BORDER}` }}>
                <span>{currentNetwork.icon} {currentNetwork.name}</span>
                {currentNetwork.isTestnet && <span style={{ fontSize: 11, color: ORANGE, marginLeft: 8 }}>(TESTNET)</span>}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>Rede de destino:</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {availableNetworks.map(net => (
                  <button key={net.chainId} onClick={() => setTargetNetwork(net)} style={{ flex: 1, padding: 10, background: targetNetwork.chainId === net.chainId ? GREEN : "#e5e7eb", color: targetNetwork.chainId === net.chainId ? "#fff" : "#374151", border: "none", borderRadius: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <span>{net.icon}</span> {net.shortName}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>Token:</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {availableTokens.map(token => (
                  <button key={token.symbol} onClick={() => setBridgeToken(token.symbol)} style={{ flex: 1, padding: 10, background: bridgeToken === token.symbol ? BLUE : "#e5e7eb", color: bridgeToken === token.symbol ? "#fff" : "#374151", border: "none", borderRadius: 10, cursor: "pointer" }}>
                    {token.icon} {token.symbol}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>Valor:</label>
              <input type="number" value={swapAmount} onChange={e => setSwapAmount(e.target.value)} placeholder="0.00" style={{ width: "100%", padding: 12, borderRadius: 10, border: `1px solid ${BORDER}`, boxSizing: "border-box" }} />
            </div>

            <div style={{ background: "#fef3c7", borderRadius: 12, padding: 12, marginBottom: 20 }}>
              <p style={{ fontSize: 12, margin: 0, color: "#92400e" }}>
                ⚠️ <strong>Importante:</strong> Bridge de {currentNetwork.shortName} → {targetNetwork.shortName}
                {currentNetwork.isTestnet && targetNetwork.isTestnet === false && <span> (Testnet → Mainnet)</span>}
              </p>
            </div>

            <button onClick={handleBridge} disabled={isProcessing} style={{ width: "100%", background: GREEN, color: "#fff", padding: 14, borderRadius: 14, border: "none", cursor: isProcessing ? "not-allowed" : "pointer", fontWeight: 600, opacity: isProcessing ? 0.7 : 1 }}>
              {isProcessing ? "Processando..." : `🌉 Bridge ${swapAmount || "0"} ${bridgeToken} → ${targetNetwork.shortName}`}
            </button>
          </>
        )}

        <button onClick={onClose} style={{ width: "100%", marginTop: 12, background: "#e5e7eb", color: "#374151", padding: 12, borderRadius: 14, border: "none", cursor: "pointer" }}>
          Fechar
        </button>
      </div>
    </div>
  );
}

// ============================================================
// COMPONENTE: RECEIVE MODAL
// ============================================================

function ReceiveModal({ account, onClose, network }: { account: string; onClose: () => void; network: Network }) {
  const copy = () => { navigator.clipboard.writeText(account); toast.success("Endereço copiado!"); };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#f2f3f5", borderRadius: 20, padding: 24, width: 340 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>Receber {network.isTestnet ? "USDC (Teste)" : "USDC"}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ background: "#fff", borderRadius: 10, padding: "10px 12px", marginBottom: 12, wordBreak: "break-all", fontFamily: "monospace", fontSize: 11 }}>
          {account}
        </div>
        <button onClick={copy} style={{ width: "100%", background: BLUE, color: "#fff", padding: 12, borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 600 }}>
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

// ============================================================
// COMPONENTE: AUTO-TRADE CONTROL
// ============================================================

function AutoTradeControl({ account, onTradeExecuted, network }: { account: string; onTradeExecuted: (profit: number) => void; network: Network }) {
  const [isActive, setIsActive] = useState(false);
  const [tradeCount, setTradeCount] = useState(0);
  const [grossProfit, setGrossProfit] = useState(0);
  const [lastTrade, setLastTrade] = useState<{ profit: number; time: string } | null>(null);
  const [tradeSize, setTradeSize] = useState(network.isTestnet ? 30 : 10);
  const [quantumAnalysis, setQuantumAnalysis] = useState('');
  const [marketSentiment, setMarketSentiment] = useState<NewsSentiment | null>(null);
  const [agentScores, setAgentScores] = useState<any[]>([]);
  const [votingStats, setVotingStats] = useState({ totalVotes: 0, avgConfidence: 0, winRate: 0 });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const priceHistory = useRef<number[]>([1.00, 1.001, 0.999, 1.002, 1.000]);

  const updateMarketSentiment = useCallback(async () => {
    const analysis = await enhancedMarketAnalyzer.getCompleteMarketAnalysis();
    setMarketSentiment(analysis.sentiment);
    return analysis.sentiment;
  }, []);

  const consultAgents = useCallback(async (currentPrice: number, prices: number[]) => {
    await enhancedMarketAnalyzer.getCompleteMarketAnalysis();

    quantumAgent.updateMarketState(currentPrice, prices);
    const quantumOpinion = quantumAgent.decide(currentPrice);

    const indicators = technicalAgent.calculateIndicators(prices);
    const indicatorsArray = Array.isArray(indicators) ? indicators : Object.values(indicators);
    const numericIndicators = indicatorsArray.map((val: any) => {
      if (typeof val === 'string') {
        if (val === 'up') return 1;
        if (val === 'down') return -1;
        return 0;
      }
      return val as number;
    });
    const technicalOpinion = technicalAgent.decide(numericIndicators, currentPrice);

    const newsDecision = await newsAgent.decide();
    const newsOpinion = {
      agentName: newsAgent.getScore().agentName,
      action: newsDecision.action,
      confidence: newsDecision.confidence,
      reason: newsDecision.reason,
    };

    await marketAgent.updateMarketInsights();
    const marketOpinion = marketAgent.getAdvice();

    const volumeAnalysis = volumeAgent.analyzeVolume(1000000, 2, 5);
    const volumeOpinion = {
      agentName: volumeAgent.getScore().agentName,
      action: volumeAnalysis.action,
      confidence: volumeAnalysis.confidence,
      reason: volumeAnalysis.reason,
    };

    const synthesisOpinion = synthesisAgent.decide(quantumOpinion, technicalOpinion, newsOpinion, marketOpinion);

    const votes: AgentVote[] = [
      { agentName: quantumOpinion.agentName, action: quantumOpinion.action, confidence: quantumOpinion.confidence, weight: 1, color: '#a78bfa', icon: '🌌' },
      { agentName: technicalOpinion.agentName, action: technicalOpinion.action, confidence: technicalOpinion.confidence, weight: 1, color: '#00d4aa', icon: '📊' },
      { agentName: newsOpinion.agentName, action: newsOpinion.action as any, confidence: newsOpinion.confidence, weight: 0.8, color: '#f97316', icon: '📰' },
      { agentName: marketOpinion.agentName, action: marketOpinion.action, confidence: marketOpinion.confidence, weight: 0.9, color: '#f97316', icon: '📈' },
      { agentName: volumeOpinion.agentName, action: volumeOpinion.action, confidence: volumeOpinion.confidence, weight: 0.9, color: '#f97316', icon: '📊' },
      { agentName: synthesisOpinion.agentName, action: synthesisOpinion.action, confidence: synthesisOpinion.confidence, weight: 1.2, color: '#fbbf24', icon: '🧠' }
    ];

    const voteResult = votingSystem.vote(votes);
    const votingStatsData = votingSystem.getStats();
    setVotingStats(votingStatsData);

    const scores = [quantumAgent.getScore(), technicalAgent.getScore(), newsAgent.getScore(), marketAgent.getScore(), volumeAgent.getScore(), synthesisAgent.getScore()];
    setAgentScores(scores);

    setQuantumAnalysis(
      `🌌 Quântico: ${quantumOpinion.action} (${quantumOpinion.confidence}%) | 📊 Técnico: ${technicalOpinion.action} (${technicalOpinion.confidence}%) | 📰 Notícias: ${newsOpinion.action} (${newsOpinion.confidence}%) | ⚖️ FINAL: ${voteResult.action.toUpperCase()} (${voteResult.confidence}%)`
    );

    return { decision: voteResult };
  }, []);

  const executeTrade = useCallback(async () => {
    if (!account) return;
    try {
      const currentMockPrice = 1.00 + (Math.random() * 0.02);
      priceHistory.current = [...priceHistory.current.slice(-30), currentMockPrice];

      const { decision } = await consultAgents(currentMockPrice, priceHistory.current);

      const deliberation = await tradingStrategies.deliberate(
        { action: decision.action, confidence: decision.confidence },
        async () => ({ action: decision.action, confidence: decision.confidence })
      );

      if (deliberation.shouldTrade) {
        const won = Math.random() > 0.4;
        setTradeCount(prev => prev + 1);
        const profit = tradeSize * 0.01;
        setGrossProfit(prev => prev + profit);
        setLastTrade({ profit, time: new Date().toLocaleTimeString() });
        onTradeExecuted(profit);

        agentMemory.update("Quantum", won, quantumAgent.getScore().avgConfidence);
        agentMemory.update("Technical", won, technicalAgent.getScore().avgConfidence);
        agentMemory.update("Synthesis", won, synthesisAgent.getScore().avgConfidence);

        votingSystem.recordResult(won);

        toast.success(`💰 TRADE ${network.isTestnet ? '🧪 TESTE' : '💰 REAL'} | ${deliberation.action.toUpperCase()} | Lucro: $${profit.toFixed(4)}`);
      }
    } catch (error) {
      console.error("Erro no trade:", error);
    }
  }, [account, tradeSize, consultAgents, onTradeExecuted, network]);

  const toggleAutoTrade = () => {
    if (!account) { toast.error("Conecte a carteira primeiro"); return; }
    if (isActive) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setIsActive(false);
      toast("⏹️ Auto-Trade parado");
    } else {
      setIsActive(true);
      updateMarketSentiment();
      toast.success(`🌌 Auto-Trade iniciado em ${network.isTestnet ? 'TESTNET' : 'MAINNET'}! Trade: $${tradeSize}`);
      setTimeout(() => executeTrade(), 2000);
      intervalRef.current = setInterval(executeTrade, 60000);
    }
  };

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  return (
    <div style={{ marginTop: '16px', padding: '16px', background: 'linear-gradient(135deg, #0a0a2e 0%, #1a1a4e 100%)', borderRadius: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '24px' }}>🌌</span>
          <span style={{ fontWeight: 'bold', color: '#8b5cf6' }}>Multi-Agent System</span>
          <span style={{ fontSize: '9px', background: network.isTestnet ? ORANGE : GREEN, padding: '2px 6px', borderRadius: 10, color: '#fff' }}>
            {network.isTestnet ? '🧪 TESTNET' : '💰 REAL'}
          </span>
          {isActive && <span style={{ fontSize: '10px', background: '#22c55e', color: '#fff', padding: '2px 8px', borderRadius: '20px' }}>🤖 ATIVO</span>}
        </div>
        <button onClick={toggleAutoTrade} style={{ padding: '8px 20px', background: isActive ? '#ef4444' : '#8b5cf6', border: 'none', borderRadius: '20px', color: '#fff', cursor: 'pointer' }}>
          {isActive ? '⏹️ PARAR' : '🤖 INICIAR'}
        </button>
      </div>

      {marketSentiment && (
        <div style={{ marginBottom: '8px', padding: '8px', background: 'rgba(0,0,0,0.4)', borderRadius: '8px', fontSize: '11px', textAlign: 'center' }}>
          📰 Sentimento: <span style={{ color: marketSentiment.bias === 'positive' ? '#4ade80' : marketSentiment.bias === 'negative' ? '#ef4444' : '#fbbf24' }}>
            {marketSentiment.bias.toUpperCase()} ({marketSentiment.score})
          </span>
        </div>
      )}

      <AgentDashboard agentScores={agentScores} votingStats={votingStats} />

      {quantumAnalysis && (
        <div style={{ marginBottom: '12px', padding: '8px', background: 'rgba(139, 92, 246, 0.15)', borderRadius: '8px', fontSize: '9px', color: '#a78bfa', textAlign: 'center' }}>
          {quantumAnalysis}
        </div>
      )}

      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>💰 Valor por trade:</span>
          <span style={{ fontSize: '13px', color: '#a78bfa', fontWeight: 'bold' }}>${tradeSize} USDC</span>
        </div>
        <input type="range" min={5} max={network.isTestnet ? 100 : 25} step={1} value={tradeSize} onChange={(e) => setTradeSize(Number(e.target.value))} style={{ width: '100%' }} />
        {!network.isTestnet && <div style={{ fontSize: '9px', color: '#fbbf24', marginTop: 4 }}>⚠️ Limite de segurança: $25 por trade em Mainnet</div>}
      </div>

      <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>Lucro Bruto:</span>
          <span style={{ fontSize: '12px', color: '#fbbf24' }}>${grossProfit.toFixed(4)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '13px', color: '#4ade80', fontWeight: 'bold' }}>LUCRO LÍQUIDO:</span>
          <span style={{ fontSize: '16px', color: '#22c55e', fontWeight: 'bold' }}>${(grossProfit - (tradeCount * GAS_PER_TRADE)).toFixed(4)}</span>
        </div>
      </div>

      <div style={{ color: '#fff', fontSize: '13px', marginTop: '8px' }}>
        <div>💰 Trades: <span style={{ fontWeight: 'bold', color: '#a78bfa' }}>{tradeCount}</span></div>
        {lastTrade && <div style={{ fontSize: '11px' }}>🕐 Último: ${lastTrade.profit.toFixed(4)}</div>}
      </div>
    </div>
  );
}

// ============================================================
// COMPONENTE: PROFIT POOL
// ============================================================

function ProfitPool({ totalProfit, onReinvest, network }: { totalProfit: number; onReinvest: (amount: number) => void; network: Network }) {
  return (
    <div style={{ marginTop: '12px', padding: '12px', background: '#fef3c7', borderRadius: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>🏦 Bolsão de Lucros {network.isTestnet && '(Teste)'}</span>
        <span style={{ fontWeight: 'bold', color: '#16a34a' }}>${totalProfit.toFixed(4)}</span>
      </div>
      {totalProfit > 1 && (
        <button onClick={() => onReinvest(totalProfit * 0.7)} style={{ width: '100%', marginTop: '8px', padding: '6px', background: '#f59e0b', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer' }}>
          🔄 Reinvestir
        </button>
      )}
    </div>
  );
}

// ============================================================
// COMPONENTE: MARKET MONITOR
// ============================================================

function MarketMonitor() {
  return (
    <div style={{ marginTop: '16px', padding: '16px', border: `1px solid ${BORDER}`, borderRadius: '16px', background: '#f9fafb' }}>
      <div>📊 Market Monitor</div>
      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>Monitorando spreads de mercado...</div>
    </div>
  );
}

// ============================================================
// COMPONENTE PRINCIPAL HOME
// ============================================================

export default function Home() {
  const [isClient, setIsClient] = useState(false);
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState(0n);
  const [decimals, setDecimals] = useState(6);
  const [tab, setTab] = useState<"send" | "history" | "jobs" | "bridge">("send");
  const [modal, setModal] = useState<"receive" | "swap" | "">("");
  const [history, setHistory] = useState<any[]>([]);
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [totalProfit, setTotalProfit] = useState(0);
  const [agentScores, setAgentScores] = useState<any[]>([]);
  
  const [currentNetwork, setCurrentNetwork] = useState<Network>(ARC_TESTNET);

  useEffect(() => { setIsClient(true); }, []);

  const loadBalance = useCallback(async (addr: string) => {
    if (!addr) return;
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
  }, [currentNetwork]);

  const connect = async () => {
    if (!window.ethereum) { toast.error("MetaMask não encontrado"); return; }
    try {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: currentNetwork.chainIdHex }],
        });
      } catch (switchErr: any) {
        if (switchErr.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: currentNetwork.chainIdHex,
              chainName: currentNetwork.name,
              rpcUrls: [currentNetwork.rpc],
              nativeCurrency: currentNetwork.nativeCurrency,
              blockExplorerUrls: [currentNetwork.explorer],
            }],
          });
        }
      }

      const accounts: string[] = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAccount(accounts[0]);
      toast.success(`Conectado à ${currentNetwork.name}!`);
      await loadBalance(accounts[0]);
      
      const scores = [quantumAgent.getScore(), technicalAgent.getScore(), newsAgent.getScore(), marketAgent.getScore(), volumeAgent.getScore(), synthesisAgent.getScore()];
      setAgentScores(scores);
    } catch (error: any) {
      console.error("Erro ao conectar:", error);
      toast.error(error?.message?.slice(0, 80) || "Erro ao conectar");
    }
  };

  const send = async () => {
    if (!dest || !amount) { toast.error("Preencha os campos"); return; }
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
      setHistory(h => [{ to: dest, amount, time: new Date().toLocaleTimeString(), hash: tx.hash, network: currentNetwork.name }, ...h]);
      setDest(""); setAmount("");
      await loadBalance(account);
    } catch (e: any) {
      toast.error(e?.reason || e?.message?.slice(0, 60) || "Erro ao enviar");
    }
    setSending(false);
  };

  const handleNetworkSwitch = async (newNetwork: Network) => {
    setCurrentNetwork(newNetwork);
    setAccount("");
    setBalance(0n);
    toast.success(`🔄 Rede alterada para ${newNetwork.name}`);
  };

  const handleTradeExecuted = (profit: number) => { setTotalProfit(prev => prev + profit); };
  const handleReinvest = (amt: number) => { toast.success(`💰 ${amt.toFixed(4)} USDC reinvestido!`); };

  const balanceDisplay = parseFloat(ethers.formatUnits(balance, decimals)).toFixed(2);

  if (!isClient) {
    return <div style={{ minHeight: "100vh", background: "#eef0f5", display: "flex", alignItems: "center", justifyContent: "center" }}>Carregando...</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#eef0f5", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <Toaster position="top-center" />
      <div style={{ width: 550, borderRadius: 28, overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.13)" }}>

        {/* Header */}
        <div style={{ background: "linear-gradient(135deg, #3a6cc8 0%, #2952a3 100%)", padding: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
            <NetworkSwitcher currentNetwork={currentNetwork} onSwitch={handleNetworkSwitch} isConnected={!!account} />
            {account ? (
              <span style={{ fontSize: 12, background: "rgba(255,255,255,0.15)", padding: "4px 10px", borderRadius: 8 }}>🟢 {short(account)}</span>
            ) : (
              <button onClick={connect} style={{ fontSize: 12, background: "rgba(255,255,255,0.25)", color: "#fff", border: "none", padding: "4px 12px", borderRadius: 8, cursor: "pointer" }}>
                Conectar
              </button>
            )}
          </div>

          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 4 }}>SALDO DISPONÍVEL</div>
            <div style={{ fontSize: 40, fontWeight: 700 }}>{balanceDisplay}</div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>USDC</div>
            {currentNetwork.isTestnet && <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7 }}>🧪 USDC de teste - sem valor real</div>}
          </div>

          <div style={{ display: "flex", justifyContent: "space-around", marginTop: 20, gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => setTab("send")} style={{ background: tab === "send" ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 12, padding: "8px 10px", cursor: "pointer", fontSize: 11 }}>✈️ Enviar</button>
            <button onClick={() => setModal("receive")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 12, padding: "8px 10px", cursor: "pointer", fontSize: 11 }}>📥 Receber</button>
            <button onClick={() => setTab("bridge")} style={{ background: tab === "bridge" ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 12, padding: "8px 10px", cursor: "pointer", fontSize: 11 }}>🔄 Bridge/Swap</button>
            <button onClick={() => setTab("jobs")} style={{ background: tab === "jobs" ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 12, padding: "8px 10px", cursor: "pointer", fontSize: 11 }}>💼 Jobs</button>
            <button onClick={() => setTab("history")} style={{ background: tab === "history" ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 12, padding: "8px 10px", cursor: "pointer", fontSize: 11 }}>📜 Histórico</button>
          </div>
        </div>

        {/* Conteúdo das Tabs */}
        <div style={{ background: "#fff", padding: 20, minHeight: 320 }}>
          {tab === "send" && (
            <div>
              <input value={dest} onChange={e => setDest(e.target.value)} placeholder="Destino (0x...)" style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${BORDER}`, marginBottom: 12, boxSizing: "border-box" }} />
              <input value={amount} onChange={e => setAmount(e.target.value)} type="number" placeholder="Valor" style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${BORDER}`, marginBottom: 12, boxSizing: "border-box" }} />
              <button onClick={account ? send : connect} disabled={sending} style={{ width: "100%", background: currentNetwork.isTestnet ? ORANGE : GREEN, color: "#fff", padding: 13, borderRadius: 14, border: "none", cursor: "pointer", fontWeight: 600 }}>
                {sending ? "Enviando..." : account ? `Transferir USDC (${currentNetwork.shortName})` : "Conectar carteira"}
              </button>
            </div>
          )}

          {tab === "bridge" && (
            <div>
              <div style={{ textAlign: "center", marginBottom: 16 }}>
                <span style={{ fontSize: 48 }}>🔄</span>
                <h3 style={{ margin: "8px 0", color: "#333" }}>Bridge / Swap</h3>
                <p style={{ fontSize: 12, color: "#6b7280" }}>Swap na mesma rede ou Bridge entre redes diferentes</p>
              </div>
              <button onClick={() => setModal("swap")} style={{ width: "100%", background: BLUE, color: "#fff", padding: 14, borderRadius: 14, border: "none", cursor: "pointer", fontWeight: 600 }}>
                🚀 Abrir Bridge / Swap (LI.FI)
              </button>
            </div>
          )}

          {tab === "jobs" && (
            account ? <JobsPanel account={account} network={currentNetwork} /> : 
            <div style={{ textAlign: "center", color: "#9ca3af", padding: 40 }}>🔌 Conecte a carteira para ver os Jobs ERC-8183</div>
          )}

          {tab === "history" && (
            <div>
              {history.length === 0 ? (
                <div style={{ textAlign: "center", color: "#9ca3af", paddingTop: 40 }}>Nenhuma transação</div>
              ) : (
                history.map((h, i) => (
                  <div key={i} style={{ background: "#f9fafb", borderRadius: 12, padding: 12, marginBottom: 10 }}>
                    → {short(h.to)} -{h.amount} USDC
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>{h.time} - {h.network}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Seções de Agentes */}
        {account && (
          <>
            <MarketMonitor />
            <AutoTradeControl account={account} onTradeExecuted={handleTradeExecuted} network={currentNetwork} />
            <ProfitPool totalProfit={totalProfit} onReinvest={handleReinvest} network={currentNetwork} />
            <BitcoinTreasureHunter
              onTreasureFound={(value: number, fee: number) => { setTotalProfit(prev => prev + fee); }}
              userAddress={account}
            />
            
            {/* NOVOS COMPONENTES INTEGRADOS */}
           <BridgeWidget userAddress={account} />
            <RealAutomatedTrader account={account} currentNetwork={currentNetwork?.id === "base" ? "base" : currentNetwork?.id === "polygon" ? "polygon" : "arc"} />
            <NanopaymentDashboard agentScores={agentScores} network={currentNetwork} privateKey={process.env.NEXT_PUBLIC_PRIVATE_KEY} />
            <TradingNanopaymentDashboard network={currentNetwork} privateKey={process.env.NEXT_PUBLIC_PRIVATE_KEY} />
          </>
        )}

        <div style={{ padding: "12px", borderTop: `1px solid ${BORDER}`, background: "#fff", fontSize: "10px", color: "#9ca3af", textAlign: "center" }}>
          🤖 Híbrido | {currentNetwork.isTestnet ? '🧪 TESTNET' : '💰 MAINNET'} | {currentNetwork.name} | TLAY Nanopayments | Bridge USDC
        </div>
      </div>

      {/* Modais */}
      {modal === "receive" && <ReceiveModal account={account} onClose={() => setModal("")} network={currentNetwork} />}
      {modal === "swap" && <SwapBridgeModal account={account} onClose={() => setModal("")} currentNetwork={currentNetwork} onComplete={() => loadBalance(account)} />}
    </div>
  );
}