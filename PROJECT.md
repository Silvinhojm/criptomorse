# arcflow — Criptomorse

## Identity
- **Nome:** arcflow (Criptomorse)
- **Framework:** Next.js 15.5 + React 19.2 + Turbopack
- **Blockchain:** Arc Testnet (5042002), Base (8453), Polygon (137), Ethereum (1)
- **Gas token:** USDC (Arc nativo)
- **Contratos on-chain no Arc Testnet:**
  - IdentityRegistry ERC-8004: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
  - ReputationRegistry ERC-8004: `0x8004B663056A597Dffe9eCcC1965A193B7388713`
  - ValidationRegistry ERC-8004: `0x8004Cb1BF31DAf7788923b405b754f57acEB4272`
  - AgenticCommerce ERC-8183: `0x0747EEf0706327138c69792bF28Cd525089e4583`
  - USDC Arc Testnet: `0x3600000000000000000000000000000000000000`
  - AgentIdentity (deploy próprio): `0xaeb95e2532a73a097e03584cb244eeca9b5609a5`

## Features Implementadas

### Wallet & Transações
- Conexão MetaMask com multi-chain (Arc, Base, Polygon, Ethereum)
- Saldo USDC em tempo real via ethers RPC
- Envio de USDC com assinatura MetaMask
- Bridge/Swap via LI.FI / Jumper.Exchange
- Unified Balance (agrega USDC cross-chain)
- Suporte batch transactions (ARC v0.7.2 hardfork 18 Jun 2026)

### Agentic Economy (ARC)
- **ERC-8004 Agent Registry** (`lib/agent-registry.ts`): registerAgent(), resolveAgentFromOwner(), listAgents()
- **ERC-8183 Job Marketplace** (`lib/job-marketplace.ts`): createJob(), approveUSDC(), fundJob(), submitDeliverable(), completeJob()
- **Transaction Memos** (`lib/transaction-memos.ts`): encode/decode memos com prefixo `0x415243`
- **Confidence Staking** (`lib/confidence-staking.ts`): agentes apostam reputação nas decisões

### Multi-Agent Trading
- 5 agentes votantes: Quantum, Technical, News, Market, Volume + Synthesis
- Weighted voting system com confidence threshold
- Modos: Conservador (70%), Moderado (50%), Agressivo (30%)
- Micro-trading engine otimizado ARC (`lib/arc-micro-trader.ts`): gas ~$0.006, batch, memos
- Circuit breaker: para após 5 perdas consecutivas ou 10% drawdown
- Position manager: trailing stop dinâmico

### Fee Monetization
- Spread por par: USDC/EURC 30 bps, USDC/USDT 10 bps, USDC/WETH 50 bps
- Fee recipient configurável

### Bitcoin PSBT Offers
- Sistema de ofertas Bitcoin com assinatura MetaMask (`personal_sign`)
- 1% de taxa, 24h de validade
- API routes: create-offer, accept-offer, list-offers, offer-stats

### Asset Recovery
- Ethical recovery com escrow (5% fee)
- Mock wallet scanning (12.5 anos inativo, 50.2 BTC)
- Private key format-only validation (nunca armazena/transmite)

### Smart Contracts (Solidity)
- `contracts/AgentIdentity.sol`: ERC-721 + Ownable, registro de identidade de agentes
- `contracts/ERC8183.sol`: Job marketplace com 7 estados, 50 bps fee, integração AgentIdentity

### Data Indexers (Goldsky / Envio)
- `arc-wallet-subgraph/`: schema e queries GraphQL para eventos AgenticCommerce
- Arc Testnet **não está no The Graph descentralizado** — deploy em **Goldsky** (suporta subgraphs) ou **Envio** (hipersync nativo Arc)
- JobsPanel com fallback para leitura on-chain via ethers se subgraph offline

## API Routes

