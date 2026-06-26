# CriptoMorse — Manual de Arquitetura e Parâmetros

> **LEIA ESTE ARQUIVO PRIMEIRO** antes de qualquer modificação no código.
> Este documento contém o mapa completo do sistema. Consulte-o sempre que for
> alterar comportamento, adicionar features ou diagnosticar bugs.

---

## 1. VISÃO GERAL

CriptoMorse é uma plataforma de trading automatizado multi-chain com:
- **Carteira** multi-chain (Arc Testnet, Polygon, Base, Ethereum)
- **Sistema de agentes** que votam em oportunidades de swap
- **Pregão** — um "pregão de bolsa" que coleta votos e gera ordens
- **Execução real** via LI.FI (mainnet) ou simulação (testnet)
- **Staircase** — fechamento automático com garantia de lucro
- **Volatility Tracker** — aprendizado contínuo do comportamento de cada token

### Origem do nome

O nome "CriptoMorse" vem do agente **Morse**, que interpreta velas e indicadores
(RSI, Bollinger, momentum, amplitude, volatilidade) como se fossem código Morse:
cada candle é um sinal, cada padrão uma mensagem. Quando múltiplas métricas
apontam na mesma direção (ex.: RSI sobrevendido + Bollinger squeeze +
volatilidade baixa + momentum revertendo), o Morse traduz isso como uma
**mensagem forte do mercado** e vota com alta confiança. Agentes que acertam
ganham pontos, lucros e podem entrar no Top 3 para ter poder decisório.

### Stack
- Next.js 15.5 + React 19.2 + TypeScript strict
- ethers v6 + viem + wagmi para blockchain
- LI.FI SDK para swaps cross-chain
- Tailwind CSS 4.3

---

## 2. ARQUITETURA — MAPA DE MÓDULOS

```
app/page.tsx                  ← SPA principal (~1000+ linhas, "use client")
  ├── app/components/*.tsx    ← 21 componentes React de UI
  ├── app/api/*               ← 17 rotas de API (Next.js API routes)
  │
  └── lib/                    ← Núcleo do sistema (72 módulos)
       ├── SISTEMA PRINCIPAL
       │   ├── real-swap-executor.ts     ← Executor de swaps (LI.FI + direto)
       │   ├── automated-trader.ts       ← Trading automático clássico
       │   ├── real-automated-trader.ts  ← Trading automático real
       │   ├── arc-micro-trader.ts       ← Micro-trades na Arc
       │   ├── lifi-executor.ts          ← Integração LI.FI
       │   ├── job-robot.ts              ← Robô autônomo de swaps na Arc testnet
       │   └── contratante.ts            ← Ciclo de swaps (JobRobot orchestrator)
       │
       ├── SISTEMA DE AGENTES
        │   ├── agentes-do-pregão.ts      ← 13 agentes de trading (VOTAM AQUI)
       │   ├── multi-agent-system.ts     ← 5 agentes clássicos
       │   ├── voting-system.ts          ← Sistema de votação
       │   ├── quantum-wave.ts           ← "Onda quântica" (preço real agora)
       │   └── agent-voting.ts           ← Votação de agentes
       │
        ├── PREGÃO (BOLSA)
        │   ├── pregão.ts                 ← Central de ordens (recebe OKs, gera ordens)
       │   ├── pregueiro.ts              ← 4 "pregueiros" que analisam mercado
       │   ├── corretor.ts               ← Executa ordens na blockchain
       │   ├── caixa.ts                  ← Gestão de saldo
       │   └── pregao-arc.ts             ← Multi-armed bandit p/ Arc (autônomo)
       │
       ├── INTELIGÊNCIA (aprendizado)
       │   ├── pair-price-feed.ts        ← Preço real por par (compartilhado)
       │   ├── volatility-tracker.ts     ← Aprende volatilidade de cada token
       │   ├── position-manager.ts       ← Gerencia posições + staircase
       │   ├── narrator.ts               ← Sistema de eventos e notificações
       │   ├── pair-sector.ts            ← Setor de moedas avaliadas (performance por par)
       │   ├── professor.ts              ← Avalia palpites, gerencia promoções
       │   ├── escola-robos.ts           ← Escola de robôs (turnos, verificação, jobs)
       │   └── parametros-robos.ts       ← Parâmetros ajustáveis por robô
       │
        ├── SUPORTE
        │   ├── persistence.ts            ← localStorage
       │   ├── circuit-breaker.ts        ← Parada de emergência
       │   ├── fee-monetization.ts       ← Taxas
       │   ├── gas-price-oracle.ts       ← Preço do gás
       │   ├── provao-ranking.ts         ← Sistema de competição (provão, bônus, poder de voto)
       │   ├── contracts.ts              ← Bytecode + ABI JobProof (deploy on-chain)
       │   └── networks.ts / real-swap-executor.ts ← Config de redes
       │
       └── AGENTES DE MERCADO (dados)
            ├── coingecko-agent.ts (deprecated → SoSoValue via sosovalue-price-agent.ts)
           ├── coinmarketcap-agent.ts
           ├── news-agent.ts
           ├── market-agent.ts
           ├── volume-agent.ts
           └── sosovalue-agent.ts
```

---

## 3. FLUXO DE UM TRADE (Caminho Crítico)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. CICLO DOS PREGUEIROS (pregueiro.ts)                         │
│    ├── Tendência, Volume, Sentimento, Tático analisam pares    │
│    ├── Cada um envia "OK" para o Pregão se gostou do par       │
│    └── VolatilityTracker coleta preços de todos os tokens      │
└──────────────────────────┬──────────────────────────────────────┘
                           │ OKs
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. CICLO DOS AGENTES (agentes-do-pregão.ts)                    │
│    ├── Quantum, Technical, TrendFollower, MeanReversion, etc.  │
│    ├── Cada um avalia pares com base em dados reais            │
│    ├── VolTracker ajusta confiança (volatilidade)              │
│    └── Enviam OKs para o Pregão                                │
└──────────────────────────┬──────────────────────────────────────┘
                           │ OKs
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2.5 APRENDIZADO (agentes-do-pregão.ts)                         │
│    ├── 📚 Sala de aula: cada voto é registrado com o preço     │
│    │    do token volátil no momento do voto                    │
│    ├── A cada ciclo, votos com 5+ min são avaliados:          │
│    │   • Recomendou comprar → lucro se preço subiu            │
│    │   • Recomendou vender → lucro se preço caiu              │
│    │   → accountant.addReport() simulado ($5 fictício)        │
│    ├── Testnet: avaliação pulada (agentes praticam sem          │
│    │   impacto no ranking competitivo)                          │
│    ├── Confiança ajustada por volatilidade (VolTracker)        │
│    ├── Confiança ponderada pelos pontos competitivos (points/500)│
│    ├── Confiança ajustada pelo streak do agente                │
│    │   (streak < 0: conf *= 1 + streak×0.08; streak ≤ -5: min 15%)│
│    │   (streak > 0: conf *= 1 + streak×0.04; max 1.3x)        │
│    ├── 🏆 Top 3 agents decidem o trade                         │
│    │   (ranking do accountant define os 3 melhores;            │
│    │    se 2 dos 3 concordam no mesmo par → ordem gerada)      │
│    ├── Fallback: qualquer 2+ agentes no mesmo par se Top 3 sem │
│    │   consenso                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │ OKs
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. PREGÃO (pregão.ts)                                          │
│    ├── Agentes: Top 3 agents decidem (2+ no mesmo par → ORDEM)│
│    ├── Pregueiros: 3+ OKs para o mesmo par → gera ORDEM       │
│    ├── ⚠️ Posições dinâmicas: max = floor(saldo * 0.9 / $5)        │
│    ├── Pregão calcula valor dinâmico: min($6, saldo/vagas)        │
│    │   (check em pregueiro.ts + agentes-do-pregão.ts)           │
│    ├── Validação dinâmica: retorno esperado = confiança × vol    │
│    │   └── Só compra se valorFinal >= (0.05 + gas) / (retorno - spread)
│    ├── Vendas (volátil→stable) nunca são bloqueadas             │
│    ├── Cria OrdemExecucao com participantes e confiança média  │
│    └── Dispara callback → corretor                             │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Ordem
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. CORRETOR (corretor.ts)                                      │
│    ├── Verifica circuit breaker                                │
│    ├── Executa swap via realSwap.executeSwap()                 │
│    ├── Se comprou token volátil → abre posição                 │
│    │   (positionManager.openPosition())                        │
│    ├── Se vendeu token volátil → fecha posição                │
│    │   (positionManager.closePosition())                       │
│    ├── APRENDIZADO: pontua cada agente que votou na ordem      │
│    │   (accountant.addReport → atualiza winRate, lucro, score) │
│    └── Marca ordem como concluída/falha                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Posição aberta
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. STAIRCASE (position-manager.ts + pregueiro.ts)              │
│    ├── A cada ciclo, verifica posições abertas                 │
│    ├── Busca preço atual do token                              │
│    ├── Sobe degraus se lucro aumentou                          │
│    ├── Se caiu 2 degraus do pico → verifica lucro mínimo      │
│    │   └── Só fecha se lucro USD > gas + spread + margem      │
│    │   └── Se lucro insuficiente → segura (evita prejuízo)    │
│    └── Injeta 3 OKs no Pregão para vender → ciclo recomeça     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. PARÂMETROS CONFIGURÁVEIS

### 4.1 Staircase (position-manager.ts)

```typescript
// Degraus de lucro expandidos — segura mais tempo por degrau
PROFIT_LEVELS = [0, 4, 7, 10, 14, 18, 24, 32, 42, 55, 70, 90, 115]

// Trail rules mais rigorosos (menor trailDrop, mais lucro garantido)
TRAIL_RULES = [
  { minProfit: 0,    maxProfit: 4,    trailDrop: 70  }, // garante 30%
  { minProfit: 4,    maxProfit: 7,    trailDrop: 55  },
  { minProfit: 7,    maxProfit: 12,   trailDrop: 45  }, // garante 55%
  { minProfit: 12,   maxProfit: 18,   trailDrop: 40  },
  { minProfit: 18,   maxProfit: 26,   trailDrop: 35  },
  { minProfit: 26,   maxProfit: 38,   trailDrop: 30  },
  { minProfit: 38,   maxProfit: 52,   trailDrop: 25  }, // garante 75%
  { minProfit: 52,   maxProfit: 72,   trailDrop: 22  },
  { minProfit: 72,   maxProfit: 100,  trailDrop: 18  }, // garante 82%
  { minProfit: 100,  maxProfit: Infinity, trailDrop: 12 }, // garante 88%
]

// Custo estimado de gas por rede (USD) — usado no staircase e no pregão
GAS_ESTIMATE_USD = { polygon: 0.10, base: 0.08, arbitrum: 0.15, ethereum: 8.00 }
SPREAD_ESTIMATE_PCT = 0.005  // 0.5%
MIN_PROFIT_MARGIN = 0.005    // 0.5%

// Staircase só fecha se lucro > gas + spread + margem (evita fechar no prejuízo)
// Se o lucro em USD atual for menor que a soma, segura a posição

MAX_POSITION_AGE_MS = 12 * 60 * 60 * 1000
// 12h — força fechamento SÓ se a posição já viu lucro (peakProfitPercent > 0)
// Se nunca lucrou, segura até o stop loss ou o mercado virar

STALE_NO_PROFIT_MS = 60_000 // REMOVIDO: incondicional de 4h removido. Staircase não segura posição.
// Posição sem lucro é fechada pelo stale force close em 5min.

STALE_FORCE_CLOSE_MS = 5 * 60 * 1000
// 5min sem lucro — FECHA para liberar vaga (removeu exceção de hold após 4h)
// Arc testnet: 1min (staleThreshold = 60_000)

MAX_LOSS_PERCENT = -15
// Stop loss máximo: se perda passar de 15%, fecha imediatamente

dropSteps = 2
// Quantos degraus abaixo do pico antes de fechar

MIN_LUCRO_LIQUIDO_USD = 0.02
// Valor fixo para todas as redes (substituiu getMinProfitUsd dinâmico)
// Só fecha posição se lucro líquido (descontado gas + spread) >= $0.02
// ETH mainnet: mesma regra (antes era $0.05)
```

### 4.2 VolatilityTracker (volatility-tracker.ts)

```typescript
// Níveis sugeridos baseados em vol1h do token:
// vol < 0.3%:  [0, 1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 50, 100]
// vol < 0.5%:  [0, 1.5, 3, 4.5, 6, 8, 10, 15, 20, 30, 50, 100]
// vol < 1%:    [0, 2, 4, 6, 8, 10, 15, 20, 30, 50, 100]
// vol < 1.5%:  [0, 3, 5, 7, 10, 15, 20, 30, 50, 100]
// vol < 2.5%:  [0, 4, 6, 8, 10, 15, 20, 30, 50, 100]
// vol < 4%:    [0, 5, 8, 11, 15, 20, 30, 50, 100]
// vol > 4%:    [0, 7, 11, 15, 20, 30, 50, 100]

// Position Size Multiplier:
// vol < 0.5%: 1.0  (100% do saldo)
// vol < 1.5%: 0.8  (80%)
// vol < 3%:   0.6  (60%)
// vol > 3%:   0.3  (30%)

// Confidence Multiplier:
// trend "rising"  → 0.7 (volatilidade subindo = incerteza)
// trend "falling" → 1.1 (volatilidade caindo = previsível)
// trend "stable"  → 1.0
```

### 4.3 Trend Filter (agentes-do-pregão.ts)

```typescript
// Histórico rolling de 10 min por token (PRICE_HISTORY)
TREND_PERIOD_MS = 10 * 60 * 1000   // 10 minutos
TREND_THRESHOLD = 0.02              // 2% — movimento mínimo para considerar tendência
TREND_CHECK_INTERVAL_MS = 60_000    // verifica a cada 1 min

// Comportamento:
//   getTrendDirection(token) → "up" | "down" | "flat"
//   - "up":   preço subiu > 2% nos últimos 10 min → bloqueia VENDAS
//   - "down": preço caiu > 2% nos últimos 10 min → bloqueia COMPRAS
//   - "flat": sem tendência forte → deixa fluir
// Aplicado em executarCicloAgentes() após ajuste de confiança por volatilidade

// registraPreco() é chamada a cada fetchTokenPrice bem-sucedido
```

### 4.4 Modo Papel (agentes-do-pregão.ts + pregão.ts)

```typescript
// Toggle via localStorage "arcflow_paper_mode" = "true" | "false"
// Botão "📝 Papel" no PregãoDashboard
// 
// Quando ativo:
//   executarPacotes() em pregão.ts: SKIPA batchApprove + executeBatch
//   Simula cada swap com o expectedToAmount da quote
//   Registra posições (openPosition/closePosition) normalmente
//   Marca ordens como concluídas com txHash "paper_<timestamp>"
//   Útil para treinar agentes sem gastar gas real
```

### 4.5 Batches por Token (professor.ts)

