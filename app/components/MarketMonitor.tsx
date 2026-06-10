"use client";

import { BORDER } from "@/lib/wallet-config";

export function MarketMonitor() {
  return (
    <div
      style={{
        marginTop: "16px",
        padding: "16px",
        border: `1px solid ${BORDER}`,
        borderRadius: "16px",
        background: "#f9fafb",
      }}
    >
      <div>📊 Market Monitor</div>
      <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "8px" }}>
        Monitorando spreads de mercado...
      </div>
    </div>
  );
}
