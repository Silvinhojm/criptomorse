"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { ethers } from "ethers";
import { Toaster, toast } from "react-hot-toast";

// Componentes
import AgentIdentityCard from "./components/AgentIdentityCard";
import BitcoinTreasureHunter from "./components/BitcoinTreasureHunter";
import { AgentDashboard } from "./components/AgentDashboard";

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
import type { AgentLearningStats } from "../lib/agent-memory";

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
// CONFIGURAÇÕES — Arc Testnet
// Chain ID 5042002 = 0x4cef52
// USDC é o GAS TOKEN nativo (não um ERC-20 separado para gas)
// RPC oficial: https://rpc.testnet.arc.network
// Explorer:    https://testnet.arcscan.app
// ============================================================

const BLUE = "#3a6cc8";
const BORDER = "#c8cdd8";
const GAS_PER_TRADE = 0.12;

// CORRIGIDO: Chain ID unificado — 0x4cef52 = 5042002 decimal
const ARC_CHAIN_ID = "0x4cef52";
const ARC_CHAIN_ID_DECIMAL = 5042002;

// Endereço do contrato USDC na Arc Testnet
// IMPORTANTE: verifique o endereço correto em https://docs.arc.network ou testnet.arcscan.app
const USDC_CONTRACT = "0x3600000000000000000000000000000000000000";
const ARC_RPC = "https://rpc.testnet.arc.network";

const short = (a: string) => a ? a.slice(0, 6) + "..." + a.slice(-4) : "";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  // CORRIGIDO: adicionado decimals() para leitura dinâmica
  "function decimals() view returns (uint8)"
];

// ============================================================
// TIPOS
// ============================================================

interface MarketOpportunity {
  type: string;
  confidence: number;
  expectedProfit: number;
}

// ============================================================
// COMPONENTES SIMPLIFICADOS
// ============================================================

function ReceiveModal({ account, onClose }: { account: string; onClose: () => void }) {
  const copy = () => { navigator.clipboard.writeText(account); toast.success("Endereço copiado!"); };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#f2f3f5", borderRadius: 20, padding: 24, width: 340 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>Receber USDC</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ background: "#fff", borderRadius: 10, padding: "10px 12px", marginBottom: 12, wordBreak: "break-all", fontFamily: "monospace", fontSize: 11 }}>
          {account}
        </div>
        <button onClick={copy} style={{ width: "100%", background: BLUE, color: "#fff", padding: 12, borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 600 }}>
          📋 Copiar endereço
        </button>
      </div>
    </div>
  );
}

// ============================================================
// AUTO-TRADE CONTROL
// ============================================================