```typescript
// gerarPacotes() agora agrupa ordens pendentes do Pregão por PAR
// dentro de cada rede (antes: umbrella por rede)
// Cada par vira um pacote atômico separado:
//   WMATIC→USDC + USDC→WMATIC → mesmo pacote (delta neutro)
//   WETH→USDC → pacote separado
// Garante atomicidade: compra + venda do mesmo token no mesmo batch
```

### 4.6 Trading Pairs (real-swap-executor.ts)

```typescript
// Cada rede tem seus pares disponíveis:
// ARC:    USDC→EURC, EURC→USDC, USDC→cirBTC, cirBTC→USDC, etc.
// BASE:   USDC→EURC, USDC→WETH, WETH→USDC, USDC→WBTC, WBTC→USDC, etc.
// POLYGON: USDC→USDT, USDT→USDC, USDC→WMATIC, WMATIC→USDC,
//          USDC→WETH, WETH→USDC, USDC→DAI, DAI→USDC
// ETH:    USDC→WETH, WETH→USDC, USDC→WBTC, WBTC→USDC, etc.
// ARB:    USDC→WETH, WETH→USDC, USDC→ARB, ARB→USDC, etc.
// SEPOLIA: USDC→WETH, WETH→USDC
```

### 4.4 Config de Rede + Gas Oracle (real-swap-executor.ts + gas-price-oracle.ts)

```typescript
GAS_COST_ESTIMATE: {
  arc:      0.006,  // ~$0.006 por tx na Arc Testnet
  base:     0.05,
  polygon:  0.005,  // POL ~$0.078, 52 gwei, 500k gas → $0.005
  ethereum: 1.50,
  arbitrum: 0.03,
  sepolia:  0.006,  // ~$0.006 por tx na Sepolia (testnet)
}

GAS_UNITS_SWAP = 500000  // 280k → 500k para swaps complexos LI.FI (jun/2026)

// Gas real da RPC (gas-price-oracle.ts):
// getGasCost(network) → provider.getFeeData() → gwei → USD
// Fallback para GAS_COST_ESTIMATE se RPC falhar
// Cache de 30s

// Usado por agentes (agentes-do-pregão.ts):
// - Venda: profitUSD >= gasCost × 3
// - Compra mainnet: aborta se gasCost > 50% do trade

// TOKEN_DECIMALS (real-swap-executor.ts) — fallback quando tokenBalances não carregou:
// USDC/EURC: 6, DAI/WETH/WMATIC/ARB: 18, WBTC/cirBTC/mcirBTC: 8, SOL: 9

// minVolatileTrade por rede:
// - Ethereum: $50
// - Polygon/Base/Arbitrum: $0.10
// - Testnet (Arc/Sepolia): $1
```

### 4.5 Pregão (pregão.ts + agentes-do-pregão.ts)

```typescript
LIMIAR_OK = 2      // Quantos OKs para gerar uma ordem (agentes, antes 3 para pregueiros)
JANELA_MS = 30000  // 30s — OKs expiram após este tempo
ORDEM_TIMEOUT_MS = 120000  // 2min — ordem "preparando"/"pronto"/"executando" expira

// Agentes usam Top 3 (accountant ranking): 2 dos Top 3 = ordem
// Fallback: qualquer 2+ agentes no mesmo par

// Alocação de valor por trade (agentes-do-pregão.ts):
// maxPositions = max(1, floor((saldoEfetivo * 0.9) / MIN_TRADE_SIZE))
// amountUsd = min(MIN_TRADE_SIZE * 1.2, (saldoEfetivo * 0.9) / vagas)
//   where vagas = max(1, maxPositions - posAbertas)
//   Depois: ajuste por volatilidade (volMult < 1.0 reduz o valor)

// Na execução, valida se vale a pena:
//   retornoEsperado = (confiancaMedia / 100) * (volatilidade24h / 100)
//   tradeMinimo = (MIN_PROFIT_REAL + gasCost) / max(0.001, retornoEsperado - spreadPct)
//   Só executa se valorFinal >= tradeMinimo (garante $0.05 de lucro real)
//   Stable-stable: bloqueado se retornoUsd < gasCost × 1.5 (retorno não cobre gas)
MIN_PROFIT_REAL = 0.05  // Lucro mínimo real desejado por trade (USD)
MIN_TRADE_SIZE = 20     // $ mínimo por trade em mainnet (Polygon/Base/Arb); $50 em ETH; $2 em testnet
TRADE_SPREAD_PCT = 0.005  // 0.5% base, dinâmico: max(0.001, 0.005 - vol24h × 0.04)

// Interface OkSignal agora tem campos opcionais:
// - direcao: "buy" | "sell" — para Professor registrar palpite
// - precoNoPalpite: number — preço do token volátil no momento do voto

// okAgentes é ordenado por confiança decrescente e filtrado >= 30%
// antes de selecionar participantes da ordem

// Votos BUY+SELL simultâneos do MESMO agente no MESMO par são removidos (blindagem)
// Pares invertidos (BUY USDC→WMATIC + SELL WMATIC→USDC) são complementares, NÃO conflito
// Pares com saldo do from-token < $1 são filtrados antes da análise

// Na Arc Testnet: agentes rodam análise mas OKs viram [APRENDIZADO] (não executam)
// Quem executa na Arc é o pregao-arc.ts (bandit multi-armed)

// 🎓 Robôs verificados/promovidos (Escola de Robôs): bypassam consenso
// - isVerified: robô em turno ativo com 3+ jobs completos → ordem aceita direta
// - isPromovido: robô promovido pelo Professor (50+ palpites, 60%+ acerto, 500+ pts) → ordem aceita direta
// - isOnShiftUnverified: robô em turno mas ainda não verificado → log informativo, não executa
// Consenso normal só aplica se nenhum desses casos for verdadeiro
```

### 4.6 Agent Learning (corretor.ts + accountant.ts)

```typescript
// Score composto por agente:
// score = winRate * 0.6 + min(avgProfit, 1) * 30 + max(0, streak) * 1
// streak * 5 → max(0, streak) * 1 (streak negativa não domina)
// min(avgProfit, 1) * 30 (capped em $1 pra não distorcer)
// Mínimo 3 trades para entrar no ranking

// Sistema competitivo de 500 pontos (zero-sum):
// - 500 pontos totais distribuídos entre todos agentes
// - initPool() redistribui igualmente sempre que novos agentes entram
// - Cada avaliação: stake = points * (confidence/100) * 0.15
// - Acertou direção → ganha stake do perdedor; errou → perde stake
// - Pool sempre soma 500 (rebalanceamento automático)

// Peso na confiança do voto (agentes-do-pregão.ts):
// confidence *= (0.8 + pointsRatio * 0.4)
// pointsRatio = points / 500
// Abaixo de 1/N da piscina → penalidade leve; acima → boost

// Streak learning:
// streak < 0: confidence *= max(0.2, 1 + streak * 0.08)
// streak > 0: confidence *= min(1.3, 1 + streak * 0.04)
// streak ≤ -5: confidence = max(15, confidence) — nunca 0%, pra poder recuperar

// 🏆 Top 3 agents decidem (por rede ativa):
// Ranking do accountant, filtrado APENAS por agentes que votaram neste ciclo
// Se 2 dos 3 concordam no mesmo par → ordem gerada
// Fallback: qualquer 2+ agentes no mesmo par
```

### 4.7 Dust Threshold (position-manager.ts)

```typescript
MIN_BALANCE_THRESHOLD = 0.50  // $0.50 — saldos abaixo disso são ignorados no reconcile
```

---

## 5. ESTADO E PERSISTÊNCIA

### O que persiste no localStorage (sobrevive a F5):

| Chave | Conteúdo | Módulo |
|-------|----------|--------|
| `arcflow_volatility_data` | Preços históricos por token | volatility-tracker.ts |
| `arcflow_open_positions` | Posições abertas (com staircaseLevel) | position-manager.ts |
| `arcflow_trade_history` | Histórico de trades (só trades reais 0x) | persistence.ts |
| `arcflow_trader_state` | Estado do trader | persistence.ts |
| `arcflow_accountant_reports` | Relatórios de trade + scores dos agentes | accountant.ts |
| `arcflow_provao` | Estado do sistema de competição (provão, bônus, poder de voto) | provao-ranking.ts |
| `arcflow_escola` | Dados da escola de robôs (pontos, histórico, status) | escola-robos.ts |
| `arcflow_escola_shift` | Turno atual (robôs ativos, expiração, número) | escola-robos.ts |
| `arcflow_escola_ultimas` | Últimas 20 avaliações por robô | escola-robos.ts |
| `arcflow_professor_palpites` | Palpites pendentes e avaliados | professor.ts |
| `arcflow_parametros_robos` | Parâmetros ajustados por robô | parametros-robos.ts |
| `arcflow_pair_sector` | Avaliações de pares por rede | pair-sector.ts |
| `arcflow_paper_mode` | Modo Papel (simulação sem gas) ativado/desativado | agentes-do-pregão.ts |

### O que é perdido no F5 (volátil):

| Dado | Consequência |
|------|-------------|
| `Pregão.oks` | OKs ativos (mas são reenviados no próximo ciclo) |
| `Pregão.ordens` | Ordens pendentes (mas a blockchain continua processando) |
| `QuantumWave.wave` | Onda quântica atual (recriada no próximo ciclo) |
| `Pregueiros.historico` | Histórico de preços dos pregueiros (recomeça) |
| `Pregão.sessionStats` | Estatísticas da sessão (trades/wins/losses/profit) — zera no F5 |
| | Dashboard mostra métricas por sessão + acumuladas lado a lado |
| `pregao-arc` | Bandit state (pares, pesos, tradeAmount) — zera no F5 |
| | Na Arc, bandit decide trades; agentes só aprendem |

### Recuperação pós-F5:
1. `positionManager` carrega posições abertas do localStorage
2. `cleanupInactiveNetworks()` remove posições de redes inativas
3. VolatilityTracker carrega dados de preço do localStorage
4. `accountant` carrega scores dos agentes do localStorage
5. No primeiro ciclo, pregueiros reenviam OKs
6. Staircase retoma monitoramento das posições restauradas

---

## 6. AGENTES DO PREGÃO (12)

Cada agente vota com confiança 0-90% (cap. removemos os tetos quebrados):

| Agente | Estratégia | Fonte de Dados |
|--------|-----------|----------------|
| **Quantum** | Avalia amplitude/momentum do par | `pairPriceFeed` (preço real) |
| **Technical** | RSI simulado com momentum real | `pairPriceFeed` |
| **TrendFollower** | Segue a tendência (momentum) | `pairPriceFeed` |
| **MeanReversion** | Aposta reversão (direção = sinal do momentum) | `pairPriceFeed` |
| **QuantumTrader** | findBestPair via LI.FI (lucro esperado) | LI.FI SDK |
| **ArbitrageHunter** | Spread entre stablecoins | `getTokenPrice` |
| **MarketMaker** | Spread em pares voláteis | `getTokenPrice` |
| **BTCTrader** | Pares BTC/ETH | `getTokenPrice` |
| **Liquidator** | Maior liquidez | `pairPriceFeed` |
| **MomentumTrader** | Volatilidade × momentum | `pairPriceFeed` |
| **NVIDIAgent** | LLM NIM (probability × liquidity) | `pairPriceFeed` |
| **Synthesis** | Combina votos, decide | `pairScores` |

### Parâmetros individuais por robô (parametros-robos.ts)
Agentes consultam `parametrosRobos.get(nome)` para thresholds dinâmicos:
- **MomentumTrader**: `thresholdEntrada` em vez de hardcoded
- **NVIDIAgent**: `thresholdProbabilidade` em vez de `> 10`
- **Synthesis**: `confiancaMinima` em vez de `>= 30`
- Professor ajusta automaticamente conforme desempenho (acertos/erros consecutivos)

### Ajustes de confiança (ordem de aplicação):
1. **VolatilityTracker**: `getConfidenceMultiplier(tokenVolatil)` — reduz se vol está subindo
2. **Pontos competitivos**: `confidence *= 0.8 + (points/500) * 0.4`
3. **Streak learning**: `confidence *= streakMult` (negativo reduz, positivo aumenta)
   - Streak ≤ -5: mínimo 15% (nunca zero)

### 🏆 Top 3 agents decidem:
- Ranking do accountant define os 3 melhores agentes
- Só os votos do Top 3 com confiança > 0% contam pra decisão
- Se 2 dos 3 concordam no mesmo par → ordem gerada
- Fallback: qualquer 2+ agentes no mesmo par se Top 3 sem consenso
- Todos agentes continuam votando (aprendizado), mas só o Top 3 tem poder decisório

---

## 7. PREGUEIROS (4)

| Pregueiro | Função | Gatilho |
|-----------|--------|---------|
| **Tendência** | Analisa tendência de preço relativo do par | `pairPriceFeed.getPairStats()` |
| **Volume** | Volume de mercado (24h / cap) | `/api/market-data` |
| **Sentimento** | Fear & Greed Index | `/api/market-data` |
| **Tático** | Rotação de portfólio (cíclico) | Interno (cada 3 ciclos) |

---

## 8. STAIRCASE — LÓGICA DE FECHAMENTO

```
Situação: Posição WETH comprada a $3000, preço atual $3200

Lucro = (3200 - 3000) / 3000 = 6.67%

Níveis sugeridos pelo VolTracker (vol1h WETH ≈ 0.8%):
  [0, 2, 4, 6, 8, 10, 15, 20, 30, 50, 100]

Level atual  = 3 (4% → 6%, 6.67% está no nível 3 = índice de 6%)
Level pico   = 3 (mesmo)

Se preço sobe para $3300 → lucro 10% → sobe para nível 4
Se preço cai para $3100 → lucro 3.3% → nível atual = 1
  1 <= 4 - 2 (= 2) → SIM → FECHA com ~3.3% de lucro
```

### Regras:
- Staircase só ativa após lucro > 0% (nível 0 = 0%)
- Close só acontece se pico > nível 0 (evita fechar no prejuízo)
- **Stale (4h sem lucro)**: REMOVIDO — não segura mais posição sem lucro
- **Stale force close (5min sem lucro)**: FECHA incondicionalmente posição parada para liberar vaga (antes 30min, depois 5min). Testnet: 1min.
- **Venda break-even**: liberada após stale threshold (5min mainnet, 1min testnet) — antes era bloqueada "só Staircase pode fechar"
- **Expired (12h)**: só força fechamento se a posição já viu lucro (peakProfitPercent > 0)
- **Stop loss (-15%)**: única exceção que fecha no prejuízo (proteção catastrófica)
- Ao fechar, injeta 3 OKs no Pregão com `toToken: "USDC"` sempre
- **Staircase chama `closePosition()` imediatamente** ao decidir fechar
- **`cleanupInactiveNetworks()`** remove posições de redes inativas a cada ciclo

---

## 9. VOLATILITY TRACKER — SISTEMA DE APRENDIZADO

### Coleta:
- A cada ciclo dos pregueiros (10-30s), busca preço de todos os tokens
- Máximo 1 coleta por token a cada 60s (PRICE_CACHE_MS)
- Histórico: até 288 pontos (~24h a 5min)

