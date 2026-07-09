# ArcFlow — ARC Agent Coordination Framework

> **ArcFlow é um framework de coordenação de agentes autônomos com camada compartilhada de cognição.** 13 agentes de IA operam em consenso sobre uma base de conhecimento unificada, executando desde trading algorítmico multi-chain até arbitragem de stablecoins — tudo de forma autônoma, sem intervenção humana. Também conhecido como **CriptoMorse**.

![Next.js](https://img.shields.io/badge/Next.js-15.5-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript)
![ethers.js](https://img.shields.io/badge/ethers.js-v6-purple)
![Arc Testnet](https://img.shields.io/badge/Arc-Testnet-green)
![Polygon](https://img.shields.io/badge/Polygon-Mainnet-8247e5)

---

## O que é

ArcFlow é um **ARC Agent Coordination Framework** — uma infraestrutura completa para coordenação de agentes autônomos baseada em conhecimento compartilhado. Cada agente consulta uma **camada central de cognição (Knowledge Service)** antes de decidir, garantindo que todas as decisões sejam informadas por um contexto consistente de liquidez, rotas, gas, reputação e histórico.

O ciclo canônico do framework é **Identity → Knowledge Service → Intent → Coordinator → Policy Engine → Voting Engine → Adapter → Execution → Audit → Decision Report → DecisionAnchor**. `PROJECT_VISION.md` é a fonte canônica de arquitetura; se uma seção histórica divergir, ela deve ser lida como nota de implementação antiga.

---

ArcFlow is also a structural discipline layer for autonomous economic agents: it separates signal, intent, approval, execution, settlement, reconciliation, and verified profit so provisional or local results are not treated as final truth. See `PROJECT_VISION.md` for the canonical explanation.

## Arquitetura

### Current Architecture (Canonical)

`PROJECT_VISION.md` is the canonical architecture source of truth.

ArcFlow is an autonomous agent coordination framework for Arc Testnet, not a trading bot. Trading is the first Adapter and the first proof domain.

The Coordinator is the only public entry point. UI, SDKs, agents, and external callers submit intents or proposals to the Coordinator. Pregão is internal TradingAdapter machinery and must not be treated as the architectural center.

```text
Identity
  -> Knowledge Service
  -> Intent
  -> Coordinator
  -> Policy Engine
  -> Voting Engine
  -> Adapter
  -> Execution
  -> Audit
  -> Decision Report
  -> DecisionAnchor
```

Framework responsibilities:

- **Knowledge Service**: official source of context for liquidity, routes, gas, market state, history, and reputation.
- **Policy Engine**: owner of global rules such as gas limits, congestion, operating windows, liquidity minimums, and learning/economic modes.
- **Voting Engine**: consensus layer using confidence, reputation, and Knowledge confidence modifiers.
- **Coordinator**: public orchestration layer that receives intents and routes the full decision lifecycle.
- **Adapters**: domain implementations. `TradingAdapter` is first; future domains must be new Adapters.
- **Audit / Decision Reports**: complete off-chain explanation of every decision.
- **DecisionAnchor**: on-chain proof layer for the Decision Report hash plus compact metadata.

Trading-specific internals:

```text
Coordinator
  -> TradingAdapter
  -> Pregão internal machinery
  -> Corretor / execution internals
```

Historical sections in this README and in `ARCFLOW.md` may describe the original trading implementation. Those notes are preserved for context, but current and future architecture must follow the Coordinator-first framework boundary above.

### Current Runtime Checkpoint After Phase 2c

Phase 1 is accepted: legacy Pregao entry paths for autonomous economic signals now route through the Coordinator. `pregao.receberOK()` is a compatibility wrapper, while `pregao.injetarSinal()` is the TradingAdapter-internal hook.

Phase 1b is accepted: `RealAutomatedTrader` and `TradingNanopayments` autonomous decisions now submit through the Coordinator. Manual, test, admin, and demo paths are classified and may remain outside the autonomous lifecycle for now.

Phase 2a is accepted: Knowledge Service and Policy Engine are enforced as runtime gates inside Coordinator.

Phase 2b is accepted: `Voting.resolve()` is the canonical consensus authority.

Phase 2c is accepted: Coordinator rejection returns preserve the canonical `{ consensus: ... }` shape, and Arqueiro startup is browser/runtime guarded while remaining shadow/inert and non-executing.

Current valid autonomous flow:

```text
Autonomous decision
  -> Coordinator.submitProposal()
  -> TradingAdapter
  -> pregao.injetarSinal()
  -> Pregao / Corretor machinery
```

Settlement principle:

```text
ArcFlow não comemora execução.
ArcFlow só confia em liquidação verificada.
```

Known limitations after Phase 2c:

- Pending proposal settlement is not reconciled back into all dashboards/accounting yet.
- Coordinator/TradingAdapter currently treats dispatch to Pregao as execution success, not final on-chain settlement.
- `job-robot` and `contratante` are demo/stress/testnet utilities for now and need a future Job/Testnet Adapter if promoted.
- Manual/admin swap routes remain callable low-level utilities and need stronger access boundaries later.
- DecisionReport is not fully canonical yet.
- DecisionAnchor exists and works as a contract, but canonical hash correctness over complete finalized DecisionReports remains future work.
- Dashboard profit is provisional until settlement reconciliation is implemented.

Next architecture work should focus on TradingAdapter settlement correctness, DecisionReport runtime correctness, and DecisionAnchor canonical hash correctness.

### ARC Agent Framework (canonical conceptual view)

This diagram mirrors the lifecycle in `PROJECT_VISION.md`:

```text
Identity
  -> Knowledge Service
  -> Intent
  -> Coordinator
  -> Policy Engine
  -> Voting Engine
  -> Adapter
  -> Execution
  -> Audit
  -> Decision Report
  -> DecisionAnchor
```

### ARC Agent Framework (visão implementada)

> Historical TradingAdapter implementation note: the following section documents the original trading-era implementation. It is preserved for context and does not override `PROJECT_VISION.md`. Pregão in this section means internal TradingAdapter machinery, not the public entry point.


```
KnowledgeService.query() ←──────────────┬──────────────┐
    │                                    │              │
    ├── PoolProfiler (liquidez)          ▼              ▼
    ├── RouteVerifier (rotas)       Agentes (13)   Votação
    ├── GasOracle (custo gas)           │
    ├── VolatilityTracker (mercado)     ▼
    ├── Accountant (histórico)     KnowledgeReport
    └── Reputation (reputação)          │
                                        ▼
                                    Intent (AgentIntent)
                                        │
                                        ▼
                                 Coordinator -> TradingAdapter -> Pregão interno -> Escriturario
                                        │
                                        ▼
                              Capital Controller
                                        │
                                        ▼
                              Corretor → Blockchain
                                        │
                                        ▼
                              Professor (aprendizado)
```

### Módulos Principais

| Módulo | Descrição |
|--------|-----------|
| **Knowledge Service** | SSOT de cognição compartilhada. Agrega 6 fontes (liquidez, rota, gas, mercado, histórico, reputação) em um `KnowledgeReport` padronizado com 4 scores, riskScore, confidenceModifier e recomendações acionáveis. Cache híbrido memória+localStorage com TTLs. |
| **Pregão** | Internal TradingAdapter machinery: trading-domain order book / consensus helper used behind the Coordinator. It is not the public architectural center. |
| **Escriturário** | Valida saldo, dimensiona valor, previne concorrência de par |
| **Corretor** | Executa swaps via DEX direto (SushiSwap/Uniswap) + LI.FI aggregator |
| **Professor** | Avalia acertos/erros, ajusta parâmetros por agente, cache em localStorage. Circuit breaker por agente+par com recovery. |
| **Escola de Robôs** | Ranking, turnos de 10min, promoção de agentes com base em performance |
| **Capital Controller** | Gate central FIFO: 1 trade por vez, fila ordenada por score |
| **Intent Publisher** | Protocolo formal de intents (off-chain + on-chain via ERC-8183). `OnChainIntentPublisher` com auto-sign e fallback off-chain. |
| **Reputation** | Sistema de reputação de agentes (winRate, score, streak, level). Integrado ao Knowledge Service como peso de confiança. |
| **Audit** | Audit trail completo: ações, propostas, resultados, lucro, gas. `AuditReport` com top agentes por período. |
| **StableMR** | Mean-reversion em pares EURC/USDC com PiFilter Gaussiano |
| **Modo Grão** | Scalping de stablecoins com batching de sinais MR+MM |
| **Oscillation Hunter** | Micro-scalping em pools Uniswap V3 profundas (USDC/USDT 0.01%) |
| **Grid Trading** | Grid adaptativo com 15 níveis, deriva de preço e Red Line |
| **PiFilter** | Filtro Gaussiano com warmup de 18 amostras para detecção de sinal em ruído DEX |
| **Arc Training** | Treinamento autônomo dos agentes na Arc Testnet com snapshots |
| **Circuit Breaker** | Proteção contra perdas consecutivas (3 strikes) + route circuit breaker por par (5 falhas → 30min cooldown) |
| **Gas Price Oracle** | Custo de gas em USD com fallback multi-RPC |
| **Pair Price Feed** | Preços em tempo real via Chainlink (Polygon) + Pyth (Arc) + SoSoValue |
| **Arqueiro** | Shadow timing/scout module: detects volatility compression via pseudo-ATR + Bollinger/Keltner squeeze. Current `getScore()` is inert in Shadow. Future role should be Opportunity Scout / Pre-Intent Router that emits candidates for Knowledge/Coordinator validation, not an executor or post-vote confidence authority. |
| **Batch Executor** | Execução em lote com contrato próprio (`BatchExecutor.sol`), pré-simulação via `eth_call` antes de gastar gas, e cálculo local de AMM. Acumula 8s/10 ordens, lock único no CapitalController. |
| **Route Verifier** | Verifica se um token tem rota de venda antes de permitir a compra. Usa Multicall3 para batch de reservas de pools, calcula output local via `x*y=k`. Bloqueia cirBTC/mcirBTC na Arc testnet. |
| **ICircuitBreaker** | Interface unificada para health-check: `RouteCircuitBreaker` (5 falhas → 20min cooldown) + `FinancialCircuitBreaker` (delega ao pânico financeiro existente). |

### Agentes de Trading

`Quantum` · `Technical` · `TrendFollower` · `MeanReversion` · `QuantumTrader` · `ArbitrageHunter` · `MarketMaker` · `BTCTrader` · `Liquidator` · `MomentumTrader` · `NVIDIAgent` · `Synthesis` · `ArcBandit (×3)`

Cada agente tem parâmetros individuais (confiança mínima, threshold de entrada, viés de direção) ajustados automaticamente pelo Professor. Os 3 melhores em cada ciclo de 10 minutos têm suas decisões aceitas sem exigir consenso dos demais.

---

## Contratos Deployados

### Arc Testnet

| Contrato | Endereço | Explorer |
|----------|----------|----------|
| AgentIdentity (ERC-8004) | `0xd2a801e60a0ab36da3fb17d4a7654b494ba8326b` | [ArcScan](https://testnet.arcscan.app/address/0xd2a801e60a0ab36da3fb17d4a7654b494ba8326b) |
| AgenticCommerce (ERC-8183) v1 | `0x319227cf1de5c61d11313af8226a8f5309fa70d9` | [ArcScan](https://testnet.arcscan.app/address/0x319227cf1de5c61d11313af8226a8f5309fa70d9) |
| AgenticCommerce (ERC-8183) v2 | `0x0747EEf0706327138c69792bF28Cd525089e4583` | [ArcScan](https://testnet.arcscan.app/address/0x0747EEf0706327138c69792bF28Cd525089e4583) |
| AMM USDC/EURC (GenericAMMPair) | `0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb` | [ArcScan](https://testnet.arcscan.app/address/0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb) |
| BatchExecutor | Pendente (deploy via `scripts/deployBatchExecutorArc.js`) | — |

### Base Mainnet

| Contrato | Endereço | Explorer |
|----------|----------|----------|
| AgentIdentity (ERC-8004) | `0xaeb95e2532a73a097e03584cb244eeca9b5609a5` | [BaseScan](https://basescan.org/address/0xaeb95e2532a73a097e03584cb244eeca9b5609a5) |
| AgenticCommerce (ERC-8183) | `0x0747EEf0706327138c69792bF28Cd525089e4583` | [BaseScan](https://basescan.org/address/0x0747EEf0706327138c69792bF28Cd525089e4583) |

### Polygon Mainnet

| Contrato | Endereço | Explorer |
|----------|----------|----------|
| AgenticCommerce (ERC-8183) | `0x0747EEf0706327138c69792bF28Cd525089e4583` | [PolygonScan](https://polygonscan.com/address/0x0747EEf0706327138c69792bF28Cd525089e4583) |

### Ethereum Mainnet

| Contrato | Endereço | Explorer |
|----------|----------|----------|
| AgenticCommerce (ERC-8183) | `0x0747EEf0706327138c69792bF28Cd525089e4583` | [Etherscan](https://etherscan.io/address/0x0747EEf0706327138c69792bF28Cd525089e4583) |

### Wallet de operação

`0x77f5C3A1079B86ef8490E7c5Ec1F9bcfbaAE5894` — ativa na Arc desde outubro de 2025

> JobProof não tem endereço fixo — é deployado dinamicamente pelo JobRobot a cada ciclo de stress na Arc.
> MicroPool.sol é conceitual (MVP), não deployado.

---

## Padrões Implementados

| Padrão | Descrição | Status |
|--------|-----------|--------|
| **ERC-8004** | Identidade on-chain de agentes autônomos | ✅ Deployado (Arc + Base) |
| **ERC-8183** | Escrow de jobs para economia agentic | ✅ Deployado (Arc, Base, Polygon, Ethereum) |
| **EIP-7702 / ERC-4337** | Account abstraction nativa da Arc (gasless) | Suportado pela rede |
| **CCTP v2** | Bridge USDC entre chains via Circle | ✅ Integrado |
| **Pyth Oracle** | Preços first-party via Hermes API | ✅ Integrado (Arc) |
| **x402** | Protocolo de micropagamentos para agentes | 🔄 Planejado |

---

## Estratégias de Trading

> Historical / internal TradingAdapter note: the following trading strategy sections describe the first Adapter implementation. References to Pregão, strategy execution, or trading modules are TradingAdapter internals and do not define ArcFlow core architecture.

### StableMR (Mean Reversion)
Mean-reversion em pares EURC/USDC com SMA rolante de 12 amostras. Threshold de 0.10% (2σ do spread típico DEX). DEX fee de 0.3% aceita como custo de entrada — o lucro vem da reversão. Amount dinâmico: `max($12, |dev| × 5000)`. Fallback automático V2 quando V3 sem pools.

### Modo Grão (Batch Trading)
Batching de sinais MeanReversion + MarketMaker em stablecoins. Acumula 3–5 sinais antes de executar um swap único maior, amortizando o custo de gas. Usa PiFilter Gaussiano (motor estocástico com warmup de 18 amostras, σ threshold ±1.5, noiseProbability bilateral) para filtrar ruído de mercado.

### Oscillation Hunter
Micro-scalping em pools Uniswap V3 de alta liquidez (USDC/USDT 0.01% fee, $2M+ TVL). Detecta desvios >0.20% da SMA com confirmação de reversão. Take-profit 0.15%, stop-loss −0.10%, timeout 5 minutos.

### Grid Adaptativo
Grid com 15 níveis e espaçamento dinâmico baseado na volatilidade do token com EMA. Drift suave quando preço deriva; Red Line quando preço escapa 2.2× o nível externo. Auto-rebalance: nível executado cria complemento no lado oposto. 1 nível por direção por ciclo.

### Multi-armed Bandit (Arc)
Seleção de pares na Arc Testnet via ArcBandit com algoritmo bandit de múltiplos braços. Pesos atualizados a cada 10 trades baseado em lucro acumulado por par.

---

## Sistema de Aprendizado

> Historical / internal TradingAdapter note: this learning flow documents the trading-era adapter behavior. References to Pregão below mean internal TradingAdapter machinery, not the public ArcFlow entry point.

```
Voto do agente com preço atual
    ↓
TradingAdapter internal Pregão machinery registra palpite (par, direção, preço, confiança)
    ↓
5 minutos depois → Professor consulta preço atual
    ↓
Acertou direção?  → +pontos, parâmetros afrouxados (↓conf.min, ↑entrada)
Errou direção?    → −pontos, parâmetros endurecidos (↑conf.min, ↓entrada)
    ↓
Escola de Robôs atualiza ranking → streak acumula → promoção
```

**Critérios de promoção**: 50+ avaliações · 60%+ acerto · 500+ pontos.
Agentes promovidos têm suas ordens aceitas via TradingAdapter internal Pregão machinery sem exigir segundo voto concordando.

O Professor tem trava de segurança: streak por par (não contamina outros pares), cap de 10 ajustes consecutivos por par, e early exit ao atingir o teto (conf.min 55%, entrada 1.50%).

---

## Resultados (Polygon Mainnet)

| Métrica | Valor |
|---------|-------|
| Trades on-chain executados | 6+ |
| Win rate | 100% |
| Lucro acumulado | ~$18.77 |
| Capital operado | ~$50–65 USDC |
| Retorno sobre capital | ~28.9% |
| Ativo desde | Outubro 2025 |

---

## Redes Suportadas

| Rede | Tipo | Porta | Status |
|------|------|-------|--------|
| Arc Testnet | 🧪 testnet | 3001 | ✅ Ativo — campo de treinamento principal |
| Polygon Mainnet | 💰 mainnet | 3000 | ✅ Ativo — trading real |
| Base Mainnet | 💰 mainnet | 3002 | ✅ Configurado |
| Ethereum Mainnet | 💰 mainnet | — | ✅ Configurado |
| Ethereum Sepolia | 🧪 testnet | 3003 | ✅ Configurado |

---

## Stack Técnica

| Categoria | Tecnologias |
|-----------|-------------|
| Framework | Next.js 15.5 + React 19.2 |
| Linguagem | TypeScript (strict mode) |
| Blockchain | ethers.js v6 + viem + wagmi |
| Swaps | LI.FI REST API + DEX direto (SushiSwap V2, Uniswap V3) |
| Preços | Chainlink Data Feeds (Polygon) + Pyth Hermes API (Arc) + SoSoValue API |
| Bridge | Circle CCTP v2 (5 chains) |
| Identidade | ERC-8004 AgentIdentity (próprio) + IdentityRegistry oficial da Arc |
| Jobs | ERC-8183 Job Marketplace (próprio) + AgenticCommerce oficial da Arc |
| Estilo | Tailwind CSS 4.3, lucide-react |
| Gráficos | recharts 3.x |
| Contratos | Solidity + OpenZeppelin v5 |
| Deploy | Vercel |

---

## Como Rodar

```bash
# Instalar dependências
npm install

# Copiar variáveis de ambiente
cp .env.example .env.local
# Preencher: PRIVATE_KEY, SOSO_API_KEY, KIT_KEY

# Arc Testnet (recomendado para começar)
npm run dev:testnet   # porta 3001

# Polygon Mainnet
npm run dev           # porta 3000

# Base Mainnet
npm run dev:base      # porta 3002

# Ethereum Sepolia (testnet)
npm run dev:sepolia   # porta 3003

# Verificar TypeScript
npx tsc --noEmit
```

### Variáveis de Ambiente

```env
PRIVATE_KEY=           # Chave privada da wallet de operação
SOSO_API_KEY=          # SoSoValue API (gratuita: 20 req/min)
KIT_KEY=               # Circle App Kit (opcional — necessário para JobRobot)
LIFI_API_KEY=          # LI.FI (opcional — usa endpoint público se ausente)
NEXT_PUBLIC_DEFAULT_NETWORK=arc
```

---

## Estrutura do Repositório

```
arcflow/
├── app/
│   ├── api/              # 17+ rotas de API (price, rpc-proxy, relayer, jobs, etc.)
│   ├── components/       # 22+ componentes React (dashboard, agentes, FrameworkDashboard)
│   └── page.tsx          # SPA principal
├── lib/                  # 75+ módulos TypeScript (núcleo do sistema)
│   ├── agent-framework/  # Framework de coordenação de agentes
│   │   ├── KnowledgeService (cognição compartilhada)
│   │   ├── IntentPublisher (off-chain + on-chain ERC-8183)
│   │   ├── Coordinator (consenso FIFO)
│   │   ├── Voting (votação ponderada)
│   │   ├── Reputation (score/winRate/streak/level)
│   │   ├── Audit (audit trail completo)
│   │   ├── SafetyGuard (circuit breaker)
│   │   ├── ResourceManager (alocação)
│   │   └── interface files (IAgent, ICoordinator, IExecutor, etc.)
│   ├── pregão.ts         # Internal TradingAdapter machinery
│   ├── stable-mr.ts      # Mean reversion para stablecoins
│   ├── modo-grão.ts      # Batch trading com PiFilter
│   ├── oscillation-hunter.ts
│   ├── grid-trading.ts   # Grid adaptativo
│   ├── capital-controller.ts
│   ├── contract-registry.ts  # Registro central de contratos
│   └── ...
├── contracts/            # Contratos Solidity (AgentIdentity, ERC8183, AMM, BatchExecutor)
├── scripts/              # Deploy e utilitários
│   ├── deployAMMArc.js
│   └── addLiquidityAMM.js
├── ARCFLOW.md            # Documentação técnica completa para IAs
└── AGENTS.md             # Histórico de sessões e regras para contribuidores
```

---


### Decision Report + DecisionAnchor Lifecycle

Every decision that passes through the Coordinator must produce a Decision Report before or during execution finalization. The report is the complete off-chain explanation of the decision.

Canonical DecisionAnchor payload:

- `decisionHash`: canonical hash of the finalized Decision Report.
- `metadata`: compact metadata only, such as `decisionId`, `network`, `domain`, `adapterId`, `timestamp`, and `knowledgeReportHash`.

DecisionAnchor must not store the full Decision Report or full KnowledgeReport on-chain. The on-chain proof is the Decision Report hash plus compact metadata.

Required Decision Report fields:

- `decisionId`: stable unique identifier for the decision.
- `timestamp`: decision creation/finalization time.
- `network`: target network, such as Arc Testnet.
- `domain`: adapter domain, such as `trading`.
- `adapterId`: adapter that executed or attempted execution.
- `actorIdentity`: submitting agent, user, or module identity.
- `intent`: original intent/proposal payload.
- `knowledgeReport`: Knowledge Service output used for the decision.
- `knowledgeReportHash`: canonical hash of the KnowledgeReport.
- `confidenceModifier`: modifier supplied by Knowledge.
- `policyChecks`: Policy Engine rules evaluated and their pass/fail results.
- `votes`: participating agents, confidence, reputation, weight, and vote result.
- `consensusResult`: accepted, rejected, deferred, or failed, with reason.
- `executionPlan`: selected adapter action before execution.
- `executionResult`: transaction, simulation, skipped, failed, or other outcome.
- `gas`: estimated and actual gas when available.
- `economicResult`: profit, loss, cost, or non-financial result depending on adapter.
- `auditTrail`: relevant events emitted during the decision lifecycle.
- `decisionHash`: canonical hash of the finalized Decision Report.
- `anchorMetadata`: compact metadata submitted with the anchor.
- `anchorTxHash`: DecisionAnchor transaction hash when anchored.
- `anchorStatus`: pending, anchored, failed, or not_required.

Lifecycle:

1. Agent, UI, or SDK submits an intent to the Coordinator.
2. Coordinator obtains context from the Knowledge Service.
3. Policy Engine evaluates global constraints.
4. Voting Engine resolves agent input when applicable.
5. Coordinator chooses the Adapter and records the execution plan.
6. Adapter executes through domain-specific internals.
7. Audit records the outcome and final metadata.
8. Decision Report is finalized with all required fields.
9. DecisionAnchor anchors `decisionHash` plus compact metadata on-chain.
10. The anchored transaction hash is attached back to the Decision Report.

## Roadmap

`PROJECT_VISION.md` is the source of truth for architecture. `docs/ROADMAP.md` is the source of truth for phase sequencing.

## Canonical Phase Status

This table is the single phase-status reference. `PROJECT_VISION.md` remains the canonical architecture source; this table only tracks implementation maturity.

| Phase | Status | Meaning |
|-------|--------|---------|
| Phase 1 - Coordinator core | Implemented / hardening | Coordinator is the public entry point; direct domain entry points are deprecated or internal. |
| Phase 2 - Knowledge First + Policy gates | Accepted / hardening | Knowledge Service and Policy Engine are runtime gates inside Coordinator. |
| Phase 3 - Voting Intelligence | Accepted / hardening | `Voting.resolve()` is the canonical consensus authority. |
| Phase 4 - Audit + Decision Reports | In progress | Every coordinated execution must produce an auditable Decision Report. |
| Phase 5 - DecisionAnchor | Implemented / hardening | DecisionAnchor anchors the Decision Report hash plus compact metadata. |
| Phase 6 - Policy Engine | Accepted / hardening | Policy blocks before voting and before execution; scattered rules should continue migrating there. |
| Phase 7 - SDK | Planned | Public developer API after architecture stabilizes. |
| Phase 8 - Adapters | In progress | TradingAdapter is first; new domains must be Adapters. |
| Phase 9-12 - UX, live view, memory, platform | Planned | Product and platform expansion after the framework boundary is stable. |

### Operational Work Already Implemented

- Multi-agent system with consensus and learning.
- ERC-8004 AgentIdentity deployed on Arc and Base.
- ERC-8183 job marketplace / AgenticCommerce integrations.
- Arc Testnet AMM and training infrastructure.
- Intent publishing and on-chain publishing support.
- Knowledge Service as the official shared cognition layer.
- TradingAdapter as the first domain Adapter.
- DecisionAnchor support for Decision Report hash plus compact metadata.

### Planned Platform Work

- Expand Policy Engine coverage and migrate scattered global rules into it.
- Harden Decision Reports and anchor metadata.
- Build SDK and third-party Adapter surface.
- Add future Adapters such as Lending, Governance, Monitoring, Job Marketplace, and Automation.

---

## Project Vision

See [PROJECT_VISION.md](PROJECT_VISION.md) for the canonical framework vision and architecture boundary.

## Documentação

- [`ARCFLOW.md`](ARCFLOW.md) — Mapa completo do sistema, parâmetros, arquitetura, fórmulas matemáticas, bugs conhecidos
- [`AGENTS.md`](AGENTS.md) — Histórico de sessões e regras para IAs contribuidoras
- [`docs/arqueiro-visual.md`](docs/arqueiro-visual.md) — Diagrama de estados do Arqueiro, curva de tensionScore, parâmetros

### ARC Agent Framework — Pilares

```
  Knowledge     — SSOT de cognição compartilhada (Phase 2 implemented; see phase status table)
  Identity      — ERC-8004 AgentIdentity on-chain
  Reputation    — Score, winRate, streak, level por agente
  Intent        — Protocolo off-chain + on-chain (ERC-8183)
  Voting        — Votação ponderada por confiança + conhecimento
  Coordinator   — public orchestration entry point
  Adapter/Execution — TradingAdapter -> internal Pregão -> Corretor / DEX / LI.FI
  Audit         — Trail completo com lucro/gas/agentes
  DecisionAnchor — Decision Report hash + compact metadata
```

---

## Autor

**Silvio** · [@Silvinhojm](https://github.com/Silvinhojm)

Construído sobre o ecossistema Arc/Circle como participante ativo desde o lançamento do testnet em outubro de 2025. O projeto explora a interseção entre sistemas multi-agente autônomos, infraestrutura de stablecoin, e os padrões emergentes da economia agentic (ERC-8004, ERC-8183, x402).

---

> **ArcFlow não é um serviço financeiro. Trading envolve risco de perda de capital. Use por sua conta e risco.**

---

## Repositório

Branch principal: `versao-polygon` — deploys automáticos via Vercel.

```
https://criptomorse.vercel.app
```
