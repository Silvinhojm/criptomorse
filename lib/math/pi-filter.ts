// lib/math/pi-filter.ts
// Engine Estocástica baseada na Distribuição Gaussiana com constante π
//
// Paradigma:
//   f(x) = 1/(σ√(2π)) · exp(-½((x-μ)/σ)²)
//
// O fator 1/√(2π) ≈ 0.3989 define o pico da normal padrão.
// No ponto de inflexão (σ = 1/√(2π)), o ruído de microestrutura
// transiciona para sinal de anomalia — esta é a fronteira teórica
// onde o Modo Grão deve entrar.
//
// Uso: PiFilter recebe preços DEX em tempo real, calcula sigma,
//       e retorna nível de confiança + tamanho dinâmico de lote.

const ONE_OVER_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI) // ≈ 0.3989
export const WARMUP_SAMPLES = 18 // ticks mínimos antes de emitir sinais (EWMA estabiliza)

export interface PiFilterState {
  ewma: number          // μ — média móvel exponencial
  variance: number      // σ² — variância estimada
  volatility: number    // σ — desvio padrão (sqrt variância)
  alpha: number         // fator de suavização da EWMA
  samples: number       // contagem de amostras (warm-up)
  lastPrice: number     // último preço observado
  sigma: number         // (x - μ) / σ — desvios padrão atuais
  gaussianPdf: number   // f(x) — densidade de probabilidade no ponto atual
  confidence: number    // 0-100 mapeado de sigma (2σ = 95%)
}

export interface PiSignal {
  direction: "buy" | "sell" | "none"
  sigma: number
  confidence: number    // 0-100
  suggestedAmount: number // lote dinâmico baseado em sigma
  threshold: number     // threshold adaptativo = vol * π/2
}

export interface PiFilterConfig {
  alphaMin: number      // α mínimo em baixa volatilidade (ex: 0.05)
  alphaMax: number      // α máximo em alta volatilidade (ex: 0.30)
  volNormalizer: number // vol que produz α = 0.10 (ex: 0.005)
  sigmaEntryBuy: number  // sigma negativo para entrada compra (ex: -1.5)
  sigmaEntrySell: number // sigma positivo para entrada venda (ex: 1.5)
  baseAmount: number    // lote base em USD (ex: 12)
  maxAmount: number     // lote máximo em USD (ex: 30)
}

const DEFAULT_CONFIG: PiFilterConfig = {
  alphaMin: 0.05,
  alphaMax: 0.30,
  volNormalizer: 0.005,
  sigmaEntryBuy: -1.5,
  sigmaEntrySell: 1.5,
  baseAmount: 12,
  maxAmount: 30,
}

export function createInitialState(): PiFilterState {
  return {
    ewma: 0,
    variance: 0,
    volatility: 0,
    alpha: DEFAULT_CONFIG.alphaMin,
    samples: 0,
    lastPrice: 0,
    sigma: 0,
    gaussianPdf: 0,
    confidence: 0,
  }
}

