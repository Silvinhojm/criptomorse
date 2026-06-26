// app/components/NanopaymentDashboard.tsx
"use client";

import { useState, useEffect } from "react";
import { nanopaymentSystem, AgentWallet, Nanopayment, ServicePricing } from "@/lib/nanopayment-system";
import { toast } from "react-hot-toast";

export function NanopaymentDashboard({ agentScores, network, privateKey }: { agentScores: any[]; network?: any; privateKey?: string }) {
  const [wallets, setWallets] = useState<AgentWallet[]>([]);
  const [payments, setPayments] = useState<Nanopayment[]>([]);
  const [services, setServices] = useState<ServicePricing[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [selectedService, setSelectedService] = useState("");
  const [isPaying, setIsPaying] = useState(false);
  const [stats, setStats] = useState({ totalPayments: 0, totalVolume: 0, avgPayment: 0 });
  const [performanceEarnings, setPerformanceEarnings] = useState<Record<string, number>>({});

  const refreshData = () => {
    setWallets(nanopaymentSystem.getAllWallets());
    setPayments(nanopaymentSystem.getPaymentHistory());
    setServices(nanopaymentSystem.getServiceCatalog());
    setStats(nanopaymentSystem.getStats());
    const earnings: Record<string, number> = {};
    for (const w of nanopaymentSystem.getAllWallets()) {
      earnings[w.agentId] = nanopaymentSystem.getPerformanceEarnings(w.agentId);
    }
    setPerformanceEarnings(earnings);
  };

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 10000);
    return () => clearInterval(interval);
  }, []);

  const handlePayForService = async () => {
    if (!selectedAgent || !selectedService) {
      toast.error("Selecione um agente e um serviço");
      return;
    }
    setIsPaying(true);
    try {
      const payment = await nanopaymentSystem.payForService(selectedAgent, selectedService);
      toast.success(`💸 Pagamento de $${payment.amount} realizado!`);
      refreshData();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsPaying(false);
    }
  };

  return (
    <div style={{ marginTop: '16px', padding: '16px', background: '#1a1a2e', borderRadius: '16px', border: '1px solid #3a6cc8' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <span style={{ fontSize: '24px' }}>💸</span>
        <span style={{ fontWeight: 'bold', color: '#fbbf24' }}>TLAY Nanopayments (M2M)</span>
        <span style={{ fontSize: '10px', background: '#3a6cc8', padding: '2px 8px', borderRadius: '20px', color: '#fff' }}>BETA</span>
      </div>

      {/* Estatísticas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
        <div style={{ background: '#0a0a2e', padding: '8px', borderRadius: '10px', textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#fbbf24' }}>{stats.totalPayments}</div>
          <div style={{ fontSize: '10px', color: '#94a3b8' }}>Pagamentos</div>
        </div>
        <div style={{ background: '#0a0a2e', padding: '8px', borderRadius: '10px', textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#4ade80' }}>${stats.totalVolume.toFixed(4)}</div>
          <div style={{ fontSize: '10px', color: '#94a3b8' }}>Volume Total</div>
        </div>
        <div style={{ background: '#0a0a2e', padding: '8px', borderRadius: '10px', textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#a78bfa' }}>${stats.avgPayment.toFixed(4)}</div>
          <div style={{ fontSize: '10px', color: '#94a3b8' }}>Méd. por Pag.</div>
        </div>
      </div>

      {/* Carteiras dos Agentes */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>💰 Saldo dos Agentes:</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {wallets.map(wallet => {
            const perfEarn = performanceEarnings[wallet.agentId] ?? 0;
            return (
              <div key={wallet.agentId} style={{ background: '#0a0a2e', padding: '8px 12px', borderRadius: '10px', flex: '1 1 auto', minWidth: '120px' }}>
                <div style={{ fontSize: '11px', color: '#a78bfa' }}>{wallet.agentId}</div>
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: wallet.balance > 0 ? '#4ade80' : '#ef4444' }}>
                  ${wallet.balance.toFixed(4)}
                </div>
                {perfEarn > 0 && (
                  <div style={{ fontSize: '9px', color: '#fbbf24' }}>
                    🏆 +${perfEarn.toFixed(4)} em trades
                  </div>
                )}
                <div style={{ fontSize: '9px', color: '#94a3b8' }}>Limite: ${wallet.dailyLimit}/dia</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pagar por Serviço */}
      <div style={{ marginBottom: '16px', padding: '12px', background: '#0a0a2e', borderRadius: '12px' }}>
        <div style={{ fontSize: '13px', marginBottom: '12px', color: '#fbbf24' }}>🛒 Comprar Serviço (Pague por Uso)</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <select 
            value={selectedAgent} 
            onChange={e => setSelectedAgent(e.target.value)}
            style={{ flex: 1, padding: '8px', borderRadius: '8px', background: '#1a1a2e', color: '#fff', border: '1px solid #3a6cc8' }}
          >
            <option value="">Selecione o Agente</option>
            {wallets.map(w => <option key={w.agentId} value={w.agentId}>{w.agentId}</option>)}
          </select>
          <select 
            value={selectedService} 
            onChange={e => setSelectedService(e.target.value)}
            style={{ flex: 2, padding: '8px', borderRadius: '8px', background: '#1a1a2e', color: '#fff', border: '1px solid #3a6cc8' }}
          >
            <option value="">Selecione o Serviço</option>
            {services.map(s => <option key={s.serviceId} value={s.serviceId}>{s.description} - ${s.pricePerCall}</option>)}
          </select>
          <button 
            onClick={handlePayForService}
            disabled={isPaying}
            style={{ padding: '8px 16px', background: '#fbbf24', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {isPaying ? '⏳' : '💸 Pagar'}
          </button>
        </div>
      </div>

      {/* Histórico de Pagamentos */}
      {payments.length > 0 && (
        <div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>📜 Últimos Pagamentos:</div>
          <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
              {payments.slice(-5).reverse().map(p => {
              const isReward = p.id.startsWith('reward_');
              return (
                <div key={p.id} style={{ fontSize: '10px', padding: '6px 0', borderBottom: '1px solid #2a2a4e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {isReward ? '🏆' : '💸'}
                    <span>{isReward ? p.toAgent : `${p.fromAgent}→${p.toAgent}`}</span>
                  </span>
                  <span style={{ color: '#fbbf24' }}>${p.amount.toFixed(4)}</span>
                  <span style={{ color: '#94a3b8', fontSize: '9px' }}>{new Date(p.timestamp).toLocaleTimeString()}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ fontSize: '9px', color: '#6b7280', marginTop: '12px', textAlign: 'center' }}>
        ⚡ Nanopagamentos TLAY — Machine-to-Machine na Arc Network
      </div>
      <div style={{ fontSize: '9px', color: '#fbbf24', marginTop: '4px', textAlign: 'center' }}>
        🏆 Agentes recebem bônus por trades lucrativos — simulado na Arc
      </div>
    </div>
  );
}