### Cálculos:
- `vol1h`: desvio padrão dos retornos na última hora
- `vol4h`: idem para 4h
- `vol24h`: idem para 24h
- `trend`: compara volatilidade recente (30% últimos pontos) com o restante
  - ratio > 1.3 → "rising"
  - ratio < 0.7 → "falling"
  - senão → "stable"

### Uso dos dados:
1. **Staircase**: sugere níveis baseados em vol1h do token comprado
2. **Position Sizing**: reduz posição em tokens voláteis
3. **Confidence**: reduz confiança dos agentes se vol está subindo

---

## 10. CIRCUIT BREAKER (circuit-breaker.ts)

- Para após **5 perdas consecutivas**
- Para após **10% de drawdown**
- Reset manual ou automático após cool-down
- Estado em memória (não persiste)

---

## 11. REDES SUPORTADAS

| Rede | ChainId | Tipo | Explorador | Gas Token |
|------|---------|------|------------|-----------|
| Arc Testnet | 5042002 | 🧪 testnet | testnet.arcscan.app | USDC (18 dec) |
| Polygon | 137 | 💰 mainnet | polygonscan.com | POL |
| Base | 8453 | 💰 mainnet | basescan.org | ETH |
| Ethereum | 1 | 💰 mainnet | etherscan.io | ETH |
| Arbitrum | 42161 | 💰 mainnet | arbiscan.io | ETH |
| Ethereum Sepolia | 11155111 | 🧪 testnet | sepolia.etherscan.io | ETH |

Cada rede roda em uma porta diferente:
- `npm run dev` → Polygon (3000)
- `npm run dev:testnet` → Arc (3001)
- `npm run dev:base` → Base (3002)
- `npm run dev:sepolia` → Sepolia (3003)

---

## 12. VARIÁVEIS DE AMBIENTE

```env
# Obrigatório para auto-sign (sem MetaMask)
PRIVATE_KEY=

# Circle KIT (opcional, para Circle App Kit)
KIT_KEY=

# LI.FI (opcional)
LIFI_API_KEY=

# RPCs customizados (opcional)
BASE_RPC_URL=

# Contratos (já têm valores padrão no código)
NEXT_PUBLIC_AGENT_IDENTITY_ADDRESS=
NEXT_PUBLIC_ERC8183_ADDRESS=
NEXT_PUBLIC_SUBGRAPH_URL=

# Rede padrão
NEXT_PUBLIC_DEFAULT_NETWORK=arc

# Circuit breaker admin
ADMIN_PANIC_KEY=

# NVIDIA NIM
NVIDIA_API_KEY=
```

---

## 13. SMART CONTRACTS (Arc Testnet)

| Contrato | Endereço |
|----------|----------|
| USDC | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| cirBTC (Arc testnet) | `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` |
| mcirBTC (Arc testnet) | `0x8cad4951192853D14f8Cb813695146b5Ae00EA6d` |
| cirBTC (Ethereum mainnet) | `0x72DFB2E44f59C5AD2bAFE84314E5b99a7cd5075E` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| CCTP TokenMessenger V2 (testnet) | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| CCTP MessageTransmitter V2 (testnet) | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| CCTP TokenMessenger V2 (mainnet) | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` |
| CCTP MessageTransmitter V2 (mainnet) | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` |
| IdentityRegistry (ERC-8004) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| AgenticCommerce (ERC-8183) | `0x0747EEf0706327138c69792bF28Cd525089e4583` |
| AgentIdentity (deploy próprio) | `0xaeb95e2532a73a097e03584cb244eeca9b5609a5` |

---

## 14. PADRÕES DE CÓDIGO

### Imports
```typescript
// Preferir imports de tipo com 'type' keyword
import { realSwap, type SwapResult } from "./real-swap-executor"
```

### Async/Await
- `quantumWaveTrader.broadcastIntent()` é async (usa pairPriceFeed)
- `pairPriceFeed.getPairStats()` é async (fetch para /api/price)
- Sempre usar `await` ao chamar funções async — confianças de 500%+ no passado eram de calls sem await

### Persistência
- Usar localStorage com chave prefixada `arcflow_*`
- Sempre try/catch no localStorage (pode falhar em SSR, modo privado, etc.)
- VolatilityTracker salva a cada coleta (batch)
- PositionManager salva a cada open/close

### Adicionar Novo Token

> **Nota:** Os currency IDs no COIN_IDS agora são IDs numéricos da SoSoValue (ex: `"1673723677362319867"` para ETH), não mais slugs do CoinGecko (ex: `"ethereum"`). cirBTC e mcirBTC usam o currency_id do BTC (`"1673723677362319866"`).

Se for adicionar um novo token, atualizar em **todos** os lugares:
1. `real-swap-executor.ts`: `NETWORKS.rede.tokens` + `TRADING_PAIRS`
2. `pair-price-feed.ts`: `COIN_IDS`
3. `volatility-tracker.ts`: `COIN_IDS`
4. `position-manager.ts`: `fetchTokenPrice` → coinIds + `fetchTokenChange24h` → coinIds
5. `professor.ts`: `COIN_IDS`
6. `agentes-do-pregão.ts`: `getTokenPrice()` → coinIds + `registrarPalpite` filter
7. `corretor.ts`: `buscarPreco` → coinIds
8. `escriturario.ts`: `fetchTokenPrice` → coinIds
9. `networks.ts`: adicionar token à rede correspondente (UI)
10. `ARCFLOW.md`: atualizar seção de contratos + pares prioritários

---

## 15. PREGÃO ARC — Multi-Armed Bandit (Testnet)

`lib/pregao-arc.ts` — sistema autônomo de trading para Arc testnet.

### Funcionamento
- **Iniciado** quando o ciclo é ativado na Arc (`iniciar()`)
- **A cada ciclo**: escolhe um par via pesos proporcionais ao lucro acumulado (softmax)
- **Envia 3 OKs** (`ArcBandit:1/2/3`) ao `pregão` para executar o trade
- **A cada 10 trades**: recalcula pesos + aumenta trade amount ($5 → $10 → $15... cap $50)
- **Resultados**: `registrarResultadoArc()` alimenta o aprendizado

### Agentes na Arc
- Continuam análise completa (votação, consenso, logs)
- `pregão.receberOK` com prefixo `Agente:` interceptado → vira `[APRENDIZADO]` no log
- Só o bandit executa trades na Arc

---



### Problema: "Saldo insuficiente de USDC"
- Verificar se há posição aberta (ETH, MATIC, etc.) que precisa ser vendida
- Staircase deve vender automaticamente quando cair 2 degraus
- Ou verificar se o saldo realmente está baixo na blockchain

### Problema: "Confiança acima de 100%"
- Verificar se `Math.min(90, ...)` está sendo aplicado no agente
- Verificar se `probability * 100` (NVIDIAgent) deveria ser só `probability`
- Verificar se VolTracker confidence multiplier não está multiplicando pra cima demais

### Problema: "Ordem anterior ainda não confirmada — aguardando"
- Pregão só processa uma ordem por vez (sequencial)
- Aguardar ordem atual concluir ou expirar (2min timeout)
- Timeout agora cobre "preparando", "pronto" E "executando" (120s)
- Se ordem travou, o próximo ciclo deve limpar via `limparOrdensTravadas()`
- Ciclo manual ("▶️ 1 Ciclo") agora chama `resumeFromPanic()` + `limparOrdensTravadas()`

### Problema: "Posições fantasmas acumulando (31 abertas)"
- Staircase não chamava `closePosition()` ao decidir fechar — posição ficava "open" pra sempre
- `cleanupInactiveNetworks()` remove posições de redes inativas a cada ciclo
- Staircase agora fecha posição imediatamente antes de criar ordem de venda

### Problema: "Simulated testnet trades enchendo o histórico"
- `persistence.ts` só persiste trades com txHash real (`0x...`)
- `real-swap-executor.ts` não retorna txHash fake para swaps simulados
- API `/api/trades` rejeita POST sem txHash começando com `0x`

### Problema: "Circuit breaker nunca desarma"
- `resumeFromPanic()` existia mas nunca era chamado
- Agora chamado a cada ciclo (manual e automático) no `PregãoDashboard.tsx`

### Feature: "Sala de aula — aprendizado simulado dos votos"
- Cada voto de agente é registrado com `{ agentName, par, preço, timestamp }`
- A cada ciclo, votos com >5min são avaliados contra o preço atual
- Se o voto teria dado lucro → score+ e ganha pontos competitivos
- Se teria dado prejuízo → score- e perde pontos competitivos
- Simulado com $5 fictício para o score tradicional
- Persiste em localStorage (`arcflow_vote_history`)

### UI: "SalaDeAula" (app/components/SalaDeAula.tsx)
- Componente React interativo exibido abaixo do PregãoDashboard
- Ranking dos agentes com notas, nível (Aprendiz→Doutorado), barra de progresso
- Exibe "🏟️ N pts" (pontos competitivos) ao lado de ✅/❌
- Mensagens do "Professor" baseadas no desempenho recente (elogios/críticas)
- Próximo nível com pontos faltando — gamificação do aprendizado
- Atualiza a cada 3s via `accountant.getRanking()` e `getTeacherFeedback()`
- Níveis: 🌱 Aprendiz (0-10) → 📗 Primeiro Grau (10-30) → 📘 Segundo Grau (30-50) → 📙 Terceiro Grau (50-70) → 🎓 Mestrado (70-85) → 🏆 Doutorado (85+)

### Feature: "Sistema competitivo de 500 pontos" (accountant.ts)
- Zero-sum: 500 pontos totais distribuídos entre todos os agentes
- Cada avaliação de voto: `stake = points * (confidence/100) * 0.15`
- Acertou direção do preço → ganha stake
- Errou → perde stake (distribuído aos ganhadores)
- `initPool()` redistribui igualmente sempre que novos agentes entram
- Pool sempre soma 500 (rebalanceamento automático)

### Regra: "Confiança por pontos competitivos"
- Substituiu score/maxScore por points/500
- Fórmula: `confidence *= (0.8 + pointsRatio * 0.4)`
- Agentes com mais pontos têm mais peso nas decisões
- Pontos abaixo da média → penalidade leve
- Pontos acima da média → boost na confiança

### Feature: "Variação 24h como meta de lucro" (position-manager.ts)
- `fetchTokenChange24h(token)` busca variação percentual 24h da SoSoValue (via sosovalue-price-agent.ts)
- `/api/price` agora retorna `{ prices, change24h }` com `include_24hr_change=true`
- No sell loop: só vende se `profitPercent >= variation24h * 0.9`
- Exemplo: ETH varia 3% → só vende com lucro >= 2.7%
- Garante que posição busca capturar a maior parte do movimento diário
- Se variação 24h for muito pequena (< 0.5%), usa fallback 2%

### Regra: "Só compra volátil se caixa livre"
- Antes: Pregão/Pregueiros/Agentes não enviavam OKs de compra (stable→volátil) enquanto houvesse **qualquer** posição aberta
- Agora: posições dinâmicas baseadas no capital: `maxPositions = max(1, floor(saldoEfetivo * 0.9 / 5))`
- Com $5.20 → 1 posição; com $50 → 10 posições
- Valor por trade: `min($6, (saldoStable * 0.9) / vagasRestantes)`
- Vendas (volátil→stable) continuam livres para fechar posição com lucro
- Garante que cada trade tenha $ suficiente para cobrir gas + spread + $0.05 lucro

### Problema: "LI.FI rota fly com estimate 0"
- Mainnet: `toEstimate <= 0` aborta com `_fail` — não envia TX que vai reverter
- Testnet: continua enviando (pode funcionar com rota fly)
- Rota "fly" retorna `toAmount: "0"` no JSON, TX sempre reverte na mainnet
- Salvou ~$5 de gas por ciclo que seria desperdiçado

### Problema: "Agentes não aprendem com os resultados"
- `corretor.ts` agora pontua cada agente que votou na ordem após trade concluído
- `accountant.ts` mantém score composto: `winRate * 0.6 + min(avgProfit, 1) * 30 + max(0, streak) * 1`
  - `streak * 5` → `max(0, streak) * 1` (streak negativa não domina mais)
  - `min(avgProfit, 1) * 30` (capped em $1 pra não distorcer)
- `agentes-do-pregão.ts` pondera confiança dos votos por points/500 (competitivo)
- Dados persistem em localStorage (`arcflow_accountant_reports`)

### Feature: "Gas oracle nos agentes" (agentes-do-pregão.ts)
- Substitui hardcoded `$0.50` por `gasPriceOracle.getGasCost(redeAtual)` 
- Venda: só executa se `profitUSD >= gasCost × 3`
- Compra (mainnet): aborta se `gasCost > 50% do valor do trade`
- Dinâmico por rede — Polygon ~$0.08, Arc ~$0.006, Ethereum ~$1.50
- Gas real da RPC com cache de 30s (gas-price-oracle.ts)

### Feature: "Streak learning — agentes perdem confiança com derrotas"
- Agent com streak negativo vota com confiança reduzida (8% por derrota consecutiva)
- Streak ≤ -5: confiança cai pra mínimo 15% (nunca zero)
- Streak positivo: +4% por vitória consecutiva (max 1.3x)
- Sistema natural de feedback: errar → menos influência → acertar → mais influência

### Feature: "🏆 Top 3 agents decidem o trade"
- Todos agentes votam, mas só o Top 3 do ranking do accountant tem voto decisivo
- Se 2 dos Top 3 concordam no mesmo par → OKs enviados ao Pregão
- Fallback: qualquer 2+ agentes no mesmo par se Top 3 não chegar a consenso
- Substitui o antigo sistema de "3+ agentes no mesmo par"
- Democracia representativa: competição para entrar no Top 3

### Feature: "Testnet isolada do ranking competitivo"
- `avaliarVotosPassados` retorna cedo em testnet
- Agentes praticam votação sem perder streak nem pontos competitivos
- Apenas mainnet (Polygon, Base, Ethereum) afeta o ranking
- Testnet: votos antigos são limpos sem avaliação

### Problema: "LI.FI 429 rate limit poluindo console"
- `console.error` → `console.warn` no lifi-executor.ts
- Rate limit é comportamento esperado, não erro

### Feature: "🔄 Posições dinâmicas por capital"
- Substitui o antigo MAX_POSITIONS fixo (3/10)
- Agora: `maxPositions = max(1, floor(saldoEfetivo * 0.9 / MIN_TRADE_SIZE))` com `MIN_TRADE_SIZE = $5`
- amountUsd por trade: `min(MIN_TRADE_SIZE * 1.2, (saldoEfetivo * 0.9) / vagasRestantes)` ≈ $6 max
- Ex: $5.20 → 1 posição, trade de $4.68
- Ex: $50 → 9 posições, trade de ~$5.00 cada
- Pregueiro.ts mantém MAX_POSICOES = 10 como upper bound para não bloquear votações
- Rotation implícita: posição estagnada pode ser fechada via Staircase para liberar vaga

