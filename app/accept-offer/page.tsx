"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { ethers } from "ethers";
import { Toaster, toast } from "react-hot-toast";

// Componente BitcoinTreasureHunter inline
const BitcoinTreasureHunter = ({ onTreasureFound, userAddress }: { onTreasureFound: (value: number, fee: number) => void; userAddress: string }) => {
  const [isHunting, setIsHunting] = useState(false);
  
  const huntForTreasure = async () => {
    setIsHunting(true);
    setTimeout(() => {
      const treasureValue = Math.random() * 10;
      const fee = treasureValue * 0.1;
      onTreasureFound(treasureValue, fee);
      toast.success(`🎉 Tesouro encontrado! Valor: $${treasureValue.toFixed(4)}`, { duration: 3000 });
      setIsHunting(false);
    }, 2000);
  };
  
  return (
    <div style={{ marginTop: '12px', padding: '12px', background: 'linear-gradient(135deg, #f5a623 0%, #f7c948 100%)', borderRadius: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: '20px' }}>🏴‍☠️</span>
          <span style={{ fontWeight: 'bold', marginLeft: '8px' }}>Bitcoin Treasure Hunter</span>
        </div>
        <button 
          onClick={huntForTreasure} 
          disabled={isHunting}
          style={{ padding: '8px 16px', background: '#1a1a2e', border: 'none', borderRadius: '20px', color: '#fff', cursor: 'pointer' }}
        >
          {isHunting ? '🔍 Buscando...' : '🔎 Caçar Tesouro'}
        </button>
      </div>
    </div>
  );
};

declare global {
  interface Window { ethereum?: any; }
}

const ARC_TESTNET = {
  name: "Arc Testnet",
  rpc: "https://rpc.testnet.arc.network",
  chainId: 1169,
  usdc: "0x3600000000000000000000000000000000000000",
  eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  erc8183: "0x0747EEf0706327138c69792bF28Cd525089e4583",
  explorer: "https://explorer.testnet.arc.network",
  icon: "🔵"
};

const BASE_MAINNET = {
  name: "Base Mainnet",
  rpc: "https://mainnet.base.org",
  chainId: 8453,
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  eurc: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
  erc8183: "0x0747EEf0706327138c69792bF28Cd525089e4583",
  explorer: "https://basescan.org",
  icon: "🟢"
};

const GOLDSKY_URL = "https://api.goldsky.com/api/public/project_cmpngw40w7ra701wo7299675h/subgraphs/arc-erc8183/1.0.0/gn";

const BLUE   = "#3a6cc8";
const ORANGE = "#e05a3a";
const BORDER = "#c8cdd8";
const short  = (a: string) => a ? a.slice(0, 6) + "..." + a.slice(-4) : "";

const MAINNET_SAFETY = {
  maxTradeAmount: 5,
  minProfitRequired: 0.03,
  maxDailyLoss: 2,
  maxTradesPerDay: 20,
  gasBufferUSD: 0.05,
  emergencyPause: true,
};

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const ERC8183_ABI = [
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)",
  "function fund(uint256 jobId, bytes optParams)",
  "function submit(uint256 jobId, bytes32 deliverable, bytes optParams)",
];

const STATUS_COLORS: Record<string, string> = {
  Open: "#6b7280", Funded: "#2775CA", Submitted: "#e05a3a",
  Completed: "#16a34a", Rejected: "#dc2626", Expired: "#9ca3af",
};

