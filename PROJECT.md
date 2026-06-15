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

### Subgraph (The Graph)
- `arc-wallet-subgraph/`: indexa eventos AgenticCommerce (JobCreated, JobFunded, etc.)
- Schema: Job, JobActivity, GlobalStats
- Deploy target: arc-testnet

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

## Next Steps / TODOs
- [ ] Popular PRIVATE_KEY, KIT_KEY, LIFI_API_KEY no .env
- [ ] Deploy AgentIdentity na Base (`node scripts/deployAgentIdentity.js`)
- [ ] Deploy ERC8183.sol com USDC + AgentIdentity
- [ ] Conectar subgraph queries no frontend (`subgraphQueries.ts`)
- [ ] Substituir mock agents (news, market, volume) por APIs reais
- [ ] Extrair page.tsx (~1300 linhas) em módulos menores
- [ ] Padronizar extensão das API routes (.ts vs .js)
- [ ] Adicionar integração BTC real no PSBT system
