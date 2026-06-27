<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:arcflow-rules -->
# ARCFLOW — Regras para IAs

1. **LEIA `ARCFLOW.md` PRIMEIRO** — contém o mapa completo do sistema, parâmetros, arquitetura e fluxos. Não modifique código sem consultá-lo.

2. **Mantenha a documentação atualizada** — toda alteração em parâmetros, novos módulos, mudanças de fluxo ou adição de tokens deve refletir em `ARCFLOW.md`. Se a IA não fizer isso automaticamente, o desenvolvedor vai pedir.

3. **Nunca duplique COIN_IDS** — ao adicionar um token, atualize em TODOS os lugares que mapeiam símbolo → SoSoValue currency_id. A lista completa está na seção 14 do ARCFLOW.md.

4. **Persistência primeiro** — qualquer estado que deve sobreviver a F5 precisa de localStorage com chave `arcflow_*`. Documente no ARCFLOW.md seção 5.

5. **Staircase sempre vende pra USDC** — o fechamento automático sempre gera ordem vendendo o token volátil → USDC, independente de como foi comprado.
<!-- END:arcflow-rules -->

- Ao verificar estado do sistema, commit alterações no ARCFLOW.md e no código e faça push

## Session Summary (24/06/2026) — Terceira sessão: Migração CoinGecko → SoSoValue

### What's Changed
1. **SoSoValue Price Agent** — `lib/sosovalue-price-agent.ts`: novo agente de preços que usa a API oficial da SoSoValue (`openapi.sosovalue.com/openapi/v1`). Cache de 15s, rate limiting de 3s entre chamadas, hardcoded currency IDs mapeados do endpoint `/currencies`.
2. **Price Route** — `app/api/price/route.ts`: backend trocado de CoinGecko (`api.coingecko.com/api/v3/simple/price`) para SoSoValue (`/currencies/{id}/market-snapshot`). Mesmo contrato de API (`?ids=...` → `{ prices, change24h }`).
3. **Market Data Route** — `app/api/market-data/route.ts`: removidas as chamadas CoinGecko (news, global). Mantido apenas alternative.me (fear/greed) + cryptocompare (news).
4. **COIN_IDS atualizados** — 10 arquivos com `COIN_IDS`/`coinIds` migrados de slugs CoinGecko (`"ethereum"`, `"bitcoin"`) para currency IDs numéricos SoSoValue (`"1673723677362319867"`, `"1673723677362319866"`): `pair-price-feed.ts`, `volatility-tracker.ts`, `professor.ts`, `real-swap-executor.ts`, `position-manager.ts`, `agentes-do-pregão.ts`, `corretor.ts`, `escriturario.ts`, `trading-nanopayments.ts`, `gas-price-oracle.ts`.
5. **Agentes deprecitados** — `coingecko-agent.ts` e `coinmarketcap-agent.ts` agora redirecionam para `sosovalue-price-agent.ts` (código original removido, compatibilidade mantida).
6. **API Key** — `SOSO_API_KEY` adicionada ao `.env.local`. Chave gratuita (20 req/min, demo plan).
7. **cirBTC/mcirBTC** — mapeados para currency_id do BTC (`"1673723677362319866"`), já que não estão listados na SoSoValue.

### Current State
- Preços agora via SoSoValue API em vez de CoinGecko.
- Rate limit: 20 req/min (demo plan). Cache de 15s + spacing de 3s entre chamadas.
- Chave: `SOSO-2ca874f7857946529d23c707520dcd17` (válida, testada — BTC $59,538).
- Build compila sem novos erros (4 erros TS pré-existentes não relacionados).

## Session Summary (25/06/2026) — Quarta sessão: Ethereum Sepolia testnet

### What's Changed
1. **Sepolia Network** — `lib/real-swap-executor.ts`: nova rede `sepolia` (chainId 11155111, testnet ETH, RPC `rpc.sepolia.org`). USDC (`0x1c7D4B...`), WETH (`0xfFf997...`), trading pairs USDC→WETH / WETH→USDC. GAS_COST_ESTIMATE $0.006, minVolatileTrade $1 (testnet).
2. **networks.ts** — Sepolia adicionada ao `SUPPORTED_NETWORKS` com LI.FI support (chainId 11155111).
3. **gas-price-oracle.ts** — Sepolia adicionada ao `GAS_COST_ESTIMATE`.
4. **caixa.ts** — `UB_CHAIN` inclui `sepolia: "Ethereum_Sepolia"`.
5. **grid-trading.ts** — `GAS_ESTIMATE_GRID` inclui Sepolia $0.006.
6. **page.tsx** — `SEPOLIA_TESTNET` config, `NETWORK_KEY_MAP` + `CHAIN_TO_KEY` com Sepolia, `handleNetworkKeyChange` suporta "sepolia", `getPortfolioTokens` inclui WETH Sepolia.
7. **Header.tsx** — Botão 🧪 Sepolia no seletor de rede.
8. **package.json** — Script `dev:sepolia` (porta 3003).
9. **Commit + Push** — Mudanças da terceira sessão (migração SoSoValue) commitadas e enviadas para `origin/versao-polygon`.

