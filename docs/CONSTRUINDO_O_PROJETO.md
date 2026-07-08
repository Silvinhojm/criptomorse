# 🏗️ CONSTRUINDO O PROJETO — ARC Agent Coordination Framework

> Documento mestre para IAs. Leia antes de qualquer alteração.
> Versão: 05/07/2026 — Transição de "trading bot" para "ARC Agent Coordination Framework"

---

> Historical implementation note: this document preserves the trading-era construction plan and migration notes. It is not the canonical architecture source. `PROJECT_VISION.md` is canonical. Any mention of Pregão as central means internal TradingAdapter machinery in the current architecture.

## 1. IDENTIDADE DO PROJETO

### O que é
Um **ARC Agent Coordination Framework** — middleware open-source para criar, coordenar e auditar agentes autônomos que movimentam USDC na blockchain Arc.

### O que NÃO é
- ~~Banco digital~~
- ~~Bot de trading~~
- ~~Carteira~~
- ~~Pagamentos / Fintech~~

### O Paradoxo
O projeto hoje **se parece** com um bot de trading (13 agentes votando, executando swaps na Polygon). Mas a **arquitetura** já é um framework de coordenação multi-agente. O trading é o use case que prova que funciona com capital real ($48 na Polygon, 24/7).

### Público-alvo
- Desenvolvedores na Arc que querem criar agentes autônomos
- Circle (como demonstração de Agentic Economy real)
- Pesquisadores de sistemas multi-agente

---

## 2. ARQUITETURA ATUAL (como está hoje)

### Stack
- **Frontend**: Next.js 15.5 + React 19.2 (cliente pesado, SSR mínimo)
- **Blockchain**: Polygon Mainnet + Arc Testnet
- **Preços**: Chainlink Data Feeds (Polygon) + SoSoValue API (fallback)
- **DEX**: QuickSwap/SushiSwap (Polygon), AMM próprio (Arc)
- **Batch**: Multicall3 para execução em lote
- **Wallet**: Auto-sign via private key (sem MetaMask)

### Estrutura de diretórios
```
arcflow/
├── app/                          ← UI (produto, será reduzida)
│   ├── components/               ← 25+ componentes React
│   │   ├── PregãoDashboard.tsx   ← 1400 linhas (monólito)
│   │   ├── DashboardShell.tsx    ← Navegação
│   │   ├── ArqueiroPanel.tsx     ← Painel do Arqueiro
│   │   ├── PiEngineMonitor.tsx   ← Painel PiFilter
│   │   └── ... (20+ outros)
│   ├── api/                      ← API routes (proxies)
│   └── page.tsx                  ← Página principal
├── lib/                          ← Core (será extraído)
│   ├── pregão.ts                 ← internal TradingAdapter machinery (historically central; 1040 linhas)
│   ├── agentes-do-pregão.ts      ← 13 agentes + votação
│   ├── professor.ts              ← Aprendizado e recalibração
│   ├── capital-controller.ts     ← 1 agente por vez
│   ├── circuit-breaker.ts        ← 3 strikes = freeze
│   ├── accountant.ts             ← Score contábil
│   ├── escola-robos.ts           ← Reputação dos agentes
│   ├── route-verifier.ts         ← Validação pré-execução
│   ├── arqueiro.ts               ← Modulador de timing
│   ├── position-manager.ts       ← Estado das posições
│   ├── agent-voting.ts           ← Sistema de votação
│   ├── grid-trading.ts           ← só reexport de examples/trading/strategies/
│   ├── stable-mr.ts              ← só reexport de examples/trading/strategies/
│   ├── modo-grão.ts              ← só reexport de examples/trading/strategies/
│   ├── oscillation-hunter.ts     ← só reexport de examples/trading/strategies/
│   ├── real-swap-executor.ts     ← Execução real na blockchain
│   ├── cctp.ts                   ← Bridge CCTP
│   ├── batch-executor.ts         ← Execução em lote
│   ├── nonce-manager.ts          ← Nonces
│   └── ... (40+ módulos)
├── contracts/                    ← Solidity
│   ├── AgentIdentity.sol         ← ERC-8004
│   ├── BatchExecutor.sol         ← Execução em lote
│   └── GenericAMMPair.sol        ← Pool AMM própria
└── docs/                         ← Documentação
```