function AutoTradeControl({ account, onTradeExecuted, isMainnet }: { account: string; onTradeExecuted: (profit: number) => void; isMainnet: boolean }) {
  const [isActive, setIsActive] = useState(false);
  const [tradeCount, setTradeCount] = useState(0);
  const [grossProfit, setGrossProfit] = useState(0);
  const [lastTrade, setLastTrade] = useState<{ profit: number; time: string } | null>(null);
  const [tradeSize, setTradeSize] = useState(isMainnet ? 10 : 30);
  const [quantumAnalysis, setQuantumAnalysis] = useState('');
  const [quantumScore, setQuantumScore] = useState(0);
  const [marketSentiment, setMarketSentiment] = useState<NewsSentiment | null>(null);
  const [agentScores, setAgentScores] = useState<any[]>([]);
  const [votingStats, setVotingStats] = useState({ totalVotes: 0, avgConfidence: 0, winRate: 0 });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const priceHistory = useRef<number[]>([1.00, 1.001, 0.999, 1.002, 1.000]);

  const fetchRealMarketData = useCallback(async () => {
    try {
      const [geckoPrice, cmcPrice, fearGreed] = await Promise.all([
        coingeckoAgent?.getPrice('bitcoin').catch(() => 65000),
        coinmarketcapAgent?.getPrice('BTC').catch(() => 65000),
        coinmarketcapAgent?.getFearAndGreed().catch(() => ({ value: 50, classification: 'Neutral' }))
      ]);
      return { geckoPrice: geckoPrice || 65000, cmcPrice: cmcPrice || 65000, fearGreed: fearGreed || { value: 50, classification: 'Neutral' } };
    } catch {
      return { geckoPrice: 65000, cmcPrice: 65000, fearGreed: { value: 50, classification: 'Neutral' } };
    }
  }, []);

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
      `🌌 Quântico: ${quantumOpinion.action} (${quantumOpinion.confidence}%) | 📊 Técnico: ${technicalOpinion.action} (${technicalOpinion.confidence}%) | 📰 Notícias: ${newsOpinion.action} (${newsOpinion.confidence}%) | 📈 Mercado: ${marketOpinion.action} (${marketOpinion.confidence}%) | 📊 Volume: ${volumeOpinion.action} (${volumeOpinion.confidence}%) | 🧠 Síntese: ${synthesisOpinion.action} (${synthesisOpinion.confidence}%) | ⚖️ FINAL: ${voteResult.action.toUpperCase()} (${voteResult.confidence}%)`
    );
    setQuantumScore(voteResult.confidence);

    return { decision: voteResult, votes };
  }, []);

  const executeTrade = useCallback(async () => {
    if (!account) return;
    try {
      await fetchRealMarketData();
      const currentMockPrice = 1.00 + (Math.random() * 0.02);
      priceHistory.current = [...priceHistory.current.slice(-30), currentMockPrice];

      const { decision } = await consultAgents(currentMockPrice, priceHistory.current);

      const deliberation = await tradingStrategies.deliberate(
        { action: decision.action, confidence: decision.confidence },
        async () => ({ action: decision.action, confidence: decision.confidence })
      );

      if (deliberation.shouldTrade) {
        const won = Math.random() > 0.4; // simulação de resultado (substituir por resultado real)
        setTradeCount(prev => prev + 1);
        const profit = tradeSize * 0.01;
        setGrossProfit(prev => prev + profit);
        setLastTrade({ profit, time: new Date().toLocaleTimeString() });
        onTradeExecuted(profit);

        // Atualiza memória individual de cada agente
        agentMemory.update("Quantum", won, quantumAgent.getScore().avgConfidence);
        agentMemory.update("Technical", won, technicalAgent.getScore().avgConfidence);
        agentMemory.update("Synthesis", won, synthesisAgent.getScore().avgConfidence);
        agentMemory.update("Market", won, marketAgent.getScore().avgConfidence);
        agentMemory.update("Volume", won, volumeAgent.getScore().avgConfidence);
        agentMemory.update("News", won, newsAgent.getScore().avgConfidence);

        // Registra resultado no sistema de votação para winRate real no dashboard
        votingSystem.recordResult(won);

        toast.success(`💰 TRADE | ${deliberation.action.toUpperCase()} | Conf: ${deliberation.confidence}% | Lucro: $${profit.toFixed(4)}`);
      }
    } catch (error) {
      console.error("Erro no trade:", error);
    }
  }, [account, tradeSize, fetchRealMarketData, consultAgents, onTradeExecuted]);

  const toggleAutoTrade = () => {
    if (!account) { toast.error("Conecte a carteira primeiro"); return; }
    if (isActive) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setIsActive(false);
      toast("⏹️ Auto-Trade parado");
    } else {
      setIsActive(true);
      updateMarketSentiment();
      toast.success(`🌌 Auto-Trade Multi-Agente iniciado! Trade: $${tradeSize}`);
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
        <div style={{ marginBottom: '12px', padding: '8px', background: 'rgba(139, 92, 246, 0.15)', borderRadius: '8px', fontSize: '10px', color: '#a78bfa', textAlign: 'center' }}>
          {quantumAnalysis}
        </div>
      )}

      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>💰 Valor por trade:</span>
          <span style={{ fontSize: '13px', color: '#a78bfa', fontWeight: 'bold' }}>${tradeSize} USDC</span>
        </div>
        <input type="range" min={10} max={isMainnet ? 25 : 100} step={1} value={tradeSize} onChange={(e) => setTradeSize(Number(e.target.value))} style={{ width: '100%' }} />
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

