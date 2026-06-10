"use client";

import { useState, useCallback, useEffect } from "react";
import { ethers } from "ethers";
import { toast } from "react-hot-toast";
import {
  BORDER,
  ORANGE,
  GREEN,
  ARC_TESTNET,
  shortAddress,
  type WalletNetwork,
} from "@/lib/wallet-config";
import {
  fetchJobsForAccount,
  createAndFundJob,
  fundJob,
  getJobExplorerUrl,
  type OnChainJob,
} from "@/lib/agentic-commerce";

interface JobsPanelProps {
  account: string;
  network: WalletNetwork;
}

export function JobsPanel({ account, network }: JobsPanelProps) {
  const [jobs, setJobs] = useState<OnChainJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newJobDesc, setNewJobDesc] = useState("");
  const [newJobBudget, setNewJobBudget] = useState("");
  const [newJobProvider, setNewJobProvider] = useState("");

  const isArcTestnet = network.chainId === ARC_TESTNET.chainId;

  const loadJobs = useCallback(async () => {
    if (!account || !isArcTestnet) return;
    setLoading(true);
    try {
      const onChainJobs = await fetchJobsForAccount(account, network);
      setJobs(onChainJobs);
    } catch (error) {
      console.error("Erro ao carregar jobs:", error);
      toast.error("Erro ao carregar jobs on-chain");
    }
    setLoading(false);
  }, [account, network, isArcTestnet]);

  const getSigner = async () => {
    if (!window.ethereum) throw new Error("MetaMask não encontrado");
    const provider = new ethers.BrowserProvider(window.ethereum);
    return provider.getSigner();
  };

  const createJob = async () => {
    if (!newJobDesc || !newJobBudget || !newJobProvider) {
      toast.error("Preencha todos os campos");
      return;
    }
    if (!ethers.isAddress(newJobProvider)) {
      toast.error("Endereço do provider inválido");
      return;
    }
    if (!isArcTestnet) {
      toast.error("Jobs ERC-8183 só estão disponíveis na Arc Testnet");
      return;
    }

    setSubmitting(true);
    try {
      toast.loading("Assine as transações no MetaMask...", { id: "createJob" });
      const signer = await getSigner();
      const { jobId, txHashes } = await createAndFundJob(signer, network, {
        provider: newJobProvider,
        description: newJobDesc,
        budgetUsdc: newJobBudget,
      });

      toast.success(`Job #${jobId} criado e financiado on-chain!`, { id: "createJob" });
      if (txHashes[0]) {
        toast(
          (t) => (
            <span>
              <a
                href={getJobExplorerUrl(network, txHashes[0])}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#3a6cc8", textDecoration: "underline" }}
                onClick={() => toast.dismiss(t.id)}
              >
                Ver no ArcScan
              </a>
            </span>
          ),
          { duration: 8000 }
        );
      }

      setShowCreateModal(false);
      setNewJobDesc("");
      setNewJobBudget("");
      setNewJobProvider("");
      await loadJobs();
    } catch (error: unknown) {
      const err = error as { reason?: string; message?: string; code?: string };
      const msg =
        err?.reason ||
        err?.message?.slice(0, 100) ||
        (err?.code === "ACTION_REJECTED" ? "Transação rejeitada" : "Erro ao criar job");
      toast.error(msg, { id: "createJob" });
    }
    setSubmitting(false);
  };

  const handleFundJob = async (jobId: string) => {
    setSubmitting(true);
    try {
      toast.loading("Financiando escrow...", { id: "fundJob" });
      const signer = await getSigner();
      const txHash = await fundJob(signer, network, jobId);
      toast.success(`Job #${jobId} financiado!`, { id: "fundJob" });
      toast(
        (t) => (
          <span>
            <a
              href={getJobExplorerUrl(network, txHash)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#3a6cc8" }}
              onClick={() => toast.dismiss(t.id)}
            >
              Ver TX no ArcScan
            </a>
          </span>
        ),
        { duration: 6000 }
      );
      await loadJobs();
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(err?.message?.slice(0, 80) || "Erro ao financiar", { id: "fundJob" });
    }
    setSubmitting(false);
  };

  useEffect(() => {
    if (account) loadJobs();
  }, [account, loadJobs]);

  if (!isArcTestnet) {
    return (
      <div style={{ textAlign: "center", color: "#9ca3af", padding: 32 }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>💼</div>
        <p style={{ margin: 0, fontSize: 13 }}>
          Jobs ERC-8183 on-chain estão disponíveis na{" "}
          <strong style={{ color: ORANGE }}>Arc Testnet</strong>.
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 11 }}>
          Troque a rede para Arc para criar jobs reais.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, color: "#333" }}>💼 Jobs ERC-8183</h3>
        <button
          onClick={() => setShowCreateModal(true)}
          disabled={submitting}
          style={{
            background: ORANGE,
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "6px 12px",
            cursor: submitting ? "not-allowed" : "pointer",
            fontSize: 12,
            opacity: submitting ? 0.7 : 1,
          }}
        >
          + Criar Job
        </button>
      </div>

      <p style={{ fontSize: 10, color: "#9ca3af", margin: "0 0 12px" }}>
        Contrato: {shortAddress(network.erc8183)} · On-chain via MetaMask
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={loadJobs}
          disabled={loading}
          style={{
            fontSize: 11,
            padding: "4px 10px",
            borderRadius: 6,
            border: `1px solid ${BORDER}`,
            background: "#fff",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "..." : "🔄 Atualizar"}
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "#9ca3af", padding: 20 }}>
          Carregando jobs on-chain...
        </div>
      ) : jobs.length === 0 ? (
        <div style={{ textAlign: "center", color: "#9ca3af", padding: 20 }}>
          Nenhum job on-chain para esta carteira
        </div>
      ) : (
        jobs.map((job) => (
          <div
            key={job.id}
            style={{
              background: "#f9fafb",
              borderRadius: 10,
              padding: 12,
              marginBottom: 8,
              border: `1px solid ${BORDER}`,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              #{job.id} — {job.description || "(sem descrição)"}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "#6b7280",
                display: "flex",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 4,
              }}
            >
              <span>💰 {parseFloat(job.budget).toFixed(2)} USDC</span>
              <span
                style={{
                  fontWeight: 600,
                  color:
                    job.status === "Funded" || job.status === "Completed"
                      ? GREEN
                      : job.status === "Rejected"
                        ? "#ef4444"
                        : "#6b7280",
                }}
              >
                {job.status}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
              👤 Provider: {shortAddress(job.provider)}
              {job.client.toLowerCase() === account.toLowerCase() && (
                <span style={{ marginLeft: 8, color: ORANGE }}>· Você é o client</span>
              )}
            </div>
            {job.status === "Open" && job.budgetRaw > 0n && (
              <button
                onClick={() => handleFundJob(job.id)}
                disabled={submitting || job.client.toLowerCase() !== account.toLowerCase()}
                style={{
                  marginTop: 8,
                  width: "100%",
                  padding: "6px",
                  fontSize: 11,
                  background: GREEN,
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: submitting ? "wait" : "pointer",
                }}
              >
                💰 Financiar Escrow
              </button>
            )}
          </div>
        ))
      )}

      {showCreateModal && (
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
              background: "#fff",
              borderRadius: 20,
              padding: 24,
              width: 400,
              maxWidth: "90%",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <h3 style={{ margin: 0 }}>Criar Job ERC-8183</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}
              >
                ×
              </button>
            </div>
            <p style={{ fontSize: 11, color: "#6b7280", margin: "0 0 16px" }}>
              Cria o job, define budget e financia escrow com USDC. Você assinará até 4
              transações no MetaMask.
            </p>
            <input
              placeholder="Descrição do job"
              value={newJobDesc}
              onChange={(e) => setNewJobDesc(e.target.value)}
              style={{
                width: "100%",
                padding: 10,
                marginBottom: 12,
                borderRadius: 8,
                border: `1px solid ${BORDER}`,
                boxSizing: "border-box",
              }}
            />
            <input
              placeholder="Provider (0x...)"
              value={newJobProvider}
              onChange={(e) => setNewJobProvider(e.target.value)}
              style={{
                width: "100%",
                padding: 10,
                marginBottom: 12,
                borderRadius: 8,
                border: `1px solid ${BORDER}`,
                boxSizing: "border-box",
              }}
            />
            <input
              placeholder="Budget (USDC)"
              type="number"
              min="0.01"
              step="0.01"
              value={newJobBudget}
              onChange={(e) => setNewJobBudget(e.target.value)}
              style={{
                width: "100%",
                padding: 10,
                marginBottom: 16,
                borderRadius: 8,
                border: `1px solid ${BORDER}`,
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={createJob}
              disabled={submitting}
              style={{
                width: "100%",
                background: ORANGE,
                color: "#fff",
                padding: 12,
                borderRadius: 12,
                border: "none",
                cursor: submitting ? "wait" : "pointer",
                fontWeight: 600,
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? "Aguardando MetaMask..." : "Criar e Financiar On-Chain"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

declare global {
  interface Window {
    ethereum?: ethers.Eip1193Provider;
  }
}
