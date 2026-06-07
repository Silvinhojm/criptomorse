"use client";

interface AgentIdentityCardProps {
  name?: string;
  role?: string;
  address?: string;
  status?: "active" | "idle" | "error";
  wins?: number;
  losses?: number;
  icon?: string;
  color?: string;
}

export default function AgentIdentityCard({
  name = "Agent",
  role = "Trading Agent",
  address = "",
  status = "idle",
  wins = 0,
  losses = 0,
  icon = "🤖",
  color = "#8b5cf6",
}: AgentIdentityCardProps) {
  const statusColor = status === "active" ? "#22c55e" : status === "error" ? "#ef4444" : "#94a3b8";
  const statusLabel = status === "active" ? "ATIVO" : status === "error" ? "ERRO" : "IDLE";
  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : "0.0";

  return (
    <div style={{
      background: "linear-gradient(135deg, #0a0a2e 0%, #1a1a4e 100%)",
      borderRadius: "16px",
      padding: "16px",
      marginBottom: "12px",
      border: `1px solid ${color}33`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{
          width: 48, height: 48, borderRadius: "50%",
          background: `${color}22`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "24px", border: `2px solid ${color}55`,
        }}>
          {icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontWeight: "bold", color: "#e2e8f0", fontSize: "14px" }}>{name}</span>
            <span style={{ fontSize: "9px", background: statusColor, color: "#fff", padding: "1px 6px", borderRadius: "10px" }}>{statusLabel}</span>
          </div>
          <div style={{ fontSize: "11px", color: color, marginTop: "2px" }}>{role}</div>
          {address && (
            <div style={{ fontSize: "9px", color: "#64748b", marginTop: "2px", fontFamily: "monospace" }}>
              {address.slice(0, 10)}...{address.slice(-6)}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "18px", fontWeight: "bold", color: "#4ade80" }}>{winRate}%</div>
          <div style={{ fontSize: "9px", color: "#64748b" }}>Win Rate</div>
          <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "2px" }}>
            {wins}W / {losses}L
          </div>
        </div>
      </div>
    </div>
  );
}
