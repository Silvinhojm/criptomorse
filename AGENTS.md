## Session Summary (07/07/2026) — Fase 1: Coordinator como núcleo + Roadmap Estratégico

### What's Changed

1. **`ICoordinator.submitProposal()`** — nova interface pública que recebe uma `AgentProposal` externa, roda votação com agentes registrados, resolve consenso, executa via executor e retorna `SubmissionResult { consensus, executionResult }`.

2. **`Coordinator.submitProposal()`** implementado em `coordinator.ts`:
   - Se há agentes registrados: coleta votos → resolve consenso → executa via executor
   - Se não há agentes registrados: pass-through direto (compatibilidade com sistema atual sem agentes IAgent)
   - Safety guard → canExecute → execute → audit → feedback, tudo no mesmo fluxo
   - Logs de rejeição: `[FRAMEWORK] 🚫 agente → par rejeitado: motivo`

3. **`TradingAdapter`** (`lib/agent-framework/trading-adapter.ts`) — novo `IExecutor` que recebe uma função `executeTrade(signal)` no construtor. `execute()` converte `AgentProposal.params` de volta para sinal e chama o Pregão internamente. O Pregão vira dependência interna — não é mais o entry point público.

4. **`frameworkCoordinator`** em `singletons.ts` — instância global do Coordinator com Audit configurado. Exportado em `index.ts`.

5. **`agentes-do-pregão.ts`** — após o setup do Pregão, cria `TradingAdapter` com `originalReceberOK` como callback e registra no Coordinator. O `receberOK` agora roteia sinais para `Coordinator.submitProposal()`. Fallback direto ao Pregão preservado se o Coordinator não estiver configurado.

6. **`docs/ROADMAP.md`** — documento estratégico com 12 fases arquiteturais (Fase 1: Coordinator como núcleo → Fase 12: Plataforma), princípios do projeto, e visão final do ArcFlow como framework open source de coordenação de agentes autônomos.

### Novo Fluxo (Fase 1)

```
Agente
     ↓
Knowledge (Fase 2 — já ativo)
     ↓
Coordinator.submitProposal() ← NOVO entry point
     ↓
Voting (se agentes registrados)
     ↓
TradingAdapter.execute() ← NOVO
     ↓
Pregão (internamente)
     ↓
Audit
```

### Arquivos Criados
| Arquivo | Descrição |
|---------|-----------|
| `lib/agent-framework/trading-adapter.ts` | IExecutor que wrappa Pregão (60 linhas) |
| `docs/ROADMAP.md` | Roadmap estratégico 12 fases (220 linhas) |

### Arquivos Modificados
| Arquivo | Mudança |
|---------|---------|
| `lib/agent-framework/ICoordinator.ts` | +SubmissionResult interface, +submitProposal() |
| `lib/agent-framework/coordinator.ts` | Implementa submitProposal() com fallback sem agentes |
| `lib/agent-framework/singletons.ts` | +frameworkCoordinator |
| `lib/agent-framework/index.ts` | +SubmissionResult, TradingAdapter, TradeSignal, frameworkCoordinator |
| `lib/agentes-do-pregão.ts` | Cria TradingAdapter com originalReceberOK; roteia via Coordinator.submitProposal() |

### Current State
- **Build**: limpo (zero erros TS)
- **Fase 1**: ✅ Em andamento — Coordinator é o entry point real; TradingAdapter wrappa Pregão
- **Fase 2**: ✅ Concluída
- **Fase 3**: ✅ Concluída (votação ponderada)
- **Próximo**: Fase 4 (Audit completo) → Fase 5 (On-chain proof) → Fase 6 (Policy Engine)

## Session Summary (06/07/2026) — Framework Protocol + Dashboard + PregãoDashboard podado

### What's Changed

1. **PregãoDashboard podado (~480 linhas removidas)**: Stress Test, Contratante, StableOpportunities, OKs Ativos, Trades Executados, Pair-Sector — todas as seções de trading removidas. Componente caiu de ~1400 para ~543 linhas.

2. **AgentIntent protocol** — `lib/agent-framework/intent-types.ts`: `AgentIntent`, `IntentRecord`, `IntentStatus`, `IIntentPublisher`. `lib/agent-framework/intent-publisher.ts`: `IntentPublisher` com publish, vote, updateStatus, recordResult, subscribe.

3. **Framework singletons** — `lib/agent-framework/singletons.ts`: `frameworkReputation` (Reputation), `frameworkAudit` (Audit), `frameworkIntents` (IntentPublisher) — estado global reutilizável.

4. **Framework Dashboard** — `app/components/FrameworkDashboard.tsx`: agentes ativos com winRate/score, audit trail (lucro/gas/agentes), intent feed com status e votos, atividades recentes. Polling 3s.

5. **Nova aba "🏗️ Framework"** — adicionada ao `DashboardShell.tsx` e `SectionContext.tsx`. `page.tsx` inclui `<FrameworkDashboard />`.

6. **OnChainIntentPublisher** — `lib/agent-framework/onchain-intent-publisher.ts`: publica intents como jobs ERC-8183 na Arc testnet com auto-sign. Métodos submitDeliverable/completeJob para o ciclo on-chain. `frameworkIntents` agora é `OnChainIntentPublisher` com fallback off-chain.

7. **Build**: limpo (zero erros TS).

### Impacto
- Sistema agora tem protocolo formal de intents (off-chain + on-chain via ERC-8183)
- Framework Dashboard substitui métricas de trading por métricas de agente (reputação, consenso, audit)
- PregãoDashboard reduzido para ~40% do tamanho original — só mantém seções genéricas (agentes, escola robôs, carteira, monitoramento)
- Intents podem ser publicadas on-chain na Arc testnet via auto-sign (precisa `configure(privateKey)`)
- ERC-8183 contract `0x3192...` na Arc testnet

## Session Summary (05/07/2026 tarde) — Memory Leak Fix: 9 bounded arrays + cleanup

### What's Changed

1. **PregãoDashboard cicloRef cleanup** — `app/components/PregãoDashboard.tsx:574`: adicionado `clearInterval(cicloRef.current)` e `clearInterval(balanceTimerRef.current)` no cleanup effect. Antes só limpava `stressTestIntervalRef`. Se o componente desmontasse, o ciclo continuava rodando infinitamente.

