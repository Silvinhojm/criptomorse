"use client";

import { useState, useEffect, useCallback } from "react";

// RI-BANK-7 Stage 1 — this component used to be dead code (never rendered
// anywhere in the app, per RI-UX-1 Stage 1) and, even if rendered, was
// broken: it POSTed to /api/panic with no body at all, so the request
// always failed 401 against ADMIN_PANIC_KEY (no fallback, per RI-BANK-4),
// yet the code reloaded the page unconditionally anyway — giving the
// false impression that panic had been activated when it almost
// certainly hadn't. Fixed here: real request body (action/key), the
// response status is checked before deciding anything, and the UI always
// shows the real outcome instead of just reloading.
//
// RI-BANK-6 confirmed the circuit breaker this calls into is global and
// already gates virtually every real execution path (realSwap.executeSwap
// checks isPanicActive as the second thing it does) — so this button
// genuinely stops trading once the call succeeds. What it does NOT have
// yet is a non-admin path: per RI-BANK-7's mandate, this intentionally
// still requires ADMIN_PANIC_KEY (there is no separate client/account
// concept today — RI-BANK-6 D1), so only whoever holds that key can use
// it. A password-less client-facing version is explicitly out of scope
// here.

type PanicState = {
  isPanicActive: boolean;
  panicReason: string | null;
  panicTimestamp: string | null;
} | null;

export function PanicButton() {
  const [state, setState] = useState<PanicState>(null);
  const [asking, setAsking] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/panic");
      if (!res.ok) return;
      const data = await res.json();
      setState(data);
    } catch {
      // best-effort status display only — never block the button itself
      // on this failing, the button must still be usable to try to panic
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submit = async (action: "panic" | "resume") => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/panic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          key,
          reason: action === "panic" ? "Ativado manualmente via painel" : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}) as any);
      if (!res.ok) {
        setFeedback({
          ok: false,
          message: data?.error ? `❌ ${data.error}` : `❌ Falha (HTTP ${res.status}) — nada foi alterado`,
        });
        return;
      }
      setState(data.state ?? null);
      setFeedback({
        ok: true,
        message: action === "panic"
          ? "✅ Pânico ativado — todas as operações reais foram bloqueadas."
          : "✅ Operações retomadas.",
      });
      setAsking(false);
      setKey("");
    } catch (e) {
      setFeedback({ ok: false, message: `❌ Erro de rede: ${e instanceof Error ? e.message : "desconhecido"} — nada foi confirmado` });
    } finally {
      setBusy(false);
    }
  };

  const isPanicActive = state?.isPanicActive ?? false;

  return (
    <div style={{
      position: "fixed", top: 12, right: 12, zIndex: 9999,
      display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6,
      fontFamily: "system-ui, sans-serif",
    }}>
      {!asking ? (
        <button
          onClick={() => { setAsking(true); setFeedback(null); }}
          style={{
            background: isPanicActive ? "#22c55e" : "#ef4444", color: "#fff", border: "none",
            borderRadius: 10, padding: "8px 16px", fontWeight: 700,
            cursor: "pointer", fontSize: 12,
          }}
        >
          {isPanicActive ? "✅ Retomar operações" : "🛑 PANIC STOP"}
        </button>
      ) : (
        <div style={{
          background: "#111827", border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 10, padding: 10, width: 230,
        }}>
          <div style={{ fontSize: 11, color: "#e5e7eb", marginBottom: 6, fontWeight: 600 }}>
            {isPanicActive ? "Confirmar retomada das operações" : "Confirmar ativação do pânico"}
          </div>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Chave de admin"
            autoFocus
            disabled={busy}
            style={{
              width: "100%", padding: "6px 8px", fontSize: 12, borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.3)", background: "#0f0f23",
              color: "#fff", marginBottom: 6, boxSizing: "border-box",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && key && !busy) submit(isPanicActive ? "resume" : "panic");
            }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              disabled={!key || busy}
              onClick={() => submit(isPanicActive ? "resume" : "panic")}
              style={{
                flex: 1, padding: "6px 0", fontSize: 11, fontWeight: 700,
                background: isPanicActive ? "#22c55e" : "#ef4444", color: "#fff",
                border: "none", borderRadius: 6,
                cursor: !key || busy ? "not-allowed" : "pointer",
                opacity: !key || busy ? 0.6 : 1,
              }}
            >
              {busy ? "..." : "Confirmar"}
            </button>
            <button
              disabled={busy}
              onClick={() => { setAsking(false); setKey(""); setFeedback(null); }}
              style={{
                padding: "6px 10px", fontSize: 11, background: "rgba(255,255,255,0.1)",
                color: "#e5e7eb", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 6, cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {feedback && (
        <div style={{
          fontSize: 11, padding: "6px 10px", borderRadius: 8, maxWidth: 240,
          background: feedback.ok ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
          color: feedback.ok ? "#4ade80" : "#f87171",
          border: `1px solid ${feedback.ok ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
        }}>
          {feedback.message}
        </div>
      )}

      {isPanicActive && !asking && (
        <div style={{
          fontSize: 9, color: "#fca5a5", background: "rgba(0,0,0,0.6)",
          padding: "3px 8px", borderRadius: 6, maxWidth: 240, textAlign: "right",
        }}>
          🚨 Pânico ativo{state?.panicReason ? `: ${state.panicReason}` : ""}
        </div>
      )}
    </div>
  );
}