---

## 3. A TRANSIÇÃO (planta — como será)

### Fase 1 — Extrair interfaces (agora)
Criar `lib/agent-framework/` com interfaces genéricas. O código existente importa delas. Nada quebra.

```
lib/agent-framework/
├── IAgent.ts              ← Contrato que todo agente implementa
├── ICoordinator.ts        ← Como agentes se coordenam (votação, consenso)
├── IExecutor.ts           ← Como ações são executadas
├── IReputation.ts         ← Como reputação é calculada
├── ISafetyGuard.ts        ← Como segurança é aplicada (circuit breaker)
├── IResourceManager.ts    ← Como recursos são alocados
├── IAudit.ts              ← Como ações são auditadas
├── ICompliance.ts         ← Como políticas são verificadas pré-execução
├── ILearningEngine.ts     ← Como o sistema aprende com resultados
├── resource-manager.ts    ← ResourceManager (genérico, usado por capital-controller)
├── safety-guard.ts        ← SafetyGuard (genérico, usado por circuit-breaker)
├── audit.ts               ← Audit (genérico, trail de auditoria)
├── reputation.ts          ← Reputation (genérico, score de agentes)
├── compliance.ts          ← Compliance (genérico, políticas pré-execução)
├── learning-engine.ts     ← LearningEngine (genérico, ajuste de parâmetros)
├── oracle-conditions.ts   ← OracleConditions (genérico, monitor de condições)
├── voting.ts              ← Voting (genérico, consenso por votação)
├── coordinator.ts         ← Coordinator (genérico, ciclo multi-agente)
└── index.ts             ← Reexporta tudo
```

### Fase 2 — Extrair implementações (próximas sessões)
Mover a lógica CONCRETA para dentro do framework, mantendo compatibilidade:

| Arquivo atual | Vai para | Vira |
|--------------|----------|------|
| `lib/pregão.ts` | `lib/agent-framework/coordinator.ts` | Orquestrador genérico |
| `lib/capital-controller.ts` | `lib/agent-framework/resource-manager.ts` | Alocador de recursos |
| `lib/circuit-breaker.ts` | `lib/agent-framework/safety-guard.ts` | Guarda de segurança |
| `lib/accountant.ts` | `lib/agent-framework/audit.ts` | Audit trail |
| `lib/escola-robos.ts` | `lib/agent-framework/reputation.ts` | Reputação |
| `lib/route-verifier.ts` | `lib/agent-framework/compliance.ts` | Verificador de políticas |
| `lib/professor.ts` | `lib/agent-framework/learning-engine.ts` | Aprendizado |
| `lib/arqueiro.ts` | `lib/agent-framework/oracle-conditions.ts` | Condições de timing |
| `lib/agent-voting.ts` | `lib/agent-framework/voting.ts` | Consenso |

**Regra**: cada extração cria o arquivo novo e reexporta do original. Nenhum import existente quebra.

### Fase 3 — Mover estratégias para examples/ (próximas sessões)

```
examples/
├── treasury-agents/             ← Nosso trading atual como exemplo vivo
│   ├── strategies/
│   │   ├── grid-trading.ts      ← movido de lib/
│   │   ├── stable-mr.ts         ← movido de lib/
│   │   ├── modo-grão.ts         ← movido de lib/
│   │   └── oscillation-hunter.ts← movido de lib/
│   ├── agents/
│   │   └── (13 agentes atuais)
│   └── README.md
├── data-agents/                 ← Futuro: agentes que monitoram dados
└── arbitrage-agents/            ← Futuro: agentes de arbitragem
```

### Fase 4 — Podar UI (futuro)
Remover componentes que só fazem sentido como produto de trading.
Criar dashboard de framework (métricas de agente, não de trading).

---

## 4. O PROTOCOLO (ideia mais valiosa — ainda na planta)

Para agentes de diferentes desenvolvedores se comunicarem, precisamos de um **protocolo** — não apenas uma API interna.