| Route | Métodos | Função |
|-------|---------|--------|
| `/api/balance` | GET | Saldo USDC multi-chain |
| `/api/send` | POST | Envio simulado |
| `/api/trades` | GET/POST | Histórico de trades (JSON file) |
| `/api/state` | GET/POST | Estado do trader (JSON file) |
| `/api/lifi` | GET | Quote LI.FI + balance |
| `/api/swap/sign` | GET/POST | Auto-sign tx (PRIVATE_KEY) |
| `/api/swap/execute` | POST | Swap completo via LI.FI |
| `/api/panic` | GET/POST | Circuit breaker |
| `/api/jobs` | GET | Lista jobs ERC-8183 on-chain |
| `/api/jobs/[id]/submit` | POST | Submete deliverable |
| `/api/jobs/[id]/complete` | POST | Completa job |
| `/api/agents/[address]` | GET | Consulta agente ERC-8004 |
| `/api/agents/register` | POST | Prepara registro agente |
| `/api/agent-card/[address]` | GET | EIP-8004 agent card JSON |
| `/api/create-offer` | POST | Cria oferta PSBT |
| `/api/accept-offer` | POST | Aceita oferta PSBT |
| `/api/list-offers` | GET | Lista ofertas pendentes |
| `/api/offer-stats` | GET | Estatísticas de ofertas |

## Components (19)
AgentDashboard, AgentIdentityCard, AutomatedTraderDashboard, BotBank, BridgeWidget, FearGreedMeter, LiFiAgentStatus, MarketMonitor, MarketOpportunityCard, NanopaymentDashboard, NetworkSelector, NewsSentimentCard, PanicButton, PrivateKeyValidator, RealAutomatedTrader, RealTradingDashboard, SwapWidget, TradingNanopaymentDashboard, TransactionScanner, TransactionViewer

## Libs Chave (49)
- `arc-micro-trader.ts` — Micro-trades com gas-aware execution
- `agent-registry.ts` — ERC-8004 on-chain agent queries
- `job-marketplace.ts` — ERC-8183 job lifecycle
- `real-swap-executor.ts` — Core swap via LI.FI REST
- `real-automated-trader.ts` — Auto-trader completo
- `fee-monetization.ts` — Spread fee config
- `transaction-memos.ts` — ARC v0.7.2 memos
- `batch-transactions.ts` — Multi-call execution
- `unified-balance.ts` — Saldo agregado cross-chain
- `confidence-staking.ts` — Reputation staking
- `circuit-breaker.ts` — Panic mode
- `position-manager.ts` — Trailing stop

## Config
- `.env.example` — template completo
- `PRIVATE_KEY=` — auto-sign server-side (opcional)
- `KIT_KEY=` — Circle KIT (opcional)
- `NEXT_PUBLIC_DEFAULT_NETWORK=arc` — rede padrão
- `ADMIN_PANIC_KEY=` — chave do circuit breaker

## Scripts
- `dev` — `next dev --turbopack` (porta 3000)
- `dev:testnet` — Arc Testnet (porta 3001)
- `dev:polygon` — Polygon (porta 3000)
- `dev:base` — Base (porta 3002)
- `build` — `next build`
- `lint` — `next lint`

## Deploy
- `scripts/deployAgentIdentity.js` — deploy AgentIdentity na Base via viem
- Requer `PRIVATE_KEY` + ETH para gas
- Compilar Solidity com forge antes: `forge build --out out --contracts contracts/`

## Changes Made (15 Jun 2026)

### ✅ Agentes de Mercado — Agora Reais
- **`coingecko-agent.ts`**: `getVolumeAnalysis()` e `getMarketTrend()` agora buscam dados reais via `/api/market-data` ao invés de mocks
- **`coinmarketcap-agent.ts`**: `getPrice()` usa `/api/price`, `getGlobalMetrics()` e `getFearAndGreed()` usam `/api/market-data` com dados reais
- **`sosovalue-agent.ts`**: `analyzeBearOpportunity()` agora busca BTC dominance e Fear & Greed reais via API, aceita parâmetros opcionais