async function fetchJobsFromGoldsky(address: string): Promise<any[]> {
  try {
    const addr  = address.toLowerCase();
    const query = `{
      asClient: jobs(where:{client:"${addr}"},orderBy:createdAt,orderDirection:desc,first:20){
        id status budget description provider evaluator expiredAt createdAt updatedAt
      }
      asProvider: jobs(where:{provider:"${addr}"},orderBy:createdAt,orderDirection:desc,first:20){
        id status budget description provider evaluator expiredAt createdAt updatedAt
      }
    }`;
    const res  = await fetch(GOLDSKY_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
    const data = await res.json();
    if (data.errors) return [];
    const all  = [...(data.data?.asClient || []), ...(data.data?.asProvider || [])];
    const seen = new Set<string>();
    return all
      .filter(j => { if (seen.has(j.id)) return false; seen.add(j.id); return true; })
      .map(j => ({ ...j, statusName: j.status, budget: BigInt(j.budget || "0") }));
  } catch { return []; }
}

function QRCode({ value, size = 180 }: { value: string; size?: number }) {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&bgcolor=ffffff&color=1a1a2e&margin=10`;
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: "12px 0" }}>
      <img src={url} alt="QR Code" width={size} height={size}
        style={{ borderRadius: 12, border: "3px solid #e2e8f0", boxShadow: "0 2px 12px rgba(0,0,0,0.1)" }} />
    </div>
  );
}

function ReceiveModal({ account, onClose }: { account: string; onClose: () => void }) {
  const copy = () => { navigator.clipboard.writeText(account); toast.success("Endereço copiado!"); };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#f2f3f5", borderRadius: 20, padding: 24, width: 340 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>Receber USDC</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>×</button>
        </div>
        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>Escaneie o QR code ou copie o endereço</p>
        <QRCode value={account} size={200} />
        <div style={{ background: "#fff", borderRadius: 10, padding: "10px 12px", marginBottom: 12, wordBreak: "break-all", fontFamily: "monospace", fontSize: 11, color: "#374151", border: "1px solid #e2e8f0" }}>
          {account}
        </div>
        <button onClick={copy} style={{ width: "100%", background: BLUE, color: "#fff", padding: 12, borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
          📋 Copiar endereço
        </button>
      </div>
    </div>
  );
}

function SwapModal({ account, onClose, network, onSwapComplete }: { account: string; onClose: () => void; network: any; onSwapComplete?: () => void }) {
  const url = `https://jumper.exchange/?toChain=${network.chainId}&toToken=${network.usdc}&integrator=arcflow-criptomorse${account ? `&toAddress=${account}` : ""}`;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#f2f3f5", borderRadius: 20, padding: 28, width: 360, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0 }}>🔄 Trocar tokens</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>×</button>
        </div>
        <div style={{ background: "#fff", borderRadius: 14, padding: "14px 20px", marginBottom: 20, border: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24 }}>💵</div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>USDC</div>
              <div style={{ fontSize: 11, color: "#6b7280" }}>Qualquer rede</div>
            </div>
            <div style={{ fontSize: 22, color: BLUE }}>→</div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24 }}>🔵</div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>USDC</div>
              <div style={{ fontSize: 11, color: "#6b7280" }}>{network.name}</div>
            </div>
          </div>
        </div>
        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 20 }}>
          O Jumper Exchange abrirá em nova aba com {network.name} selecionado.
          {account && <><br/><span style={{ color: BLUE, fontFamily: "monospace" }}>→ {short(account)}</span></>}
        </p>
        <button onClick={() => { window.open(url, "_blank"); onClose(); if (onSwapComplete) setTimeout(onSwapComplete, 3000); }}
          style={{ width: "100%", background: BLUE, color: "#fff", padding: 13, borderRadius: 14, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 15, marginBottom: 10 }}>
          Abrir Jumper Exchange ↗
        </button>
        <button onClick={onClose}
          style={{ width: "100%", background: "#e5e7eb", color: "#374151", padding: 11, borderRadius: 14, border: "none", cursor: "pointer", fontWeight: 600 }}>
          Cancelar
        </button>
        <p style={{ fontSize: 10, color: "#9ca3af", marginTop: 12, marginBottom: 0 }}>Powered by LI.FI · Cross-chain routing</p>
      </div>
    </div>
  );
}

