# ARCFLOW — Manual de Arquitetura e Parâmetros

> **LEIA ESTE ARQUIVO PRIMEIRO** antes de qualquer modificação no código.
> Este documento contém o mapa completo do sistema. Consulte-o sempre que for
> alterar comportamento, adicionar features ou diagnosticar bugs.

---

## 1. VISÃO GERAL

Arcflow é uma plataforma de trading automatizado multi-chain com:
- **Carteira** multi-chain (Arc Testnet, Polygon, Base, Ethereum)
- **Sistema de agentes** que votam em oportunidades de swap
- **Pregão** — um "pregão de bolsa" que coleta votos e gera ordens
- **Execução real** via LI.FI (mainnet) ou simulação (testnet)
- **Staircase** — fechamento automático com garantia de lucro
- **Volatility Tracker** — aprendizado contínuo do comportamento de cada token

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
       │   ├── agentes-do-pregão.ts      ← 12 agentes de trading (VOTAM AQUI)
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
│    ├── Confiança ajustada por volatilidade (VolTracker)        │
│    ├── Confiança ponderada pelo score histórico do agente      │
│    │   (accountant.getAgentScore → score/maxScore pondera      │
│    │    a confiança: agentes mais acertativos pesam mais)       │
│    └── Síntese: maior score composto vence (totalConfidence    │
│        × número de votos)                                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ OKs
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. PREGÃO (pregão.ts)                                          │
│    ├── Quando 3+ OKs para o mesmo par → gera ORDEM             │
│    ├── ⚠️ Só gera ordem de COMPRA se NÃO houver posição aberta │
│    │   (check em pregueiro.ts + agentes-do-pregão.ts)           │
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
│    ├── Se caiu 2 degraus do pico → retorna "close"            │
│    └── Injeta 3 OKs no Pregão para vender → ciclo recomeça     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. PARÂMETROS CONFIGURÁVEIS

### 4.1 Staircase (position-manager.ts)

```typescript
PROFIT_LEVELS = [0, 3, 5, 8, 10, 15, 20, 30, 50, 70, 100]
// Degraus padrão. Usado se VolatilityTracker não tiver dados.
// Cada token pode ter níveis diferentes sugeridos pelo tracker.

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

### 4.4 Config de Rede (real-swap-executor.ts)

```typescript
GAS_COST_ESTIMATE: {
  arc:      0.006,  // ~$0.006 por tx na Arc Testnet
  base:     0.05,
  polygon:  0.08,
  ethereum: 1.50,
  arbitrum: 0.03,
}
```

### 4.5 Pregão (pregão.ts)

```typescript
LIMIAR_OK = 3      // Quantos OKs para gerar uma ordem
JANELA_MS = 30000  // 30s — OKs expiram após este tempo
ORDEM_TIMEOUT_MS = 120000  // 2min — ordem "preparando"/"pronto"/"executando" expira
```

### 4.6 Agent Learning (corretor.ts + accountant.ts)

```typescript
// Score composto por agente:
// score = winRate * 0.6 + max(0, avgProfit) * 30 + streak * 5
// Mínimo 3 trades para entrar no ranking

// Peso do score na confiança do voto (agentes-do-pregão.ts):
// confiança *= 0.5 + (score / maxScore) * 0.5
// Agentes com score máximo mantêm 100% da confiança
// Agentes com score 0 perdem 50% da confiança

// Quando um trade conclui, cada agente que votou recebe:
// profit / número_de_agentes_votantes
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

### Ajuste do VolatilityTracker:
Após todos votarem, a confiança de cada voto é multiplicada por:
- `getConfidenceMultiplier(tokenVolatil)` — reduz se vol está subindo

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

### Regra: "Só compra volátil se caixa livre"
- Pregão/Pregueiros/Agentes não enviam OKs de compra (stable→volátil) enquanto houver posição aberta
- Vendas (volátil→stable) continuam livres para fechar posição com lucro
- Garante ciclo completo: compra → lucro → venda → caixa de volta → nova compra

### Problema: "LI.FI rota fly com estimate 0 bloqueava trades legítimos"
- `toEstimate <= 0` não bloqueia mais a transação — só loga aviso
- Rota "fly" às vezes retorna `toAmount: "0"` no JSON mas o `transactionRequest.data` é válido
- Confirmação on-chain via `txResponse.wait()` detecta revert (status 0) se falhar

### Problema: "Agentes não aprendem com os resultados"
- `corretor.ts` agora pontua cada agente que votou na ordem após trade concluído
- `accountant.ts` mantém score composto (winRate, lucro médio, streak)
- `agentes-do-pregão.ts` pondera confiança dos votos pelo score histórico
- Dados persistem em localStorage (`arcflow_accountant_reports`)

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

*Documento gerado em 16/06/2026. Mantenha atualizado conforme novas features.*