## Session Summary (24/06/2026) — Segunda sessão

### What's Changed
1. **cirBTC Ethereum mainnet** — `lib/real-swap-executor.ts`: adicionado endereço real `0x72DFB2E44f59C5AD2bAFE84314E5b99a7cd5075E` ao NETWORKS.ethereum.tokens + trading pairs USDC→cirBTC, cirBTC→USDC, EURC→cirBTC, cirBTC→EURC no ethereum TRADING_PAIRS.
2. **cirBTC no networks.ts** — adicionado cirBTC, WBTC, EURC aos tokens do Ethereum mainnet para exibição no dashboard.
3. **pair-sector.ts** — `VALID_TOKENS` agora inclui `cirBTC` e `mcirBTC` (antes eram filtrados como inválidos).
4. **professor.ts** — `COIN_IDS` agora mapeia `cirBTC → "bitcoin"` para permitir avaliação de agentes nos pares com cirBTC.
5. **direct-dex.ts** — adicionado `ethereum: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"` (Uniswap V2) para DEX direto em Ethereum.
6. **Correções preservadas das sessões anteriores**: quoting paralelo, timeout 5s, threshold progressivo, 3-strike rule, DEX preferido sobre LI.FI, wallet balance priority, RPC Proxy, minViableTrade dinâmico $2, CCTP bridge, entryPrice corrigido, painel de carteira, job-robot.

## Session Summary (22/06/2026)

### What's Changed
1. **Profit streak não destruído por compras** — `lib/corretor.ts`: `isBuyOpening` skipa `accountant.addReport()` + `processarRecompensa()` + `circuitBreaker.recordTrade()` quando é compra (stable→volátil)
2. **minViableTrade dinâmico** — `lib/agentes-do-pregão.ts:1098`: `getMinTradeSize(pairNet)` retorna $2 (não-ETH) em vez de hardcoded $5
3. **Wallet balance priority** — `lib/agentes-do-pregão.ts:328`: `Math.max(walletBalance, unifiedBalance)` quando wallet real > Circle Kit balance
4. **RPC Proxy** — `app/api/rpc-proxy/route.ts` + `_createProxyProvider()`: todas RPCs via proxy Next.js (CORS)
5. **LI.FI Quote Proxy** — `app/api/lifi/quote/route.ts`: proxy GET para `li.quest/v1/quote` (CORS)
6. **refreshAllBalances** — provider fresco + cascata RPC fallback (llamarpc, polygon-rpc, maticvigil, MetaMask)
7. **CCTP bridge** — usa `caixa.getSaldo()` (cache 10s) em vez de `unifiedBalance` direto
8. **jumper-learn** — `/api/narrator/learn` proxy (CORS)
9. **PregãoDashboard** — inline `PREGUEIROS_DISPLAY` (HMR fix)
10. **caixa.ts** — cache 10s `getSaldo()`
11. **escriturario** — `switchNetwork()` + unified balance fallback em mainnet
12. **pregão** — `okAgentes` sorted by confidence >= 30%
13. **entryPrice corrompido corrigido** — `agentes-do-pregão.ts:1236`: quando `profitPercent > 100%`, recalcula `entryPrice = amountPaid / amountBought` (swap real), salva posição corrigida via `positionManager.savePositions()`
14. **Painel de carteira no dashboard** — `PregãoDashboard.tsx`: novo card com 🤖 robô explicativo, posições abertas (token, entry, profit%), últimas 5 operações (status, valor, lucro). Dados atualizados a cada 8s via polling do `positionManager`.
15. **getRecentTrades()** — `position-manager.ts:182`: novo método que retorna as últimas N posições (abertas + fechadas) ordenadas por timestamp.
16. **JobRobot (Contratante)** — `lib/job-robot.ts` + `lib/contratante.ts`: robô autônomo que executa swaps USDC/EURC na Arc testnet via `@circle-fin/app-kit` + `createViemAdapterFromPrivateKey` (sem MetaMask). Cada ciclo: verifica saldo → swap com retry (30s backoff, 3 tentativas). Dashboard tem botão Iniciar/Parar visível só na testnet.