### Fix: "💰 Preço de entrada real (não $1.00)"
- `real-automated-trader.ts`: entryPrice usa `tradeAmount / result.toAmount` (preço real do swap) em vez de `fetchTokenPrice` que caía pra $1.00
- `corretor.ts`: mesma lógica — `valorTrade / resultado.toAmount`
- Swap falhou com toAmount=0 → posição não é registrada (retorna early)
- Elimina o "184900% de lucro fantasma" e o loop de venda sem saldo

### Fix: "🔇 Debounce nos OKs do Staircase/TrailingStop/AutoClose"
- `pregueiro.ts`: Set `staircaseCloseSent` rastreia positions que já geraram OKs de fechamento no ciclo atual
- Limpo no início de cada `verificarStaircaseFechamento()`
- Evita dezenas de OKs idênticos no mesmo segundo

### Fix: "💾 Persistência do circuit breaker (localStorage)"
- `circuit-breaker.ts`: estado salvo em `localStorage` via `arcflow_circuit_breaker`
- Persiste após cada `setTestnetMode`, `recordTradeResult`, `recordError`, `activatePanic`, `resumeFromPanic`, `resetCircuitBreaker`
- Restaura no carregamento: se pânico estava ativo no F5, mantém (segurança)
- `persistence.ts`: funções `saveCircuitBreakerState` / `loadCircuitBreakerState`

### Fix: "🎯 Sala de aula: stable-stable não conta micro-variação como acerto"
- `agentes-do-pregão.ts` `avaliarVotosPassados`: se ambos os tokens são stables, spread precisa ser ≥ 0.1% pra contar como acerto
- Variações menores que 0.1% em 5 minutos são ruído e não geram pontuação
- Para voláteis, a lógica de direção do preço permanece inalterada

### Problema: "Lucro sempre $0.0000"
- Testnet: swaps simulados não têm slippage real
- Mainnet: verificar se pairPriceFeed está retornando preços diferentes de 1.0
- Verificar se há liquidez real no par via LI.FI

### Bug (22/06): "Compra (stable→volátil) destrói streak dos agentes"
- `corretor.ts:80`: `profit = 0` em abertura de posição
- `accountant.ts:147-153`: profit ≤ 0 conta como derrota → streak negativo
- Cada compra WMATIC dava -1 streak, depois de 6 compras streak = -6, confiança 15%
- **Fix**: `isBuyOpening` flag skipping accountant.addReport + reward + circuit breaker para compras
- Agentes só são avaliados na venda (volátil→stable), onde o lucro é real

### Bug (22/06): "minViableTrade com bypass para trades < $5"
- `agentes-do-pregão.ts:1098`: condição `valorFinal >= 5` impedia cheque de viabilidade para micro-trades
- Trade de $2.40 na Polygon ($0.08 gas) executava sem verificar se retorno cobre custos
- **Fix**: `valorFinal >= minSizeForCheck` onde `minSizeForCheck = getMinTradeSize(pairNet)` ($2 p/ Polygon)

---

## 17. COMANDOS ÚTEIS

```bash
npm run dev          # Polygon (porta 3000)
npm run dev:testnet  # Arc Testnet (porta 3001)
npm run dev:base     # Base (porta 3002)
npm run build        # Build de produção
npm run lint         # ESLint
npx tsc --noEmit     # TypeScript check
```

---

---

## 18. UI/UX — DESIGN SYSTEM E COMPONENTES

### 17.1 Design System (`constants/design-system.ts`)

```typescript
// Paleta de cores global (redesign 06/2026)
colors: {
  bg: { DEFAULT: "#0f172a", card: "#1e293b", hover: "#262A33", border: "rgba(148,163,184,0.15)" },
  accent: { green: "#22c55e", blue: "#3b82f6", red: "#ef4444", gold: "#FFD700" },
  text: { primary: "#F1F5F9", secondary: "#94a3b8", muted: "#64748B" },
  gradient: { from: "#0f172a", to: "#1e3a5f" },
}
```

### 17.2 Nova Hierarquia Visual (DashboardShell)

```
Zona 1 (topo):  KpiPanel — 4 métricas lado a lado (Saldo, Lucro, Win Rate, Status)
Zona 2 (meio):  DecisionFeed — o que os robôs estão fazendo agora
Zona 3 (baixo): ActiveTrades + AgentGrid — posições ativas e ranking
```

