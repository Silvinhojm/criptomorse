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
  └── lib/                    ← Núcleo do sistema (66 módulos)
       ├── SISTEMA PRINCIPAL
       │   ├── real-swap-executor.ts     ← Executor de swaps (LI.FI + direto)
       │   ├── automated-trader.ts       ← Trading automático clássico
       │   ├── real-automated-trader.ts  ← Trading automático real
       │   ├── arc-micro-trader.ts       ← Micro-trades na Arc
       │   └── lifi-executor.ts          ← Integração LI.FI
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
       │   └── caixa.ts                  ← Gestão de saldo
       │
       ├── INTELIGÊNCIA (aprendizado)
       │   ├── pair-price-feed.ts        ← Preço real por par (compartilhado)
       │   ├── volatility-tracker.ts     ← Aprende volatilidade de cada token
       │   └── position-manager.ts       ← Gerencia posições + staircase
       │
        ├── SUPORTE
        │   ├── persistence.ts            ← localStorage
        │   ├── circuit-breaker.ts        ← Parada de emergência
        │   ├── fee-monetization.ts       ← Taxas
        │   ├── gas-price-oracle.ts       ← Preço do gás
        │   ├── provao-ranking.ts         ← Sistema de competição (provão, bônus, poder de voto)
        │   └── networks.ts / real-swap-executor.ts ← Config de redes
       │
       └── AGENTES DE MERCADO (dados)
           ├── coingecko-agent.ts
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
│    ├── ⚠️ Máximo de 3 posições simultâneas (MAX_POSITIONS=3)      │
│    ├── Pregão calcula valor dinâmico: saldo/vagasRestantes        │
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

STALE_NO_PROFIT_MS = 4 * 60 * 60 * 1000
// 4h sem lucro — NÃO fecha mais (só loga aviso). Espera mercado virar.

MAX_LOSS_PERCENT = -15
// Stop loss máximo: se perda passar de 15%, fecha imediatamente

dropSteps = 2
// Quantos degraus abaixo do pico antes de fechar
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

### 4.3 Trading Pairs (real-swap-executor.ts)

```typescript
// Cada rede tem seus pares disponíveis:
// ARC:    USDC→EURC, EURC→USDC, USDC→cirBTC, cirBTC→USDC, etc.
// BASE:   USDC→EURC, USDC→WETH, WETH→USDC, USDC→WBTC, WBTC→USDC, etc.
// POLYGON: USDC→USDT, USDT→USDC, USDC→WMATIC, WMATIC→USDC,
//          USDC→WETH, WETH→USDC, USDC→DAI, DAI→USDC
// ETH:    USDC→WETH, WETH→USDC, USDC→WBTC, WBTC→USDC, etc.
// ARB:    USDC→WETH, WETH→USDC, USDC→ARB, ARB→USDC, etc.
```

### 4.4 Config de Rede + Gas Oracle (real-swap-executor.ts + gas-price-oracle.ts)

```typescript
GAS_COST_ESTIMATE: {
  arc:      0.006,  // ~$0.006 por tx na Arc Testnet
  base:     0.05,
  polygon:  0.08,
  ethereum: 1.50,
  arbitrum: 0.03,
}

// Gas real da RPC (gas-price-oracle.ts):
// getGasCost(network) → provider.getFeeData() → gwei → USD
// Fallback para GAS_COST_ESTIMATE se RPC falhar
// Cache de 30s

// Usado por agentes (agentes-do-pregão.ts):
// - Venda: profitUSD >= gasCost × 3
// - Compra mainnet: aborta se gasCost > 50% do trade
```

### 4.5 Pregão (pregão.ts + agentes-do-pregão.ts)

