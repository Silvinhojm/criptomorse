"use client"

import { useState, useEffect, useRef } from "react"
import { frameworkReputation, frameworkAudit, frameworkIntents } from "@/lib/agent-framework/singletons"

const BG = "#0f172a"
const CARD_BG = "rgba(255,255,255,0.03)"
const BORDER = "rgba(255,255,255,0.08)"
const TEXT_PRIMARY = "#e2e8f0"
const TEXT_MUTED = "#64748b"
const ACCENT = "#3b82f6"
const GREEN = "#22c55e"
const RED = "#ef4444"
const YELLOW = "#fbbf24"

export function FrameworkDashboard() {
  const [agents, setAgents] = useState(frameworkReputation.getAllStats())
  const [auditReport, setAuditReport] = useState(frameworkAudit.getReport(0))
  const [recentAudits, setRecentAudits] = useState(frameworkAudit.getRecent(20))
  const [intents, setIntents] = useState(frameworkIntents.list({ limit: 20 }))
  const [intentStats, setIntentStats] = useState(frameworkIntents.getStats())
  const [now, setNow] = useState(Date.now())
  const mounted = useRef(true)

  useEffect(() => {
    const unsub = frameworkIntents.subscribe(() => {
      if (!mounted.current) return
      setIntents(frameworkIntents.list({ limit: 20 }))
      setIntentStats(frameworkIntents.getStats())
    })
    const interval = setInterval(() => {
      if (!mounted.current) return
      setAgents(frameworkReputation.getAllStats())
      setAuditReport(frameworkAudit.getReport(0))
      setRecentAudits(frameworkAudit.getRecent(20))
      setNow(Date.now())
    }, 3000)

    return () => {
      mounted.current = false
      unsub()
      clearInterval(interval)
    }
  }, [])

  return (
    <div style={{ background: BG, color: TEXT_PRIMARY, borderRadius: 12, padding: 16, fontSize: 12 }}>
      {/* Header */}
      <div style={{ fontSize: 16, fontWeight: "bold", marginBottom: 16, color: ACCENT }}>
        🏗️ ARC Agent Framework
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 16 }}>
        <StatBox label="Agentes" value={agents.length.toString()} color={ACCENT} />
        <StatBox label="Propostas" value={intentStats.total.toString()} color={ACCENT} />
        <StatBox label="Executadas" value={intentStats.executed.toString()} color={GREEN} />
        <StatBox label="Pendentes" value={intentStats.pending.toString()} color={YELLOW} />
        <StatBox label="Falhas" value={intentStats.failed.toString()} color={RED} />
        <StatBox label="Ações (24h)" value={auditReport.totalActions.toString()} color={ACCENT} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Agents */}
        <div style={{ background: CARD_BG, borderRadius: 8, padding: 12, border: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 11, fontWeight: "bold", color: ACCENT, marginBottom: 8 }}>
            🤖 Agentes Ativos ({agents.length})
          </div>
          {agents.length === 0 ? (
            <div style={{ color: TEXT_MUTED }}>Nenhum agente registrado</div>
          ) : (
            agents.slice(0, 10).map(a => (
              <div key={a.agentId} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "4px 0", borderBottom: `1px solid ${BORDER}`, fontSize: 10
              }}>
                <span style={{ fontWeight: "bold" }}>{a.agentId}</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ color: a.winRate >= 60 ? GREEN : a.winRate >= 40 ? YELLOW : RED }}>
                    {a.winRate.toFixed(0)}%
                  </span>
                  <span style={{ color: TEXT_MUTED }}>{a.totalActions} ações</span>
                  <span style={{ color: a.score >= 50 ? GREEN : a.score >= 20 ? YELLOW : RED, fontWeight: "bold" }}>
                    score {a.score.toFixed(0)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Audit Summary */}
        <div style={{ background: CARD_BG, borderRadius: 8, padding: 12, border: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 11, fontWeight: "bold", color: ACCENT, marginBottom: 8 }}>
            📋 Audit Trail
          </div>
          <div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 6 }}>
            Total: {auditReport.totalActions} ações · {auditReport.successful} sucesso · {auditReport.failed} falhas
          </div>
          {auditReport.topAgents.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: TEXT_MUTED, marginBottom: 4 }}>Top agentes:</div>
              {auditReport.topAgents.slice(0, 5).map(a => (
                <div key={a.agentId} style={{ display: "flex", justifyContent: "space-between", fontSize: 9, padding: "2px 0" }}>
                  <span>{a.agentId}</span>
                  <span style={{ color: TEXT_MUTED }}>{a.actions} ações · ${a.profit.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 9, color: TEXT_MUTED, marginTop: 6 }}>
            💰 Lucro total: ${auditReport.totalProfit.toFixed(4)} · Gas: ${auditReport.totalGasCost.toFixed(4)}
          </div>
        </div>

        {/* Intent Feed */}
        <div style={{ background: CARD_BG, borderRadius: 8, padding: 12, border: `1px solid ${BORDER}`, gridColumn: "span 2" }}>
          <div style={{ fontSize: 11, fontWeight: "bold", color: ACCENT, marginBottom: 8 }}>
            📨 Intent Feed ({intentStats.total})
          </div>
          {intents.length === 0 ? (
            <div style={{ color: TEXT_MUTED }}>Nenhuma intent publicada</div>
          ) : (
            intents.map(r => (
              <div key={r.intent.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "4px 0", borderBottom: `1px solid ${BORDER}`, fontSize: 10
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <StatusDot status={r.status} />
                  <span style={{ fontWeight: "bold" }}>{r.intent.agentId}</span>
                  <span style={{ color: ACCENT }}>{r.intent.action}</span>
                  <span style={{ color: TEXT_MUTED, fontSize: 9 }}>
                    {tempoRelativo(r.createdAt, now)}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: TEXT_MUTED, fontSize: 9 }}>
                    {r.intent.confidence.toFixed(0)}% · {r.votes.length} votos
                  </span>
                  {r.result && (
                    <span style={{ color: r.result.success ? GREEN : RED }}>
                      {r.result.success ? "✅" : "❌"}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Recent Audit Entries */}
        <div style={{ background: CARD_BG, borderRadius: 8, padding: 12, border: `1px solid ${BORDER}`, gridColumn: "span 2" }}>
          <div style={{ fontSize: 11, fontWeight: "bold", color: ACCENT, marginBottom: 8 }}>
            🕵️ Atividades Recentes
          </div>
          {recentAudits.length === 0 ? (
            <div style={{ color: TEXT_MUTED }}>Nenhuma atividade registrada</div>
          ) : (
            recentAudits.slice(0, 10).map(e => (
              <div key={e.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "3px 0", borderBottom: `1px solid ${BORDER}`, fontSize: 9
              }}>
                <div style={{ display: "flex", gap: 4 }}>
                  <span style={{ color: e.consensus?.approved ? GREEN : RED }}>
                    {e.consensus?.approved ? "✅" : "❌"}
                  </span>
                  <span style={{ fontWeight: "bold" }}>{e.agentId}</span>
                  <span style={{ color: ACCENT }}>{e.action}</span>
                  <span style={{ color: TEXT_MUTED }}>conf {e.consensus?.confidence.toFixed(0)}%</span>
                </div>
                <div style={{ color: TEXT_MUTED }}>
                  {tempoRelativo(e.timestamp, now)}
                  {e.result && (
                    <span style={{ marginLeft: 6, color: (e.result.profit ?? 0) >= 0 ? GREEN : RED }}>
                      ${(e.result.profit ?? 0).toFixed(4)}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: CARD_BG, borderRadius: 8, padding: "8px 12",
      border: `1px solid ${BORDER}`, textAlign: "center"
    }}>
      <div style={{ fontSize: 18, fontWeight: "bold", color }}>{value}</div>
      <div style={{ fontSize: 9, color: TEXT_MUTED }}>{label}</div>
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: YELLOW, voting: ACCENT, approved: GREEN,
    rejected: RED, executing: ACCENT, executed: GREEN, failed: RED,
  }
  return <span style={{ color: colors[status] ?? TEXT_MUTED }}>●</span>
}

function tempoRelativo(ts: number, now: number): string {
  const diff = now - ts
  if (diff < 60000) return "agora"
  if (diff < 3600000) return `${Math.floor(diff / 60000)}min`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`
  return `${Math.floor(diff / 86400000)}d`
}
