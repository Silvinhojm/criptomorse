"use client";
import DashboardShell from "@/app/components/DashboardShell"
import { useSection } from "@/app/components/SectionContext"
import { RealAutomatedTrader } from "./components/RealAutomatedTrader";
import { PregãoDashboard } from "./components/PregãoDashboard";
import { SalaDeAula } from "./components/SalaDeAula";
import { NETWORKS } from "@/lib/real-swap-executor";

import { realSwap, type NetworkKey } from "@/lib/real-swap-executor";
import { useState, useCallback, useEffect, useRef } from "react";
import { ethers } from "ethers";
import { Toaster, toast } from "react-hot-toast";

// Componentes
import { NanopaymentDashboard } from "./components/NanopaymentDashboard";
import { BridgeWidget } from "./components/BridgeWidget";
import { BotBank } from "./components/BotBank";

// Agents (usados no connect)
import { quantumAgent, technicalAgent, synthesisAgent } from "../lib/multi-agent-system";
import { marketAgent } from "../lib/market-agent";
import { volumeAgent } from "../lib/volume-agent";
import newsAgent from "../lib/news-agent";

// Types


import { jobMarketplace, type JobData } from "../lib/job-marketplace";

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


// Arc Testnet
const ARC_TESTNET = {
  name: "Arc Testnet",
  shortName: "Arc",
  rpc: "https://rpc.testnet.arc.network",
  chainId: 5042002,
  chainIdHex: "0x4cef52",
  usdc: "0x3600000000000000000000000000000000000000",
  eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  erc8183: "0x319227cf1de5c61d11313af8226a8f5309fa70d9",
  explorer: "https://testnet.arcscan.app",
  icon: "🔵",
  isTestnet: true,
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 }
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
  explorer: "https://basescan.org",
  icon: "🟢",
  isTestnet: false,
  nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 }
};

// Polygon (POL) Mainnet
const POLYGON_MAINNET = {
  name: "Polygon (POL)",
  shortName: "Polygon",
  rpc: "https://polygon.publicnode.com",
  chainId: 137,
  chainIdHex: "0x89",
  usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  eurc: "0xc52d20D70d2B1E27C2cb85AA0E3a9F5b4AEBf7e7",
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
  explorer: "https://etherscan.io",
  icon: "💙",
  isTestnet: false,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }
};

// Ethereum Sepolia (testnet)
const SEPOLIA_TESTNET = {
  name: "Ethereum Sepolia",
  shortName: "Sepolia",
  rpc: "https://rpc.sepolia.org",
  chainId: 11155111,
  chainIdHex: "0xaa36a7",
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  eurc: "",
  explorer: "https://sepolia.etherscan.io",
  icon: "🧪",
  isTestnet: true,
  nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 }
};

type Network = typeof ARC_TESTNET | typeof BASE_MAINNET | typeof POLYGON_MAINNET | typeof ETHEREUM_MAINNET | typeof SEPOLIA_TESTNET;

const NETWORK_KEY_MAP: Record<number, keyof typeof NETWORKS> = {
  5042002: "arc",
  8453: "base",
  137: "polygon",
  1: "ethereum",
  11155111: "sepolia",
};

const short = (a: string) => a ? a.slice(0, 6) + "..." + a.slice(-4) : "";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

// ============================================================
// COMPONENTE: JOBS PANEL (ERC-8183)
// ============================================================