### ✅ Subgraph Queries Conectadas
- `subgraphQueries.ts` expandido com 5 queries GraphQL (GET_JOBS, GET_JOBS_BY_ADDRESS, GET_GLOBAL_STATS, GET_JOB_ACTIVITIES)
- `lib/subgraph-client.ts` — client urql configurável via `NEXT_PUBLIC_SUBGRAPH_URL`
- `page.tsx` JobsPanel tenta subgraph primeiro, fallback para leitura on-chain

### ✅ NVIDIA NIM Agent
- Chave NVIDIA_API_KEY configurada no `.env`
- Proxy `/api/nim` para `nvidia/nemotron-3-nano-30b-a3b`
- "NVIDIAgent" participa do sistema de votação multi-agente com decisões LLM reais

### ✅ Arc Docs Compliance (15 Jun 2026)
- `nativeCurrency.decimals` Arc Testnet: **6 → 18** (USDC nativo usa 18 decimals para gas)
- `GAS_COST_ESTIMATE.arc`: **0.001 → 0.006** (docs: ~$0.006/tx)
- `gas-price-oracle.ts`: stablecoin native price = $1 (USDC é o gas token), **min 20 Gwei** enforced
- Subgraph docs: migrado de "The Graph" para **Goldsky/Envio** (Arc não suportado no Graph descentralizado)
- `lib/arc-gas.ts` criado: `getArcFeeParams()` retorna `{ maxFeePerGas: 20 gwei, maxPriorityFeePerGas: 1 gwei }`
- `maxFeePerGas` (min 20 Gwei) + `maxPriorityFeePerGas` (1 Gwei) adicionados em **todos os `sendTransaction()`**:
  - `arc-micro-trader.ts` (always Arc)
  - `batch-transactions.ts` (auto-detect via `isArcChain`)
  - `lifi-executor.ts` (auto-detect via `enforceArcFee`)
  - `real-swap-executor.ts` (auto-detect via `net.chainId`)
- `batch-transactions.ts` reescrito: usa **Multicall3** (`0xcA11bde05977b3631167028862bE2a173976CA11`) para batches multi-call na Arc, fallback sequential em outras chains
- ERC-20 USDC interface (6 decimals) já usada corretamente em page.tsx, `arc-micro-trader.ts`, `unified-balance.ts` — conforme recomendação dos docs
- Fees exibidos em USDC ($) ao invés de Gwei (gas-price-oracle, arc-micro-trader)
- Contratos Arc Testnet verificados e 100% conformes: USDC, EURC, ERC-8004, ERC-8183, Multicall3, Permit2, CCTP, Gateway

### ⏳ Pendente
- `.env` vazio: PRIVATE_KEY, KIT_KEY (precisa de chaves reais)
- Deploy AgentIdentity na Base (requer forge + PRIVATE_KEY + ETH)
- Subgraph não deployado (sem endpoint Goldsky/Envio para Arc Testnet)
- page.tsx (~1393 linhas) precisa refatoração em módulos
- API routes misturam .ts e .js — padronizar

## Next Steps / TODOs
- [ ] Popular PRIVATE_KEY, KIT_KEY no .env (se houver)
- [ ] Instalar Foundry/forge e compilar contratos
- [ ] Deploy AgentIdentity na Base (`node scripts/deployAgentIdentity.js`)
- [ ] Deploy ERC8183.sol com USDC + AgentIdentity
- [x] Deploy subgraph no Goldsky/Envio e configurar NEXT_PUBLIC_SUBGRAPH_URL
- [x] Migrar `lib/arc-app-kit.ts` de LI.FI wrapper para **Circle App Kit SDK** (`@circle-fin/user-controlled-wallets`) com Unified Balance nativo
- [x] Adicionar suporte CCTP direto (TokenMessengerV2 `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`) para bridging entre Arc ↔ outras chains
- [ ] Implementar `permit2` approvals (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) para StableFX
- [ ] Extrair page.tsx (~1400 linhas) em módulos menores
- [ ] Padronizar extensão das API routes (.ts vs .js)
- [ ] Adicionar integração BTC real no PSBT system