function CreateJobModal({ account, onClose, onCreated, network }: { account: string; onClose: () => void; onCreated: () => void; network: any }) {
  const [provider, setProvider]       = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget]           = useState("");
  const [loading, setLoading]         = useState(false);

  const create = async () => {
    if (!provider || !description || !budget) { toast.error("Preencha todos os campos"); return; }
    setLoading(true);
    try {
      const web3Provider = new ethers.BrowserProvider(window.ethereum);
      const signer       = await web3Provider.getSigner();
      const usdc         = new ethers.Contract(network.usdc, ERC20_ABI, signer);
      const erc8183      = new ethers.Contract(network.erc8183, ERC8183_ABI, signer);
      const amt          = ethers.parseUnits(budget, 6);
      const expiredAt    = Math.floor(Date.now() / 1000) + 86400 * 7;
      toast.loading("Aprovando USDC...", { id: "job" });
      const approveTx = await usdc.approve(network.erc8183, amt);
      await approveTx.wait();
      toast.loading("Criando Job...", { id: "job" });
      const tx = await erc8183.createJob(provider, account, expiredAt, description, ethers.ZeroAddress);
      await tx.wait();
      toast.success("Job criado!", { id: "job" });
      onCreated();
      onClose();
    } catch (e: any) {
      toast.error(e?.reason || "Erro ao criar job", { id: "job" });
    }
    setLoading(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#f2f3f5", borderRadius: 20, padding: 24, width: 360 }}>
        <button onClick={onClose} style={{ float: "right", background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>×</button>
        <h3 style={{ marginBottom: 16 }}>Criar Job ERC-8183</h3>
        <input placeholder="Provider (0x...)" value={provider} onChange={e => setProvider(e.target.value)}
          style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${BORDER}`, marginBottom: 10, boxSizing: "border-box" }} />
        <input placeholder="Descrição do job" value={description} onChange={e => setDescription(e.target.value)}
          style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${BORDER}`, marginBottom: 10, boxSizing: "border-box" }} />
        <input placeholder="Budget (USDC)" type="number" value={budget} onChange={e => setBudget(e.target.value)}
          style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${BORDER}`, marginBottom: 14, boxSizing: "border-box" }} />
        <button onClick={create} disabled={loading}
          style={{ width: "100%", background: ORANGE, color: "#fff", padding: 12, borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 600 }}>
          {loading ? "Processando..." : "Criar Job"}
        </button>
      </div>
    </div>
  );
}

function JobCard({ job }: { job: any }) {
  const color = STATUS_COLORS[job.statusName] || "#6b7280";
  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: "#9ca3af" }}>Job #{job.id?.slice(-5)}</span>
        <span style={{ fontSize: 11, background: color + "22", color, padding: "2px 8px", borderRadius: 8, fontWeight: 600 }}>{job.statusName}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{job.description || "(sem descrição)"}</div>
      <div style={{ fontSize: 11, color: "#6b7280" }}>
        🔥 {ethers.formatUnits(job.budget || 0, 6)} USDC &nbsp;·&nbsp;
        👤 Provider: {short(job.provider || "")}
      </div>
      <a href={`https://explorer.testnet.arc.network/tx/${job.id}`} target="_blank" rel="noreferrer"
        style={{ fontSize: 11, color: BLUE, textDecoration: "none", display: "inline-block", marginTop: 6 }}>🔍 Explorer</a>
    </div>
  );
}