### Formato de Intent (proposto)
```typescript
interface AgentIntent {
  id: string
  agentId: string           // ERC-8004
  action: string            // "swap", "alert", "vote", "request_resource"
  params: Record<string, any>
  confidence: number        // 0-100
  signature?: string        // on-chain proof
  timestamp: number
}
```

### Fluxo proposto
```
Agent A                          Agent B
  |                                |
  |─ publishIntent(intent) ──────►|  (via ERC-8183 on Arc)
  |                                |
  |◄───── voteOnIntent(id) ──────|
  |◄───── voteOnIntent(id) ──────|  (N agentes votam)
  |                                |
  |─ resolveConsensus(results) ──►|  (resultado on-chain)
  |                                |
  |─ executeAction(action) ──────►|  (executor faz swap)
  |                                |
  |─ publishAudit(result) ───────►|  (audit trail on-chain)
```

### Integração com Arc
- **ERC-8004**: identidade dos agentes (já implementado em `AgentIdentity.sol`)
- **ERC-8183**: jobs (intents viram jobs on-chain)
- **USDC as gas**: agentes pagam gas em USDC (já implementado)

---

## 5. INTEGRAÇÕES COM ARC + CIRCLE

### O que já funciona
| Integração | Status | Detalhes |
|-----------|--------|----------|
| USDC como gas na Arc | ✅ | Paymaster configurado |
| CCTP bridge Polygon ↔ Arc | ✅ | Bridge automática |
| ERC-8004 (AgentIdentity) | ✅ | Contrato deployado |
| Swaps na Arc (AMM próprio) | ✅ | Pool USDC/EURC |
| Gas Station | ✅ | Gas patrocinado |

### O que pode virar parceria (oportunidades)
| Proposta | Para a Circle | Para a Arc |
|----------|--------------|------------|
| Market maker autônomo para cirBTC | Liquidez automatizada 24/7 | Caso real de agentes |
| Orquestrador de agentes ERC-8004 | Demonstração de Agentic Economy | Infraestrutura para devs |
| Reputação on-chain de agentes | Dados de performance verificáveis | Padrão para ecossistema |

---

## 6. DECISÕES ATIVAS (design rationale)

### Por que TypeScript e não Rust/Solidity puro?
O framework roda no **cliente** (browser/Node.js) porque agentes precisam de latência baixa para votar e decidir. On-chain fica só o registro (ERC-8004, ERC-8183). Isso é deliberado — computação pesada off-chain, prova on-chain.

### Por que manter o trading real com $48?
Porque é a **única prova viva** de que o framework funciona com capital real. Nenhuma quantidade de testes simulados substitui 5 semanas de trades reais na Polygon. Isso é nosso maior ativo de marketing técnico.

### Por que NÃO virar banco/pagamentos/carteira?
Concorrer com PicPay, Mercado Pago, Nubank seria suicídio (equipe de 1 dev, sem licença, sem capital). O valor está na **orquestração de agentes**, não no produto final.

### Por que NÃO renomear o repo agora?
Renomear agora quebraria todos os links, issues, e referências existentes. Primeiro extrair o framework como `/packages/framework/`. *Depois* avaliar se faz sentido um repo separado.

---

## 7. ROADMAP