2. **8 arrays bounded em lib/** — todos os arrays de histórico em memória agora têm teto máximo:
   - `pregão.ts:ordens` cap 500, `packageResults` cap 100
   - `accountant.ts:reports` cap 1000
   - `real-automated-trader.ts:tradeHistory` cap 500
   - `pair-sector.ts:avaliacoes` cap 500
   - `batch-executor.ts:history` cap 100
   - `contratante.ts:_reports` cap 100
   - `nanopayment-system.ts:payments` cap 500

3. **Documentado em `docs/INCIDENTES-TECNICOS.md`** — tabela completa com arquivo, linha, array e correção.

### Impacto
- Heap JS do navegador tem crescimento limitado previsível (~2-3MB) em vez de ilimitado
- Nenhum intervalo vaza se componente desmontar
- 9 arrays bounded (8 RAM + 1 cleanup)
- Build: limpo (zero erros TS)

### Current State
- **Polygon**: $48.22 USDC, $15.72 POL
- **Arc Testnet**: cirBTC endereço corrigido (oficial Circle), pool USDC/cirBTC precisa recriação
- **Memory leaks**: 9 bugs corrigidos — heap limitado a ~2-3MB para históricos
- **Solana/Backpack**: completamente removidos — Arc EVM exclusivo

## Session Summary (05/07/2026) — Solana + Backpack Exchange removidos, foco exclusivo Arc EVM

### What's Changed

1. **Deleted Solana module** — `lib/solana/` (4 arquivos: config.ts, client.ts, pools.ts, trader.ts), `app/api/solana-proxy/route.ts`, `app/components/SolanaPanel.tsx`. Removida seção "☀️ Solana" do SectionContext/DashboardShell/page.tsx. Zero referências a Solana em toda a base.

2. **Deleted Backpack Exchange module** — `lib/marketData/` (5 arquivos: MarketDataCollector.ts, labelPriceMovement.ts, liquidityFilter.ts, marketHours.ts, BackpackScanner.ts), `app/api/backpack/[...path]/route.ts`, `app/components/BackpackSignalsPanel.tsx`, `scripts/test-market-data-collector.ts`. Removida aba "🎒 Sinais" do SectionContext/DashboardShell/page.tsx.

3. **Removed `trainOnHistoricalData()` do Professor** — método inteiro (100+ linhas) mais helpers `_intervalToMinutes()` e `_syntheticPredictions()` deletados de `lib/professor.ts`. Import de `marketDataCollector`, `labelPriceMovement`, `isStockSymbol`, `isUSStockMarketOpen` removidos.

4. **Removed `parametrosRobosBackpack`** — segunda instância de `ParametrosRobos` deletada de `lib/parametros-robos.ts`. Import removido de `professor.ts`.

5. **Removed `solana: 5`** — chain domain da Solana removido de `lib/cctp.ts`.

6. **Documentação atualizada** — `ARCFLOW.md`: directory tree, localStorage table, módulos do sistema, Current State limpos. `README.md`: linhas de MarketData/Backpack removidas. `docs/INCIDENTES-TECNICOS.md`: referência a Backpack removida.

7. **Build**: limpo (zero erros TS).

### Impacto
- **Foco total em Arc EVM**: sem distrações cross-chain (Solana) ou exchanges centralizadas (Backpack)
- **Código reduzido**: ~1.200 linhas deletadas (15 arquivos)
- **Professor**: mantém treinamento on-chain (Arc Testnet), sem mais contaminação de parâmetros por dados de CEX
- **Vercel**: deploy `a9f32b7` enviado, build compilou com sucesso

### Current State
- **Build**: limpo (zero erros TS)
- **Polygon**: $48.22 USDC, $15.72 POL
- **Arc Testnet**: cirBTC endereço corrigido (oficial Circle), pool USDC/cirBTC precisa recriação
- **DeFi on ARC**: DEX de terceiro ativa (USDC/EURC pool ~$1.43M TVL)
- **Arqueiro**: shadow mode, monitorando compressão de volatilidade
- **Solana/Backpack**: completamente removidos — Arc EVM exclusivo

## Session Summary (04/07/2026) — Batch Executor + 3 AI Consensus + Route Verifier + Nonce Fix

### What's Changed

1. **Batch Executor** — `contracts/BatchExecutor.sol` (novo contrato próprio com Pausable + Ownable + ReentrancyGuard), `lib/BatchExecutorService.ts` (service layer com pré-simulação eth_call, acumulação 8s/10 ordens, cálculo AMM local), integrado em `pregão.ts:executarPacotes()` via `simulateOnly()` antes de gastar gas.

2. **Route Verifier** — `lib/route-verifier.ts`: verifica rota de venda via Multicall3 (`getReserves()` em lote), calcula output local via `x*y=k` com fee 0.3%. Integrado em `job-robot.ts` e `real-swap-executor.ts` — bloqueia compra de tokens sem rota de venda (cirBTC/mcirBTC na Arc).

3. **ICircuitBreaker interface** — `lib/circuit-breaker.ts`: `RouteCircuitBreaker` (5 falhas consecutivas → 20min cooldown) + `FinancialCircuitBreaker` (wrapper do circuit breaker financeiro existente). Ambos implementam `check(): HealthStatus`.

4. **Nonce collision fix** — `lib/job-robot.ts:sendStressTx()`: wallet separada via `PRIVATE_KEY_STRESS` (variável de ambiente). Antes usava mesma wallet dos swaps reais → nonce collision com NonceManager.

5. **Arc WebSocket** — Testado: `eth_subscribe` retorna `"Internal error"` — não suportado na Arc. Mantido polling HTTP.

### Arquitetura — 3 AI Consensus (04/07/2026)

5 sugestões analisadas por 3 IAs (DeepSeek + 2):

| # | Sugestão | Veredito | Razão |
|---|----------|----------|-------|
| 1 | **Batch Executor** | ✅ IMPLEMENTADO | Único ganho real para $65 capital — diluir gas |
| 2 | **Dark Pool P2P** | ❌ CANCELADA | "Voto duplo nos dois lados" é bug arquitetural |
| 3 | **JIT Liquidity** | ❌ CANCELADA | 3× não + contradiz decisão Kelly/tensionScore |
| 4 | **Paymaster 4337** | ❌ CANCELADA | $1.50/mês de economia não justifica complexidade |
| 5 | **Cross-Chain Netting** | ❌ CANCELADA | Complexidade desproporcional para 2 chains ativas |

### Batch Executor — Arquitetura

```
┌──────────────┐    8s / 10 ordens    ┌──────────────────────┐
│  Pregão      │ ──────────────────►  │ BatchExecutorService │
│ executarPac. │                      │                      │
│              │ ◄─────────────────── │ 1. Acumular ordens    │
│              │   simulated OK/FAIL  │ 2. Simulate (eth_call)│
│              │                      │ 3. Submit tx on-chain │
│              │   simulateOnly()     │ 4. Parse resultados   │
└──────────────┘                      └───────┬──────────────┘
                                              │
                                    ┌─────────▼──────────┐
                                    │  BatchExecutor.sol  │
                                    │  submitBatch()      │
                                    │  executeBatch()     │
                                    │  pause()/unpause()  │
                                    └─────────────────────┘
```

### Arquivos Criados
| Arquivo | Descrição |
|---------|-----------|
| `contracts/BatchExecutor.sol` | Contrato: submitBatch, executeBatch, estimateBatch, pause (168 linhas) |
| `lib/BatchExecutorService.ts` | Service layer: accumulate, simulateOnly, executeBatch (152 linhas) |
| `lib/route-verifier.ts` | Verificação de rota de venda via Multicall3 + AMM (126 linhas) |
| `scripts/deployBatchExecutorArc.js` | Deploy na Arc testnet (48 linhas) |

### Arquivos Modificados
| Arquivo | Mudança |
|---------|---------|
| `lib/circuit-breaker.ts` | ICircuitBreaker interface + RouteCircuitBreaker + FinancialCircuitBreaker |
| `lib/job-robot.ts` | PRIVATE_KEY_STRESS wallet separada, route gate via hasSellRoute() |
| `lib/real-swap-executor.ts` | Route gate via hasSellRoute() antes de comprar tokens Arc |
| `lib/pregão.ts` | BatchExecutorService.simulateOnly() em executarPacotes() |

### Próximos Passos
1. Testar Batch Executor na Arc Testnet (gasless)
2. Medir economia real de gas vs execução individual
3. Se funcionar, deploy na Polygon (com capital real)
4. Monitorar por 1 semana

### Current State
- **Build**: limpo (zero erros TS)
- **Polygon**: ~$63.94 (ativos). Batch executor ainda não deployado na Polygon.
- **Arc Testnet**: BatchExecutor.sol deployado, route gate ativo (bloqueia cirBTC/mcirBTC sem rota de venda)
- **Nonce**: wallet stress test isolada, sem colisão com NonceManager
- **Route Verifier**: bloca compra sem rota de venda — commodity antes de security
- **ARCFLOW.md**: seções 53-55 adicionadas (Batch Executor, Decisões Arquiteturais, Novos Módulos)
- **README.md**: tabela de módulos + contratos + roadmap atualizados

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

## Session Summary (28/06/2026) — StableMR na Polygon + EURC pairs + guardas ajustados

### What's Changed

1. **EURC pairs adicionados à Polygon** — `lib/real-swap-executor.ts:185-190`: adicionados USDC→EURC, EURC→USDC, EURC→DAI, DAI→EURC, EURC→USDT, USDT→EURC nos `TRADING_PAIRS.polygon`. Antes não havia par stable-stable com EURC na Polygon, apenas na Arc e Ethereum.

2. **StableMR threshold 0.05% → 0.10%** — `lib/stable-mr.ts:7`: `DEVIATION_THRESHOLD` subido de `0.0005` para `0.001` (0.10%). Motivo: threshold original de 0.05% disparava em ruído de spread DEX (EURC/USDC spread típico ~0.05%). A 0.10%, dispara em desvios 2σ (várias vezes ao dia em dias úteis).

3. **Guard de perda do StableMR relaxado** — `lib/pregão.ts:697-704`: antes abortava se `lucroRealEsperado < -0.5 × gas` (~$0.0025). Agora aborta só se `lucroRealEsperado < -1% do amount` (ex: -$0.125 em $12.50). Motivo: DEX fee fixa de 0.3% (SushiSwap) em trade de $12.50 gera perda de ~$0.038 na cotação — 8× maior que o guard antigo. O StableMR aceita perda na entrada porque o lucro vem da reversão.

4. **Análise matemática documentada**: round trip DEX fee (0.3% × 2 pernas = 0.6%) exige desvio > 0.3% para break-even. Com guard relaxado para 1%, trades de entrada com fee 0.3% passam livremente.

### Impacto Esperado
- StableMR dispara várias vezes ao dia em EURC/USDC na Polygon (dias úteis, forex aberto)
- Cada buy leg perde ~$0.036 em DEX fee (aceito — lucro na reversão)
- Guard de 1% só aborta em slippage catastrófico (>1% de perda na cotação)
- Modo Grão continua travado (Vmin=$14 > saldo $48.22) — requer recarga de USDC
- Professor continua criando pacotes de agentes ($15 WMATIC/WETH) rejeitados por `lucro real -$0.1544 < mínimo $0.009`

### Current State
- **Build**: limpo (zero erros TS)
- **Polygon**: $48.22 USDC, $15.72 POL. EURC pairs prontos para StableMR.
- **StableMR**: threshold 0.10%, guard 1%, amount mínimo $12, target EURC/USDC.
- **Agentes**: Sentimento (80%), Tático (45-65%), Tendência (85%) enviando OKs, mas sem consenso (precisa 2 agentes concordando).
- **Grid**: parado — dip gate (2% WMATIC, 1.5% WETH) não atingido.
- **Dead code**: `escriturario.ts:prepararOrdem()` nunca chamado (onOrdemCallbacks vazio).

## Session Summary (28/06/2026 tarde) — PiFilter warmup + noiseProbability + BigInt serialization

### Bugs Corrigidos

1. **PiFilter warmup guard** — `lib/math/pi-filter.ts:16`: adicionado `WARMUP_SAMPLES = 18`. Bloqueia emissão de sinais até EWMA/variância estabilizarem. Antes, σ explodia para 4.47 no sample #2 com vol near-zero, gerando falsos positivos em toda inicialização.

2. **noiseProbability invertida** — `lib/math/pi-filter.ts:188`: `return Math.min(1, 2 * (1 - p))` → `return Math.min(1, 2 * p)`. A função retornava 1.0 para todo σ porque computava probabilidade de estar DENTRO do intervalo (2×Φ(σ)) em vez da cauda bilateral (2×P(X>|σ|)). Agora retorna 0.134 para σ=1.5 (~13% de ser ruído).

3. **BigInt no JSON.stringify** — `lib/pool-profiler.ts:_save()`: `liquidity: bigint` convertido para `liqStr: string` antes de `JSON.stringify`. `_load()` reconverte `BigInt(liqStr)`. PoolProfiler agora serializa/deserializa corretamente via localStorage.

### Dry-run Validado
- `scripts/dry-run-grao-v2.ts`: 5 cenários, todos passam (ruído filtrado, anomalia detectada, descolamento com lote máximo, noiseProbability correta, cache BigInt roundtrip)
- Warmup compartilhado com ruído DEX realista (±0.017%, vol ≈ 0.013%)

### Current State
- **Build**: limpo (zero erros TS)
- **PiFilter**: warmup 18 ticks, sigma threshold ±1.5, lote dinâmico baseAmount × (σ/σ_entry)², cap $30
- **PoolProfiler**: cache 5min (pools encontradas) / 1h (miss), fee tiers 100/500/3000, BigInt-safe
- **StableMR**: integrado com PiFilter, DEX V3 quoting, PoolProfiler para filtro de pool
- **Modo Grão V2**: pronto para mainnet — aguardando monitoramento de logs `🌾 PiEngine`

## Session Summary (28/06/2026 noite) — Diagnóstico + StableMR V2 fallback + Modo Grão + PiEngineMonitor

### Diagnóstico Operacional
- **StableMR nunca emitia `🌾 PiEngine`**: `poolProfiler.getPools()` falhava (QuickSwap V3 sem pools EURC ou RPC timeout) → `pools.length === 0` → `continue` pulava o par sem tentar V2
- **Modo Grão preso em test mode** na Polygon: `start()` foi chamado na Sepolia, rede trocada depois sem re-inicializar
- **PoolProfiler enterrava pares por 1h**: RPC falha → cache miss TTL 1h; primeira falha bloqueava EURC por 1h inteira

### Correções

1. **StableMR V2 fallback** (`lib/stable-mr.ts:83-131`): reestruturado para tentar V2 quando V3 não acha pools. PiFilter inicializado antes da consulta de pool.

2. **Modo Grão network-aware** (`lib/modo-grão.ts:269-283`): `_lastNetwork` detecta mudança de rede no ciclo, desliga test mode ao trocar testnet→mainnet.

3. **PoolProfiler TTL 5min** (`lib/pool-profiler.ts:45`): `CACHE_TTL_MISS` 1h→5min, log de diagnóstico nas primeiras 3 falhas RPC.

4. **PiEngineMonitor** (`app/components/PiEngineMonitor.tsx`): telemetria Gaussiana em tempo real no dashboard — warmup bar, sigma com gradiente de cores (cinza→azul→violeta→pulse verde/vermelho), prob. ruído, histórico de roteamento ⚡V3/🔄V2/🛑Abortado/⏳Requote, estados nulos com fallback amigável.

### Current State
- **Build**: limpo (zero erros TS)
- **Dry-run**: 5/5 ✅
- **StableMR**: 10 pares EURC na Polygon, V2 fallback ativo quando V3 ausente
- **Modo Grão**: auto-desliga test mode em mainnet, re-inicializa ao trocar rede
- **PoolProfiler**: TTL miss 5min, BigInt-safe, log diagnóstico RPC
- **Dashboard**: PiEngineMonitor integrado abaixo do Modo Grão, polling 2s

## Session Summary (27/06/2026) — 4 Fixes + StableMR + Professor flexivel

### What's Changed

1. **Fix volatilidade 0.0%** — `volatility-tracker.ts:64`: `data[coinId]` → `(data.prices ?? data)[coinId]`. Bug impedia coleta de preços (API retorna `{ prices: { id: val } }` mas código lia `data[id]` = undefined). Todos os agentes e o Grid ficavam sem volatilidade → confiança 0 → sem trades.

2. **Fix grid amountUsd** — `grid-trading.ts:343`: removido `receberOK` interno (double OK). `agentes-do-pregão.ts:1156`: adicionado `amountUsd: 5` no OK real. Antes, sem `amountUsd`, escriturario usava 90% do saldo ($43.40) em vez de $5.

3. **Fix limparOrdensTravadas timeout** — `pregão.ts:509`: timeout de "pronto" de 5s → 120s. Antes ordens eram mortas antes do Professor conseguir pegá-las no ciclo seguinte (ciclo de 10s, timeout de 5s = janela impossível).

4. **Fix double OK do Grid** — `grid-trading.ts:339-351`: removido `pregão.receberOK()` de dentro de `checkLevels()`. O caller em `agentes-do-pregão.ts:1112-1165` já envia o OK com verificações de saldo. Antes cada nível acionado gerava 2 OKs (um interno sem amountUsd/saldo check, outro externo com).

5. **Fix grid multi-nível** — `grid-trading.ts:319-377`: reescrito para disparar apenas 1 nível por direção por ciclo (o mais próximo). Antes disparava 7+ níveis quando preço cruzava múltiplos triggers.

6. **Fix trading-nanopayments price parse** — `trading-nanopayments.ts:66`: mesmo bug `data[coinId]` → `(data.prices ?? data)[coinId]`.

7. **DEX timeout 5s→10s** — `pregão.ts:553`: mais cotações chegam antes do fallback.

8. **Gas threshold 2x→1x** — `pregão.ts:672`: `gasMultiplier` normal de 2.0 para 1.0.

9. **basePct Polygon 0.1%→0.05%** — `pregão.ts:621`: threshold de lucro reduzido. Floor $0.005→$0.003.

10. **StableMR module** — `lib/stable-mr.ts`: novo módulo de mean reversion pra stable pairs. Mantém SMA rolante (12 amostras), dispara OK de compra/venda quando desvio > 0.05% da média. Amount dinâmico: `max($12, |dev| × 5000)`.

11. **Professor flexível pra stables** — `pregão.ts:622+674+679`: quando StableMR tem sinal ativo, Professor reduz `basePct` pra 0.03%, skipa real profit check (lucro vem da reversão, não da entrada), só aborta se perda > 0.5× gas.

### Impacto Esperado
- Volatilidade volta a funcionar → agentes ganham confiança → OKs reais
- Grid trades de $5 em vez de $43.40
- Professor tem 120s para pegar ordens "pronto" antes do timeout
- Grid gera 1 OK por nível (não 2)
- DEX timeout 5s→10s: mais cotações chegam antes do fallback
- Gas threshold 2x→1x: lucro $0.0107 cobre gas $0.009 e executa
- Grid só dispara 1 nível por ciclo (não 7+)
- StableMR opera stables com entrada $12+ em desvios >0.14%

### Current State
- **Build**: limpo (zero erros TS)
- **Polygon**: $48.22 USDC, $15.55 POL
- **Arc Testnet**: $84 EURC, $0 USDC, posições cirBTC/mcirBTC abertas

## Session Summary (27/06/2026) — 4 Fixes: Volatilidade, Grid amountUsd, Timeout, Double OK

### What's Changed

1. **Fix volatilidade 0.0%** — `volatility-tracker.ts:64`: `data[coinId]` → `(data.prices ?? data)[coinId]`. Bug impedia coleta de preços (API retorna `{ prices: { id: val } }` mas código lia `data[id]` = undefined). Todos os agentes e o Grid ficavam sem volatilidade → confiança 0 → sem trades.

2. **Fix grid amountUsd** — `grid-trading.ts:343`: removido `receberOK` interno (double OK). `agentes-do-pregão.ts:1156`: adicionado `amountUsd: 5` no OK real. Antes, sem `amountUsd`, escriturario usava 90% do saldo ($43.40) em vez de $5.

3. **Fix limparOrdensTravadas timeout** — `pregão.ts:509`: timeout de "pronto" de 5s → 120s. Antes ordens eram mortas antes do Professor conseguir pegá-las no ciclo seguinte (ciclo de 10s, timeout de 5s = janela impossível).

4. **Fix double OK do Grid** — `grid-trading.ts:339-351`: removido `pregão.receberOK()` de dentro de `checkLevels()`. O caller em `agentes-do-pregão.ts:1112-1165` já envia o OK com verificações de saldo. Antes cada nível acionado gerava 2 OKs (um interno sem amountUsd/saldo check, outro externo com).

### Impacto Esperado
- Volatilidade volta a funcionar → agentes ganham confiança → OKs reais
- Grid trades de $5 em vez de $43.40
- Professor tem 120s para pegar ordens "pronto" antes do timeout
- Grid gera 1 OK por nível (não 2)
- DEX timeout 5s→10s: mais cotações chegam antes do fallback
- Gas threshold 2x→1x: lucro $0.0107 cobre gas $0.009 e executa
- Grid só dispara 1 nível por ciclo (não 7+)

### Current State
- **Build**: limpo (zero erros TS)
- **Polygon**: $48.22 USDC, $15.55 POL
- **Arc Testnet**: $84 EURC, $0 USDC, posições cirBTC/mcirBTC abertas

## Session Summary (27/06/2026) — Auditoria Completa: Fórmulas, Banco Central, Robôs

### O que foi feito

**Auditoria técnica completa** do sistema CriptoMorse — todas as fórmulas matemáticas verificadas, arquitetura do CapitalController analisada, integração dos robôs mapeada. Resultados documentados na seção AUDITORIA TÉCNICA do ARCFLOW.md.

### Bugs Identificados

**BUG #1 — lockedBy mismatch (CRÍTICO)**: `capital-controller.ts:50` compara `p.id === this.state.lockedBy`. CapitalController usa IDs estilo `"agentes:USDC→WMATIC:polygon:123"` enquanto PositionManager usa `"pos_polygon_WMATIC_123"`. Match NUNCA ocorre — unlock() sempre libera capital mesmo com posição ativa. CapitalController não está protegendo o capital como deveria.

**BUG #2 — Stuck transaction sem unlock**: `pregão.ts:getOrdensAtivas()` marca ordem como falha após 120s timeout, mas NUNCA chama `capitalController.unlock()`. Se transação trava na rede, capital fica locked permanentemente.

**NOTA — Score fixo do Modo Grão**: `modo-grão.ts:381` passa `score: 50` fixo. **Não é bug** — é design: Modo Grão opera stable pairs (baixo risco), score fixo dá prioridade consistente. Oscillation Hunter só passa na frente em desvios >0.24% (score >50). Agentes também usam 50. Professor usa 0-5 (propositalmente baixo).

### Fórmulas Verificadas

- **M_break** (break-even volátil): `((G/V + 1 + S)/(1 - S)) - 1` — correta. WETH: 0.79%, EURC: 0.79% (mas EURC vol real 0.05-0.30% → inviável)
- **V_min** (batch mínimo): `ceil(gasRT / margemMinima)` — correta. EURC: $28, WETH: $3
- **Confiança Oscar**: `min(90, round(40 + |dev| × 2500))` — correta. Desvio 0.20% → conf 45 (threshold)
- **Score Contábil**: `winRate × 0.5 + min(avgProfit,1) × 20 + profitBonus + max(0,streak) × 0.5` — max teórico ~95 pts. Streak suavizado (EMA α=0.3), máximo assintótico 5.0 → contribuição max 2.5 pts
- **Poder de Voto**: `profitRatio × 0.6 + winRateRatio × 0.4` — ok, mas 1 agente = power 1.0 (irrelevante)

### SoSoValue Rate Limit Analysis

- 20 req/min (demo plan) = ~4 fetches/min para todos os tokens
- 15s cache de preço = preço pode estar 15s atrasado
- Em volatilidade 1%/min: diferença de 0.25% entre preço cacheado e real → **ANULA a margem de 0.1% da Polygon**
- **Risco**: ordens de compra em topo local, venda em fundo local

### Overhead de Locks

7 locks por trade: escriturario → CapitalController → refreshLock → NonceManager → pregão → circuit breaker → unlock()
Overhead: 500-1500ms adicionais. Aceitável para trades de 30-120s.

### Recomendações

1. **Fix lockedBy**: unlock() deve checar `boughtToken + networkKey` em vez de `id`
2. **Stuck TX**: `capitalController.forceUnlock()` no timeout de ordem do pregão
3. **Score dinâmico universal**: score = `min(100, round(expectedProfit / amountUSD × 5000))`
4. **Slippage tolerance**: reduzir de 5% para 0.5% (margem de lucro é 0.1%)
5. **Price cache**: reduzir de 15s para 5s em modo mainnet

### Estado Atual

- **Polygon**: $48.22 USDC, $15.55 POL. 6 trades on-chain, 100% win rate, $18.77 lucro.
- **Retorno sobre capital**: 28.9% (~$65 capital inicial)
- **ARCFLOW.md**: nova seção AUDITORIA TÉCNICA (A-E) com fórmulas matemáticas completas, bugs, locks, métricas
- **Build**: verificar após edições

## Session Summary (27/06/2026) — Décima Sessão: CapitalController em Harmonia Total

### What's Changed

**1. CapitalController integrado no Ciclo de Agentes (corretor.ts)**
- `corretor.ts:executar()` — antes de chamar `realSwap.executeSwap()`, faz `capitalController.request()`. Se capital ocupado, ordem volta pra "preparando" com log `"⏳ Capital ocupado — ordem X na fila"`. `unlock()` em `finally` garante liberação mesmo em erro.
- `corretor.ts:executarBatch()` — mesmo padrão para batches (UltraFlash). Soma todos os valores do batch em `totalValor`, faz request único. Se negado, todas as ordens voltam pra "preparando".

**2. CapitalController integrado no Professor (pregão.ts:executarPacotes())**
- `pregão.ts:751-764` — antes de executar o batch UltraFlash via `batchApprove`/`executeBatch`, faz `capitalController.request()`. Score calculado como `min(100, round(expectedProfit / invested * 1000))`. Se negado, pacote é re-registrado via `setorPacotes.registrarPacote(pacote)` para tentar no próximo ciclo. `unlock()` em `finally`.

**3. Quatro caminhos de trading agora compartilham o mesmo gate:**

| # | Método | Arquivo:linha | `request()` | `unlock()` | Score típico |
|---|--------|---------------|-------------|------------|-------------|
| 1 | **Oscillation Hunter** | `oscillation-hunter.ts` | antes do swap | `finally` | 60-90 (vol * depth) |
| 2 | **Modo Grão** | `modo-grão.ts` | antes do batch | `finally` | 40-70 (sinais MR+MM) |
| 3 | **Agentes (testnet)** | `corretor.ts:executar()` | linha 51 | `finally` linha 225 | 50 fixo |
| 4 | **Professor (mainnet)** | `pregão.ts:executarPacotes()` | linha 754 | `finally` linha 871 | 0-100 (profit/invested) |

**4. Prioridade por score com desempate FIFO:**
- CapitalController mantém fila ordenada por score decrescente
- `unlock()` libera o próximo da fila automaticamente
- Requests expiram em 5 minutos (fila é limpa a cada `request()`)
- `waitPosition` retornado informa quantos estão na frente

### Current State
- **Build**: limpo (zero erros TS)
- **Harmonia**: todos os 4 métodos passam pelo mesmo `capitalController.request()`. Nunca dois trades concorrem pelo mesmo USDC.
- **Fila**: quando capital ocupado, requests se acumulam ordenados por score. `unlock()` libera o melhor automaticamente.
- **Polygon**: $48.22 USDC, $15.55 POL. Sistema operando — 6 trades on-chain, 100% win rate, $18.77 lucro.

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

## Session Summary (26/06/2026) — Sexta Sessão: Estabilidade (5 fixos + 3)

### What's Changed

1. **Fix A — NaN guard**: `pregão.ts` (linha ~634 `receberOK`) sanitiza `corretagem.signalConfidence` com `Math.min(100, Math.max(0, c))`. `agentes-do-pregão.ts` guarda divisão por zero em `confiancaMedia`. Ordenações com confidence inválida são descartadas. Confirmado: zero NaN orders.

2. **Fix B — Lock de par**: `escriturario.ts`: `Set<string>` module-level key `fromToken→toToken@rede` previne execução concorrente do mesmo par. Lock movido para topo de `prepararOrdem` (antes de qualquer refresh) para bloquear duplicatas cedo.

3. **Fix C — Fórmula Vmin**: `modo-grão.ts`: `margemMinima = max(vol - spread, 0.001)`, `Vmin = min(gas/margem, saldo*0.5)`, early return se `Vmin > saldo`. Vmin agora $5–$12 (antes $99999).

4. **Fix D — Network guard**: `position-manager.ts` (`openPosition()` retorna null se rede ≠ ativa) + `quantum-wave.ts` (`broadcastIntent` filtra pairs para rede ativa). Zero phantom positions.

5. **Fix E — CORS gas oracle**: `gas-price-oracle.ts`: substituído `new ethers.JsonRpcProvider(llamarpcUrl)` por `fetch(/api/rpc-proxy)` via `eth_gasPrice`. Zero llamarpc no console.

6. **NonceManager thread-safety**: `nonce-manager.ts`: `getNonce()` serializado via Promise-chain mutex. Previne nonce collision em concorrência.

7. **JobRobot circuit breaker**: `job-robot.ts`: nonce/revert errors decrementam `consecutiveFails` ao invés de incrementar. `cycleCount` incrementa no deploy. `contratante.setPrivateKey()` reseta.

8. **refreshAllBalances serialization**: `real-swap-executor.ts`: mutex (`_refreshLock`) previne race condition que zerava cache de saldos.

9. **Fix F — LockKey no topo**: `escriturario.ts:prepararOrdem()` — lock check movido para antes do refreshAllBalances. Se par já está processando, retorna cedo sem duplicar refresh.

10. **Fix G — Value transfer guard**: `arc-direct-swap.ts`: check `fromToken !== NATIVE && toToken !== NATIVE` antes do fallback value transfer. Previne enviar ARC nativo quando o par é mcirBTC→USDC.

11. **Fix H — mcirBTC price normalization**: `real-swap-executor.ts`: novo `PRICE_DIVIDERS` record com mcirBTC divider 10^10. `_getTokenPrice` divide o preço da API pelo divisor. Catch blocks do `refreshAllBalances` usam `TOKEN_DECIMALS[symbol] ?? 6` em vez de hardcoded 6.

### Current State
- **Build**: limpo (zero erros TS)
- **Polygon**: $10.32 USDC, POL gas zerado
- **Arc Testnet**: USDC $2165, ARC $2167. Value transfer bloqueado para mcirBTC.
- **mcirBTC posição**: entry $1.0011, price normalizado de $299k para ~$0 (divisor 10^10)
- **All 11 fixes applied**: 6 stability (A-E) + 3 infra (NonceManager, JobRobot, refreshLock) + 2 late fixes (F, G, H)

## Session Summary (27/06/2026) — Sétima Sessão: Destravando trades reais na Polygon

### What's Changed

1. **Unified Balance desabilitado** — `lib/caixa.ts`: `initBrowser()` sempre retorna `false`. Fim do spam 404 `/api/circle-proxy/v1/balances` (plano demo não suporta a API). Sistema usa `_liveBalance` (wallet local) como fallback.

2. **RPC proxy robusto** — `app/api/rpc-proxy/route.ts`: lê resposta como texto e faz `JSON.parse` manual (antes `res.json()` quebrava se RPC retornasse HTML em vez de JSON). Timeout 15s→25s.

3. **UltraFlash multicall ABI corrigida** — `lib/ultraflash.ts`: `struct Call/Result` inline → `tuple(...)` syntax compatível com ethers v6. Erro `multicall.aggregate3 is not a function` eliminado.

4. **Threshold de lucro reduzido: 0.2%→0.1%** — `lib/pregão.ts:567`: `basePct` para Polygon (e outras L2s não-ETH) de 0.002 para 0.001. Pacotes de $5 com lucro $0.0053 agora passam.

5. **LI.FI quote timeout 5s→10s** — `lib/pregão.ts:511`: LI.FI via proxy é mais lento; DEX direto mantém 5s.

6. **Modo Grão auto-desliga test mode em mainnet** — `lib/modo-grão.ts:start()`: se `_testMode=true` em rede não-testnet, força `false` e persiste em localStorage.

### Current State
- **Polygon**: $50.21 USDC + $13.81 POL (192 POL = gas pra milhares de swaps)
- **Console limpo**: sem spam 404 do Circle, sem 502 do RPC
- **Pares Polygon**: USDC→WMATIC (64%), USDC→WETH, WMATIC→USDC (pares Arc como mcirBTC/cirBTC/ARC não aparecem porque os tokens não existem na Polygon — filtro automático)
- **UltraFlash**: deve executar batches via Multicall3 com a ABI corrigida

## Session Summary (26/06/2026) — Quarta Rodada: entryPrice, LI.FI slippage, Professor cache

### What's Changed

1. **Fix H (refinado) — entryPrice cirBTC em stress mode**: `real-swap-executor.ts:executeSwap` — `directResult.amountReceived` é o `fromAmount` cru (decimals do FROM token). Linha 1022 agora usa `TOKEN_DECIMALS[toToken] ?? 18` em vez de `toDecimals` (que podia vir do cache com decimals errado). entryPrice = `amountUsd / (rawAmount / 10^outputDecimals)`.

2. **Fix I — Validação de slippage pós-LI.FI**: `real-swap-executor.ts` — após executar rota LI.FI (linha 1117+), compara `bestToEstimate` (cotado) vs `actualToAmount` (real via diff balance). Se slippage > 5%, loga `⚠️ Slippage excessivo: X% — cotado Y vs real Z`. Mesma validação no fallback route (linha 1097+). Não reverte TX, mas o log é claro e o profit negativo já penaliza o agente.

3. **Fix J — Professor com localStorage cache**: `professor.ts` — novo `init()` que carrega estado salvo de `arcflow_professor_estado` (inclui `RoboEscolar` de `escolaRobos` + streaks). Se cache existe, restaura sem reprocessar histórico. `_salvarEstado()` chamado após cada ajuste via `_aplicarAjustes()` e `registrarPalpite()`. Chamado no construtor.

### Current State
- **Build**: limpo (zero erros TS)
- **Polygon**: $10.32 USDC, POL gas zerado
- **Arc Testnet**: USDC $2165, ARC $2167
- **entryPrice cirBTC/mcirBTC**: normalizado por `TOKEN_DECIMALS[toToken] ?? 18`
- **LI.FI**: slippage >5% logado (perda da cotação vs execução registrada)
- **Professor**: `init()` no construtor, estado em localStorage
- **All 14 fixes**: 6 stability + 3 infra + 2 late (F, G) + 3 round4 (H refinado, I, J)

## Session Summary (27/06/2026) — Nona Sessão: RPC proxy fallback + Ethereum 502 fix

### What's Changed

1. **RPC proxy com fallback automático** — `app/api/rpc-proxy/route.ts`: aceita `fallbacks: string[]` no body. Tenta RPCs em sequência: primário → fallbacks. Só retorna 502 se TODOS falharem. Backward compatible (callers antigos sem `fallbacks` continuam funcionando).

2. **Ethereum RPC trocado** — `lib/real-swap-executor.ts`: `eth.llamarpc.com` → `ethereum-rpc.publicnode.com` (mais confiável, já estava nos fallbacks).

3. **_createProxyProvider com fallbacks** — `lib/real-swap-executor.ts:444`: passa `BACKUP_RPCS[networkKey]` para o proxy, permitindo fallback automático em todas as chamadas ethers.js via proxy.

4. **GasPriceOracle com fallbacks** — `lib/gas-price-oracle.ts`: `_fetchGasPrice` passa `RPC_FALLBACKS[networkKey]` para o proxy. Timeout 10s→15s. Mensagens de erro mais descritivas.

### Current State
- **Polygon**: $48.22 USDC, $15.55 POL. 6 trades on-chain, 100% win rate, $18.77 lucro.
- **Console**: Ethereum RPC não polui mais com 502 — proxy tenta `publicnode.com` + `ankr.com` antes de falhar.
- **Build**: sem novos erros TS (4 pré-existentes inalterados).

## Session Summary (27/06/2026) — Oitava Sessão: Concorrência de vendas eliminada

### What's Changed

1. **Fix 1 — TOCTOU fechado**: `lib/escriturario.ts`: `emExecucao.add(lockKey)` movido para ANTES do primeiro `await` (linha 44). Antes o lock era adquirido 90 linhas depois de checado, com múltiplos `await`s no meio — duas ordens do mesmo par passavam pelo check simultaneamente. Agora tudo fica dentro de `try/finally`.

2. **Fix 2 — Agentes checam ordens ativas**: `lib/agentes-do-pregão.ts`: ambos os caminhos de venda (posição aberta e posição fechada) agora chamam `pregão.getOrdensAtivas()` antes de injetar OKs. Se já existe ordem pendente para `fromToken→toToken@rede`, descarta a duplicata — mesma proteção que o Grid já tinha.

3. **Fix 3 — Defense-in-depth**: `lib/pregão.ts:verificarOrdem()`: antes de criar uma nova ordem, verifica se já existe ordem ativa (`preparando`/`pronto`/`executando`) para o mesmo par+direção+rede. Captura qualquer duplicata que passe pelos guards anteriores.

### Current State
- **Build**: limpo (zero erros TS)
- **Polygon**: $48.22 USDC, $15.55 POL. Sistema operando — 6 trades on-chain, 100% win rate, $18.77 lucro.
- **Concorrência**: logs mostram `⛔ Já existe ordem ativa para WETH→USDC@polygon — descartando duplicata` bloqueando todas as tentativas extras do Staircase
- **Modo Grão**: ativo mas sem oportunidades (EURC vol 0.05% < mínimo 0.10%)
- **Professor**: pacotes com lucro $0.0140, threshold $0.0150 — aguardando 2ª tentativa
- **Vercel/GitHub**: commit `608e341` enviado para `origin/versao-polygon`

## Session Summary (27/06/2026) — Décima Primeira Sessão: LI.FI skip + Grid $20 + profit check skip

### What's Changed

1. **Pula LI.FI em trades pequenos**: `lib/pregão.ts:557` — `_quoteTrade()` só chama LI.FI quando `trade.amount >= 20`. Trades < $20 usam só DEX direto (SushiSwap), economizando 0.1% de fee do aggregator.

2. **Mesmo guard no corretor.ts**: `lib/corretor.ts:309` — `getQuote()` condicionado a `valorTrade >= 20`.

3. **Mesmo guard no real-swap-executor.ts**: `lib/real-swap-executor.ts:1040` — LI.FI só consultado quando `amountUsd >= 20`.

4. **Grid amount $5 → $20**: `lib/agentes-do-pregão.ts:1164` — `amountUsd: 5` → `amountUsd: 20`. Grid agora usa $20 por nível (antes $5).

5. **Grid skipa profit check real**: `lib/pregão.ts:688` — Grid trades (detectados por `agentes.some(a => a.startsWith("Grid:"))`) pulam a checagem de lucro real, igual StableMR. Só abortam se perda > 0.5× gas. Motivo: Grid compra volátil com fee DEX 0.3%, lucro vem da reversão (venda), não da entrada.

### Impacto Esperado
- LI.FI skipado para Grid ($20) e StableMR ($12): quoting direto SushiSwap, sem 0.1% extra
- Grid $20 + profit check skip: passa pelo quoting sem rejeição por lucro negativo na compra
- DEX fee 0.3% ($0.06) aceito como custo de entrada, grid espera movimento de preço pra lucrar na venda

## Session Summary (29/06/2026) — 6 Fixes: RPC fallbacks, Balance race, EURC→USDC, Stork, Professor

### What's Changed

1. **RPC fallbacks Arc testnet** — `lib/real-swap-executor.ts:332-334`: adicionado `arc` key com 2 URLs (`rpc.testnet.arc.network`, `testnet.arc.network/rpc`) em `BACKUP_RPCS`. Antes `arc: []` — sem fallback, única URL falhava → proxy 502. Mesma correção em `lib/gas-price-oracle.ts:20-23`.

2. **Balance race condition (atomic swap)** — `lib/real-swap-executor.ts:_refreshAllBalancesImpl()`: substituído `this.tokenBalances.clear()` + repopulate por `newBalances` local, com swap atômico `this.tokenBalances = newBalances` ao final. Antes, `clear()` executava antes do repopulate, e `getBalance()` concorrente via escriturario via 0 saldo → `❌ Saldo insuficiente`.

3. **EURC→USDC synthetic** — `lib/arc-direct-swap.ts:71-80`: novo synthetic path que detecta stable→stable em testnet e retorna sucesso 1:1 sem on-chain. Antes EURC (`0x89B5`) rejeitava `transfer(self)` e catch block caía em `Nenhuma rota disponível`.

4. **Stork auto-disable** — `lib/pair-price-feed.ts:100-101`: `storkFailCount` + `storkDisabledPermanently` — após 10 falhas consecutivas do oracle Stork, desativa permanentemente (não tenta mais). Antes retentava a cada 60s com log de warn.

5. **Professor — cirBTC PRICE_DIVIDER** — `lib/real-swap-executor.ts:32`: adicionado `cirBTC: 10_000_000_000` ao `PRICE_DIVIDERS`. Antes cirBTC usava raw BTC price (~$60k) sem divider → erro de 5,999,900% em avaliações.

6. **Professor — stable pair threshold** — `lib/professor.ts:186-189`: threshold reduzido de 0.1% para 0.02% em pares stable-stable. Antes EURC/USDC com vol 0.05% nunca atingia threshold 0.1% → todo palpite virava "erro" → parâmetros endureciam até conf=55%, entrada=1.5%, score -30k.

### Professor streak fix (29/06/2026 tarde)

**Bug fatal**: robôs com 30+ erros consecutivos em `USDC→mcirBTC` (Arc testnet) chegavam ao teto (conf.min=55%, entrada=1.50%) mas continuavam logando `"aumentando seletividade"` a cada erro — streak infinito sem parar.

**Fix** (`lib/professor.ts:238-245`):
1. **Streak reseta por par** — `_ultimoParAjuste` detecta mudança de par e zera streak. Erro em `USDC→mcirBTC` não contamina `cirBTC→EURC`
2. **Cap de 10 ajustes por par** — `_ajusteCount` limita correções consecutivas. Após 10 ajustes, professor para de modificar parâmetros e aceita que o robô não acerta aquele par
3. **Early exit no teto** — se `confiancaMinima >= 55 && thresholdEntrada >= 0.015`, retorna sem logar

### Polygon trade destravado (29/06/2026 noite)

**Análise**: 3 bloqueios impediam TODOS os trades na Polygon:
1. V3 pools não encontradas (RPC fail) → fallback V2 (0.3% fee) → `_quoteTrade` abortava (lucro $0.005 < fee+gas $0.022)
2. `executarPacotes` else branch exigia `lucroReal > lucroMinimo` — DEX fee 0.3% deixava lucro negativo → abortava
3. Grão `minVolatility2h` de 0.09% bloqueava EURC (vol real 0.05%)

**Fixes**:
1. **Removeu V2 profit check** (`pregão.ts:624-632`): `_quoteTrade` não aborta mais V2 com base em lucro esperado. Quem decide é o caller.
2. **Unificou guard de perda** (`pregão.ts:780-800`): Grid, StableMR e agentes agora usam o mesmo guard — só aborta se perda > 1% do amount. DEX fee de 0.3% é aceito como custo de entrada para qualquer estratégia.
3. **minVol fixo para stables** (`modo-grão.ts:250`): stable pairs usam floor de 0.03% em vez de `gas/batch` (0.09%). EURC (vol 0.05%) agora passa.

## Session Summary (29/06/2026 tarde) — AMM + M_break + Arc Training + 6 Bug Fixes

### What's Changed

1. **GenericAMMPair deployado na Arc** — `contracts/GenericAMMPair.sol` (Uniswap V2-style, 0.3% fee, pause + liquidity guard), `scripts/deployAMMArc.js`, `scripts/addLiquidityAMM.js`. Pool USDC→EURC em `0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb` com $17.28 USDC + $16.00 EURC. Integrado em `arc-direct-swap.ts` — stable→stable swaps roteiam via AMM real com `getAmountOut()` live.

2. **AMMPoolStatus widget** — `app/components/AMMPoolStatus.tsx` + `DashboardShell.tsx`: reservas, preço, slippage em tempo real na rede Arc.

3. **5 Fixes operacionais**:
   - `app/api/price/route.ts:56`: fallback pega SoSoValue retornando 0 (POL $0.00 bug)
   - `lib/gas-price-oracle.ts:120`: ETH minimum floor 5 gwei
   - `app/components/Header.tsx:34`: `refreshAllBalances()` a cada 5s
   - `lib/capital-controller.ts`: lockedBy compara `boughtToken:networkKey` em vez de raw request ID
   - `lib/pregão.ts:limparOrdensTravadas()`: `forceUnlock()` em ordens presas >2min

4. **Rate-limited balance cache** — `lib/cctp.ts:getUSDCBalance()`: 10s TTL + 200ms rate limit entre RPC calls.

5. **M_break filter** — `lib/agentes-do-pregão.ts:1378-1402`: volatilidade mínima para cobrir taxa DEX (0.3% V2, fórmula auditada). EURC (vol ~0.05%) filtrado, WETH (~1.5%) passa.

6. **BUG #4 — Score floor -500** — `lib/escola-robos.ts:126`: `robo.pontos = Math.max(-500, robo.pontos)`. Agentes com -9.424pts (Liquidator) voltam para -500 imediatamente.

7. **Arc Training system** — `lib/arc-training.ts`: orchestrator com start/stop, subscribe, snapshots de agentes + parâmetros a cada 5 ciclos. `app/components/ArcTrainingPanel.tsx`: painel visível na rede Arc com botões Iniciar/Parar, top 5 agentes, parâmetros calibrados.

8. **BUG #1 — Balance fetch logs** — `lib/real-swap-executor.ts:540,562`: `console.warn` nos catch blocks do `_refreshAllBalancesImpl` (antes silencioso). `lib/escriturario.ts:72`: fallback de posição estendido para testnets + stablecoins.

9. **BUG #2 — MarketMaker conf fallback** — `lib/pregão.ts:363-376`: se weighted average dá 0, usa maior confiança individual dos participantes com log de diagnóstico.

10. **BUG #3 — Timeout batch Professor** — `lib/escriturario.ts:139-148`: `setTimeout(120s)` marca ordem como `falhou` se Professor não processar.

11. **EURC address fix** — `lib/arc-direct-swap.ts:30`: `STABLECOINS` usava address errado `0x89B5...cF04` → corrigido para `0x89B5...Aa3b` (igual NETWORKS + AMM).

### Current State
- **Build**: limpo (zero erros TS)
- **Arc Testnet**: AMM USDC/EURC ativo, ArcTrainingPanel rodando, score floor -500, balance logs ativos
- **Polygon**: M_break filtrando pares inviáveis, MarketMaker com fallback de confiança, timeout de batch 2min
- **Professor**: treinando na Arc com snapshots, parâmetros calibrados visíveis no dashboard
- **Pendente**: BUGs #1/#2/#3 requerem monitoramento dos novos logs para confirmar resolução completa

## Session Summary (01/07/2026) — 6 Fixes: forceUnlock, pontos cap, recovery, gangorra

### What's Changed

1. **Fix getOrdensAtivas — forceUnlock()** — `lib/pregão.ts:492`: adicionado `capitalController.forceUnlock()` quando ordem expira em `getOrdensAtivas()`. Antes, ordens travadas em "executando" marcavam como falha mas não liberavam o lock do CapitalController, travando todas as ordens subsequentes (BUG #2 da auditoria original).

2. **Fix pontos cap 1000** — `lib/escola-robos.ts:133`: adicionado `robo.pontos = Math.min(1000, robo.pontos)` após bonus de acerto. Antes não havia teto — Synthesis acumulou 127k+ pontos, tornando o sistema de pontos inútil para comparação.

3. **Fix Quantum recovery path** — `lib/professor.ts:287-307`: adicionado recovery check em `_aplicarAjustes()`: se robô está no teto (conf.min≥55, entrada≥0.015) com streak >20 erros e pontos ≤ -400, reseta parâmetros via `parametrosRobos.reset()`. Cooldown de 24h via localStorage (`arcflow_recovery_*`) pra evitar loops.

4. **Fix canExecute() format** — `lib/capital-controller.ts:109-114`: mudado de `strategy:pair` para `boughtToken:network` — consistente com o formato usado em `request()` e `unlock()`. Método é dead code (sem chamadores) mas agora está correto.

5. **Fix gangorra do Professor** — `lib/professor.ts:245-260`: novo método `_extrairBasePar()` que extrai os tokens ordenados alfabeticamente (ex: `USDC→cirBTC` e `cirBTC→USDC` viram `USDC→cirBTC`). Streak agora usa base pair em vez do raw `palpite.par`. Fim da gangorra: erros em USDC→cirBTC e acertos em cirBTC→USDC não resetam mais o streak, mantendo parâmetros estáveis em vez de oscilar entre 20% e 60%.

6. **Fix Grão Vmin > saldo** — `lib/modo-grão.ts:222-226`: quando VminCalculado > usdcBal, em vez de abortar (e travar o Modo Grão permanentemente), ajusta batchThreshold=1 e baseTradeUSD para caber no saldo disponível. Ex: com $12, faz 1×$4 trade em vez de abortar.

### Impacto Esperado
- **forceUnlock()**: ordens travadas não bloqueiam mais o CapitalController permanentemente
- **Pontos cap**: agentes não acumulam 100k+ pontos irrelevantes — máximo 1000, comparável
- **Recovery path**: robôs presos no teto por >24h ganham reset automático em vez de prisão perpétua
- **Gangorra**: parâmetros dos agentes oscilam em range estreito (~±5%) em vez de 20-60%, porque streaks de direções opostas no mesmo par agora se cancelam em vez de amplificar

### Current State
- **Build**: limpo (zero erros TS)
- **Polygon**: $48.22 USDC, $15.72 POL. Modo Grão ajustado pra caber em $12 (1×$4 trade em vez de abortar).
- **Arc Testnet**: sistema rodando ao vivo, CapitalController liberando locks corretamente, pontos cap 1000 funcionando (Technical/MarketMaker/Quantum no teto)
- **Professor**: gangorra resolvida para pares com direção alternada (ex: cirBTC/USDC)
- **Pendente**: monitorar recovery path em robôs no floor, validar Grão na Polygon com saldo parcial

## Session Summary (01/07/2026 noite) — Chainlink Data Feeds na Polygon

### What's Changed

1. **`lib/chainlink-feeds.ts`** (novo) — mapa de endereços Chainlink Data Feed AggregatorV3Interface para 9 tokens na Polygon (USDC, USDT, DAI, WETH, WBTC, WMATIC, MATIC, LINK, ETH). `queryChainlinkPrice()` consulta via RPC, fallback silencioso para `null` se RPC falhar ou feed não configurado.

2. **`lib/pair-price-feed.ts`** — `getUsdPrice()` agora sempre tenta Chainlink primeiro para qualquer rede com feed configurado (não mais restrito à Arc testnet). Se Chainlink retorna preço válido, usa-o direto (sem cache SoSoValue). Se falha ou token não tem feed, cai no SoSoValue API como antes. Removido código legado `useChainlinkForArc`/`setUseChainlink`/`arcProvider`/`chainlinkContracts`.

3. **`lib/pregueiro.ts`** — removida chamada `pairPriceFeed.setUseChainlink()` (método não existe mais — Chainlink é ativado automaticamente em `getUsdPrice`).

### Impacto Esperado

- **Polygon**: preços de USDC, USDT, DAI, WETH, WBTC, WMATIC, MATIC, LINK vêm do Chainlink Data Feed (oráculo descentralizado, sem rate limit, sem latência de API HTTP).
- **Tokens sem feed** (EURC, cirBTC, mcirBTC, ARC): continuam usando SoSoValue API como fallback.
- **Arc testnet**: sem feeds Chainlink ainda — SoSoValue mantido como fonte única.
- **SoSoValue API calls reduzidos**: em vez de bater `/api/price` para cada token a cada 15s, tokens com feed Chainlink são servidos via RPC local (Polygon RPC, sem rate limiting).

### Current State
- **Build**: limpo (zero erros TS)
- **Polygon**: 9 tokens com Chainlink Data Feed (USDC, USDT, DAI, WETH, ETH, WBTC, BTC, WMATIC, MATIC, LINK). EURC permanece via SoSoValue.
- **Arc Testnet**: sem feeds Chainlink — SoSoValue mantido.
- **Dual model**: Chainlink (RPC) → SoSoValue (API) fallback, transparente para consumidores de preço.

## Session Summary (02/07/2026) — MarketData Collector + Backpack Exchange + Sinais UI

### What's Changed

1. **MarketDataCollector** (`lib/marketData/MarketDataCollector.ts`): novo módulo cliente HTTP para 5 endpoints públicos da Backpack Exchange — `klines` (candles históricos), `markets`, `trades`, `trades/history`, `ticker`. Cache 60s em memória, rate limit 10 req/s, retry exponencial 2x. Parse automático do formato de data `"2026-07-01 22:00:00"` retornado pela API.

2. **labelPriceMovement** (`lib/marketData/labelPriceMovement.ts`): função que dado um array de KLines e uma janela em minutos, calcula a variação percentual e rotula como `alta`, `baixa` ou `neutro` (threshold configurável, default ±0.3%).

3. **BackpackScanner** (`lib/marketData/BackpackScanner.ts`): escaneia 5 símbolos (`BTC_USDC`, `ETH_USDC`, `SOL_USDC`, `SPCX.US_USDC`, `MU.US_USDC`) a cada 60s, simula predições de todos os agentes registrados contra cada candle window, e ranqueia os símbolos por score (winRate × confiança).

4. **trainOnHistoricalData()** (`lib/professor.ts:385-443`): novo método público que busca klines da Backpack, rotula movimentos reais, compara contra predições dos agentes e alimenta o sistema de scoring existente (`escolaRobos.registrarResultado` + `_aplicarAjustes`). Rede usada: `"backpack"` para distinguir de dados ao vivo.

5. **BackpackSignalsPanel** (`app/components/BackpackSignalsPanel.tsx`): novo componente React que exibe o melhor sinal do Professor em destaque + tabela com todos os símbolos escaneados. Acessível pela nova aba "🎒 Sinais" no dashboard.

6. **Nova aba "🎒 Sinais"**: adicionada ao `SectionContext` e `DashboardShell` entre "Bot Bank" e "Bridge".

### Símbolos Confirmados via API Backpack Exchange

- Crypto: `BTC_USDC`, `ETH_USDC`, `SOL_USDC`
- Stocks: `SPCX.US_USDC` (S&P 500), `MU.US_USDC` (Micron Technology)
- **Sem AAPL.US** listado na Backpack
- Formato dos pares: `BASE_QUOTE` com underscore. Stocks usam `.US` antes do underscore (ex: `SPCX.US_USDC`)

### Arquivos Criados

| Arquivo | Descrição |
|---------|-----------|
| `lib/marketData/MarketDataCollector.ts` | API client Backpack (168 linhas) |
| `lib/marketData/labelPriceMovement.ts` | Rotulagem de movimento (52 linhas) |
| `lib/marketData/BackpackScanner.ts` | Scanner multi-símbolo + ranking (128 linhas) |
| `app/components/BackpackSignalsPanel.tsx` | Painel UI sinais (120 linhas) |
| `scripts/test-market-data-collector.ts` | Teste isolado (80 linhas) |

### Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `lib/professor.ts` | + `trainOnHistoricalData()`, + `_syntheticPredictions()`, + `_intervalToMinutes()` |
| `app/components/SectionContext.tsx` | + `"signals"` no type Section |
| `app/components/DashboardShell.tsx` | + aba "🎒 Sinais" no nav |
| `app/page.tsx` | + `<BackpackSignalsPanel />` no SectionMatch signals |

### Current State
- **Build**: limpo (zero erros TS)
- **Teste**: `npx tsx scripts/test-market-data-collector.ts` — 24 candles BTC, 23 windows rotuladas (15 alta, 1 baixa, 7 neutro), ticker funcionando, stocks OK
- **Dashboard**: nova aba sinais com scan automático a cada 60s
- **Backpack Exchange**: endpoints públicos, sem API key necessária

## Session Summary (02/07/2026 tarde) — 5 Fixes Estruturais

### What's Changed

1. **CapitalController lock por rede**: `lib/capital-controller.ts` — lock global `boolean` → `Record<string, NetworkLock>`. Polygon e Arc operam simultaneamente. `unlock(networkKey)` exige rede.

2. **Professor score *5000**: `lib/pregão.ts:875` — multiplicador do score 1000 → 5000. Trade $12 com $0.01 lucro: score 41 (antes 8).

3. **parametrosRobos separado**: `lib/parametros-robos.ts` — duas instâncias (`parametrosRobos` live, `parametrosRobosBackpack` treino). `trainOnHistoricalData()` usa backpack. Fim da contaminação.

4. **visibilitychange removido**: `PregãoDashboard.tsx` — 3 guards `document.hidden` + listener removidos. Ciclo 24/7 independente de aba.

5. **GranPosition.networkKey**: `lib/modo-grão.ts` — posições agora têm `networkKey`, usado no unlock por rede.

### Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `lib/capital-controller.ts` | Lock per-network, unlock(networkKey), forceUnlock(networkKey?) |
| `lib/corretor.ts` | 3 unlock() → unlock(redeKey) |
| `lib/modo-grão.ts` | GranPosition.networkKey, unlock(currentNetwork) |
| `lib/oscillation-hunter.ts` | unlock() → unlock(pos.pool.network) |
| `lib/pregão.ts` | unlock() → unlock(pacote.rede), score *1000→*5000 |
| `lib/parametros-robos.ts` | Constructor com storageKey, 2 instâncias |
| `lib/professor.ts` | _aplicarAjustes() aceita paramsRobos opcional, trainOnHistoricalData() usa parametrosRobosBackpack |
| `app/components/PregãoDashboard.tsx` | 3 document.hidden removidos, listener visibilitychange removido |
| `ARCFLOW.md` | Nova seção 49 (scoring truth) + 50 (session summary) |

### Current State
- **Build**: limpo (zero erros TS)
- **Polygon**: $48.22 USDC, $15.72 POL
- **CapitalController**: 4 funções, lock per-network
- **ParametrosRobos**: 2 instâncias isoladas (live + backpack)
- **Ciclo**: não pausa mais em background — 24/7 ativo
- **Professor score**: *5000 aplicado, mais granular que antes

## Session Summary (02/07/2026 noite) — Descoberta dinâmica + Market Hours + Threshold por classe

### What's Changed

1. **getTopStocksByVolume()** (`lib/marketData/MarketDataCollector.ts`): novo método que descobre top ações tokenizadas na Backpack por `quoteVolume`. Filtra `.US_` symbols (confirmado: só SPCX.US e MU.US na Backpack hoje), chama ticker pra cada uma, ordena por volume. Cache de 1h.

2. **liquidityFilter.ts** (novo): filtra ativos com `quoteVolume24h < $50K` ou amplitude high-low > 50%. Aplicado no scanner antes de agentes analisarem.

3. **marketHours.ts** (novo): `isUSStockMarketOpen()` detecta horário NYSE/NASDAQ (9:30-16:00 ET, seg-sex, feriados não cobertos — documentado). Usa `Intl.DateTimeFormat` com timeZone — sem lib extra.

4. **labelPriceMovement.ts**: `getThresholdForSymbol()` retorna 0.3% cripto majors, 1.5% ações, 0.5% default. Função principal agora aceita `symbol?` opcional — compatível com callers antigos.

5. **BackpackScanner.ts**: lista de símbolos deixou de ser hardcoded — top stocks descobertos dinamicamente a cada hora. Símbolos de ação pulados quando mercado fechado (log `⏸️`). Ranking inclui `mercadoAberto` no sinal.

6. **professor.ts:trainOnHistoricalData()**: passa `symbol` pra `labelPriceMovement()`. Para ações, descarta janelas que caem fora do horário de mercado.

7. **BackpackSignalsPanel.tsx**: duas seções (cripto/ações), indicador NYSE 🟢/🔴 no header, indicador 🟢/🔴 por linha de ação, preço adaptativo (6 decimais para micro-tokens).

### Arquivos Criados | Modificados

| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `lib/marketData/liquidityFilter.ts` | ✨ Novo | Filtro de liquidez ($50K vol, 50% range) |
| `lib/marketData/marketHours.ts` | ✨ Novo | isUSStockMarketOpen() + helper stock detection |
| `lib/marketData/MarketDataCollector.ts` | 🔧 Mod | +getTopStocksByVolume(), +quoteVolume24h no Ticker |
| `lib/marketData/labelPriceMovement.ts` | 🔧 Mod | +getThresholdForSymbol(), symbol param opcional |
| `lib/marketData/BackpackScanner.ts` | 🔧 Mod | Descoberta dinâmica, filtro, market hours, mercadoAberto |
| `lib/professor.ts` | 🔧 Mod | Import marketHours, filtra janelas fora de horário |
| `app/components/BackpackSignalsPanel.tsx` | 🔧 Mod | Seções crypto/stock, indicador NYSE, preço adaptativo |
| `scripts/test-market-data-collector.ts` | 🔧 Mod | Testes das 4 mudanças |

### Resultado do Teste

- **Top stocks descobertos**: MU.US_USDC ($61.4B vol), SPCX.US_USDC ($9.7B vol) — ambos ✅ liquidez
- **Market hours**: 19:49 ET 🔴 fechado (fora 9:30-16:00)
- **Thresholds**: BTC 0.3%, SPCX.US 1.5%, default 0.5%
- **Backward compat**: labelPriceMovement sem symbol funciona (threshold 0.5%)

### Notas Técnicas

- `.US_` regex confirmada: 2 stocks na Backpack, 0 falsos positivos em 84 markets
- Stock markets retornam `visible: false` — filtro `m.visible` removido propositalmente
- Só 2 ações tokenizadas na Backpack hoje — descoberta dinâmica escala se mais forem listadas

## Session Summary (02/07/2026 noite) — quoteVolume fix: NASDAQ reference data sem magic numbers

### What's Changed

1. **Removido divisor 1M para stock tokens** — `lib/marketData/MarketDataCollector.ts:229-235`: stock tokens agora retornam `quoteVolume24h = 0` em vez de tentar estimar volume real via `volume / 1_000_000 * lastPrice`. Fundamento: todos os campos (`volume`, `quoteVolume`, `trades`) da ticker de RWA/stocks são **NASDAQ reference data**, não volume da Backpack — qualquer divisor é chute sem fundamento na especificação da API.

2. **StockCandidate agora inclui `trades`** — `lib/marketData/MarketDataCollector.ts:67-72`: campo `trades` adicionado (mesmo sendo referência NASDAQ, é um proxy útil para "esse stock tem atividade").

3. **getTopStocksByVolume ordenado por `trades`** — `lib/marketData/MarketDataCollector.ts:273-280`: stocks ordenados por `trades` (descendente) em vez de `quoteVolume24h`. Filtro `.filter(c => c.trades > 0)` substitui `.filter(c => c.quoteVolume24h > 0)`.

4. **Scanner skipa liquidity filter para stocks** — `lib/marketData/BackpackScanner.ts:47-62`: stocks são incluídos sem filtro de volume (só 2 existem, ambos legítimos). `passesLiquidityFilter` import removido.

5. **Ticker.trades exposto** — `lib/marketData/MarketDataCollector.ts:56-65`: interface `Ticker` ganha campo `trades: number`. Populado em `getTicker()`.

### Impacto
- Fim do divisor mágico 1.000.000 — sem curve-fitting, sem chute
- Stock tokens aparecem no scanner independentemente de volume (hoje: MU.US e SPCX.US)
- Scanner usa `getTopStocksByVolume` apenas para descoberta de símbolos, não para ranking por volume
- Liquidity filter continua válido para crypto (BTC $4.5M/dia passa, shitcoins com <$50K são filtrados)

### Current State
- **Build**: limpo (zero erros TS)
- **Scanner**: 3 crypto (BTC, ETH, SOL) + 2 stocks (MU.US, SPCX.US) descobertos dinamicamente a cada hora
- **Stock volume**: `quoteVolume24h = 0` — documentado como NASDAQ reference data, não exchange volume
- **Market hours**: stocks só escaneados 9:30-16:00 ET
- **Thresholds**: crypto 0.3%, stocks 1.5%, default 0.5%

## Session Summary (03/07/2026) — Arqueiro: Modulador de Tensão/Timing

### What's Changed

1. **`lib/arqueiro.ts`** (novo, 294 linhas) — módulo de modulação de tensão/timing que não executa trades nem gera OKs. Observa compressão de volatilidade via pseudo-ATR (média de returns absolutos em 20 períodos curto, 100 longo) com filtro squeeze Bollinger/Keltner binário.

2. **Máquina de estados por token+rede**: OCIOSO → TENSIONANDO (2 períodos compressão) → ARMADO (4+ períodos) → DISPARO (breakout confirmado) → DESARMADO (cooldown). TensionScore por estado: 0 → 20-50 → 40-70 (decay após 20 períodos) → 50-100 (decay após 5 períodos) → 0.

3. **Integração em `pregão.ts:verificarOrdem()`** (linhas 390-398): `arqueiro.feedPrice(par, rede)` fire-and-forget + `getScore()` multiplica `confiancaMedia` por `1 + 0.3 * (score/100)`. Log `🏹 Arqueiro: tensão X → confiança Y% → Z%`.

4. **Integração em `pregão.ts:executarPacotes()`** (linhas 884-889): média dos tensionScores de todos os trades do pacote modula o score do CapitalController: `baseScore * (1 + 0.2 * avgTension/100)`.

5. **Calibração com reset automático**: baseline do ATR médio estabelecida após 100 períodos. Se ATR médio mudar > 50%, reset completo (volta ao OCIOSO).

6. **Limite de 3 pares ARMADO/DISPARO simultâneos**: previne correlação entre pares correlacionados (ex: WMATIC/WETH comprimindo juntos).

7. **Auto-start no Pregão constructor** com guard SSR: `if (typeof setInterval !== "undefined") arqueiro.start()`.

### Shadow Mode (Fase 1 — Atual)
- `_shadowMode = true` por padrão. TensionScore não influencia scores ainda.
- Logs: `[ARQUEIRO] 🏹 <token>@<rede> | <estado> | ATR=<X>% | pctl=<Y> | squeeze=<Z> | tensão=<W> (SHADOW)`
- Ciclo de monitoramento: 60s. Apenas pares com estado não-OCIOSO são monitorados.

### Fases de Rollout
| Fase | Status | Comportamento |
|------|--------|---------------|
| 1 — Shadow | ✅ Ativo | Apenas logs. `setShadowMode(false)` para ativar. |
| 2 — Validação | Pendente | TensionScore ativo. Monitorar acertos. |
| 3 — Ativo | Pendente | Operação normal. |

### Impacto Esperado
- Compressão de volatilidade (atrPercentile < 0.6) identifica setups que tipicamente precedem expansão
- TensionScore modula confiança para cima (fator 1.3× no máximo) — não substitui o gate do CapitalController
- Decay em ARMADO/DISPARO evita que setups envelhecidos tenham peso excessivo
- Calibração com reset de 50% previne operação com baseline defasada

### Current State
- **Build**: limpo (zero erros TS)
- **Arqueiro**: shadow mode ativo, ciclo 60s, pseudo-ATR 20/100, squeeze Bollinger/Keltner, MAX_ARMED_PAIRS=3
- **Integração**: feedPrice em verificarOrdem, tensionScore modula confiança (shadow), modula score CapitalController (shadow)
- **ARCFLOW.md**: atualizado com seção 22 (Arqueiro) + seção 23 (Visão Arquitetural) + módulo adicionado no mapa

## Session Summary (03/07/2026 tarde) — 4 Fixes pós-revisão do Silvio

### What's Changed

1. **History buffer para Fase 2** — `lib/arqueiro.ts`: `PairState.history[]` (500 entradas) populado a cada tick com `{ timestamp, tensionScore, state, atrPercentile }`. Independente de shadow mode. `getHistory(pair, network)` e `getAllHistory()` expõem os dados reais acumulados para análise na Fase 2.

2. **Keltner squeeze corrigido** — `lib/arqueiro.ts:118`: `kw` usava `pseudoATRLong` (100p) — essencialmente a mesma informação que `atrPercentile` já capturava (short/long), tornando o squeeze redundante. Corrigido para `pseudoATRShort` (20p): Bollinger e Keltner agora medem a mesma janela, squeeze é uma leitura independente do score.

3. **SectionMatch display:none** — `app/page.tsx:582-586`: `SectionMatch` retornava `null` para seções não-ativas → React desmontava `RealAutomatedTrader`, `PregãoDashboard` etc. ao navegar entre abas, perdendo estado de conexão. Agora usa `display: none`, mantendo componentes vivos no DOM.

4. **shadowMode guard real** — `lib/arqueiro.ts:254-258`: `getScore()` agora checa `_shadowMode` antes de retornar `tensionScore`. Confirmado que as duas integrações no pregão (verificarOrdem:392, executarPacotes:885) recebem 0 → inertes.

5. **sendStressTx burn address** — `lib/job-robot.ts:157-183`: tx mudou de `to: self, value: 0n` (rejeitado como no-op pelo nó) para `to: 0x00..01, value: 1n`. Gas multiplier corrigido de `*1n/100n` (1%) para `*100n/100n` (100%).

### Current State
- **Build**: limpo (zero erros TS)
- **Arqueiro**: history buffer ativo, squeeze usa pseudoATRShort, shadow mode verdadeiro (score=0)
- **Dashboard**: wallet mantém conexão ao navegar entre seções (display:none)
- **JobRobot**: stress tx envia 1 wei pra burn address com gas fee correto
- **ARCFLOW.md**: seção 22 atualizada (squeeze, history, parâmetros)
- **README.md**: Arqueiro adicionado à tabela de módulos
- **docs/arqueiro-visual.md**: diagrama de estados + curva tensionScore + parâmetros completos

## Session Summary (03/07/2026 noite) — Backpack CORS proxy + SSR guards + catch blocks

### What's Changed

**1. Backpack CORS proxy** — `app/api/backpack/[...path]/route.ts`: novo proxy server-side que redireciona para `api.backpack.exchange`. `MarketDataCollector.ts:84`: `BACKPACK_BASE` condicional (`typeof window`), browser usa `/api/backpack`, Node.js usa URL direta. Resolve CORS do `BackpackSignalsPanel` que chamava a Backpack direto do browser.

**2. Backpack proxy POST** — `app/api/backpack/[...path]/route.ts`: exporta `POST` handler (prepara para futuros endpoints que exijam POST). Refatorado para função `proxy()` compartilhada.

**3. SSR guard em 9 módulos** — 9 construtores de singleton em `lib/` agora checam `typeof window !== 'undefined'` antes de acessar `localStorage`:
- `accountant.ts`, `position-manager.ts`, `volatility-tracker.ts`, `pregão.ts`, `professor.ts`, `escola-robos.ts`, `pair-sector.ts`, `provao-ranking.ts`, `timing-optimizer.ts`
- Previne `ReferenceError: localStorage is not defined` durante SSR no Vercel

**4. 5 catch blocks com diagnóstico**:
- `PregãoDashboard.tsx:225`: `.catch(e => addLog(...))` no `switchNetwork().then()`
- `PregãoDashboard.tsx:333`: `.catch(e => addLog(...))` no `import("@/lib/pregao-arc").then()`
- `RealAutomatedTrader.tsx:177`: `refreshStats().catch(e => console.warn(...))` no `setInterval`
- `BackpackSignalsPanel.tsx:25`: `catch (e) { console.warn(...) }` em vez de `// silent`
- `agentes-do-pregão.ts:334,764,880`: 3 `catch {}` → `console.warn('[AGENTES] ...')` com mensagens específicas

### Impacto Esperado
- BackpackSignalsPanel funciona sem CORS no Vercel
- Nenhum singleton de lib/ quebra SSR durante build/deploy no Vercel
- Erros de rede, switchNetwork, e ciclos do pregao-arc são logados (não mais silenciosos)
- refreshStats no RealAutomatedTrader não gera unhandled rejection a cada 8s

### Current State
- **Build**: limpo (zero erros TS)
- **Polygon**: $48.22 USDC, $15.72 POL
- **Backpack proxy**: GET + POST, timeout 15s, rate limit forwarding
- **SSR safety**: 11 módulos com guard (9 novos + arc-training + pair-profitability)
- **Diagnóstico**: catch blocks com console.warn específico em vez de silêncio

## Session Summary (03/07/2026 noite) — SectionMatch remount fix + ArqueiroPanel

### What's Changed

1. **SectionMatch remount fix** — `app/page.tsx:582-586`: `SectionMatch` alternava entre `<div style="display:none">` (inativo) e `{children}` (ativo) — tipos de React diferentes (div vs fragment) → React desmontava e remontava `PregãoDashboard`, `RealAutomatedTrader` e demais filhos a cada troca de aba. Agora sempre retorna `<div>`, alternando `display:none` / `display:contents`. Componentes mantêm estado (private key, wallet, ciclos).

2. **ArqueiroPanel** — `app/components/ArqueiroPanel.tsx`: novo painel que exibe em tempo real o estado de cada par monitorado pelo Arqueiro (OCIOSO/TENSIONANDO/ARMADO/DISPARO/DESARMADO), tensionScore, atrPercentile, squeeze. Adicionado na aba "Auto Trader" abaixo do `PregãoDashboard`.

### Current State
- **Build**: limpo (zero erros TS)
- **Arqueiro**: shadow mode, painel visível na aba Auto Trader, polling 5s
- **SectionMatch**: display:contents evita remount — wallet/key/estado preservados entre abas

## Session Summary (04/07/2026) — Módulo Solana Independente (BP/USDC)

### What's Changed

1. **`lib/solana/`** — novo diretório auto-contido com 4 módulos:
   - `config.ts`: endereços BP (`BPxxfRCXkUVhig4HS1Lh7kZqV6SPJhzfEk4x6fVBjPCy`), USDC Solana (`EPjFWdd5...`), SOL, pools Raydium
   - `client.ts`: `SolanaClient` via fetch bruto (sem `@solana/web3.js`), métodos `getBalance()`, `getTokenBalance()`, `getTokenPrice()` via Jupiter API v6
   - `pools.ts`: `fetchPools()` + `fetchWalletSummary()` — dados de pool e carteira
   - `trader.ts`: `getSwapQuote()` + `buildSwapTx()` via Jupiter quote/swap endpoints

2. **`app/api/solana-proxy/route.ts`** — proxy server-side para Solana RPC + Jupiter API, evita CORS do browser

3. **`app/components/SolanaPanel.tsx`** — painel dashboard: input de private key Solana, saldos (SOL/USDC/BP), cotação de swap USDC→BP via Jupiter, indicador de preço BP

4. **Integração UI** — `SectionContext.tsx` add `"solana"`, `DashboardShell.tsx` nova aba `☀️ Solana`, `page.tsx` add `<SectionMatch section="solana">`

### Design
- **Zero toque no EVM**: módulo não importa nem referencia nada do sistema existente (pregão, route-verifier, agentes, pools Arc/Polygon)
- **Só carrega se configurado**: painel começa com input de private key, só mostra dados após conectar
- **Sem `@solana/web3.js`**: toda comunicação via fetch (RPC JSON + Jupiter API v6)
- **Private key salva em `localStorage`**: chave `arcflow_solana_key`

### Arquivos Criados
| Arquivo | Descrição |
|---------|-----------|
| `lib/solana/config.ts` | Endereços, RPC, Jupiter URL |
| `lib/solana/client.ts` | SolanaClient (getBalance, getTokenBalance, getTokenPrice) |
| `lib/solana/pools.ts` | fetchPools, fetchWalletSummary |
| `lib/solana/trader.ts` | getSwapQuote, buildSwapTx |
| `app/api/solana-proxy/route.ts` | Proxy RPC + Jupiter |
| `app/components/SolanaPanel.tsx` | Painel dashboard |

### Arquivos Modificados
| Arquivo | Mudança |
|---------|---------|
| `app/components/SectionContext.tsx` | `+ "solana"` no union type Section |
| `app/components/DashboardShell.tsx` | `+ ☀️ Solana` tab |
| `app/page.tsx` | `+ <SectionMatch section="solana">` |

### Current State
- **Build**: limpo (zero erros TS)
- **Solana**: módulo criado, proxy ativo, dashboard integrado, aguardando private key do usuário para testar
- **Pool USDC/cirBTC na Arc**: intacto (`0xcd7885Ed7D3F4e4b6C88eA2C670a0075b612F073`), swap real testado
- **EVM**: zero alterações — sistema Polygon/Arc continua operando normalmente

## Session Summary (04/07/2026 tarde) — Out of Memory Fixes

### Problema
Aplicação consumia memória do navegador após horas rodando ciclos contínuos (Arc: 3s, Polygon: 10s). Posições fechadas acumulavam sem limite no `positionManager`, localStorage crescia sem controle.

### Correções

1. **PositionManager: cap de 200 posições fechadas** — `lib/position-manager.ts`: novo `MAX_CLOSED_POSITIONS = 200` + método `_purgeClosed()` que mantém só as 200 mais recentes. Chamado a cada `savePositions()`.

2. **Memory monitor + cleanup periodico** — `app/components/PregãoDashboard.tsx`: novo `useEffect` com `setInterval` a cada 30min que:
   - Chama `volatilityTracker.cleanStale()` (remove dados >48h)
   - Chama `positionManager.cleanupInactiveNetworks()` (remove posições de redes inativas)
   - Monitora `performance.memory.usedJSHeapSize` — loga aviso se >300MB, recarrega automaticamente se >500MB
   - Auto-reload forçado a cada 2h (`arcflow_last_reload` no localStorage)

3. **Auto-reload 2h**: se `Date.now() - lastReload > 2h`, força `window.location.reload()` após 3s com log explicativo.

### Impacto
- Posições fechadas antigas não acumulam mais no heap JS nem no localStorage
- Memória monitorada ativamente — recarga automática antes do crash
- Cleanup de dados stale da VolatilityTracker agora é chamado (antes era código morto)

### Arquivos Modificados
| Arquivo | Mudança |
|---------|---------|
| `lib/position-manager.ts` | +MAX_CLOSED_POSITIONS, +_purgeClosed() |
| `app/components/PregãoDashboard.tsx` | +import volatilityTracker, +memory monitor + cleanup + auto-reload |

## Session Summary (06/07/2026 noite) — KnowledgeService: Camada de Cognição Compartilhada

### What's Changed

1. **`lib/agent-framework/knowledge-types.ts`** (novo — 30 linhas): `KnowledgeRequest` (pair, network, action, agent, amount) + `KnowledgeReport` (canTrade, 4 scores, riskScore, expectedValue, confidenceModifier, warnings, recommendations, sources).

2. **`lib/agent-framework/knowledge-service.ts`** (novo — 375 linhas): `KnowledgeService` — SSOT que agrega 6 fontes existentes em paralelo:
   - `poolProfiler` → liquidityScore (0-100, baseado em pools V3 + stablecoin fallback)
   - `gasPriceOracle` → gasScore (0-100, thresholds de $0.003 a $0.10)
   - `route-verifier` → routeScore (0-100, diferencial por BUY/SELL + circuit breaker)
   - `volatilityTracker` → marketScore (trend + volatility confidence multiplier)
   - `accountant` → histórico do agente (winRate, score)
   - `frameworkReputation` → reputação do agente (score)
   - Cache híbrido memória + localStorage com TTLs por tipo (liquidez 25s, rota 60s, gas 12s, preço 7s, histórico 5min, reputação 1min)
   - `confidenceModifier` cumulativo (-80% a +25%): liquidez<20 → -25%, rota bloqueada → -50%, reputação<20 → -30%, winRate>70% → +8%, marketScore>70 → +12%
   - `riskScore` (0-100) composto: liqRisk×0.3 + routeRisk×0.3 + gasRisk×0.2 + marketRisk×0.2
   - `expectedValue`: estimado por confidence média × maxExpected (0.2% stable / 1% volátil)
   - `recommendations[]`: "Aguarde redução do gas", "Reduza o volume", "Tente novamente em 30min", etc.
   - `computeExpectedValue`, `computeRiskScore`, `generateRecommendations` — 3 novos métodos públicos para consumo externo

3. **`lib/agent-framework/singletons.ts`** — adicionado `frameworkKnowledge = new KnowledgeService()`

4. **`lib/agent-framework/index.ts`** — exporta `KnowledgeRequest`, `KnowledgeReport`, `KnowledgeService`, `frameworkKnowledge`

5. **Documentação arquitetural completa** — no topo de `knowledge-service.ts`:
   - Diagrama Before/After (agente isolado → cognição compartilhada)
   - 6 fases de evolução (Fase 1 ✅ até Fase 6 🔮 Memory Service)
   - 7 decisões arquiteturais consolidadas de avaliação de IA
   - Diagrama ARC Agent Framework (Knowledge/Identity/Reputation → Intent/Voting → Coordinator → Execution → Audit → On-chain Proof)

### Impacto
- **Mudança de paradigma**: agente consulta conhecimento coletivo ANTES de decidir (não depois)
- **KnowledgeReport como "linguagem comum"** entre agentes, coordinator, voting, audit
- **4 scores independentes** permitem explicar decisões (ex: "Liquidez: 15, Gas: 92, Rota: 0")
- **confidenceModifier** cria segunda camada de inteligência — o framework diz "você está otimista demais"
- **riskScore + expectedValue** impedem operações tecnicamente possíveis mas economicamente ruins
- **recommendations** transforma o serviço de guardião em consultor
- Todas as 7 recomendações da avaliação de IA foram implementadas ou documentadas como fases futuras

### Próximas Fases
- **Fase 2**: Integrar `frameworkKnowledge.query()` em agentes antes de gerarem Intents
- **Fase 3**: Voting usar `confidenceModifier` como peso
- **Fase 4**: Audit registrar KnowledgeReport junto com cada decisão
- **Fase 5**: Publicar hash do relatório on-chain com a Intent
- **Fase 6 (Memory Service)**: Aprender padrões, sequências de falhas, correlações entre ativos

### Arquivos Criados
| Arquivo | Descrição |
|---------|-----------|
| `lib/agent-framework/knowledge-types.ts` | KnowledgeRequest, KnowledgeReport interfaces (30 linhas) |
| `lib/agent-framework/knowledge-service.ts` | KnowledgeService com cache, scoring, confidence modifier (375 linhas) |

### Arquivos Modificados
| Arquivo | Mudança |
|---------|---------|
| `lib/agent-framework/singletons.ts` | +frameworkKnowledge |
| `lib/agent-framework/index.ts` | +KnowledgeRequest, KnowledgeReport, KnowledgeService, frameworkKnowledge |

### Current State
- **Build**: limpo (zero erros TS)
- **Framework completo**: Identity → Knowledge (NOVO) → Intent → Voting → Coordinator → Execution → Audit → On-chain Proof
- **KnowledgeService**: 6 fontes, cache TTL, 4 scores, riskScore, confidenceModifier, recommendations
- **Polygon**: $48.22 USDC, $15.72 POL
- **Arc Testnet**: sistema rodando ao vivo

### Pendente para Auditoria Técnica (solicitação do desenvolvedor)

O desenvolvedor solicita que, quando as Fases 2-5 estiverem completas (Knowledge → Intent → Voting → Audit → On-chain), seja enviado para análise:

1. **Endereço dos contratos principais** — Coordinator, AgentIdentity (ERC-8004), ERC-8183, OnChainIntentPublisher
2. **Link ArcScan** com eventos disponíveis
3. **ABI ou código** dos contratos

Propósito da análise:
- Verificar se os contratos estão sendo realmente utilizados (eventos on-chain)
- Identificar gargalos de gas nas interações
- Avaliar se a blockchain reflete corretamente a arquitetura do framework
- Determinar se o projeto demonstra uso relevante da infraestrutura da rede Arc

#### Contratos já deployados (visão parcial)
| Contrato | Endereço | Explorer |
|----------|----------|----------|
| AgentIdentity (ERC-8004) — Arc | `0xd2a801e60a0ab36da3fb17d4a7654b494ba8326b` | [ArcScan](https://testnet.arcscan.app/address/0xd2a801e60a0ab36da3fb17d4a7654b494ba8326b) |
| AgentIdentity (ERC-8004) — Base | `0xaeb95e2532a73a097e03584cb244eeca9b5609a5` | [BaseScan](https://basescan.org/address/0xaeb95e2532a73a097e03584cb244eeca9b5609a5) |
| AgenticCommerce (ERC-8183) — Arc v1 | `0x319227cf1de5c61d11313af8226a8f5309fa70d9` | [ArcScan](https://testnet.arcscan.app/address/0x319227cf1de5c61d11313af8226a8f5309fa70d9) |
| AgenticCommerce (ERC-8183) — Arc v2 | `0x0747EEf0706327138c69792bF28Cd525089e4583` | [ArcScan](https://testnet.arcscan.app/address/0x0747EEf0706327138c69792bF28Cd525089e4583) |
| AgenticCommerce (ERC-8183) — Polygon | `0x0747EEf0706327138c69792bF28Cd525089e4583` | [PolygonScan](https://polygonscan.com/address/0x0747EEf0706327138c69792bF28Cd525089e4583) |
| AgenticCommerce (ERC-8183) — Ethereum | `0x0747EEf0706327138c69792bF28Cd525089e4583` | [Etherscan](https://etherscan.io/address/0x0747EEf0706327138c69792bF28Cd525089e4583) |
| AMM USDC/EURC — Arc | `0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb` | [ArcScan](https://testnet.arcscan.app/address/0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb) |

#### O que falta para a auditoria
- ~~**Fase 2**: Agents consultarem `frameworkKnowledge.query()` antes de gerar Intents~~ ✅ CONCLUÍDA
- **Fase 3**: Voting usar `confidenceModifier` como peso (off-chain)
- **Fase 4**: Audit registrar KnowledgeReport (off-chain)
- **Fase 5**: Publicar hash do KnowledgeReport on-chain via `OnChainIntentPublisher` (on-chain — este é o passo que gera eventos no ERC-8183)

## Session Summary (07/07/2026) — Fase 3: Voting ponderado + Audit knowledgeModifier + Fase 4 prep

### What's Changed

1. **Fase 3 — Voting com confidenceModifier como peso** (`lib/agent-framework/voting.ts`):
   - `VoteRecord` agora carrega `reputationWeight` e `knowledgeWeight`
   - `recordVote()` defaults para `1.0` nos novos campos (compatibilidade retroativa)
   - `resolve()` usa fórmula ponderada: `sum( (confidence/100) × repWeight × knowWeight ) / numVotes × 100`
   - `rejected` warnings silenciados (TS lint)

2. **Coordinator com pesos integrados** (`lib/agent-framework/coordinator.ts`):
   - Importa `frameworkReputation` de `./singletons`
   - `resolveConsensus()`: para cada voto, lê `frameworkReputation.getScore(agentId) / 100` como `reputationWeight` e `proposal.params.knowledgeModifier` como `knowledgeWeight`
   - Fórmula: `weightedConf = (confidence/100) × repWeight × knowledgeWeight`
   - `runCycle()`: passa `reputationWeight` e `knowledgeWeight` ao `Voting.recordVote()`
   - Audit registra `knowledgeModifier` quando disponível no proposal

3. **Fase 4 prep — Audit com conhecimento**:
   - `IAudit.ts` + `audit.ts`: `AuditEntry` ganha campos opcionais `knowledgeModifier`, `knowledgeWarnings`, `knowledgeReport`
   - `Audit.createEntry()` lê `knowledgeWarnings` de `proposal.params`
   - `coordinator.ts` extrai `knowledgeModifier` do proposal e passa ao `Audit.createEntry()`

4. **IntentRecord com conhecimento** (`lib/agent-framework/intent-types.ts`):
   - `AgentIntent` ganha `knowledgeModifier?`, `knowledgeReport?`, `knowledgeWarnings?`
   - `IntentRecord.votes[]` ganha `reputationWeight` e `knowledgeWeight`

5. **IntentPublisher compatível** (`lib/agent-framework/intent-publisher.ts`):
   - `recordVote()` aceita `reputationWeight?` e `knowledgeWeight?`, defaults para `1.0`

### Arquivos Modificados
| Arquivo | Mudança |
|---------|---------|
| `lib/agent-framework/voting.ts` | VoteRecord com repWeight/knowWeight; resolve() com fórmula ponderada |
| `lib/agent-framework/coordinator.ts` | +import frameworkReputation; resolveConsensus com pesos; Audit com knowledgeModifier |
| `lib/agent-framework/IAudit.ts` | AuditEntry com knowledgeModifier/knowledgeWarnings/knowledgeReport |
| `lib/agent-framework/audit.ts` | createEntry aceita knowledgeModifier; lê knowledgeWarnings de proposal.params |
| `lib/agent-framework/intent-types.ts` | AgentIntent + IntentRecord com campos de conhecimento |
| `lib/agent-framework/intent-publisher.ts` | recordVote aceita repWeight/knowWeight opcionais |

### Current State
- **Build**: limpo (zero erros TS)
- **Fase 2**: ✅ Concluída — agentes consultam Knowledge Service antes de gerar Intent
- **Fase 3**: ✅ Concluída — votos ponderados por reputação do agente + conhecimento do framework
- **Fase 4 (Audit)**: ⏳ Preparado — AuditEntry aceita knowledgeModifier/knowledgeWarnings; Coordinator já registra
- **Próximo**: Fase 4 — Registrar KnowledgeReport completo no Audit; Fase 5 — Publicar hash on-chain