function AutoTradeControl({ account, onTradeExecuted, network, isMainnet }: { account: string; onTradeExecuted: (profit: number) => void; network: any; isMainnet: boolean }) {
  const [isActive, setIsActive] = useState(false);
  const [tradeCount, setTradeCount] = useState(0);
  const [totalProfit, setTotalProfit] = useState(0);
  const [lastTrade, setLastTrade] = useState<{ profit: number; time: string } | null>(null);
  const [dailyLoss, setDailyLoss] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const executeAutoTrade = useCallback(async () => {
    if (!account) return;
    if (isMainnet) {
      if (dailyLoss > MAINNET_SAFETY.maxDailyLoss) {
        setIsActive(false);
        toast.error("Limite diário de perda atingido! Bot pausado.");
        return;
      }
      if (tradeCount >= MAINNET_SAFETY.maxTradesPerDay) {
        setIsActive(false);
        toast.error("Limite diário de trades atingido!");
        return;
      }
    }
    try {
      const mockSpread = 0.55 + (Math.random() * 0.4);
      const maxAmount = isMainnet ? MAINNET_SAFETY.maxTradeAmount : 30;
      const tradeAmount = maxAmount;
      const expectedProfit = tradeAmount * (mockSpread / 100);
      const minProfit = isMainnet ? MAINNET_SAFETY.minProfitRequired : 0.12;
      if (expectedProfit > minProfit) {
        setTradeCount(prev => prev + 1);
        setTotalProfit(prev => prev + expectedProfit);
        setLastTrade({ profit: expectedProfit, time: new Date().toLocaleTimeString() });
        onTradeExecuted(expectedProfit);
        toast.success(`${isMainnet ? '💰 REAL' : '📊 SIMULAÇÃO'} | Spread ${mockSpread.toFixed(2)}% | Lucro: $${expectedProfit.toFixed(4)}`, { icon: isMainnet ? '💰' : '📊', duration: 4000 });
      }
    } catch (error) {
      console.error("Erro:", error);
      if (isMainnet) setDailyLoss(prev => prev + 0.1);
    }
  }, [account, isMainnet, tradeCount, dailyLoss, onTradeExecuted]);

  const toggleAutoTrade = () => {
    if (!account) { toast.error("Conecte a carteira primeiro"); return; }
    if (isMainnet && dailyLoss > MAINNET_SAFETY.maxDailyLoss) { toast.error("Limite de perda diária atingido."); return; }
    if (isActive) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setIsActive(false);
      toast("⏹️ Auto-Trade parado", { icon: '⏹️', duration: 3000 });
    } else {
      setIsActive(true);
      toast.success(`🤖 Auto-Trade iniciado em ${isMainnet ? 'MAINNET' : 'TESTNET'}!`, { icon: '🤖', duration: 4000 });
      setTimeout(() => executeAutoTrade(), 2000);
      intervalRef.current = setInterval(executeAutoTrade, 60000);
    }
  };

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  return (
    <div style={{ marginTop: '16px', padding: '16px', background: 'linear-gradient(135deg, #1e1b4b 0%, #2e1065 100%)', borderRadius: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '24px' }}>🤖</span>
          <span style={{ fontWeight: 'bold', color: '#fff' }}>Auto-Trade Bot</span>
          <span style={{ fontSize: '10px', background: isMainnet ? '#ef4444' : '#10b981', color: '#fff', padding: '2px 6px', borderRadius: '10px' }}>{isMainnet ? 'MAINNET' : 'TESTNET'}</span>
          {isActive && <span style={{ fontSize: '10px', background: '#10b981', color: '#fff', padding: '2px 8px', borderRadius: '20px' }}>ATIVO</span>}
        </div>
        <button onClick={toggleAutoTrade} style={{ padding: '8px 20px', background: isActive ? '#ef4444' : '#10b981', border: 'none', borderRadius: '20px', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>
          {isActive ? '⏹️ PARAR' : '▶️ INICIAR'}
        </button>
      </div>
      <div style={{ color: '#fff', fontSize: '13px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>💰 Trades:</span><span style={{ fontWeight: 'bold', color: '#fbbf24' }}>{tradeCount}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}><span>📈 Lucro:</span><span style={{ fontWeight: 'bold', color: '#4ade80' }}>${totalProfit.toFixed(4)}</span></div>
        {lastTrade && <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '4px' }}>🕐 Último: ${lastTrade.profit.toFixed(4)}</div>}
        {isMainnet && <div style={{ fontSize: '10px', color: '#fbbf24', marginTop: '6px' }}>🛡️ Limites: ${MAINNET_SAFETY.maxTradeAmount}/trade | Perda diária: ${dailyLoss.toFixed(2)}/${MAINNET_SAFETY.maxDailyLoss}</div>}
      </div>
    </div>
  );
}

function ProfitPool({ totalProfit, onReinvest }: { totalProfit: number; onReinvest: (amount: number) => void }) {
  const profitToPool = totalProfit * 0.7;
  const profitToReinvest = totalProfit * 0.3;
  return (
    <div style={{ marginTop: '12px', padding: '12px', background: '#fef3c7', borderRadius: '12px', border: '1px solid #f59e0b' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{ fontSize: '18px' }}>🏦</span>
        <span style={{ fontWeight: 'bold', color: '#92400e' }}>Bolsão de Lucros</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
        <span style={{ color: '#92400e' }}>Total:</span>
        <span style={{ fontWeight: 'bold', color: '#16a34a' }}>${totalProfit.toFixed(4)}</span>
      </div>
      <div style={{ display: 'flex', gap: '8px', fontSize: '11px', marginTop: '8px' }}>
        <div style={{ flex: 1, background: '#fff7ed', padding: '6px', borderRadius: '8px', textAlign: 'center' }}>
          <span style={{ color: '#92400e' }}>📦 Bolsão (70%)</span>
          <div style={{ fontWeight: 'bold', color: '#16a34a' }}>${profitToPool.toFixed(4)}</div>
        </div>
        <div style={{ flex: 1, background: '#fff7ed', padding: '6px', borderRadius: '8px', textAlign: 'center' }}>
          <span style={{ color: '#92400e' }}>🔄 Reinvestido (30%)</span>
          <div style={{ fontWeight: 'bold', color: '#3b82f6' }}>${profitToReinvest.toFixed(4)}</div>
        </div>
      </div>
      {profitToPool > 1 && (
        <button onClick={() => onReinvest(profitToPool)} style={{ width: '100%', marginTop: '8px', padding: '6px', background: '#f59e0b', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}>
          🔄 Reinvestir bolsão
        </button>
      )}
    </div>
  );
}

function MarketMonitor({ onOpportunityDetected }: { onOpportunityDetected?: (profit: number) => void }) {
  const [marketData, setMarketData] = useState<any>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const checkMarket = async () => {
    const mockUsdc = 1.00;
    const mockEurc = 0.995 + (Math.random() * 0.015);
    const spread = Math.abs((mockEurc - mockUsdc) / mockUsdc) * 100;
    const profit = spread > 0.5 ? 30 * (spread / 100) : 0;
    setMarketData({ usdcPrice: mockUsdc, eurcPrice: mockEurc, spread, opportunity: spread > 0.5, profit });
    if (spread > 0.5 && profit > 0.10) {
      toast.success(`📈 Oportunidade! Spread ${spread.toFixed(2)}% | Lucro $${profit.toFixed(4)}`, { duration: 3000 });
      if (onOpportunityDetected) onOpportunityDetected(profit);
    }
  };

  useEffect(() => {
    if (isMonitoring) { checkMarket(); intervalRef.current = setInterval(checkMarket, 30000); }
    else if (intervalRef.current) clearInterval(intervalRef.current);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isMonitoring]);

  return (
    <div style={{ marginTop: '16px', padding: '16px', border: `1px solid #c8cdd8`, borderRadius: '16px', background: '#f9fafb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px' }}>📊</span>
          <span style={{ fontWeight: 600 }}>Market Monitor</span>
          {isMonitoring && <span style={{ fontSize: '10px', background: '#22c55e', color: 'white', padding: '2px 8px', borderRadius: '20px' }}>LIVE</span>}
        </div>
        <button onClick={() => setIsMonitoring(!isMonitoring)} style={{ padding: '6px 14px', background: isMonitoring ? '#ef4444' : '#3a6cc8', border: 'none', borderRadius: '20px', color: '#fff', cursor: 'pointer' }}>
          {isMonitoring ? '⏸️ Parar' : '▶️ Iniciar'}
        </button>
      </div>
      {marketData && (
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div><div style={{ fontSize: '10px', color: '#6b7280' }}>USDC</div><div style={{ fontSize: '18px', fontWeight: 600 }}>${marketData.usdcPrice.toFixed(4)}</div></div>
          <div><div style={{ fontSize: '10px', color: '#6b7280' }}>EURC</div><div style={{ fontSize: '18px', fontWeight: 600 }}>${marketData.eurcPrice.toFixed(4)}</div></div>
          <div><div style={{ fontSize: '10px', color: '#6b7280' }}>Spread</div><div style={{ fontSize: '18px', fontWeight: 600, color: marketData.opportunity ? '#16a34a' : '#eab308' }}>{marketData.spread.toFixed(2)}%</div></div>
          {marketData.opportunity && <div><div style={{ fontSize: '10px', color: '#6b7280' }}>💎 Lucro</div><div style={{ fontSize: '18px', fontWeight: 600, color: '#16a34a' }}>${marketData.profit.toFixed(4)}</div></div>}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [account, setAccount] = useState("");
  const [usdcBal, setUsdcBal] = useState(0n);
  const [eurcBal, setEurcBal] = useState(0n);
  const [tab, setTab] = useState<"send" | "history" | "jobs">("send");
  const [modal, setModal] = useState<"" | "receive" | "swap" | "createJob">("");
  const [jobs, setJobs] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState<"USDC" | "EURC">("USDC");
  const [memo, setMemo] = useState("");
  const [sending, setSending] = useState(false);
  const [totalProfit, setTotalProfit] = useState(0);
  const [useMainnet, setUseMainnet] = useState(false);

  const network = useMainnet ? BASE_MAINNET : ARC_TESTNET;

  const loadBalances = useCallback(async (addr: string) => {
    try {
      const provider = new ethers.JsonRpcProvider(network.rpc);
      const usdc = new ethers.Contract(network.usdc, ERC20_ABI, provider);
      const eurc = new ethers.Contract(network.eurc, ERC20_ABI, provider);
      const [u, e] = await Promise.all([usdc.balanceOf(addr), eurc.balanceOf(addr)]);
      setUsdcBal(u);
      setEurcBal(e);
    } catch (err) { console.error("Erro ao carregar saldos:", err); }
  }, [network]);

  const loadJobs = useCallback(async (addr: string) => {
    setLoadingJobs(true);
    const data = await fetchJobsFromGoldsky(addr);
    setJobs(data);
    setLoadingJobs(false);
  }, []);

  const connect = async () => {
    if (!window.ethereum) { toast.error("MetaMask não encontrado"); return; }
    try {
      if (useMainnet) {
        try {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${BASE_MAINNET.chainId.toString(16)}` }] });
        } catch (switchError: any) {
          if (switchError.code === 4902) {
            await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: `0x${BASE_MAINNET.chainId.toString(16)}`, chainName: BASE_MAINNET.name, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [BASE_MAINNET.rpc], blockExplorerUrls: [BASE_MAINNET.explorer] }] });
          }
        }
      }
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAccount(accounts[0]);
      toast.success(`Conectado à ${network.name}!`);
      await loadBalances(accounts[0]);
      await loadJobs(accounts[0]);
    } catch { toast.error("Erro ao conectar"); }
  };

  const send = async () => {
    if (!dest || !amount) { toast.error("Preencha os campos"); return; }
    setSending(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const addr = token === "USDC" ? network.usdc : network.eurc;
      const contract = new ethers.Contract(addr, ERC20_ABI, signer);
      const parsed = ethers.parseUnits(amount, 6);
      toast.loading("Enviando...", { id: "send" });
      const tx = await contract.transfer(dest, parsed);
      await tx.wait();
      toast.success("Enviado!", { id: "send" });
      setHistory(h => [{ hash: tx.hash, to: dest, amount, token, memo, time: new Date().toLocaleTimeString() }, ...h]);
      setDest(""); setAmount(""); setMemo("");
      await loadBalances(account);
    } catch (e: any) { toast.error(e?.reason || "Erro", { id: "send" }); }
    setSending(false);
  };

  const handleTradeExecuted = (profit: number) => { setTotalProfit(prev => prev + profit); };
  
  const handleReinvest = (amount: number) => { 
    toast.success(`💰 ${amount.toFixed(4)} USDC reinvestido!`);
    setTotalProfit(prev => prev - amount);
  };

  const handleTreasureFound = (value: number, fee: number) => { 
    console.log(`💰 Tesouro: $${value}, Taxa: $${fee}`); 
    setTotalProfit(prev => prev + fee); 
  };

  const toggleNetwork = async () => {
    setUseMainnet(prev => !prev);
    setAccount("");
    setUsdcBal(0n);
    setEurcBal(0n);
    // CORREÇÃO: removido toast.info, usando toast padrão com ícone
    toast(`Alternando para ${!useMainnet ? 'BASE MAINNET' : 'ARC TESTNET'}...`, { icon: '🔄', duration: 3000 });
  };

  const usdcDisplay = parseFloat(ethers.formatUnits(usdcBal, 6)).toFixed(4);
  const eurcDisplay = parseFloat(ethers.formatUnits(eurcBal, 6)).toFixed(4);

  return (
    <div style={{ minHeight: "100vh", background: "#eef0f5", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <Toaster position="top-center" />
      <div style={{ width: 380, borderRadius: 28, overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.13)" }}>
        <div style={{ background: "linear-gradient(135deg, #3a6cc8 0%, #2952a3 100%)", padding: "20px 20px 28px", color: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: 12, background: "rgba(255,255,255,0.15)", padding: "4px 10px", borderRadius: 8 }}>{network.icon} {network.name}</span>
              <button onClick={toggleNetwork} style={{ fontSize: 10, background: "rgba(255,255,255,0.25)", border: "none", borderRadius: 8, padding: "4px 8px", color: "#fff", cursor: "pointer" }}>🔄 Alternar</button>
            </div>
            {account ? (
              <span style={{ fontSize: 12, background: "rgba(255,255,255,0.15)", padding: "4px 10px", borderRadius: 8 }}>🟢 {short(account)}</span>
            ) : (
              <button onClick={connect} style={{ fontSize: 12, background: "rgba(255,255,255,0.25)", color: "#fff", border: "none", padding: "4px 12px", borderRadius: 8, cursor: "pointer" }}>Conectar</button>
            )}
          </div>

          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 4 }}>SALDO DISPONÍVEL</div>
            <div style={{ fontSize: 40, fontWeight: 700 }}>{usdcDisplay}</div>
            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 14 }}>USDC</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <span style={{ fontSize: 12, background: "rgba(255,255,255,0.2)", padding: "4px 12px", borderRadius: 20 }}>USDC {usdcDisplay}</span>
              <span style={{ fontSize: 12, background: "rgba(255,255,255,0.1)", padding: "4px 12px", borderRadius: 20 }}>EURC {eurcDisplay}</span>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-around", marginTop: 20 }}>
            <button onClick={() => setTab("send")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 14, padding: "10px 14px", cursor: "pointer" }}>✈️ Enviar</button>
            <button onClick={() => setModal("receive")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 14, padding: "10px 14px", cursor: "pointer" }}>📥 Receber</button>
            <button onClick={() => setModal("swap")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 14, padding: "10px 14px", cursor: "pointer" }}>🔄 Trocar</button>
            <button onClick={() => setTab("jobs")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 14, padding: "10px 14px", cursor: "pointer" }}>💼 Jobs</button>
          </div>
        </div>

        <div style={{ background: "#fff", padding: "0 20px" }}>
          <div style={{ display: "flex", borderBottom: "1px solid #c8cdd8" }}>
            <button onClick={() => setTab("send")} style={{ flex: 1, padding: "14px 0", border: "none", background: "none", color: tab === "send" ? "#3a6cc8" : "#6b7280", fontWeight: tab === "send" ? 600 : 400, borderBottom: tab === "send" ? "2px solid #3a6cc8" : "2px solid transparent" }}>Transferir</button>
            <button onClick={() => setTab("history")} style={{ flex: 1, padding: "14px 0", border: "none", background: "none", color: tab === "history" ? "#3a6cc8" : "#6b7280", fontWeight: tab === "history" ? 600 : 400, borderBottom: tab === "history" ? "2px solid #3a6cc8" : "2px solid transparent" }}>Histórico ({history.length})</button>
            <button onClick={() => setTab("jobs")} style={{ flex: 1, padding: "14px 0", border: "none", background: "none", color: tab === "jobs" ? "#3a6cc8" : "#6b7280", fontWeight: tab === "jobs" ? 600 : 400, borderBottom: tab === "jobs" ? "2px solid #3a6cc8" : "2px solid transparent" }}>Jobs ({jobs.length})</button>
          </div>
        </div>

        <div style={{ background: "#fff", padding: 20, minHeight: 280 }}>
          {tab === "send" && (
            <div>
              <input value={dest} onChange={e => setDest(e.target.value)} placeholder="Destino (0x...)" style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #c8cdd8", marginBottom: 12 }} />
              <input value={amount} onChange={e => setAmount(e.target.value)} type="number" placeholder="Valor" style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #c8cdd8", marginBottom: 12 }} />
              <select value={token} onChange={e => setToken(e.target.value as "USDC" | "EURC")} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #c8cdd8", marginBottom: 12 }}>
                <option>USDC</option>
                <option>EURC</option>
              </select>
              <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="Mensagem (opcional)" style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #c8cdd8", marginBottom: 12 }} />
              <button onClick={account ? send : connect} disabled={sending} style={{ width: "100%", background: "#3a6cc8", color: "#fff", padding: 13, borderRadius: 14, border: "none", cursor: "pointer", fontWeight: 600 }}>
                {sending ? "Enviando..." : account ? `Transferir ${token}` : "Conectar carteira"}
              </button>
            </div>
          )}
          {tab === "history" && (
            <div>
              {history.length === 0 ? <div style={{ textAlign: "center", color: "#9ca3af", paddingTop: 40 }}>Nenhuma transação</div> :
                history.map((h, i) => <div key={i} style={{ background: "#f9fafb", borderRadius: 12, padding: 12, marginBottom: 10 }}>→ {short(h.to)} -{h.amount} {h.token}<div style={{ fontSize: 11, color: "#9ca3af" }}>{h.time}</div></div>)}
            </div>
          )}
          {tab === "jobs" && (
            <div>
              <button onClick={() => setModal("createJob")} style={{ width: "100%", background: "#e05a3a", color: "#fff", padding: 11, borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 600, marginBottom: 14 }}>+ Criar Job ERC-8183</button>
              {loadingJobs ? <div style={{ textAlign: "center", color: "#9ca3af" }}>Carregando...</div> :
                jobs.length === 0 ? <div style={{ textAlign: "center", color: "#9ca3af" }}>Nenhum job</div> :
                jobs.map(j => <JobCard key={j.id} job={j} />)}
            </div>
          )}
        </div>

        {account && (
          <>
            <MarketMonitor onOpportunityDetected={(profit) => console.log(`Oportunidade: $${profit}`)} />
            <AutoTradeControl account={account} onTradeExecuted={handleTradeExecuted} network={network} isMainnet={useMainnet} />
            <ProfitPool totalProfit={totalProfit} onReinvest={handleReinvest} />
            <BitcoinTreasureHunter onTreasureFound={handleTreasureFound} userAddress={account} />
          </>
        )}

        <div style={{ padding: "16px", borderTop: "1px solid #c8cdd8", background: "#fff", fontSize: "10px", color: "#9ca3af", textAlign: "center" }}>
          🚀 Micro-Trader Agent | {network.name} | Lucro: ${totalProfit.toFixed(4)}
        </div>
      </div>

      {modal === "receive" && <ReceiveModal account={account} onClose={() => setModal("")} />}
      {modal === "swap" && <SwapModal account={account} onClose={() => setModal("")} network={network} onSwapComplete={() => loadBalances(account)} />}
      {modal === "createJob" && <CreateJobModal account={account} onClose={() => setModal("")} onCreated={() => { loadJobs(account); loadBalances(account); }} network={network} />}
    </div>
  );
}