### Current State
- **Polygon Mainnet**: wallet $23.30 USDC, $2.085 POL. Bot rodando com LI.FI proxy (CORS resolvido). 25 trades executados, $116.95 bruto / ~$18.77 líquido. entryPrice corrigido automaticamente. Dashboard agora mostra posições abertas + últimas 5 operações.
- **Arc Testnet**: rodando mas perdendo $0.015/trade em USDC→EURC (spread come lucro).
- **CCTP Bridge**: ainda não testado com sucesso
- **LI.FI**: `Failed to fetch` resolvido com proxy `/api/lifi/quote`
- **Ver deploy automático no Vercel**

## Session Summary (26/06/2026) — Quinta Sessão: Banco CriptoMorse (Multi-Strategy Micro-Trading)

### What's Changed

1. **4 correções de bugs**:
   - `real-swap-executor.ts` — `refreshAllBalances()` restaura saldos parciais não-zero (USDC Arc ficava 0)
   - `job-robot.ts` — circuit breaker (3 falhas → para), `cycleCount` incrementa no deploy, `contratante.setPrivateKey()` reseta
   - `stress-test/route.ts` — aceita `body.privateKey` do front-end, não só `process.env`
   - `real-swap-executor.ts:1030` — skip profit check stable→stable em testnet

2. **Autogas ativado em testnets** — removido guard `isTestnet return`, adicionado NATIVE token (0x0000...) na Arc

3. **Fix minTradeSize Polygon** — `agentes-do-pregão.ts:617`: `Math.max(...todas)` → `getMinTradeSize(redeAtual)`. Polygon era $50 (puxado ETH), agora $2.

4. **Modo Grão Batching** (`lib/modo-grão.ts`):
   - Acumula sinais MR+MM (não AND gate) → batch de 3-5 × $5 = $15
   - `targetUSD` cobre gas+spread (não $0.02 fixo)
   - Auto-stablecoin: detecta WETH inviável → migra pra EURC

5. **Robô Ajustador** (`ajustarAoMercado()`): recalibra 7 parâmetros a cada 2min baseado em gas, vol, saldo, spread. Fórmula de break-even: `M_break = ((G/V+1+S)/(1-S))-1`

6. **Stable Micro-Trades** (3 novos módulos):
   - `lib/stable-stability.ts` — detector de micro-movimentos 0.05-0.15% em 5min
   - `lib/stable-pair-scanner.ts` — relatório JSON score 0-100, batch mínimo, lucro estimado
   - `app/components/StableOpportunities.tsx` — painel dashboard com top 3 pares ativos
   - `agentes-do-pregão.ts:745` — pares stablecoin com score ≥30 injetados no topo

7. **Stablecoins Internacionais** (`lib/stablecoins-internacionais.ts`):
   - JPYC (Polygon ~$120K TVL), QCAD (ETH ~$15K)
   - Forex rates: JPY, BRL, AUD, CAD, MXN, ZAR, PHP, CHF, CNH
   - Gate de liquidez: spread estimado por TVL, blacklist regulatória (AxCNH)

8. **Oscar Hunter** (`lib/oscillation-hunter.ts`):
   - Micro-scalping em pools profundas de terceiros (Uniswap V3)
   - SMA mean-reversion: detecta desvio >0.2%, confirma reversão, entra
   - Take-profit 0.15%, stop-loss -0.1%, timeout 5min
   - Pools alvo: USDC/USDT 0.01% ($2M TVL), USDC/DAI 0.05%, USDC/EURC 0.3%

9. **Capital Controller** (`lib/capital-controller.ts`):
   - Gate central: um trade por vez, sempre o melhor score
   - Integrado em: `modo-grão.ts`, `oscillation-hunter.ts`
   - `request()` → autoriza ou enfileira, `unlock()` → próximo na fila

10. **MicroPool AMM** (`contracts/MicroPool.sol`):
    - Uniswap V2 minimalista, 0.3% fee
    - Script deploy: `scripts/deployMicroPoolArc.js`
    - Limitação: $100 TVL → trade $1 = 4% slippage (só viável com TVL >$1000)

### Current State
- **Banco CriptoMorse**: 4 mesas de trading (Grão, Scanner, Internacional, Oscar) + CapitalController
- **Polygon**: $10.32 USDC, POL gas zerado. Autogas corrigido (lê USDC direto RPC). Preço precisa subir 0.33% pra lucrar.
- **Arc Testnet**: USDC $2165, ARC $2167. Autogas ativado, mas LI.FI não tem rota USDC→ARC nativa.
- **Unified Balance (Circle API)**: 404 no plano demo (`networkType: "mainnet"` não suportado)
- **CCTP**: configurado em 5 chains, mas requer gas em ambos os lados
- **Build**: limpo (zero erros TS)**