function ProfitPool({ totalProfit, onReinvest }: { totalProfit: number; onReinvest: (amount: number) => void }) {
  return (
    <div style={{ marginTop: '12px', padding: '12px', background: '#fef3c7', borderRadius: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>🏦 Bolsão de Lucros</span>
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

function MarketMonitor() {
  return (
    <div style={{ marginTop: '16px', padding: '16px', border: `1px solid ${BORDER}`, borderRadius: '16px', background: '#f9fafb' }}>
      <div>📊 Market Monitor</div>
      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>Monitorando spreads de mercado...</div>
    </div>
  );
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================
export default function Home() {
  const [isClient, setIsClient] = useState(false);
  const [account, setAccount] = useState("");
  const [usdcBal, setUsdcBal] = useState(0n);
  const [usdcDecimals, setUsdcDecimals] = useState(6); // CORRIGIDO: estado para decimals dinâmico
  const [tab, setTab] = useState<"send" | "history">("send");
  const [modal, setModal] = useState<"" | "receive">("");
  const [history, setHistory] = useState<any[]>([]);
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [totalProfit, setTotalProfit] = useState(0);

  useEffect(() => { setIsClient(true); }, []);

  // ── Busca saldo USDC real + decimals na Arc Testnet ───────
  const loadBalances = useCallback(async (addr: string) => {
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const usdc = new ethers.Contract(USDC_CONTRACT, ERC20_ABI, provider);

      // CORRIGIDO: lê decimals dinamicamente do contrato
      const [bal, dec]: [bigint, number] = await Promise.all([
        usdc.balanceOf(addr),
        usdc.decimals().catch(() => 6), // fallback para 6 se contrato não responder
      ]);
      setUsdcBal(bal);
      setUsdcDecimals(Number(dec));
    } catch (e) {
      console.error("Erro ao buscar saldo:", e);
      setUsdcBal(0n);
    }
  }, []);

  // ── Conectar carteira + garantir Arc Testnet ──────────────
  const connect = async () => {
    if (!window.ethereum) { toast.error("MetaMask não encontrado"); return; }
    try {
      // Tenta trocar para a Arc Testnet
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ARC_CHAIN_ID }], // CORRIGIDO: usa constante única 0x4cef52
        });
      } catch (switchErr: any) {
        if (switchErr.code === 4902) {
          // Rede não encontrada na MetaMask — adiciona
          try {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: ARC_CHAIN_ID, // CORRIGIDO: mesma constante 0x4cef52
                chainName: "Arc Testnet",
                rpcUrls: [ARC_RPC],
                // CORRIGIDO: nativeCurrency correto — USDC é o gas token nativo da Arc
                nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 6 },
                blockExplorerUrls: ["https://testnet.arcscan.app"],
              }],
            });
          } catch (addErr: any) {
            // Ignora erro de RPC duplicado — rede já existe com outro nome
            if (!addErr?.message?.includes("same RPC")) throw addErr;
          }
        }
        // Qualquer outro erro de switch: continua e tenta pegar as contas mesmo assim
      }

      const accounts: string[] = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAccount(accounts[0]);
      toast.success("Conectado!");
      await loadBalances(accounts[0]);
    } catch (error: any) {
      console.error("Erro ao conectar:", error);
      toast.error(error?.message ? error.message.slice(0, 80) : "Erro ao conectar");
    }
  };

  // ── Enviar USDC real ──────────────────────────────────────
  const send = async () => {
    if (!dest || !amount) { toast.error("Preencha os campos"); return; }
    setSending(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const usdc = new ethers.Contract(USDC_CONTRACT, ERC20_ABI, signer);

      // CORRIGIDO: usa usdcDecimals lido dinamicamente do contrato
      const parsed = ethers.parseUnits(amount, usdcDecimals);
      const tx = await usdc.transfer(dest, parsed);
      toast.loading("Aguardando confirmação...", { id: "tx" });
      await tx.wait();
      toast.success("Enviado!", { id: "tx" });
      setHistory(h => [{ to: dest, amount, time: new Date().toLocaleTimeString(), hash: tx.hash }, ...h]);
      setDest(""); setAmount("");
      await loadBalances(account);
    } catch (e: any) {
      toast.error(e?.reason || e?.message?.slice(0, 60) || "Erro ao enviar");
    }
    setSending(false);
  };

  const handleTradeExecuted = (profit: number) => { setTotalProfit(prev => prev + profit); };
  const handleReinvest = (amt: number) => { toast.success(`💰 ${amt.toFixed(4)} USDC reinvestido!`); };

  // CORRIGIDO: usa usdcDecimals dinâmico no formatUnits
  const usdcDisplay = parseFloat(ethers.formatUnits(usdcBal, usdcDecimals)).toFixed(2);

  if (!isClient) {
    return <div style={{ minHeight: "100vh", background: "#eef0f5", display: "flex", alignItems: "center", justifyContent: "center" }}>Carregando...</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#eef0f5", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <Toaster position="top-center" />
      <div style={{ width: 420, borderRadius: 28, overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.13)" }}>

        {/* ── Header azul ── */}
        <div style={{ background: "linear-gradient(135deg, #3a6cc8 0%, #2952a3 100%)", padding: "20px 20px 28px", color: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: 12, background: "rgba(255,255,255,0.15)", padding: "4px 10px", borderRadius: 8 }}>🔵 ARC Testnet</span>
              <span style={{ fontSize: 10, background: '#10b981', padding: "2px 8px", borderRadius: 12 }}>🧪 TESTE</span>
            </div>
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
            <div style={{ fontSize: 40, fontWeight: 700 }}>{usdcDisplay}</div>
            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 14 }}>USDC</div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-around", marginTop: 20 }}>
            <button onClick={() => setTab("send")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 14, padding: "10px 14px", cursor: "pointer" }}>✈️ Enviar</button>
            <button onClick={() => setModal("receive")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 14, padding: "10px 14px", cursor: "pointer" }}>📥 Receber</button>
            <button onClick={() => setTab("history")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 14, padding: "10px 14px", cursor: "pointer" }}>📜 Histórico</button>
          </div>
        </div>

        {/* ── Conteúdo branco ── */}
        <div style={{ background: "#fff", padding: 20, minHeight: 280 }}>
          {tab === "send" && (
            <div>
              <input value={dest} onChange={e => setDest(e.target.value)} placeholder="Destino (0x...)" style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${BORDER}`, marginBottom: 12, boxSizing: "border-box" }} />
              <input value={amount} onChange={e => setAmount(e.target.value)} type="number" placeholder="Valor" style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${BORDER}`, marginBottom: 12, boxSizing: "border-box" }} />
              <button onClick={account ? send : connect} disabled={sending} style={{ width: "100%", background: BLUE, color: "#fff", padding: 13, borderRadius: 14, border: "none", cursor: "pointer", fontWeight: 600 }}>
                {sending ? "Enviando..." : account ? "Transferir USDC" : "Conectar carteira"}
              </button>
            </div>
          )}
          {tab === "history" && (
            <div>
              {history.length === 0
                ? <div style={{ textAlign: "center", color: "#9ca3af", paddingTop: 40 }}>Nenhuma transação</div>
                : history.map((h, i) => (
                  <div key={i} style={{ background: "#f9fafb", borderRadius: 12, padding: 12, marginBottom: 10 }}>
                    → {short(h.to)} -{h.amount} USDC
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>{h.time}</div>
                    {h.hash && <div style={{ fontSize: 10, color: "#6b7280", fontFamily: "monospace" }}>{h.hash.slice(0, 20)}...</div>}
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* ── Seções de agentes (só quando conectado) ── */}
        {account && (
          <>
            <MarketMonitor />
            <AutoTradeControl account={account} onTradeExecuted={handleTradeExecuted} isMainnet={false} />
            <ProfitPool totalProfit={totalProfit} onReinvest={handleReinvest} />
            <BitcoinTreasureHunter
              onTreasureFound={(value: number, fee: number) => { setTotalProfit(prev => prev + fee); }}
              userAddress={account}
            />
          </>
        )}

        <div style={{ padding: "16px", borderTop: `1px solid ${BORDER}`, background: "#fff", fontSize: "10px", color: "#9ca3af", textAlign: "center" }}>
          🤖 6 Agentes | Votação Ponderada | ARC Testnet · Chain 5042002
        </div>
      </div>

      {modal === "receive" && <ReceiveModal account={account} onClose={() => setModal("")} />}
    </div>
  );
}