function JobsPanel({ account, network }: { account: string; network: Network }) {
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newJobDesc, setNewJobDesc] = useState("");
  const [newJobBudget, setNewJobBudget] = useState("");
  const [newJobProvider, setNewJobProvider] = useState("");
  const [jobActionLoading, setJobActionLoading] = useState<number | null>(null);

  const loadJobs = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      const { queryJobsByAddress } = await import('@/lib/subgraph-client');
      const subgraphJobs = await queryJobsByAddress(account, 30);
      if (subgraphJobs.length > 0) {
        const mapped: JobData[] = subgraphJobs.map(j => ({
          id: parseInt(j.id),
          client: j.client,
          provider: j.provider,
          evaluator: j.evaluator || '0x0000000000000000000000000000000000000000',
          description: j.description || 'N/A',
          budget: j.budget || '0',
          expiredAt: 0,
          status: 0,
          statusLabel: j.status,
          hook: '0x0000000000000000000000000000000000000000',
        }));
        setJobs(mapped);
        setLoading(false);
        return;
      }
    } catch {}
    try {
      if (network.shortName === 'ARC') {
        const jobsData = await jobMarketplace.getJobsByAddress(account, 30);
        setJobs(jobsData);
      } else {
        const res = await fetch(`/api/jobs?address=${account}&count=30`);
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch (error) {
      console.error("Erro ao carregar jobs:", error);
      toast.error("Erro ao carregar jobs");
    }
    setLoading(false);
  }, [account, network.shortName]);

  const createJob = async () => {
    if (!newJobDesc || !newJobBudget || !newJobProvider) {
      toast.error("Preencha todos os campos");
      return;
    }
    try {
      toast.loading("Criando job on-chain...", { id: "createJob" });

      if (network.shortName === 'ARC') {
        const result = await jobMarketplace.createJob(
          newJobProvider,
          account,
          newJobDesc,
          parseFloat(newJobBudget),
          60
        );
        toast.success(`Job #${result.jobId} criado!`, { id: "createJob" });
      } else {
        await new Promise(resolve => setTimeout(resolve, 1500));
        toast.success("Job criado (simulado - use Arc Testnet para on-chain)", { id: "createJob" });
      }

      await loadJobs();
      setShowCreateModal(false);
      setNewJobDesc("");
      setNewJobBudget("");
      setNewJobProvider("");
    } catch (error: any) {
      toast.error(error?.message?.slice(0, 80) || "Erro ao criar job", { id: "createJob" });
    }
  };

  const fundJob = async (jobId: number, budget: string) => {
    setJobActionLoading(jobId);
    try {
      toast.loading(`Aprovando USDC e fundando job #${jobId}...`, { id: `fund${jobId}` });
      if (network.shortName === 'ARC') {
        await jobMarketplace.approveUSDC(parseFloat(budget));
        toast.success(`USDC aprovado!`, { id: `fund${jobId}` });
        toast.loading(`Fundando job #${jobId}...`, { id: `fund${jobId}` });
        const fundHash = await jobMarketplace.fundJob(jobId);
        toast.success(`Job #${jobId} fundado! TX: ${fundHash.slice(0, 10)}...`, { id: `fund${jobId}` });
      }
      await loadJobs();
    } catch (err: any) {
      toast.error(err.message?.slice(0, 80) || "Erro ao fundar", { id: `fund${jobId}` });
    }
    setJobActionLoading(null);
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
            <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>{job.description}</div>
            <div style={{ fontSize: 11, color: "#6b7280", display: "flex", justifyContent: "space-between" }}>
              <span>💰 {job.budget} USDC</span>
              <span>📊 {job.statusLabel}</span>
            </div>
            <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>👤 Cliente: {short(job.client)} · Provider: {short(job.provider)}</span>
              {job.status === 0 && network.shortName === 'ARC' && (
                <button
                  onClick={() => fundJob(job.id, job.budget)}
                  disabled={jobActionLoading === job.id}
                  style={{ background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 10, cursor: 'pointer' }}
                >
                  {jobActionLoading === job.id ? '...' : '💰 Fund'}
                </button>
              )}
            </div>
          </div>
        ))
      )}

      {showCreateModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: 380, maxWidth: "90%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Criar Job ERC-8183</h3>
              <button onClick={() => setShowCreateModal(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>×</button>
            </div>
            {network.shortName === 'ARC' && (
              <div style={{ fontSize: 10, color: '#059669', background: '#d1fae5', padding: '6px 10px', borderRadius: 8, marginBottom: 12 }}>
                ✅ On-chain no Arc Testnet · Contrato: 0x0747EEf...4583
              </div>
            )}
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

  const availableNetworks = [BASE_MAINNET, POLYGON_MAINNET, ETHEREUM_MAINNET, SEPOLIA_TESTNET];

  const availableTokens = [
    { symbol: "USDC", name: "USD Coin", icon: "💵" },
    { symbol: "EURC", name: "Euro Coin", icon: "💶" },
    { symbol: "USDT", name: "Tether", icon: "🪙" },
    { symbol: "DAI", name: "Dai", icon: "🏦" }
  ];

  const getTokenAddress = (network: Network, tokenSymbol: string): string => {
    if (tokenSymbol === "USDC") return network.usdc;
    if (tokenSymbol === "EURC") return network.eurc;
    if (tokenSymbol === "cirBTC") return "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF";
    if (tokenSymbol === "mcirBTC") return "0x8cad4951192853D14f8Cb813695146b5Ae00EA6d";
    return network.usdc;
  };

  const getSwapUrl = () => {
    const fromTokenAddress = getTokenAddress(currentNetwork, fromToken);
    const toTokenAddress = getTokenAddress(currentNetwork, toToken);
    const amount = parseFloat(swapAmount) || 0;
    return `https://jumper.exchange/?fromChain=${currentNetwork.chainId}&fromToken=${fromTokenAddress}&toChain=${currentNetwork.chainId}&toToken=${toTokenAddress}&integrator=arcflow${account ? `&toAddress=${account}` : ""}&fromAmount=${amount}`;
  };

  const getBridgeUrl = () => {
    const fromTokenAddress = getTokenAddress(currentNetwork, bridgeToken);
    const toTokenAddress = getTokenAddress(targetNetwork, bridgeToken);
    const amount = parseFloat(swapAmount) || 0;
    return `https://jumper.exchange/?fromChain=${currentNetwork.chainId}&fromToken=${fromTokenAddress}&toChain=${targetNetwork.chainId}&toToken=${toTokenAddress}&integrator=arcflow${account ? `&toAddress=${account}` : ""}&fromAmount=${amount}`;
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

function SectionMatch({ section, children }: { section: string; children: React.ReactNode }) {
  const ctx = useSection()
  if (ctx.section !== section) return null
  return <>{children}</>
}

// COMPONENTE PRINCIPAL HOME
// ============================================================

export default function Home() {
  const [isClient, setIsClient] = useState(false);
  const [account, setAccount] = useState("");
  const [portfolios, setPortfolios] = useState<{ symbol: string; name: string; icon: string; balance: bigint; decimals: number }[]>([]);
  const [tab, setTab] = useState<"send" | "history" | "jobs" | "bridge" | "agents">("send");
  const [modal, setModal] = useState<"receive" | "swap" | "">("");
  const [history, setHistory] = useState<any[]>([]);
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [agentScores, setAgentScores] = useState<any[]>([]);
  const accountsChangedRef = useRef<((accts: string[]) => void) | null>(null)
  const chainChangedRef = useRef<(() => void) | null>(null)
  
  const [currentNetwork, setCurrentNetwork] = useState<Network>(() => {
    const defaultNet = process.env.NEXT_PUBLIC_DEFAULT_NETWORK || "arc";
    if (defaultNet === "polygon") return POLYGON_MAINNET;
    if (defaultNet === "base") return BASE_MAINNET;
    if (defaultNet === "sepolia") return SEPOLIA_TESTNET;
    return ARC_TESTNET;
  });

  useEffect(() => { setIsClient(true); }, []);

  const getPortfolioTokens = useCallback(() => {
    const common: { symbol: string; name: string; icon: string; address: string; decimals: number; isNative: boolean }[] = [
      { symbol: currentNetwork.nativeCurrency.symbol, name: currentNetwork.nativeCurrency.name, icon: "🪙", address: "", decimals: currentNetwork.nativeCurrency.decimals, isNative: true },
    ];
    // Arc: USDC é nativo, EURC + cirBTC + mcirBTC são ERC-20
    if (currentNetwork.chainId === 5042002) {
      common.push(
        { symbol: "USDC", name: "USD Coin", icon: "💵", address: "", decimals: 6, isNative: true },
        { symbol: "EURC", name: "Euro Coin", icon: "💶", address: currentNetwork.eurc, decimals: 6, isNative: false },
        { symbol: "cirBTC", name: "Circulating BTC", icon: "₿", address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF", decimals: 8, isNative: false },
        { symbol: "mcirBTC", name: "Micro Circulating BTC", icon: "₿", address: "0x8cad4951192853D14f8Cb813695146b5Ae00EA6d", decimals: 8, isNative: false },
      );
      return common;
    }
    // Demais redes: USDC é ERC-20 real
    common.push(
      { symbol: "USDC", name: "USD Coin", icon: "💵", address: currentNetwork.usdc, decimals: 6, isNative: false },
      { symbol: "EURC", name: "Euro Coin", icon: "💶", address: currentNetwork.eurc, decimals: 6, isNative: false },
    );
    if (currentNetwork.chainId === 137) { // Polygon
      common.push(
        { symbol: "WMATIC", name: "Wrapped MATIC", icon: "🔷", address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", decimals: 18, isNative: false },
        { symbol: "WETH", name: "Wrapped Ether", icon: "✨", address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18, isNative: false },
        { symbol: "DAI", name: "Dai", icon: "🏦", address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", decimals: 18, isNative: false },
        { symbol: "USDT", name: "Tether", icon: "🪙", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6, isNative: false },
      );
    } else if (currentNetwork.chainId === 8453) { // Base
      common.push(
        { symbol: "WETH", name: "Wrapped Ether", icon: "✨", address: "0x4200000000000000000000000000000000000006", decimals: 18, isNative: false },
        { symbol: "DAI", name: "Dai", icon: "🏦", address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18, isNative: false },
        { symbol: "WBTC", name: "Wrapped Bitcoin", icon: "₿", address: "0x0555E30dD009B6f21Bcb7A78FeE496525DbD919e", decimals: 8, isNative: false },
      );
    } else if (currentNetwork.chainId === 1) { // Ethereum
      common.push(
        { symbol: "WETH", name: "Wrapped Ether", icon: "✨", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, isNative: false },
        { symbol: "DAI", name: "Dai", icon: "🏦", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18, isNative: false },
        { symbol: "USDT", name: "Tether", icon: "🪙", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, isNative: false },
        { symbol: "WBTC", name: "Wrapped Bitcoin", icon: "₿", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8, isNative: false },
      );
    } else if (currentNetwork.chainId === 11155111) { // Sepolia
      common.push(
        { symbol: "WETH", name: "Wrapped Ether", icon: "✨", address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", decimals: 18, isNative: false },
      );
    }
    return common;
  }, [currentNetwork]);

  const loadAllBalances = useCallback(async (addr: string) => {
    if (!addr) return;
    try {
      const bp = new ethers.BrowserProvider(window.ethereum);
      const tokens = getPortfolioTokens();
      const results = await Promise.allSettled(tokens.map(async (t) => {
        if (t.isNative) {
          const bal = await bp.getBalance(addr);
          return { symbol: t.symbol, balance: bal, decimals: t.decimals, name: t.name, icon: t.icon };
        }
        const contract = new ethers.Contract(t.address, ERC20_ABI, bp);
        const [bal, dec] = await Promise.all([
          contract.balanceOf(addr).catch(() => 0n),
          contract.decimals().catch(() => t.decimals),
        ]);
        return { symbol: t.symbol, balance: bal, decimals: Number(dec), name: t.name, icon: t.icon };
      }));
      const loaded = results.filter(r => r.status === "fulfilled").map(r => (r as PromiseFulfilledResult<any>).value);
      setPortfolios(loaded);
    } catch (e) {
      console.error("Erro ao buscar carteira:", e);
    }
  }, [getPortfolioTokens]);

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
      await loadAllBalances(accounts[0]);
      const netKey = (CHAIN_TO_KEY[currentNetwork.chainId] ?? "polygon") as NetworkKey;
      await realSwap.initialize(accounts[0], netKey, true).catch(e =>
        console.error("❌ realSwap.initialize:", e?.message ?? e)
      );
      
      const scores = [quantumAgent.getScore(), technicalAgent.getScore(), newsAgent.getScore(), marketAgent.getScore(), volumeAgent.getScore(), synthesisAgent.getScore()];
      setAgentScores(scores);

      // Auto-refresh on account/chain change — limpa listeners antigos primeiro
      if (accountsChangedRef.current) window.ethereum.removeListener("accountsChanged", accountsChangedRef.current)
      if (chainChangedRef.current) window.ethereum.removeListener("chainChanged", chainChangedRef.current)

      accountsChangedRef.current = (accts: string[]) => {
        if (accts.length === 0) { setAccount(""); setPortfolios([]); return; }
        setAccount(accts[0]);
        loadAllBalances(accts[0]);
      }
      chainChangedRef.current = async () => {
        const accts: string[] = await window.ethereum.request({ method: "eth_accounts" });
        if (accts.length > 0) loadAllBalances(accts[0]);
      }
      window.ethereum.on("accountsChanged", accountsChangedRef.current)
      window.ethereum.on("chainChanged", chainChangedRef.current)
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
      const parsed = ethers.parseUnits(amount, 6);
      const tx = await usdc.transfer(dest, parsed);
      toast.loading("Aguardando confirmação...", { id: "tx" });
      await tx.wait();
      toast.success("Enviado!", { id: "tx" });
      setHistory(h => [{ to: dest, amount, time: new Date().toLocaleTimeString(), hash: tx.hash, network: currentNetwork.name }, ...h]);
      setDest(""); setAmount("");
      await loadAllBalances(account);
    } catch (e: any) {
      toast.error(e?.reason || e?.message?.slice(0, 60) || "Erro ao enviar");
    }
    setSending(false);
  };

  const handleNetworkSwitch = async (newNetwork: Network) => {
    setCurrentNetwork(newNetwork);
    setAccount("");
    setPortfolios([]);
    toast.success(`🔄 Rede alterada para ${newNetwork.name}`);
  };


  const portfoliosWithBalance = portfolios.filter(p => p.balance > 0n);
  const usdcEntry = portfolios.find(p => p.symbol === "USDC");
  const usdcDisplay = usdcEntry ? parseFloat(ethers.formatUnits(usdcEntry.balance, usdcEntry.decimals)).toFixed(2) : "0.00";

  // Auto-refresh portfolio every 15s while connected
  useEffect(() => {
    if (!account) return;
    const id = setInterval(() => loadAllBalances(account), 15000);
    return () => clearInterval(id);
  }, [account, loadAllBalances]);

  const CHAIN_TO_KEY: Record<number, string> = {
    5042002: "arc",
    137: "polygon",
    8453: "base",
    1: "ethereum",
    42161: "arbitrum",
    11155111: "sepolia",
  }
  const currentNetworkKey = (CHAIN_TO_KEY[currentNetwork.chainId] ?? "polygon") as "arc" | "polygon" | "base" | "ethereum" | "arbitrum" | "sepolia"
  const handleNetworkKeyChange = (key: "arc" | "polygon" | "base" | "ethereum" | "arbitrum" | "sepolia") => {
    const netMap: Record<string, typeof ARC_TESTNET | typeof POLYGON_MAINNET | typeof BASE_MAINNET | typeof ETHEREUM_MAINNET | typeof SEPOLIA_TESTNET> = {
      arc: ARC_TESTNET,
      polygon: POLYGON_MAINNET,
      base: BASE_MAINNET,
      ethereum: ETHEREUM_MAINNET,
      sepolia: SEPOLIA_TESTNET,
    }
    const newNet = netMap[key]
    if (newNet) handleNetworkSwitch(newNet)
  }

  if (!isClient) {
    return <div style={{ minHeight: "100vh", background: "#eef0f5", display: "flex", alignItems: "center", justifyContent: "center" }}>Carregando...</div>;
  }

  return (
    <DashboardShell account={account} networkName={currentNetwork.name} isTestnet={currentNetwork.isTestnet} currentNetworkKey={currentNetworkKey} onNetworkChange={handleNetworkKeyChange} onConnect={connect}>
      <Toaster position="top-center" />

      {/* Tabs de Navegação */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1" style={{ borderBottom: `1px solid rgba(148,163,184,0.15)` }}>
        {[
          { key: "send" as const, label: "✈️ Enviar" },
          { key: "bridge" as const, label: "🔄 Bridge/Swap" },
          { key: "jobs" as const, label: "💼 Jobs" },
          { key: "history" as const, label: "📜 Histórico" },
          { key: "agents" as const, label: "🤖 Robôs" },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="text-xs font-medium px-3 py-2 rounded-t-lg transition-colors whitespace-nowrap"
            style={{
              background: tab === t.key ? "rgba(74,158,255,0.15)" : "transparent",
              color: tab === t.key ? "#4A9EFF" : "#94a3b8",
              borderBottom: tab === t.key ? "2px solid #4A9EFF" : "2px solid transparent",
            }}>
            {t.label}
          </button>
        ))}
        {account && (
          <button onClick={connect} className="text-xs font-medium px-3 py-2 ml-auto whitespace-nowrap"
            style={{ color: "#00D4AA" }}>
            🟢 {short(account)}
          </button>
        )}
      </div>

      {/* Conteúdo das Tabs */}
      {tab === "send" && (
        <div className="rounded-xl p-4" style={{ background: "#1E2128", border: "1px solid rgba(148,163,184,0.15)" }}>
          <input value={dest} onChange={e => setDest(e.target.value)} placeholder="Destino (0x...)"
            className="w-full p-2.5 rounded-lg text-sm mb-3 outline-none"
            style={{ background: "#0A0B0E", border: "1px solid rgba(148,163,184,0.15)", color: "#F1F5F9" }} />
          <input value={amount} onChange={e => setAmount(e.target.value)} type="number" placeholder="Valor"
            className="w-full p-2.5 rounded-lg text-sm mb-3 outline-none"
            style={{ background: "#0A0B0E", border: "1px solid rgba(148,163,184,0.15)", color: "#F1F5F9" }} />
          <button onClick={account ? send : connect} disabled={sending}
            className="w-full py-3 rounded-xl font-semibold text-sm transition-all duration-200 hover:brightness-110"
            style={{ background: currentNetwork.isTestnet ? "#e05a3a" : "#00D4AA", color: "#fff" }}>
            {sending ? "Enviando..." : account ? `Transferir USDC (${currentNetwork.shortName})` : "Conectar carteira"}
          </button>
        </div>
      )}

      {tab === "bridge" && (
        <div className="rounded-xl p-6 text-center" style={{ background: "#1E2128", border: "1px solid rgba(148,163,184,0.15)" }}>
          <div className="text-4xl mb-3">🔄</div>
          <h3 className="text-base font-semibold mb-1" style={{ color: "#F1F5F9" }}>Bridge / Swap</h3>
          <p className="text-xs mb-4" style={{ color: "#94a3b8" }}>Swap na mesma rede ou Bridge entre redes diferentes</p>
          <button onClick={() => setModal("swap")}
            className="py-3 px-6 rounded-xl font-semibold text-sm transition-all duration-200 hover:brightness-110"
            style={{ background: "#4A9EFF", color: "#fff" }}>
            🚀 Abrir Bridge / Swap (LI.FI)
          </button>
        </div>
      )}

      {tab === "jobs" && (
        account ? <JobsPanel account={account} network={currentNetwork} /> :
        <div className="py-10 text-center text-xs" style={{ color: "#64748b" }}>🔌 Conecte a carteira para ver os Jobs ERC-8183</div>
      )}

      {tab === "history" && (
        <div className="rounded-xl p-4" style={{ background: "#1E2128", border: "1px solid rgba(148,163,184,0.15)" }}>
          {history.length === 0 ? (
            <div className="py-8 text-center text-xs" style={{ color: "#64748b" }}>Nenhuma transação</div>
          ) : (
            history.map((h, i) => (
              <div key={i} className="p-3 rounded-lg mb-2 text-xs" style={{ background: "#262A33" }}>
                → {short(h.to)} -{h.amount} USDC
                <div style={{ color: "#64748b", marginTop: 2 }}>{h.time} - {h.network}</div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "agents" && account && (
        <div className="py-4 text-center text-xs" style={{ color: "#64748b" }}>
          🤖 Robôs traders rodando nos painéis abaixo
        </div>
      )}

      {/* Seções de Trading */}
      {account && (
        <div className="space-y-4 mt-4">
          <SectionMatch section="bot"><BotBank /></SectionMatch>
          <SectionMatch section="bridge"><BridgeWidget userAddress={account} /></SectionMatch>
          <SectionMatch section="trading"><RealAutomatedTrader account={account} currentNetwork={NETWORK_KEY_MAP[currentNetwork.chainId] ?? "arc"} /></SectionMatch>
          <SectionMatch section="payments"><NanopaymentDashboard agentScores={agentScores} /></SectionMatch>
          <SectionMatch section="trading"><PregãoDashboard rede={NETWORK_KEY_MAP[currentNetwork.chainId] ?? "arc"} /></SectionMatch>
          <SectionMatch section="classroom"><SalaDeAula /></SectionMatch>
        </div>
      )}

      {/* Modais */}
      {modal === "receive" && <ReceiveModal account={account} onClose={() => setModal("")} network={currentNetwork} />}
      {modal === "swap" && <SwapBridgeModal account={account} onClose={() => setModal("")} currentNetwork={currentNetwork} onComplete={() => loadAllBalances(account)} />}
    </DashboardShell>
  );
}