### Concluído (06/07/2026)
- ✅ **Fase 3 completa**: 4 estratégias movidas de `lib/` para `examples/trading/strategies/` com reexport
- ✅ **lib/agent-framework/** completo: 9 interfaces + 8 implementações genéricas
  - IAgent, ICoordinator, IExecutor, IReputation, ISafetyGuard, IResourceManager, IAudit, ICompliance, ILearningEngine
  - ResourceManager, SafetyGuard, Audit, Reputation, Compliance, LearningEngine, OracleConditions, Voting, Coordinator
- ✅ capital-controller.ts → resource-manager.ts (já importa e usa o ResourceManager genérico)
- ✅ circuit-breaker.ts → safety-guard.ts (já importa e usa o SafetyGuard genérico)
- ✅ accountant.ts → audit.ts (Audit genérico adicionado ao framework)
- ✅ escola-robos.ts → reputation.ts (Reputation genérico adicionado ao framework)
- ✅ route-verifier.ts → compliance.ts (Compliance genérico adicionado ao framework)
- ✅ professor.ts → learning-engine.ts (LearningEngine genérico adicionado ao framework)
- ✅ arqueiro.ts → oracle-conditions.ts (OracleConditions genérico adicionado ao framework)
- ✅ agent-voting.ts → voting.ts (Voting genérico adicionado ao framework)
- ✅ pregão.ts → coordinator.ts (Coordinator genérico adicionado ao framework)
- ✅ Memory leak fix: 9 arrays bounded + cicloRef cleanup
- ✅ Solana removido do código
- ✅ Backpack Exchange removido do código
- ✅ cirBTC address corrigido para o oficial Circle
- ✅ Faucet auto-claim com 3 layers
- ✅ CapitalController lock por token+rede
- ✅ Grid trading guard (recenter)
- ✅ Documentação de incidentes técnicos
- ✅ Build limpo (zero erros TS)
- ✅ **PregãoDashboard podado**: Stress Test, Contratante, StableOpportunities, OKs Ativos, Trades Executados, Pair-Sector removidos (~480 linhas a menos)
- ✅ **AgentIntent protocol**: `lib/agent-framework/intent-types.ts` + `intent-publisher.ts`
- ✅ **Framework singletons**: `lib/agent-framework/singletons.ts` (reputation, audit, intents)
- ✅ **Framework Dashboard**: `app/components/FrameworkDashboard.tsx` + aba "🏗️ Framework"
- ✅ **Build limpo** (zero erros TS)
- ✅ **OnChainIntentPublisher**: `lib/agent-framework/onchain-intent-publisher.ts` — publica intents como jobs ERC-8183 na Arc testnet, submit/complete via auto-sign
- ✅ **frameworkIntents agora é OnChainIntentPublisher** — fallback off-chain quando sem private key

### Próximas sessões
1. **Dashboard de monitoramento on-chain** (ver jobs ERC-8183 ativos)
2. **Reputação on-chain** (vincular intent results ao ERC-8004 AgentIdentity)

### Futuro (sem data)
- Market maker autônomo para cirBTC
- Marketplace de jobs ERC-8183
- Pitch técnico para Circle/Arc
- Suporte a mais chains (Base, Arbitrum)

---

## 8. REGRAS PARA IAs

1. **LEIA ESTE DOCUMENTO PRIMEIRO** antes de qualquer alteração
2. **Nunca quebre imports existentes** — extraia, não remova
3. **Interface primeiro** — crie o contrato, depois a implementação
4. **Prova real > simulação** — o trading com $48 é o que valida o framework
5. **Vocabulário de framework** — "agente", "coordenação", "consenso", "reputação". Evite "pregão", "escriturário", "pregoeiro" em código novo
6. **Documente decisões** — toda decisão de arquitetura adicionada aqui
7. **Build limpo** — `npx tsc --noEmit` deve passar sempre

---

## 9. GLOSSÁRIO

| Termo | Significado |
|-------|------------|
| Agente | Entidade autônoma que vota, propõe ações, e tem reputação |
| Coordenação | Processo de múltiplos agentes chegarem a consenso |
| Intent | Proposta de ação publicada por um agente |
| Consenso | Decisão tomada por N agentes votando |
| Recurso | O que está sendo alocado (capital, CPU, permissão) |
| Reputação | Score do agente baseado em performance real |
| Safety Guard | Mecanismo que para tudo se condições de risco forem atingidas |
| Prova real | Trading com dinheiro real que valida o framework |

---

## 10. REFERÊNCIAS

- [Arc Docs](https://docs.arc.io/llms.txt) — USDC as gas, sub-second finality, ERC-8004
- [Circle Docs](https://developers.circle.com/llms.txt) — CCTP, Wallets, Gateway, Gas Station
- [AgentIdentity.sol](../contracts/AgentIdentity.sol) — ERC-8004 implementado
- [INCIDENTES-TECNICOS.md](./INCIDENTES-TECNICOS.md) — Bugs e correções
- [ARQUITETURA_TRADER.md](./ARQUITETURA_TRADER.md) — Arquitetura legada (trading)
