export const DESIGN_SYSTEM = {
  colors: {
    bg: { DEFAULT: "#0f172a", card: "#1e293b", hover: "#262A33", border: "rgba(148,163,184,0.15)" },
    accent: { green: "#22c55e", blue: "#3b82f6", red: "#ef4444", gold: "#FFD700" },
    text: { primary: "#F1F5F9", secondary: "#94a3b8", muted: "#64748B" },
    status: { high: "#22c55e", medium: "#FBBF24", low: "#ef4444", info: "#3b82f6" },
    gradient: { from: "#0f172a", to: "#1e3a5f" },
  },
  fonts: {
    sans: "'Inter', system-ui, -apple-system, sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', monospace",
  },
  radii: { sm: 6, md: 8, lg: 12, xl: 16 },
  shadows: { card: "0 4px 24px rgba(0,0,0,0.3)", glow: "0 0 20px rgba(59,130,246,0.2)" },
  animation: { fast: "150ms", normal: "300ms", slow: "500ms" },
} as const