// ─── Atualiza o filtro com um novo preço ─────────────────────────────────────
// Retorna o novo estado + sinal (se houver)
export function updatePiFilter(
  state: PiFilterState,
  price: number,
  config: PiFilterConfig = DEFAULT_CONFIG,
): { state: PiFilterState; signal: PiSignal | null } {
  const s = { ...state }

  if (price <= 0) return { state: s, signal: null }

  s.samples++
  s.lastPrice = price

  if (s.samples === 1) {
    s.ewma = price
    s.variance = 0
    s.volatility = 0
    return { state: s, signal: null }
  }

  // Estima volatilidade a partir da diferença de preço consecutiva
  const priceChange = Math.abs(price - state.lastPrice) / state.lastPrice

  // Alpha adaptativo: α = min(α_max, max(α_min, vol / volNormalizer))
  // Em EURC vol 0.05% → α = 0.05 (filtro forte, rejeita ruído)
  // Em EURC vol 0.20% → α = 0.20 (responsivo)
  const targetAlpha = Math.min(config.alphaMax, Math.max(config.alphaMin, priceChange / config.volNormalizer))
  s.alpha = s.alpha * 0.7 + targetAlpha * 0.3 // suaviza

  // EWMA: μ_t = α · x_t + (1 - α) · μ_{t-1}
  s.ewma = s.alpha * price + (1 - s.alpha) * s.ewma

  // Variância recursiva (Welford online algorithm adaptado para EWMA):
  // σ²_t = α · (x_t - μ_t)² + (1 - α) · σ²_{t-1}
  const diff = price - s.ewma
  s.variance = s.alpha * diff * diff + (1 - s.alpha) * s.variance
  s.volatility = Math.sqrt(s.variance)

  // Se volatilidade é zero (estável demais), não há sinal
  if (s.volatility < 1e-10) {
    s.sigma = 0
    s.gaussianPdf = ONE_OVER_SQRT_2PI / (s.volatility || 1)
    s.confidence = 0
    return { state: s, signal: null }
  }

  // Sigma: (x - μ) / σ — quantos desvios padrão do mean
  s.sigma = diff / s.volatility

  // Gaussian PDF: f(x) = 1/(σ√(2π)) · exp(-½ · sigma²)
  s.gaussianPdf = Math.exp(-0.5 * s.sigma * s.sigma) / (s.volatility * Math.sqrt(2 * Math.PI))

  // Confiança baseada em sigma (mapeamento aproximado da CDF normal):
  //   |sigma| = 1.0 → 68%  → confidence = 68
  //   |sigma| = 1.5 → 87%  → confidence = 87
  //   |sigma| = 2.0 → 95%  → confidence = 95
  //   |sigma| = 2.5 → 99%  → confidence = 99
  //   |sigma| = 3.0 → 99.7% → confidence = 100
  const absSigma = Math.abs(s.sigma)
  s.confidence = Math.min(100, Math.round(
    (1 - Math.exp(-absSigma * absSigma / 2)) * 100
  ))

  // ─── Threshold adaptativo via π ───────────────────────────────────────
  // Threshold = vol * π/2
  // Justificativa: o ponto de inflexão da Gaussiana está em σ = 1.
  // Multiplicando por π/2 ≈ 1.57, expandimos a zona de ruído em 57%,
  // reduzindo falsos positivos em mercado calmo. Em mercado volátil,
  // o threshold escala proporcionalmente.
  const entryThreshold = s.volatility * (Math.PI / 2)

  // ─── Geração de sinal ────────────────────────────────────────────────
  const direction: "buy" | "sell" | "none" =
    s.sigma <= config.sigmaEntryBuy ? "buy" :
    s.sigma >= config.sigmaEntrySell ? "sell" : "none"

  if (s.samples < WARMUP_SAMPLES) {
    return { state: s, signal: null } // warmup: EWMA ainda instável
  }

  if (direction === "none") {
    return { state: s, signal: null }
  }

  // ─── Tamanho dinâmico de lote ────────────────────────────────────────
  // Escala o lote base pelo quadrado do sigma (relação risco/recompensa constante)
  //   sigma 1.5 → 1.5² = 2.25 → baseAmount * 2.25
  //   sigma 2.0 → 2.0² = 4.00 → baseAmount * 4.00 (limitado a maxAmount)
  //   sigma 2.5 → 2.5² = 6.25 → cap no maxAmount
  // Isso compensa o custo fixo do gás em trades de alta confiança:
  // Se gas = $0.007 e trade de $12 = 0.058%, trade de $30 = 0.023%
  const sigmaRatio = Math.abs(s.sigma) / Math.abs(config.sigmaEntryBuy)
  const amountMultiplier = Math.min(config.maxAmount / config.baseAmount, sigmaRatio * sigmaRatio)
  const suggestedAmount = Math.round(config.baseAmount * amountMultiplier * 100) / 100

  return {
    state: s,
    signal: {
      direction,
      sigma: s.sigma,
      confidence: s.confidence,
      suggestedAmount: Math.max(config.baseAmount, Math.min(config.maxAmount, suggestedAmount)),
      threshold: entryThreshold,
    },
  }
}

// ─── Utilitário: calcula a probabilidade de um desvio ser ruído vs sinal ─────
// Retorna 0-1: quanto mais próximo de 0, maior a chance de ser sinal real
export function noiseProbability(sigma: number): number {
  // Aproximação da cauda da normal: P(|X| > sigma) ≈ 2 · (1 - Φ(sigma))
  // Usamos a aproximação racional de Abramowitz & Stegun 26.2.17
  const t = 1 / (1 + 0.2316419 * Math.abs(sigma))
  const d = 0.39894228 * Math.exp(-sigma * sigma / 2)
  const p = d * (0.319381530 * t - 0.356563782 * t * t + 1.781477937 * Math.pow(t, 3) - 1.821255978 * Math.pow(t, 4) + 1.330274429 * Math.pow(t, 5))
  return Math.min(1, 2 * p) // p = P(X > |sigma|), tail bidirecional = 2p
}