### 17.3 WelcomeScreen (`app/components/WelcomeScreen.tsx`)
- Tela de boas-vindas quando desconectado
- Logo ARCFLOW centralizado com gradiente animado
- Frase "Seus robôs trabalhando para você 24h"
- Botão "Conectar Carteira" verde vibrante com gradiente
- Fundo gradiente azul escuro (#0f172a → #1e3a5f)

### 17.4 Narrador (`app/components/NarratorBot.tsx`)
- Card fixo no topo do painel em vez de popup de rodapé
- Avatar robô com expressões: 😴 dormindo, 🤖 animado, 🤔 pensativo, 🎉 feliz
- Avatar muda conforme evento recebido
- Mensagens em linguagem natural simplificada

### 17.5 Sala de Aula (`app/components/SalaDeAula.tsx`)
- Barra de progresso animada com gradiente
- Medalhas visuais por nível
- Ícone colorido único por agente
- Mensagem do professor com ícone de quadro-negro 📖
- Usa paleta global do design system

### 17.6 KPI Cards (`app/components/dashboard/KpiPanel.tsx`)
- Card Win Rate com gráfico circular (SVG donut)
- Card Status com indicador pulsante verde 🟢 ou amarelo 🟡
- Cores dinâmicas (verde para lucro, vermelho para perda)
- Efeito hover de elevação

### 17.7 Mensagens Simplificadas (`constants/messages.ts`)
- "🔍 Robôs analisando oportunidades" em vez de "OKs Ativos no Pregão"
- "⏳ Aguardando melhor momento" em vez de "Confiança X% < 50% mínimo"
- "👥 17 robôs ativos" em vez de "Pregueiros (4) + Agentes (13)"
- "🛡️ Proteção ativada" em vez de "Circuit breaker ativo"
- "📈 Posição subindo" em vez de "Staircase Level X"
- "💰 Aguardando saldo" em vez de "Saldo insuficiente"
- "⚙️ Realizando trade agora" em vez de "Ordem executando"
- "📂 X investimentos ativos" em vez de "Posições em polygon: X"

### 17.8 Log Técnico
- Oculta atrás de `<details>` com label "Ver log técnico"
- Fonte monospace reduzida com scroll limitado a 200px
- Linhas coloridas por tipo (verde=sucesso, vermelho=erro, amarelo=aviso)

---

## 19. ORACLE STORK (Arc Testnet)

### 19.1 Arquitetura (Pull Oracle)
Stork é um **pull oracle** (diferente de Chainlink push):
1. Dados chegam off-chain via WebSocket (assinatura signed)
2. Subscriber envia tx `updateTemporalNumericValuesV1()` ao contrato Arc
3. Contrato armazena o preço assinado — lido via `getTemporalNumericValueUnsafeV1(bytes32 id)`

### 19.2 WebSocket (Off-chain)
| Item | Detalhe |
|------|---------|
| Endpoint | `wss://api.jp.stork-oracle.network` |
| Path | `/evm/subscribe` |
| Auth | `Authorization: Basic <token>` (requer contato com Stork Labs — sales@stork.network) |
| Frequência | A cada 500ms ou 0.1% de variação |
| Payload | `oracle_prices` com `asset_id`, `price`, `timestamp`, `stork_signed_price` |

### 19.3 Contrato On-chain (Arc Testnet)
| Item | Detalhe |
|------|---------|
| Endereço | `0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62` |
| Explorer | `https://testnet.arcscan.app/address/0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62` |
| Função | `getTemporalNumericValueUnsafeV1(bytes32 id)` → preço com 18 decimais |
| Feeds | `EURCUSD`, `BTCUSD` (usado para cirBTC/mcirBTC) |

### 19.4 Integração no Código
- `pair-price-feed.ts`: suporte ao oracle Stork on-chain na Arc Testnet
- Ativado automaticamente quando a rede é `arc` (via `executarCicloPregueiros`)
- Stork como fonte primária → SoSoValue (fallback)
- `pairPriceFeed.setUseStork(true/false)` para controle programático

### 19.5 Status Atual
| Aspecto | Status |
|---------|--------|
| Contrato on-chain verificado | ✅ Deployado em `0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62` |
| WebSocket subscriber | ⏳ Não implementado (requer token Stork Labs) |
| Prioridade | **Baixa** — já temos preços reais via SoSoValue |

### 19.6 Adapters (Pyth / Chainlink)
Stork pode ser consumido via interfaces Pyth e Chainlink (adapters). Documentação: `https://docs.stork.network/resources/adapters.md`
SDK npm: `@storknetwork/stork-evm-sdk`

## 19. PRIVACIDADE (Roadmap)

### 19.1 Estrutura Preparada
- `SwapResult.private?: boolean` — campo opcional para modo privado (sempre false por enquanto)
- `arc-direct-swap.ts`: documentação comentada sobre onde aplicar selective disclosure
- UI: toggle "🔒 Privado" desabilitado no Header com tooltip "Modo privado em breve"

### 19.2 Próximos Passos (quando disponível)
1. SDK Arc liberar transações privadas
2. Propagadar flag `private` do SwapResult → executor
3. Usar AgenticCommerce (ERC-8183) para intenções sem expor dados completos

## 20. TRANSACTION MEMOS (Arc Testnet)

### 20.1 Contrato

| Contrato | Endereço                                                                                                                            |
| :------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| `Memo`   | [`0x5294E9927c3306DcBaDb03fe70b92e01cCede505`](https://testnet.arcscan.app/address/0x5294E9927c3306DcBaDb03fe70b92e01cCede505)      |
| `USDC`   | [`0x3600000000000000000000000000000000000000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000)      |

### 20.2 Como funciona

O `Memo` contract usa a precompile `CallFrom` da Arc para encaminhar uma chamada ao contrato alvo preservando o `msg.sender` original (EOA). Emite `BeforeMemo` + `Memo` events — eventos `Memo` carregam `sender`, `target`, `callDataHash`, `memoId`, `memoData`, `memoIndex`.

### 20.3 Módulos

- **`lib/arc-memo.ts`** — interação com o contrato `Memo` (singleton `arcMemo`)
  - `sendUSDCWithMemo(signer, recipient, amount, memoId, memoData)` — envia USDC com memo em 1 tx
  - `sendWithMemo(signer, target, data, memoId, memoData)` — versão genérica
  - `queryMemoEvents(provider, memoId)` — busca eventos `Memo` pelo `memoId`
  - `isDeployed(provider)` — verifica se contrato existe na rede
- **`lib/transaction-memos.ts`** — encoding local + helpers
  - `generateMemoId(reference)` → `keccak256(utf8(ref))` = bytes32 compatível
  - `encodeMemoData(record)` → `hexlify(utf8(JSON.stringify(data)))`

### 20.4 Fluxo de integração

1. **`arc-micro-trader.ts` `send()`** — se `memoRef` for passado e chain='arc', usa `arcMemo.sendUSDCWithMemo()` em vez de `arcAppKit.sendToken()`
2. **`arc-micro-trader.ts` `executeMicroTrade()`** — após swap bem-sucedido, se `memoEnabled`, envia post-trade memo registrando resultado (par, profit, txHash)
3. **`real-swap-executor.ts` `executeSwap()`** — aceita `memoRef` como 5º parâmetro; na Arc, envia post-trade memo com metadados da execução
4. **`corretor.ts` `executar()`** — passa `ordem.id` como `memoRef` para `realSwap.executeSwap()`

### 20.5 Guardrails (contrato impõe)

- Chamar `Memo.memo()` apenas de EOA (contract calls revertem)
- Não usar `STATICCALL` nem `DELEGATECALL` no Memo
- Se a call filha reverte, a tx inteira reverte
- `memoId` = `keccak256(utf8(reference))` via `transactionMemos.generateMemoId()`

---

## 21. SISTEMA DE COMPETIÇÃO — PROVÃO, BÔNUS E PODER DE VOTO

### 21.1 Visão Geral (`lib/provao-ranking.ts`)

Sistema gamificado de competição entre agentes, com três premiações e ciclo de poder de voto:

```
┌──────────────────────────────────────────────────────────────────┐
│ PROVÃO DIÁRIO                                                    │
│ ├── A cada trade, o agente é registrado no ranking do dia        │
│ ├── Ao virar o dia, o provão é finalizado                        │
│ ├── Vencedor: agente com melhor score (lucro + winRate)          │
│ └── Prêmio: 1 ponto de bônus diário (acumula para a semana)      │
├──────────────────────────────────────────────────────────────────┤
│ BÔNUS SEMANAL (a cada 7 dias)                                    │
│ ├── Conta quantos provões cada agente venceu na semana           │
│ ├── Vencedor: quem tem mais vitórias diárias                     │
│ └── Prêmio: 1 ponto de bônus semanal (acumula para 4 semanas)    │
├──────────────────────────────────────────────────────────────────┤
│ GRANDE PRÊMIO (a cada 4 semanas)                                 │
│ ├── Conta quantos bônus semanais cada agente acumulou            │
│ ├── Vencedor: quem tem mais vitórias semanais                    │
│ └── Prêmio: bônus extra                                          │
├──────────────────────────────────────────────────────────────────┤
│ PODER DE VOTO (ciclo de 10 trades)                               │
│ ├── A cada 10 trades no sistema, o ciclo é finalizado            │
│ ├── Todos os agentes têm o poder de voto zerado                  │
│ ├── Novo ciclo começa — todos empatados                          │
│ ├── Poder = lucro * 0.6 + winRate * 0.4 (dentro do ciclo)       │
│ └── Garante que agentes atrás nunca desanimem — sempre recomeça  │
└──────────────────────────────────────────────────────────────────┘
```

### 21.2 Provão Diário

- **Quando**: O provão do dia começa no primeiro trade do dia e finaliza à meia-noite (quando um novo dia é detectado)
- **Score do dia**: `profit + (wins / trades) * 10`
- **Prêmio**: O vencedor ganha 1 ponto no acumulador semanal
- **UI**: Aba "🏆 Provão" na SalaDeAula mostra o líder do dia, último resultado e corrida semanal

### 21.3 Bônus Semanal

- **Quando**: Após 7 provões (segunda a domingo), o agente com mais vitórias diárias vence
- **Desempate**: Quem tiver mais vitórias diárias na semana
- **Prêmio**: O vencedor ganha 1 ponto no acumulador do Grande Prêmio (4 semanas)
- **UI**: Exibe o placar semanal com vitórias de cada agente

### 21.4 Grande Prêmio (4 Semanas)

- **Quando**: A cada 4 semanas, o agente com mais bônus semanais vence
- **Prêmio**: Bônus extra + registro no histórico de grandes campeões
- **UI**: Exibe o campeão e o placar das 4 semanas

### 21.5 Poder de Voto (Ciclo de 10 Trades)

- **Ciclo**: A cada 10 trades no sistema, TODOS os agentes têm o poder de voto zerado
- **Cálculo**: Dentro de cada ciclo, o poder é:
  - `power = profitRatio * 0.6 + winRateRatio * 0.4`
  - `profitRatio = profit / maxProfit do ciclo`
  - `winRateRatio = winRate / maxWinRate do ciclo`
  - Resultado: 0-1 (0% a 100%)
- **Impacto**: O poder de voto pode ser usado para ponderar a confiança dos agentes nas votações (integração futura com `agentes-do-pregão.ts`)
- **Reset**: A cada 10 trades, todos voltam a 0 — ninguém fica para trás permanentemente
- **UI**: Aba "🗳️ Poder de Voto" na SalaDeAula mostra barra de progresso do ciclo e ranking de poder atual

### 21.6 Persistência

| Chave | Conteúdo | Módulo |
|-------|----------|--------|
| `arcflow_provao` | Estado completo (dailyScores, dailyHistory, weeklyHistory, grandPrizes, cycleState, accumulators) | provao-ranking.ts |

### 21.7 Integração com Accountant

- `accountant.addReport()` → chama `provaoRanking.recordTrade(agentName, profit)`
- A cada trade: atualiza score diário + ciclo de poder de voto
- Ao finalizar dia: define vencedor do provão
- A cada 10 trades: zera poder de voto de todos

### 21.8 UI — Abas da SalaDeAula

A SalaDeAula agora tem 3 abas:
1. **📊 Ranking** — ranking clássico dos agentes (notas, streaks, níveis)
2. **🏆 Provão** — competições: provão do dia, corrida semanal, grande prêmio
3. **🗳️ Poder de Voto** — ciclo de 10 trades, ranking de poder atual, progresso do reset

*Documento gerado em 19/06/2026. Mantenha atualizado conforme novas features.*

---

## 26. ESTRATÉGIA — GRID ADAPTATIVO COM ZONA NEUTRA

### 26.1 Conceito

O Grid Adaptativo substitui o antigo sistema de grid fixo. Em vez de níveis estáticos ao redor do preço de inicialização, o grid agora **deriva, salta e se reequilibra** conforme o mercado se move.

```
Zona Neutra (centro do grid)
  ├── Preço atual = centro do grid
  ├── 15 níveis (7-8 de compra abaixo, 7-8 de venda acima)
  ├── Espaçamento DINÂMICO baseado na volatilidade do token
  │   (vol < 0.3% → 0.25%, vol < 0.5% → 0.3%, vol < 1% → 0.5%, etc.)
  └── Cada nível = $5, micro-ganhos na volatilidade

Drift (deriva suave)
  ├── Se preço fica 60%+ do tempo acima do centro → centro SOBE devagar
  ├── Se preço fica 60%+ do tempo abaixo do centro → centro DESCE devagar
  └── Velocidade: 12% da distância por ciclo — suave, sem solavancos

Red Line (linha vermelha)
  ├── Se preço escapa 2.2× além do nível mais externo → RED LINE
  ├── Grid pula para o preço atual (novo centro)
  ├── Cria nível "catch-up" na direção do salto
  └── Cooldown de 3min entre saltos (evita whipsaw)

Auto-Rebalance
  ├── Quando um nível de COMPRA executa → cria novo nível de VENDA 1.5 espaçamento acima
  ├── Quando um nível de VENDA executa → cria novo nível de COMPRA 1.5 espaçamento abaixo
  ├── Grid sempre mantém ~15 níveis ativos
  └── Posições executadas são preservadas durante re-centerings
```

### 26.2 Fluxo de Decisão

```
Grid nível atingido? 
  ├── Sim → valida saldo + posições → OK direto ao Pregão (pula agentes)
  │        Pregão aceita com LIMIAR=1 (Grid: prefix)
  └── Não → agentes votam normalmente
           ├── Se grid ativo no token → confiança dos agentes REDUZIDA (-30%)
           ├── Se grid saltou → confiança NORMAL
           └── Se grid obsoleto → confiança AUMENTADA

Pregão (verificarOrdem):
  ├── Grid: prefix → LIMIAR=1, pula mínimo de 40% confiança
  ├── Agente normal → LIMIAR=2, mínimo 40% em mainnet
  └── Ambos → max 5 ordens ativas simultâneas
```

### 26.3 Arquivos Alterados

| Arquivo | Mudança |
|---------|---------|
| `lib/grid-trading.ts` | Reescrevendo: grid adaptativo (15 níveis, spacing dinâmico, drift, red line, auto-rebalance) |
| `lib/pregão.ts` | `verificarOrdem` aceita `Grid:` prefix com LIMIAR=1 |
| `lib/agentes-do-pregão.ts` | Grid envia OKs direto ao Pregão; grid awareness reduz confiança de agentes |

## 27. ESTRATÉGIA — MICRO-TRADES POR QUANTIDADE (EXCETO ETH)

### 27.1 Conceito

Em redes com gas barato (Polygon, Base, Arbitrum, Arc), o sistema opera micro-trades
com lucro líquido real a partir de $0.002, priorizando **quantidade de trades lucrativos**
em vez de esperar grandes ganhos por posição.

```
ETH mainnet ($1.50 gas) → estratégia conservadora (MIN_PROFIT_REAL=$0.05, MIN_TRADE_SIZE=$5)
Polygon ($0.005-0.08 gas) → micro-trades (MIN_PROFIT_REAL=$0.005, MIN_TRADE_SIZE=$2)
Base ($0.05-0.08 gas) → micro-trades (MIN_PROFIT_REAL=$0.005, MIN_TRADE_SIZE=$2)
Arbitrum ($0.03 gas) → micro-trades (MIN_PROFIT_REAL=$0.005, MIN_TRADE_SIZE=$2)
Arc testnet ($0.006 gas) → micro-trades (MIN_PROFIT_REAL=$0.002, MIN_TRADE_SIZE=$1)
```

### 27.2 Parâmetros Dinâmicos por Rede

```typescript
// agentes-do-pregão.ts:
function getMinTradeSize(network: NetworkKey): number {
  if (network === "ethereum") return 5  // $5 mínimo na ETH mainnet
  return 2  // $2 mínimo nas demais redes
}

function getMinProfitReal(network: NetworkKey): number {
  if (network === "ethereum") return 0.05  // $0.05 lucro mínimo na ETH
  return 0.005  // $0.005 lucro mínimo nas demais (micro-trades)
}

// position-manager.ts:
function getMinProfitUsd(networkKey: NetworkKey): number {
  if (networkKey === "ethereum") return 0.05
  return 0.002  // $0.002 — fecha assim que qualquer lucro líquido surgir
}

// real-swap-executor.ts:
function getMinProfitThreshold(networkKey: NetworkKey): number {
  if (networkKey === "ethereum") return Math.max(0.01, gasCost * 3)
  return Math.max(0.001, gasCost * 1.5)  // margem menor, trades mais frequentes
}
```

### 27.3 Pares por Rede

Cada rede agora prioriza pares diferentes:

| Rede | Pares Prioritários | Estratégia |
|------|--------------------|------------|
| Arc (testnet) | USDC→EURC, EURC→USDC, USDC→cirBTC | Estáveis + aprendizado |
| Polygon (mainnet) | WMATIC→USDC, WETH→USDC, USDC→WMATIC, USDC→WETH | Voláteis primeiro |
| Base (mainnet) | WETH→USDC, USDC→WETH, WBTC→USDC | Voláteis primeiro |
| Arbitrum (mainnet) | ARB→USDC, WETH→USDC, USDC→ARB, USDC→WETH | Voláteis primeiro |
| Ethereum (mainnet) | WETH→USDC, USDC→WETH, WBTC→USDC, USDC→cirBTC, cirBTC→USDC | Conservador (gas alto) |

Em mainnet (exceto ETH), pares voláteis (WETH, WBTC, WMATIC, ARB) são analisados
**antes** de pares stable-stable, garantindo que micro-trades voláteis tenham prioridade.

### 27.4 Fechamento Agressivo (Staircase)

- **Redes não-ETH**: fecha posição assim que lucro líquido ≥ $0.002
- **ETH mainnet**: mantém lógica conservadora ($0.05 de lucro mínimo)
- Stop loss de -15% continua valendo para todas as redes
- Stale force close (30min sem lucro) continua liberando vaga

### 27.5 Fluxo de Micro-Trade

```
1. Agentes detectam oportunidade em par volátil (ex: WMATIC→USDC)
2. Pregão valida: MIN_PROFIT_REAL = $0.005 (não-ETH)
3. Trade mínimo: $2 (não-ETH)
4. Executa swap → abre posição
5. Staircase monitora: assim que lucro ≥ $0.002 → fecha
6. Lucro líquido: $0.002-$0.02 por trade
7. Repete: dezenas de micro-trades por hora
```

### 27.6 Proteções

- **Ethereum excluído** de micro-trades (gas $1.50 inviabiliza)
- Circuit breaker continua ativo em todas as redes
- Staircase nunca fecha no prejuízo (só stop loss de -15%)
- Micro-trades só abrem se saldo + volatilidade compensarem o gas

### 27.7 Auto-Gas (USDC → Native Token)

Quando o native token (POL, ETH, ARC) está baixo na mainnet, o bot automaticamente
swap uma porção de USDC para o wrapped native (WMATIC, WETH) via LI.FI.

```
executeSwap(USDC → WMATIC, $2, polygon):
  1. refreshNativeBalance → POL = $0.02 ❌
  2. ensureGasBalance() é chamada
  3. USDC balance = $10 → swap $1 USDC → WMATIC
  4. refreshNativeBalance → POL = $1.00 ✅ (WMATIC vira POL na stack)
  5. Prossegue com USDC → WMATIC
```

**Regras:**
- Só ativa em mainnet (testnet não tem native token com valor)
- Compra no máximo $5 de native token por vez (10% do USDC disponível)
- Só compra se native < $0.50 e houver pelo menos $0.50 de USDC
- Guard `_refuelingGas` previne recursão (ensureGasBalance → executeSwap → ensureGasBalance)

**Arquivo:** `lib/real-swap-executor.ts` — método `ensureGasBalance()`

### 27.8 Gateway Unificado (CCTP Bridge Automático)

Quando o bot detecta uma oportunidade em uma rede onde o saldo de USDC é insuficiente,
ele automaticamente faz bridge via **Circle CCTP** de outra rede que tenha USDC disponível.

```
antes do swap em Polygon:
  1. realSwap.refreshAllBalances() → saldo USDC = $0.50, precisa de $2.00
  2. ensureStableViaCCTP() é chamada
  3. unifiedBalance.refreshAllBalances() → checa todas as chains
  4. Base tem $10 USDC → CCTP bridge Base→Polygon ($2.00)
  5. refreshAllBalances() → saldo USDC = $2.50 ✅
  6. Executa swap USDC→WMATIC normalmente
```

**Fluxo de Bridge (lib/real-swap-executor.ts:ensureStableViaCCTP):**
- Só ativa se `fromToken` for USDC (CCTP não suporta outras stables)
- Varre todas as chains configuradas (Base, Polygon, Arbitrum, Ethereum, Arc)
- Usa `unified-balance.ts` para consultar saldos on-chain em tempo real
- Cria signer temporário conectado à RPC da source chain via private key
- Chama `CCTPService.initiateTransfer()` (burn → fetch_attestation → mint)
- Após confirmação, atualiza saldos e prossegue com o swap

**Arquivos envolvidos:**
- `lib/real-swap-executor.ts` — `ensureStableViaCCTP()` + chamada em `executeSwap()`
- `lib/cctp.ts` — `CCTPService` com suporte a todas as 5 chains (arbitrum adicionado)
- `lib/unified-balance.ts` — `UnifiedBalanceManager` consulta saldos USDC on-chain
- `lib/caixa.ts` — Gateway browser-only (MetaMask); não usado no bot headless

**Benefício:**
- Capital não fica fragmentado: USDC concentrado em 1-2 chains, movido sob demanda
- Cada micro-trade pode acontecer em QUALQUER chain, independente de onde está o saldo
- Custo do bridge (~$0.02-0.05) é diluído nos micro-trades seguintes
- Preparado para futura integração Circle Gateway (API server-side)

### 27.9 Multi-Chain Scanning

O bot agora escaneia **todas as mainnets simultaneamente** em cada ciclo, analisando pares
de Polygon, Base e Arbitrum ao mesmo tempo. O melhor par (maior consenso entre agentes)
é executado na rede onde a oportunidade foi detectada.

```
Ciclo multi-chain:
  1. quantumWaveTrader.broadcastIntent() → wave com pares de TODAS as redes
  2. Agentes analisam todos os pares em paralelo (Promise.all)
  3. Consenso identifica: "WMATIC→USDC em Polygon" com 3 agentes, 65%
  4. Pregão gera ordem com rede = "polygon"
  5. Corretor: realSwap.switchNetwork("polygon") → CCTP bridge se necessário → auto-gas → swap
  6. Próximo ciclo pode encontrar USDC→WETH na Base, e assim por diante
```

**Mudanças principais:**
- `executarCicloAgentes("all")` escaneia Polygon + Base + Arbitrum (ignora Ethereum por gas alto)
- `agentes-do-pregão.ts`: combina `TRADING_PAIRS` de todas as redes em `multiPairs[]`
- Cada voto de agente carrega `network: pairNet` (rede do par, não rede primária)
- `corretor.ts`: `switchNetwork()` antes de executar se a rede for diferente
- Capital alocado via `unifiedBalance` (saldo USDC consolidado entre chains), com fallback para `realSwap.getBalance()` (wallet balance) quando maior
- Grid trading desativado em modo multi-chain (grid é por rede)

**Arquivos alterados:**
- `lib/agentes-do-pregão.ts` — `executarCicloAgentes()` aceita "all", analisa multi-pairs; wallet balance priority sobre unified balance
- `lib/corretor.ts` — `executar()` alterna rede via `realSwap.switchNetwork()`
- `app/components/PregãoDashboard.tsx` — chama `executarCicloAgentes("all")`

**Benefício:**
- Dezenas de pares voláteis em 3+ chains vs ~5 pares em 1 chain
- Onda quântica capta momentum onde ele é mais forte (cross-chain)
- Capital unificado não fica parado: USDC vai para a chain com melhor oportunidade
- Wallet balance real tem prioridade sobre unified balance (evita sub-alocação quando Circle Kit retorna saldo menor)

### 27.10 RPC Proxy (CORS Bypass)

O Next.js API route `/api/rpc-proxy` atua como intermediário para todas as chamadas RPC
(Polygon, Ethereum, etc.), resolvendo bloqueios de CORS que ocorrem ao chamar RPCs
diretamente do navegador.

```
Browser → /api/rpc-proxy (POST) → RPC externa (polygon-rpc.com, etc.)
  ├── req.body: { rpcUrl: string, body: JsonRpcPayload }
  ├── Timeout: 15s
  └── Erro: retorna 502 com mensagem
```

**Uso em `real-swap-executor.ts`:**
- `_createProxyProvider(rpcUrl)` cria um `ethers.JsonRpcProvider` que roteia todas as chamadas via `/api/rpc-proxy`
- Todo provider criado em `switchNetwork()` ou `refreshAllBalances()` usa o proxy
- Evita CORS sem precisar de extensões de navegador ou configurar proxy reverso

**Arquivos:**
- `app/api/rpc-proxy/route.ts` — endpoint POST que encaminha chamadas RPC
- `lib/real-swap-executor.ts` — `_createProxyProvider()` usa fetch para o proxy em vez de ethers.js direto

### 27.11 LI.FI Quote Proxy (CORS Bypass)

O Next.js API route `/api/lifi/quote` atua como proxy para a API de cotação do LI.FI
(`li.quest/v1/quote`), resolvendo bloqueios de CORS no navegador.

```
Browser → /api/lifi/quote (GET) → li.quest/v1/quote (server-side)
  ├── Query params: fromChain, toChain, fromToken, toToken, fromAmount, fromAddress, slippage, integrator
  ├── Timeout: 15s
  └── Erro: retorna 502/504 com mensagem
```

**Uso em `lifi-executor.ts`:**
- `getQuote()` constrói `URLSearchParams` e faz fetch para `/api/lifi/quote?${searchParams}`
- Todo o rate limiting e backoff permanece no client-side
- Evita CORS sem precisar de extensões de navegador

**Arquivos:**
- `app/api/lifi/quote/route.ts` — endpoint GET que encaminha consultas ao LI.FI
- `lib/lifi-executor.ts` — `getQuote()` usa `/api/lifi/quote` em vez de `https://li.quest/v1/quote`

---

## 28. CHANGELOG

### 22/06/2026 — Bug Fixes, Wallet Balance Priority, RPC Proxy

#### Profit Streak não é mais destruído por compras
- **Problema GRAVE**: `lib/corretor.ts` — ao executar uma compra (stable → volátil), profit era 0 (preço de entrada = preço de saída no mesmo instante). Esse profit=0 era reportado ao `accountant.addReport()`, que trata profit ≤ 0 como loss, decrementando o streak de TODOS os agentes que votaram a favor. Após 6 compras, streaks iam a -6, levando semanas para se recuperar.
- **Fix**: `lib/corretor.ts` — `executar()` detecta `isBuyOpening` (fromToken é stable e toToken é volátil) com `BUY_STABLES.includes(fromToken) && VOLATILE_TOKENS.includes(toToken)`. Se for compra, **não chama** `accountant.addReport()` nem `processarRecompensa()` nem `circuitBreaker.recordTrade()`. Profit só é contabilizado no fechamento da posição (venda).

#### minViableTrade com bypass para micro-trades
- **Problema**: `lib/agentes-do-pregão.ts:1098` — `minViableTrade` usava valor hardcoded `>= 5` (dólares) mesmo em redes de gas barato como Polygon ($0.08 de gas).
- **Fix**: Substituído por `minSizeForCheck = getMinTradeSize(pairNet)` — retorna `$2` em redes não-ETH. Micro-trades de $2+ são viáveis com gas de $0.08 (Polygon).

#### Wallet balance tem prioridade sobre Unified Balance
- **Problema**: `lib/agentes-do-pregão.ts` — em multi-chain mode, capital alocado via `unifiedBalance` (Circle Kit) retornava $6.37 enquanto a wallet real tinha $23.68. Isso sub-alocava capital, impedindo trades maiores.
- **Fix**: `lib/agentes-do-pregão.ts:328` — quando `walletBalance` (via `realSwap.getBalance()`) é MAIOR que `unifiedBalance`, usa o wallet balance. `Math.max(walletBalance, unifiedBalance)`. Documentado em ARCFLOW.md 27.9.

#### RPC Proxy para contornar CORS
- **Novo**: `app/api/rpc-proxy/route.ts` — endpoint POST que recebe `{ rpcUrl, body }`, faz fetch para a RPC externa e retorna o resultado. Timeout de 15s.
- **Novo**: `lib/real-swap-executor.ts` — `_createProxyProvider(rpcUrl)` cria `ethers.JsonRpcProvider` personalizado que roteia chamadas via `/api/rpc-proxy` em vez de chamar a RPC diretamente.
- **Impacto**: Todas as chamadas RPC (balance, gas, etc.) agora passam pelo proxy, eliminando erros de CORS no navegador.

#### refreshAllBalances com RPC fallback chain
- **Modificado**: `lib/real-swap-executor.ts:refreshAllBalances()` — agora cria provider fresco a cada ciclo (`new ethers.JsonRpcProvider(net.rpcUrl)` via proxy), com cascata de RPCs fallback (llamarpc, polygon-rpc, maticvigil) e MetaMask BrowserProvider como último recurso.
- **CCTP bridge**: usa `caixa.getSaldo()` (cache de 10s) em vez de `unifiedBalance` diretamente, garantindo dados frescos.

#### correção automática de entryPrice corrompido
- **Problema**: posições WETH antigas com `entryPrice = $559.87` (preço irreal, WETH real ~$1850). O sistema detectava `profitPercent > 100%` e pulava a venda, deixando a posição presa para sempre.
- **Fix**: `lib/agentes-do-pregão.ts:1236-1243` — quando detecta `profitPercent > 100%` e `amountPaid > 0 && amountBought > 0`, recalcula: `entryPrice = amountPaid / amountBought` (preço real do swap), salva a posição corrigida via `positionManager.savePositions()`, e prossegue com o fluxo normal de fechamento. `position-manager.ts:savePositions()` tornado `public`.

#### LI.FI Quote Proxy (CORS)
- **Novo**: `app/api/lifi/quote/route.ts` — proxy GET para `li.quest/v1/quote`, mesmo padrão do RPC proxy
- **Modificado**: `lib/lifi-executor.ts:getQuote()` — fetch para `/api/lifi/quote` em vez de `https://li.quest/v1/quote`
- **Impacto**: Elimina `TypeError: Failed to fetch` em chamadas LI.FI no navegador

#### Painel de posições no dashboard
- **Novo**: `PregãoDashboard.tsx` — card com 🤖 robô explicativo mostrando posições abertas (token, entry price, profit%) e últimas 5 operações (status, valor, lucro)
- **Novo**: `lib/position-manager.ts:getRecentTrades(n)` — retorna últimas N posições ordenadas por timestamp
- **Dados atualizados a cada 8s via polling do `positionManager`

#### JobRobot (Contratante) — Arc testnet
- **Reescrito**: `lib/job-robot.ts` — agora usa `@circle-fin/app-kit` + `createViemAdapterFromPrivateKey` (sem MetaMask). Ciclo: verifica saldo USDC via ethers → executa swap USDC↔EURC via `kit.swap()`. Retry com 30s backoff, 3 tentativas. Alterna entre USDC→EURC e EURC→USDC a cada ciclo.
- **Reescrito**: `lib/contratante.ts` — gerencia swaps em vez de jobs. Rastreia `swapsExecutados`, `swapsSucesso`, `swapsFalha`, `reports[]` com últimas 10 operações.
- **Novo**: `PregãoDashboard.tsx` — botão Iniciar/Parar visível só na testnet, mostra swaps OK/falhas, últimas 5 operações com status, par, valor.

#### Outros fixes
- **jumper-learn.ts**: consulta artigos via `/api/narrator/learn` (proxy) em vez de fetch direto para `jumper.xyz` (CORS).
- **PregãoDashboard.tsx**: removeu static import de `pregueiro.ts`; usa `PREGUEIROS_DISPLAY` inline (resolve HMR crash).
- **caixa.ts**: cache de 10s em `getSaldo()` — Circle Kit `getBalances()` chamado 12x/min por ciclo; cache reduz para 6x/min sem perda de dados.
- **escriturario.ts**: `switchNetwork()` antes de ler saldos; fallback para unified balance em mainnet também (não só testnet).
- **okAgentes sorted by confidence**: `pregão.ts:160-165` — ordena agentes por confiança decrescente e filtra >= 30% antes de selecionar participantes.

---

### Multi-Chain Scanning (28/06/2026)
- **Novo**: `lib/agentes-do-pregão.ts`: `executarCicloAgentes("all")` escaneia Polygon, Base e Arbitrum simultaneamente; combina `TRADING_PAIRS` em `multiPairs[]` com contexto de rede
- **Novo**: `lib/agentes-do-pregão.ts`: cada voto carrega `network: pairNet` — a rede do par analisado, não da rede primária
- **Novo**: `lib/agentes-do-pregão.ts`: capital alocado via `unifiedBalance` (saldo consolidado entre chains) em vez de `realSwap.getBalance()` (per-chain)
- **Modificado**: `lib/corretor.ts`: `executar()` chama `realSwap.switchNetwork(ordem.rede)` antes de executar, permitindo trades em qualquer chain
- **Modificado**: `app/components/PregãoDashboard.tsx`: ciclo de agentes chama `executarCicloAgentes("all")` em vez de `(redeRef.current)`
- **Grid**: desativado em modo multi-chain (grid trading é por rede, incompatível com scanning cross-chain)
- **Documentado**: ARCFLOW.md seção 27.9 — Multi-Chain Scanning

---

### Auto-Gas: USDC → Native Token
- **Novo**: `lib/real-swap-executor.ts`: método `ensureGasBalance()` — quando native token (POL/ETH/ARB) está abaixo de $0.50, swap automático de 10% do USDC da wallet para o wrapped native (WMATIC/WETH)
- **Novo**: chamado em `executeSwap()` antes do gas check falhar, com guard `_refuelingGas` para evitar recursão
- **Impacto**: trades nunca param por falta de gas; USDC da própria wallet financia as taxas

### Gateway Unificado — CCTP Bridge Automático
- **Novo**: `lib/real-swap-executor.ts`: método `ensureStableViaCCTP()` — quando saldo USDC é insuficiente na chain alvo, busca USDC em outra chain e faz bridge via Circle CCTP
- **Novo**: `lib/real-swap-executor.ts`: `ensureStableViaCCTP` chamado em `executeSwap()` antes do balance check falhar
- **Modificado**: `lib/real-swap-executor.ts`: salva `privateKey` durante `initialize()` para criar signers temporários em outras chains
- **Modificado**: `lib/cctp.ts`: `CCTP_CONFIG` exportado + arbitrum adicionado ao config
- **Integração**: `unified-balance.ts` consulta saldos USDC on-chain em todas as chains para decidir source do bridge
- **Documentado**: ARCFLOW.md seção 27.7 — Gateway Unificado (CCTP Bridge Automático)

### Grid/GridRef removidos do ranking competitivo
- **Problema**: Grid e GridRef são bots de grid trading (operacionais), mas seus votos eram registrados em `historicoVotos` e avaliados em `avaliarVotosPassados`, acumulando scores no accountant. Com scores altos (~76 pts), viravam Top 3 — mas sem votos ativos (grid sem níveis gatilhados), o Top 3 ficava com 0 votos válidos, travando o sistema em fallback com agentes de baixa confiança.
- **Fix**: 
  - `lib/accountant.ts`: novo método `removeAgent()` para limpar reports + scores de um agente específico
  - `lib/agentes-do-pregão.ts`: no início de cada ciclo, Grid/GridRef são removidos do accountant e do `historicoVotos`
  - `lib/agentes-do-pregão.ts`: registro de votos ignora Grid/GridRef (não entram no aprendizado)
  - `lib/agentes-do-pregão.ts`: Top 3 filtra Grid/GridRef do ranking antes de selecionar

### Arc Testnet — balance check antes de gerar ordens
- **Problema**: O else block (linha 968) tratava testnet sem validação — USDC→EURC era executado mesmo com saldo USDC=0, gerando loop infinito de ordens expiradas.
- **Fix**: `lib/agentes-do-pregão.ts`: adicionado balance check com `realSwap.getBalance()` no else block. Se saldo < $0.50, a ordem é bloqueada com log explicativo.

### Grid Adaptativo — nova estratégia
- **Novo**: `lib/grid-trading.ts` reescrito com grid adaptativo:
  - 15 níveis em vez de 3
  - Espaçamento dinâmico baseado na volatilidade do token (VolTracker)
  - Drift suave: centro do grid deriva conforme o preço (12% da distância por ciclo)
  - Red Line: se preço escapa 2.2× o nível externo, grid pula para o novo preço
  - Auto-rebalance: nível executado cria complemento no lado oposto
- **Novo**: `lib/pregão.ts`: `verificarOrdem` aceita `Grid:` prefix com LIMIAR=1 (grid não precisa de 2 OKs)
- **Novo**: `lib/agentes-do-pregão.ts`: grid envia OKs direto ao Pregão, pula pipeline de agentes; grid awareness reduz confiança de agentes em tokens com grid ativo

### Integração Onda Quântica → Grid
- **Novo**: `grid-trading.ts` recebe `setWaveData(wavePairs, network)` — a onda quântica informa o grid sobre momentum
- **Novo**: quando momentum > 0.5 (onda ↑), grid cria níveis extras de VENDA para capturar alta
- **Novo**: quando momentum < -0.5 (onda ↓), grid cria níveis extras de COMPRA para capturar baixa
- **Novo**: `agentes-do-pregão.ts` chama `gridTrader.setWaveData()` após `broadcastIntent()`

### Grid Performance Panel (UI)
- **Novo**: `app/components/grid/GridPerformancePanel.tsx` — painel visível no dashboard
- Exibe: total de trades do grid, lucro bruto, custos (gas+spread), lucro líquido
- Barra de win rate, média por trade, lista dos últimos 10 trades
- Atualiza a cada 5s automaticamente

### Micro-Lucro Garantido
- **Novo**: `spacingMinimoLucrativo(amount, gasCost, spreadPct)` calcula o espaçamento mínimo para cada nível ter `lucro líquido ≥ $0.001` após custos
- **Novo**: grid aplica `Math.max(getSpacing(vol), spacingMinimoLucrativo(...))` em init() e recenter()
- Cada nível do grid garante: `grossEst - gasEst - spreadEst ≥ $0.001`

### Fluxo Sincronizado (sem conflitos)
- **Dedup grid sell**: grid não envia venda se já há ordem de venda ativa no pregão para o mesmo token
- **Dedup agent sell**: agente não envia venda se grid já está vendendo
- **Grid buy**: verifica max positions (mesmo cálculo do pipeline de agentes)
- **Grid sell**: verifica se posição existe e se não há venda pendente

### Agentes Especializados por Par
- **Novo**: `agentes-do-pregão.ts` — cada robô agora analisa **apenas seus pares designados** no mapeamento `AGENTE_PARES`
- **Novo**: `agentAssigned(agentName, pairLabel)` — filtra quais agentes votam em cada par
- Synthesis é meta-agente designado a **todos os pares** (`[]` = ilimitado)
- Log atualizado: `"🔍 Analisando USDC→WETH — Quantum, Technical, TrendFollower..."`
- Cada par tem de 2 a 7 especialistas dedicados (antes eram todos os 13 agentes em todo par)

### 23/06/2026 — Escola de Robôs, JobRobot, Callbacks Multi-Listener

#### Novo: Escola de Robôs + Professor + PairSector
- **Novo**: `lib/escola-robos.ts` — sistema completo de educação de robôs:
  - Turnos de 10min: top 3 robôs por pontuação ficam ativos e têm ordens aceitas sem consenso
  - Verificação: robô precisa completar 3 jobs na Arc testnet para ser verificado
  - Promoção: 50+ palpites, 60%+ acerto, 500+ pontos → status "promovido"
  - Rebaixamento: promovido com <50% nas últimas 20 avaliações → volta a aprendiz
  - `registrarJob()` — registra prova on-chain (deploy JobProof contract) como requisito para verificação
- **Novo**: `lib/professor.ts` — avalia palpites dos robôs:
  - A cada 5min, busca preço atual e compara com palpite
  - Acertou: `+confiança * 0.3` pts; Errou: `-confiança * 0.3` pts
  - Ajuste automático de parâmetros: acertos consecutivos afrouxam thresholds, erros consecutivos endurecem
  - Gera feedback textual personalizado por nível de confiança
  - Overload de `getPairSectorReport(rede?)` para performance por par
- **Novo**: `lib/pair-sector.ts` — centraliza avaliações de pares:
  - `registrarAvaliacao()` — cada voto de agente vira uma avaliação com par, rede, robô, direção
  - `getPerformancePorPar(rede)` — taxa de acerto por par, melhores robôs em cada par
  - Usado pelo PregãoDashboard para exibir "Setor de Pares"
- **Novo**: `lib/parametros-robos.ts` — parâmetros ajustáveis individualmente por robô:
  - `confiancaMinima` (default 30), `thresholdEntrada` (default 0.005), `thresholdSpread`, `thresholdLiquidez`, `thresholdProbabilidade`, `rsiCompra`, `rsiVenda`
  - Agentes consultam `parametrosRobos.get(nome)` em vez de hardcoded
  - `MomentumTrader`: usa `thresholdEntrada` em vez de hardcoded
  - `NVIDIAgent`: usa `thresholdProbabilidade` em vez de hardcoded `> 10`
  - `Synthesis`: usa `confiancaMinima` em vez de hardcoded `>= 30`
  - Persiste em `arcflow_parametros_robos`

#### Novo: JobRobot + Contratante com Fallback JobProof
- **Reescrito**: `lib/job-robot.ts` — swap autônomo na Arc testnet:
  - `_swapWithTimeout()` — executa swap com timeout de 30s (Promise.race)
  - `deployJobProof(robotName, jobNumber)` — deploy do contrato `JobProof` na Arc como prova on-chain quando swap falha
  - `executeSwap(amount, robotName)` — retry 3x com 10s backoff; se falhar, deploy do JobProof como fallback
  - Ciclo alterna USDC→EURC / EURC→USDC
  - `getKitKey()` — lê kit key do localStorage
- **Modificado**: `lib/contratante.ts`:
  - Guard `_executando` contra overlap de ciclos
  - Registra jobs como prova para robôs em turno ativo via `escolaRobos.registrarJob()`
  - Notifica `narrador.jobConcluido()` a cada swap bem-sucedido
  - Retorna `contractAddress` no swap report quando deploy de JobProof é usado
- **Novo**: `lib/contracts.ts` — `JOB_PROOF_BYTECODE` + `JOB_PROOF_ABI` para deploy do contrato JobProof
- **Novo**: `contracts/JobProof.sol` — contrato Solidity que registra robotName + jobNumber + deployer + timestamp

#### Callbacks Refatorados: Single → Multi-Listener
- **Modificado**: `caixa.ts`, `corretor.ts`, `escriturario.ts`, `pregão.ts`, `position-manager.ts`, `real-automated-trader.ts`
- Callbacks `onLog`/`onTrade`/`onOrdem`/`onClose`/`onCashBoxChange` agora suportam múltiplos listeners
- Retornam função de cleanup (`return () => { ... filter(c !== cb) }`)
- Evita perda de callbacks quando múltiplos componentes subscribem ao mesmo evento

#### Fix: Blindagem de Votos BUY+SELL
- **Corrigido**: `lib/agentes-do-pregão.ts` — blindagem agora verifica **exato mesmo par** (USDC→WMATIC BUY + USDC→WMATIC SELL), não mais pares invertidos (BUY USDC→WMATIC + SELL WMATIC→USDC são complementares, não conflito)
- Log atualizado: `"votaram BUY+SELL no exato par"`

#### Fix: LI.FI Quote — toAmount via estimate.toAmount
- **Corrigido**: `lib/lifi-executor.ts` — LI.FI v1 coloca `toAmount` em `estimate.toAmount`, não no top-level
- `rawToAmount = data.estimate?.toAmount ?? data.toAmount ?? params.fromAmount`
- Rota "fly" com `rawToAmount === "0"` usa `params.fromAmount` como fallback

#### Fix: Position Manager — Preço Irreal Ignorado
- **Corrigido**: `lib/position-manager.ts` — `checkStaircase()`:
  - Verifica se preço é irreal: `profitPercent < -99 && entryPrice > 0.01` → retorna "hold"
  - `closePosition()`: valida se preços são coerentes (`Math.abs(closePrice - entryPrice) / Math.max(closePrice, entryPrice) < 0.999`), senão zera profit para evitar lucro fantasma
  - `fetchTokenPrice()`: fallback usa `entryPrice` de posição aberta quando coinId não existe

#### Fix: MIN_LUCRO_LIQUIDO_USD = $0.02 (Fixo)
- **Corrigido**: `lib/position-manager.ts` — removeu `getMinProfitUsd()` dinâmico por rede
- `MIN_LUCRO_LIQUIDO_USD = 0.02` fixo para todas as redes
- Só fecha posição se lucro líquido (descontado gas + spread) >= $0.02

#### Fix: minVolatileTrade Reduzido
- **Corrigido**: `lib/real-swap-executor.ts` — `minVolatileTrade` para Polygon/Base/Arb: `$0.10` (antes `$20`)
- ETH mainnet continua `$50`, testnet `$1`

#### Fix: Compra (stable→volátil) não conta como trade na sessão
- **Corrigido**: `lib/pregão.ts` — `atualizarOrdem()`: quando `isBuyOpening` true, não incrementa `sessionStats.trades/wins/losses/profit`
- Apenas vendas (volátil→stable) contam para estatísticas da sessão

#### Fix: okAgentes ordenados por confiança
- **Corrigido**: `lib/pregão.ts` — `verificarOrdem()` ordena OKs de agentes por confiança decrescente e filtra >= 30%
- Garante que os agentes mais confiantes sejam selecionados para a ordem

#### TOKEN_DECIMALS constante
- **Novo**: `lib/real-swap-executor.ts` — `TOKEN_DECIMALS` mapa com decimais conhecidos por token
- Fallback quando `tokenBalances` não carregou: `TOKEN_DECIMALS[pair.from] ?? 6`
- Usado em `swapPair()` e `executeSwap()` para evitar decimais incorretos

### Estado atual (23/06/2026)
- **Polygon Mainnet**: ativo — 25 trades executados, $116.95 bruto / ~$18.77 líquido
- **Escola de Robôs**: ativa na Arc testnet — robôs aprendem com palpites, turnos de 10min, Professor avalia a cada 5min
- **JobRobot (Contratante)**: rodando na Arc testnet — swaps USDC/EURC com retry 3x + deploy JobProof como fallback
- **RPC Proxy**: implementado — todas as RPCs via `/api/rpc-proxy` (CORS bypass)
- **LI.FI Quote Proxy**: `/api/lifi/quote` — CORS resolvido
- **Wallet balance priority**: wallet real tem prioridade sobre unified balance (Circle Kit)
- **CCTP Bridge V2**: atualizado para V2 — endereços corretos (TokenMessenger `0x28b5a0e9C...` mainnet, `0x8FE6B999...` testnet), MessageTransmitter (`0x81D40F21...` mainnet, `0xE737e5c...` testnet), ABI com `maxFee`/`minFinalityThreshold`, domainId Arc=26, attestation API V2 (`/v2/messages/{hash}/attestation`)
- **Grid Trading**: disponível em modo single-chain; desativado em multi-chain
- **PARÂMETROS AJUSTÁVEIS**: cada robô tem thresholds individuais (professor.ts + parametros-robos.ts)
- **CALLBACKS MULTI-LISTENER**: subscribe/cleanup pattern em todos os eventos do sistema
- **micro-trade optimization (23/06)**: GAS_UNITS_SWAP 500k→200k, GAS_COST_ESTIMATE realistas (Polygon $0.005, Base $0.003, Arb $0.02), feeMonetization removido, MIN_LUCRO_LIQUIDO $0.02→$0.01, getMinProfitReal $0.005→$0.002, MIN_PROFIT_HOLD_MS 60s→30s, getMinProfitThreshold gas*1.5→gas*1.2

---

## 27. ESCOLA DE ROBÔS — SISTEMA DE EDUCAÇÃO E PROMOÇÃO

### 27.1 Visão Geral

Sistema de escola/avaliação onde os robôs aprendem analisando pares de TODAS as redes simultaneamente na Arc Testnet, recebem notas de um "Professor", acumulam pontos, e quando atingem nota suficiente são promovidos a robôs autorizados — cujas decisões o Pregão aceita sem questionar, apenas verificando viabilidade na rede alvo.

```
Arc Testnet
│
├── Robôs analisam pares de TODAS as redes (polygon, base, ethereum...)
│   usando dados quânticos da Arc como ambiente de simulação
│
├── Cada voto → Professor registra como palpite com preço atual
│
├── 5 minutos depois → Professor busca preço real da rede alvo
│   ├── Acertou → +pontos + feedback positivo
│   └── Errou   → -pontos + sugestão de melhoria
│
├── Robô com 50+ palpites, 60%+ acerto, 500+ pontos → PROMOVIDO
│
└── Robô promovido → Pregão aceita ordem direta sem segundo agente
    └── Pregão só verifica: tem saldo? gas comporta? spread viável?
        └── Sim → executa imediatamente (trade mais rápido e certeiro)
```

### 27.2 Módulos

| Arquivo | Função |
|---------|--------|
| `lib/professor.ts` | Classe Professor: registra palpites, avalia a cada 5 min, gera feedback, persiste em `arcflow_professor_palpites` |
| `lib/escola-robos.ts` | Gerencia pontuação, promoção, rebaixamento. Persiste em `arcflow_escola` + `arcflow_escola_ultimas` |
| `lib/pair-sector.ts` | Setor de pares avaliados — centraliza avaliações por rede, calcula performance por par, consultado pelo PregãoDashboard |

### 27.3 Interface PalpiteRobo

```typescript
{
  roboNome: string
  rede: string
  par: string
  fromToken: string
  toToken: string
  direcao: "buy" | "sell"
  confianca: number
  precoNoPalpite: number
  timestamp: number
}
```

### 27.4 Regras de Pontuação

- **Acerto com movimento relevante (>0.1%)**: `+pontos = confianca * 0.3` (mínimo 1)
- **Erro**: `-pontos = confianca * 0.3` (mínimo 1, mais confiante = mais penalidade)
- **Acerto com alta confiança (>70%)**: "Continue nesta direção — seu modelo de momentum está calibrado"
- **Acerto com baixa confiança (<40%)**: "Acertou mas estava inseguro — confie mais nos sinais fortes"
- **Erro com alta confiança (>70%)**: "Estava muito confiante e errou — revise o threshold de entrada"
- **Erro com baixa confiança (<40%)**: "Erro esperado — continue explorando este par"

### 27.5 Critérios de Promoção

| Critério | Mínimo |
|----------|--------|
| Palpites avaliados | 50 |
| Taxa de acerto | >= 60% |
| Pontos | >= 500 |

### 27.6 Critérios de Rebaixamento

- Se promovido e taxa de acerto cair abaixo de 50% nas últimas 20 avaliações → volta a aprendiz

### 27.7 Modificações no Código

| Arquivo | O que mudou |
|---------|-------------|
| `lib/agentes-do-pregão.ts` | Import `professor` + `parametrosRobos`. No `isArc` block, registra palpite cada voto de agente. `professor.avaliarPalpites()` a cada ciclo. Agentes consultam `parametrosRobos.get(nome)` para thresholds ajustáveis. |
| `lib/pregão.ts` | Import `escolaRobos`. Em `verificarOrdem`, checa `isOnShift` — robô em turno ativo bypassa consenso. Método `verificarShiftRotacao()` delegado ao `escolaRobos`. |
| `lib/pregão.ts` (interface `OkSignal`) | Campos opcionais `direcao` e `precoNoPalpite`. |
| `app/components/PregãoDashboard.tsx` | Seção "📚 Escola de Robôs" com turno atual, robôs em turno destacados, barra de progresso, último feedback. `pregão.verificarShiftRotacao()` no polling. |
| `app/components/PregãoDashboard.tsx` | Seção "📊 Setor de Pares" exibe `professor.getPairSectorReport(rede)` com performance por par (acertos, taxa, melhores robôs). Importa `pairSector` + `professor`. |

### 27.8 Fluxo de Rotação (Turnos de 10 min)

1. **Pregão** pergunta ao **Professor**: "quais os 3 melhores robôs agora?"
2. **Professor** seleciona top 3 por pontuação positiva → ativos por 10 min
3. Durante o turno: ordens desses robôs são aceitas **sem consenso**
4. Após 10 min: **Pregão** pede nova rotação → Professor seleciona os próximos 3
5. Robôs podem repetir turno se continuarem com boa pontuação

### 27.9 Ajuste Automático de Parâmetros

O Professor ajusta automaticamente os parâmetros dos robôs com base no desempenho:

| Situação | Ajuste |
|----------|--------|
| 5+ acertos consecutivos | `confiancaMinima -3`, `thresholdEntrada -0.0005` (mais permissivo) |
| Erro confiante isolado (>70%) | `confiancaMinima +5` (mais seletivo) |
| 2+ erros confiantes em série | `thresholdEntrada ×2`, `confiancaMinima +8` (endurece entrada) |
| 3+ erros consecutivos | `confiancaMinima +5`, `thresholdEntrada +0.002` |

Parâmetros ajustáveis por robô em `lib/parametros-robos.ts`:
- `confiancaMinima` (default 30) — confiança mínima para votar
- `thresholdEntrada` (default 0.005) — momentum/amplitude mínimo
- `thresholdSpread` (default 0.001) — spread mínimo
- `thresholdLiquidez` (default 0.1) — liquidez mínima
- `thresholdProbabilidade` (default 10) — probabilidade mínima (NVIDIAgent)
- `rsiCompra` (default 35) / `rsiVenda` (default 65) — thresholds RSI

### 27.10 Persistência

| Chave | Conteúdo |
|-------|----------|
| `arcflow_escola` | Dados de todos os robôs (pontos, histórico) |
| `arcflow_escola_shift` | Estado do turno atual (robôs ativos, expiração, número do turno) |
| `arcflow_escola_ultimas` | Últimas 20 avaliações por robô |
| `arcflow_professor_palpites` | Palpites pendentes e avaliados |
| `arcflow_parametros_robos` | Parâmetros ajustados por robô |


---

## 28. CHANGELOG — 24/06/2026 (Sessão 2)

### 28.1 cirBTC Ethereum Mainnet (Live desde 08/06/2026)

cirBTC (Circle Wrapped Bitcoin) agora integrado como token real no Ethereum mainnet:

| Item | Antes | Depois |
|------|-------|--------|
| Endereço Ethereum | Não existia | `0x72DFB2E44f59C5AD2bAFE84314E5b99a7cd5075E` |
| Endereço Arc testnet | `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` | Mantido (testnet) |
| Trading pairs Ethereum | Sem cirBTC | USDC→cirBTC, cirBTC→USDC, EURC→cirBTC, cirBTC→EURC |
| VALID_TOKENS (pair-sector) | Sem cirBTC/mcirBTC | Adicionado |
| COIN_IDS (professor/volatility/position/etc) | Sem cirBTC | Adicionado `cirBTC → "bitcoin"` |
| DEX routing Ethereum | Não existia | Uniswap V2 `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` |
| UI (networks.ts) | Sem cirBTC/WBTC/EURC no ETH | Adicionado |

### 28.2 Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `real-swap-executor.ts` | Add cirBTC `0x72DFB2E44f59C5AD2bAFE84314E5b99a7cd5075E` ao Ethereum tokens + 4 trading pairs ETH |
| `networks.ts` | Add cirBTC, WBTC, EURC ao Ethereum mainnet |
| `direct-dex.ts` | Add Uniswap V2 router Ethereum |
| `pair-sector.ts` | Add cirBTC/mcirBTC ao VALID_TOKENS |
| `professor.ts` | Add `cirBTC: "bitcoin"` ao COIN_IDS, removido comentário "testnet" |
| `volatility-tracker.ts` | Add `cirBTC/mcirBTC: "bitcoin"` ao COIN_IDS |
| `position-manager.ts` | Add `cirBTC: "bitcoin"` em fetchTokenPrice + fetchTokenChange24h |
| `agentes-do-pregão.ts` | Add `cirBTC: "bitcoin"` em getTokenPrice + filtro de agente |
| `escriturario.ts` | Add `cirBTC: "bitcoin"` em fetchTokenPrice |
| `corretor.ts` | Add `cirBTC: "bitcoin"` em buscarPreco |
| `pregão.ts` | Refatorado: `_quoteWithTimeout()`, `_quoteTrade()`, quoting paralelo, threshold progressivo, 3-strike rule |
| `AGENTS.md` | Session summary atualizado |

### 28.3 Renomeação do Projeto

| Onde | Antes | Depois |
|------|-------|--------|
| GitHub | `Silvinhojm/criptomorse-arc` | `Silvinhojm/criptomorse` |
| `package.json` | `arcflow` | `criptomorse` |
| `vercel.json` | Não existia | Criado com `name: "criptomorse"` |
| `README.md` | Template Next.js | Título "Criptomorse" |

### 28.4 Próximos Passos

- [ ] Adicionar Ethereum Sepolia testnet para testes de cirBTC sem custo
- [ ] Verificar se o ciclo gera pacotes com cirBTC no log: "[PROFESSOR] 📦 Pacote gerado..."
- [ ] Testar swap real USDC→cirBTC no Ethereum mainnet (gas ~$1.50)
- [ ] Escalar capital inicial para $50-100 para tornar gas irrelevante no Ethereum

---

## 29. CHANGELOG — 24/06/2026 (Terceira sessão: Migração CoinGecko → SoSoValue)

### 29.1 SoSoValue Price Agent
- **Novo**: `lib/sosovalue-price-agent.ts` — agente de preços usando a API oficial da SoSoValue (`openapi.sosovalue.com/openapi/v1`). Cache de 15s, rate limiting de 3s entre chamadas, currency IDs numéricos mapeados do endpoint `/currencies`.
- **Modificado**: `app/api/price/route.ts` — backend trocado de CoinGecko (`api.coingecko.com/api/v3/simple/price`) para SoSoValue (`/currencies/{id}/market-snapshot`). Mesmo contrato de API (`?ids=...` → `{ prices, change24h }`).
- **Modificado**: `app/api/market-data/route.ts` — removidas as chamadas CoinGecko (news, global). Mantido apenas alternative.me (fear/greed) + cryptocompare (news).

### 29.2 COIN_IDS Migrados
- **10 arquivos** migrados de slugs CoinGecko (`"ethereum"`, `"bitcoin"`) para currency IDs numéricos SoSoValue (`"1673723677362319867"`, `"1673723677362319866"`): `pair-price-feed.ts`, `volatility-tracker.ts`, `professor.ts`, `real-swap-executor.ts`, `position-manager.ts`, `agentes-do-pregão.ts`, `corretor.ts`, `escriturario.ts`, `trading-nanopayments.ts`, `gas-price-oracle.ts`.
- `cirBTC`/`mcirBTC` mapeados para currency_id do BTC (`"1673723677362319866"`), já que não estão listados na SoSoValue.

### 29.3 Agentes Deprecitados
- `coingecko-agent.ts` e `coinmarketcap-agent.ts` — código original removido, agora redirecionam para `sosovalue-price-agent.ts` (compatibilidade mantida).

### 29.4 API Key
- `SOSO_API_KEY` adicionada ao `.env.local`. Chave gratuita (20 req/min, demo plan).

### 29.5 Estado Atual
- Preços agora via SoSoValue API em vez de CoinGecko.
- Rate limit: 20 req/min (demo plan). Cache de 15s + spacing de 3s entre chamadas.
- Chave: `SOSO-2ca874f7857946529d23c707520dcd17` (válida, testada — BTC $59,538).
- Build compila sem novos erros (4 erros TS pré-existentes não relacionados).

---

## 30. CHANGELOG — 25/06/2026 (Quarta sessão: Ethereum Sepolia testnet)

### 30.1 Sepolia Network

| Item | Detalhe |
|------|---------|
| ChainId | 11155111 |
| RPC | `https://rpc.sepolia.org` |
| Explorer | `https://sepolia.etherscan.io` |
| Native | SepoliaETH (testnet) |
| USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (Circle test) |
| WETH | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` |
| Trading pairs | USDC→WETH, WETH→USDC |
| Gas estimate | $0.006/tx |

### 30.2 Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `lib/real-swap-executor.ts` | Add `sepolia` em NETWORKS, GAS_COST_ESTIMATE, TRADING_PAIRS, UB_CHAIN, BACKUP_RPCS |
| `lib/networks.ts` | Add Sepolia ao SUPPORTED_NETWORKS (LI.FI chainId 11155111) |
| `lib/gas-price-oracle.ts` | Add sepolia ao GAS_COST_ESTIMATE |
| `lib/caixa.ts` | Add `Ethereum_Sepolia` ao UB_CHAIN |
| `lib/grid-trading.ts` | Add sepolia ao GAS_ESTIMATE_GRID |
| `app/page.tsx` | Add SEPOLIA_TESTNET config, NETWORK_KEY_MAP, CHAIN_TO_KEY, handleNetworkKeyChange, getPortfolioTokens |
| `app/components/layout/Header.tsx` | Add botão 🧪 Sepolia no seletor de rede |
| `package.json` | Add script `dev:sepolia` (porta 3003) |
| `AGENTS.md` | Session summary atualizado |

### 30.3 Comando
```bash
npm run dev:sepolia  # Sepolia testnet (porta 3003)
```

---

## 31. CHANGELOG — 25/06/2026 (Quinta sessão: Pipeline 10× mais rápido)

### 31.1 Gargalos Identificados e Corrigidos

| # | Gargalo | Antes | Depois | Técnica |
|---|---------|-------|--------|---------|
| 1 | Avaliação de agentes sequencial | 30–60s | 3–5s | `Promise.all` com 11 agentes simultâneos |
| 2 | Preço por token individual | N chamadas HTTP | 1 chamada em lote | `fetchPricesBatch()` via `/api/price?ids=a,b,c` |
| 3 | Cache de preço ausente | 5+ fetches/par | 1 fetch compartilhado | `getTokenPrice()` com cache 15s TTL + pré-carregamento |
| 4 | Swap prep sequencial | 15–25s/batch | ~3–5s | DEX + LI.FI quotes em paralelo entre todos os swaps |
| 5 | Allowance checks sequenciais | 1–2.5s | ~0.3s | `Promise.all` em todas as chamadas `token.allowance()` |
| 6 | Import dinâmico `positionManager` | 0.1–0.4s/pkg | 0s | Import estático no topo do arquivo |

### 31.2 Ganho Total

- **Pipeline completo**: **~85s → ~8s** (~10× mais rápido)
  - Ciclo de agentes: ~60s → ~5s
  - Execução de batch: ~25s → ~3s

### 31.3 Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `lib/agentes-do-pregão.ts` | Avaliação paralela dos 11 agentes; `fetchPricesBatch()`; `getTokenPrice()` com cache 15s |
| `lib/professor.ts` | `fetchPricesBatch()` em vez de `getTokenPrice()` individual |
| `lib/corretor.ts` | Swap preparation loop convertido para `Promise.all` |
| `lib/ultraflash.ts` | Allowance checks paralelos via `Promise.all` |
| `lib/pregão.ts` | `import("./position-manager")` → `import { positionManager }` estático |

### 31.4 Commits

```
e0b7c0a fix: 3 gargalos de velocidade no pipeline de pacotes
9846d10 perf: parallel swap prep + allowance checks + static imports
```

---

## 32. AJUSTES DE ESTRATÉGIA (Sessão 26/06/2026)

Análise profunda via DeepSeek V4-Pro identificou e corrigiu 5 áreas críticas do sistema de trading.

### 32.1 Streak EWMA — Decaimento Exponencial (accountant.ts)

**Antes**: `streak = Math.max(streak + 1, 1)` / `Math.min(streak - 1, -1)` — salto linear.
Agente com 5 acertos seguidos (streak=5) perdia tudo com 1 erro (streak=-1).

**Depois**: EWMA com α=0.3:
```
acerto → streak = streak * 0.7 + 5 * 0.3   // converge pra +5
erro   → streak = streak * 0.7 + (-5) * 0.3  // converge pra -5
```
Após 5 acertos (streak≈4.2) + 1 erro → streak≈2.6 (não zera). Transições suaves.

### 32.2 MIN_LUCRO_LIQUIDO por Rede (position-manager.ts)

**Antes**: `MIN_LUCRO_LIQUIDO_USD = 0.01` fixo para todas as redes.

**Depois**: Mapa por rede via `getMinProfitUsd(networkKey)`:
```
polygon: $0.02  |  base: $0.03  |  arbitrum: $0.05
ethereum: $0.50  |  arc: $0.001  |  sepolia: $0.02
```
Staircase só fecha se `lucroBruto - gas - spread ≥ getMinProfitUsd(rede)`.
Ethereum exige $0.50 líquido (cobre $1.50 gas + spread).

### 32.3 Groupthink Detection (agentes-do-pregão.ts)

Quando **8+ agentes** votam no mesmo par simultaneamente:
- Confiança de todos os votos naquele par é reduzida em **30%**
- Log: `"🧠 Groupthink detectado: X agentes no mesmo par — confiança reduzida em 30%"`
- Previne manada onde agentes copiam votos alheios

### 32.4 Slippage Dinâmico (real-swap-executor.ts)

Funções `getDynamicSlippageBps(token)` e `getDynamicSlippage(token)`:

| Token | DEX (slippageBps) | LI.FI (slippage) |
|-------|-------------------|-------------------|
| Stable (USDC, EURC, etc.) | 30 bps (0.3%) | 0.003 (0.3%) |
| Volátil (WETH, WMATIC, etc.) | 100 bps (1%) | 0.005 (0.5%) |

Antes: 100 bps / 0.5% fixo para tudo. Stables agora têm slippage mais justo.

### 32.5 getMinTradeSize por Custo de Gas (agentes-do-pregão.ts)

**Antes**: valores hardcoded (Ethereum=$50, Polygon=$6.50, Base/Arb=$2).

**Depois**: usa `GAS_COST_ESTIMATE[network]` como base:
```
ethereum: max(50, gasCost * 33)   // gas=$1.50 → min=$50
polygon:  max(2, gasCost * 100)   // gas=$0.005 → min=$2
base/arb: max(2, gasCost * 50)    // gas=$0.03 → min=$2
```
Trade mínimo escala automaticamente com custo operacional da rede.

### 32.6 Score com Peso do Lucro Real (accountant.ts)

**Antes**: `score = winRate*0.6 + avgProfit*30 + streak*1`. Lucro total ignorado.

**Depois**:
```
profitBonus = min(max(0, totalProfit), 5) * 4   // cap $5 → max 20pts
score = winRate*0.5 + avgProfit*20 + profitBonus + max(0, streak)*0.5
```
Agentes que geram $0 de lucro total não dominam o ranking só por terem winRate alta.

### 32.7 Consolidação COIN_IDS (coin-ids.ts)

Extraído `COIN_IDS` de 6 arquivos duplicados para `lib/coin-ids.ts` unificado.
Atualizados: `real-swap-executor.ts`, `pair-price-feed.ts`, `volatility-tracker.ts`,
`professor.ts`, `agentes-do-pregão.ts`, `corretor.ts`, `escriturario.ts`,
`trading-nanopayments.ts`, `position-manager.ts`.

Adicionar token agora requer **1 edição** (em vez de 9 arquivos).

### 32.8 Arquivos Modificados

| Arquivo | Mudanças |
|---------|----------|
| `lib/accountant.ts` | Streak EWMA (F1), Score com lucro real (F6) |
| `lib/position-manager.ts` | `getMinProfitUsd()` por rede (F2) |
| `lib/agentes-do-pregão.ts` | Groupthink detection (F3), `getMinTradeSize` por gas (F5), filtro de tendência corrigido, try/finally monkey-patch, `rebalancePool` fora do loop, `COIN_IDS` unificado, `body.prices` sanitizado |
| `lib/real-swap-executor.ts` | Slippage dinâmico (F4), `COIN_IDS` unificado, `body.prices` sanitizado |
| `lib/coin-ids.ts` | **NOVO** — mapeamento único token→SoSoValue currency_id |
| `lib/pair-price-feed.ts` | `COIN_IDS` → import de coin-ids |
| `lib/volatility-tracker.ts` | `COIN_IDS` → import de coin-ids |
| `lib/professor.ts` | `COIN_IDS` → import de coin-ids |
| `lib/corretor.ts` | `COIN_IDS` → import de coin-ids, `body.prices` sanitizado |
| `lib/escriturario.ts` | `COIN_IDS` → import de coin-ids, `body.prices` sanitizado |
| `lib/trading-nanopayments.ts` | `COIN_IDS` → import de coin-ids |
| `lib/persistence.ts` | Guard `typeof window` para SSR safety |
| `lib/batch-executor.ts` | `setInterval` armazena timer ID |
| `app/page.tsx` | `_chainChangedListener` usa `eth_accounts`, ERC-8183 removido de non-Arc |
| `app/api/stress-test/route.ts` | `body.privateKey` removido (security) |