```typescript
LIMIAR_OK = 2      // Quantos OKs para gerar uma ordem (agentes, antes 3 para pregueiros)
JANELA_MS = 30000  // 30s — OKs expiram após este tempo
ORDEM_TIMEOUT_MS = 120000  // 2min — ordem "preparando"/"pronto"/"executando" expira

// Agentes usam Top 3 (accountant ranking): 2 dos Top 3 = ordem
// Fallback: qualquer 2+ agentes no mesmo par

// Alocação de valor por trade (agentes-do-pregão.ts):
// amountUsd = (saldoEfetivo * 0.9) / vagas, depois:
//   Ajuste por volatilidade (volMult < 1.0 reduz o valor)

// Na execução, valida se vale a pena:
//   retornoEsperado = (confiancaMedia / 100) * (volatilidade24h / 100)
//   tradeMinimo = (MIN_PROFIT_REAL + gasCost) / max(0.001, retornoEsperado - spreadPct)
//   Só executa se valorFinal >= tradeMinimo (garante $0.05 de lucro real)
MIN_PROFIT_REAL = 0.05  // Lucro mínimo real desejado por trade (USD)
TRADE_SPREAD_PCT = 0.005  // 0.5% de spread estimado
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

// 🏆 Top 3 agents decidem:
// Ranking do accountant → top 3 têm voto decisivo
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

### O que é perdido no F5 (volátil):

| Dado | Consequência |
|------|-------------|
| `Pregão.oks` | OKs ativos (mas são reenviados no próximo ciclo) |
| `Pregão.ordens` | Ordens pendentes (mas a blockchain continua processando) |
| `QuantumWave.wave` | Onda quântica atual (recriada no próximo ciclo) |
| `Pregueiros.historico` | Histórico de preços dos pregueiros (recomeça) |

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
- **Stale (4h sem lucro)**: NÃO fecha mais — segura e espera o mercado virar
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

Cada rede roda em uma porta diferente:
- `npm run dev` → Polygon (3000)
- `npm run dev:testnet` → Arc (3001)
- `npm run dev:base` → Base (3002)

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
| cirBTC | `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` |
| mcirBTC | `0x8cad4951192853D14f8Cb813695146b5Ae00EA6d` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| CCTP TokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
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
Se for adicionar um novo token, atualizar em **todos** os lugares:
1. `real-swap-executor.ts`: `NETWORKS.rede.tokens` + `COIN_IDS`
2. `pair-price-feed.ts`: `COIN_IDS`
3. `volatility-tracker.ts`: `COIN_IDS`
4. `position-manager.ts`: `fetchTokenPrice` → coinIds
5. `TRADING_PAIRS`: adicionar pares com o novo token
6. `agentes-do-pregão.ts`: `getTokenPrice()` → coinIds (se aplicável)

---

## 15. DIAGNÓSTICO RÁPIDO

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
- `fetchTokenChange24h(token)` busca variação percentual 24h da CoinGecko
- `/api/price` agora retorna `{ prices, change24h }` com `include_24hr_change=true`
- No sell loop: só vende se `profitPercent >= variation24h * 0.9`
- Exemplo: ETH varia 3% → só vende com lucro >= 2.7%
- Garante que posição busca capturar a maior parte do movimento diário
- Se variação 24h for muito pequena (< 0.5%), usa fallback 2%

### Regra: "Só compra volátil se caixa livre"
- Antes: Pregão/Pregueiros/Agentes não enviavam OKs de compra (stable→volátil) enquanto houvesse **qualquer** posição aberta
- Agora: permite até **3 posições simultâneas** (MAX_POSITIONS = 3)
- Valor por trade é calculado dinamicamente: `(saldoStable * 0.9) / vagasRestantes`
- O `Valor por trade` da UI vira teto máximo — Pregão decide o valor real
- Vendas (volátil→stable) continuam livres para fechar posição com lucro
- Garante diversificação: múltiplas oportunidades sem precisar fechar uma pra abrir outra

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

### Feature: "🔄 Múltiplas posições simultâneas (até 3)"
- Substitui o antigo bloqueio "uma posição por vez"
- MAX_POSITIONS = 3 em agentes-do-pregão.ts e pregueiro.ts
- Pregão divide saldo disponível pelas vagas restantes
- Ex: $18 com 2 posições abertas → $18 * 0.9 / 1 vaga = $16.20 para o próximo trade
- Ex: $18 com 0 posições → $18 * 0.9 / 3 vagas = $5.40 por trade (até 3 trades)
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

---

## 16. COMANDOS ÚTEIS

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

## 17. UI/UX — DESIGN SYSTEM E COMPONENTES

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

## 18. ORACLE STORK (Arc Testnet)

### 18.1 Integração
- `pair-price-feed.ts`: suporte ao oracle Stork on-chain na Arc Testnet
- Contrato: `0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62` (Arc)
- Feed IDs disponíveis:
  - `EURCUSD`: `0x64ffe1382a02f37d4e16872cde1e7379679aa83bba98d99036921942203afafb`
  - `BTCUSD`: `0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de` (usado para cirBTC/mcirBTC)

### 18.2 Comportamento
- Ativado automaticamente quando a rede é `arc` (via `executarCicloPregueiros`)
- Stork como fonte primária → CoinGecko como fallback
- `pairPriceFeed.setUseStork(true/false)` para controle programático
- `getTemporalNumericValueUnsafeV1(bytes32 id)` → retorna preço com 18 decimais

### 18.3 Chainlink e Pyth
Segundo a documentação da Stork, os adapters Pyth e Chainlink também estão disponíveis:
- Stork pode ser consumido via interfaces Pyth e Chainlink (adapters)
- Para verificar feeds específicos de EURC/cirBTC na Arc, consultar `https://docs.stork.network/resources/adapters.md`
- Stork também tem SDK npm: `@storknetwork/stork-evm-sdk`

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

## 22. CHANGELOG — 19/06/2026

### Pregão — LIMIAR_OK
- **Fix**: `LIMIAR_OK = 3 → 2` — o sistema migrou de 3 pregueiros para 2 agentes do Top 3, mas o limite nunca foi ajustado. Resultado: 2 OKs chegavam, Pregão esperava o 3º que nunca vinha → NENHUMA ordem passava.
- **Efeito**: com 2 OKs, a média de confiança é MAIOR (elimina o 3º agente de baixa confiança que diluía a média)

### Staircase
- **Fix**: `staircaseUpdate` não fecha mais no prejuízo — verifica se `lucroUSD >= gas + spread + margem` antes de fechar
- **Novas constantes**: `GAS_ESTIMATE_USD` (por rede), `SPREAD_ESTIMATE_PCT` (0.5%), `MIN_PROFIT_MARGIN` (0.5%)

### Pregão — mínimo dinâmico por trade
- **Novo**: valor mínimo de trade calculado dinamicamente: `(MIN_PROFIT_REAL + gas) / (retornoEsperado - spread)`
- `retornoEsperado = (confiancaMedia / 100) * (volatilidade24h / 100)`
- Só executa trade se o valor investido puder gerar **$0.05 de lucro real** após custos

### Testnet Arc — cirBTC
- **Fix**: cotação sintética agora usa preço real do BTC — `toAmount = amountUsd / btcPrice` em vez de 1:1
- **Fix**: `getPortfolioTokens` agora inclui `cirBTC` e `mcirBTC` no portfolio da UI
- **Fix**: `getTokenAddress` estendido para suportar cirBTC/mcirBTC

### Provão
- **Fix**: `_finalizeDay` usava variável `day` inexistente → corrigido para `this.state.currentDay`
