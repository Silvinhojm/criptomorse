# ArcFlow — Roadmap do Construtor (Fases Arquiteturais)

> **Objetivo:** Este documento descreve a visão arquitetural do ArcFlow e a ordem correta de evolução do framework. Antes de implementar qualquer nova funcionalidade, verifique se ela está alinhada com estas fases. O objetivo é evitar acoplamento desnecessário e preservar o ArcFlow como um framework de coordenação de agentes autônomos, e não apenas uma aplicação de trading.

---

# Visão Final

O ArcFlow deve evoluir para uma plataforma reutilizável de coordenação de agentes autônomos.

O trading será apenas um **Adapter** construído sobre o Framework.

Arquitetura alvo (canônica; ver `PROJECT_VISION.md`):

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

---

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

---

# Fase 1 — Coordinator como núcleo (Implementado / hardening)

Objetivo:

Remover o Pregão como ponto central do sistema.

O fluxo oficial deve ser:

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

Implementações:

- Coordinator torna-se entry point oficial
- TradingAdapter implementa IExecutor
- Pregão passa a ser implementação interna
- UI conversa somente com Coordinator

Resultado esperado:

O Framework deixa de depender do domínio de trading.

---

## Estado aceito apos Phase 1 / Phase 1b

- Legacy Pregao entry paths for autonomous economic signals route through the Coordinator.
- `pregao.receberOK()` is a compatibility wrapper.
- `pregao.injetarSinal()` is the TradingAdapter-internal hook.
- `RealAutomatedTrader` autonomous decisions submit through the Coordinator.
- `TradingNanopayments` autonomous decisions submit through the Coordinator.
- Manual/test/admin/demo paths are classified and allowed outside the autonomous lifecycle for now.

Current valid autonomous flow:

```text
Autonomous decision
  -> Coordinator.submitProposal()
  -> TradingAdapter
  -> pregao.injetarSinal()
  -> Pregao / Corretor machinery
```

Known limitations after Phase 2c:

- Pending proposal settlement is not reconciled back into all dashboards/accounting yet.
- Coordinator/TradingAdapter currently treats dispatch to Pregao as execution success, not final on-chain settlement.
- `job-robot` and `contratante` are demo/stress/testnet utilities for now and need a future Job/Testnet Adapter if promoted.
- Manual/admin swap routes remain callable low-level utilities and need stronger access boundaries later.
- DecisionReport and DecisionAnchor are not yet fully wired into the runtime completion path.

# Fase 2 — Knowledge First (Implementado)

Todo agente deve consultar o Knowledge Service antes de criar qualquer Intent.

Knowledge Service torna-se a única fonte oficial de contexto.

Responsabilidades:

- Liquidez
- Rotas
- Gas
- Mercado
- Histórico
- Reputação

Nenhum agente deve consultar diretamente serviços externos.

Original Phase 2 focus after Phase 1b acceptance:

- Enforce Knowledge Service as the required context source.
- Enforce Policy Engine ownership of global rules.
- Align local/domain voting with the framework Voting Engine.
- Make DecisionReport runtime records correct for proposal, dispatch, settlement, and failure states.
- Make DecisionAnchor correctness depend on finalized DecisionReport hash plus compact metadata.

## Estado aceito apos Phase 2a / Phase 2b / Phase 2c

Phase 2a is accepted:

- Knowledge Service is enforced inside Coordinator.
- `knowledgeStatus` and `knowledgeError` are persisted.
- `KnowledgeReport.canTrade = false` blocks execution.
- Policy Engine is enforced before voting and before execution.
- Policy rejection blocks execution and is persisted in DecisionReport and Audit where applicable.

Phase 2b is accepted:

- `Voting.resolve()` is the canonical consensus authority.
- `Coordinator.resolveConsensus()` was removed.
- `submitProposal()` and `runCycle()` use `Voting.resolve()`.
- Zero voting agents reject instead of executing.
- `ConsensusResult.action` maps from `proposal.action`.

Phase 2c is accepted:

- Coordinator rejection returns preserve the canonical `{ consensus: ... }` `SubmissionResult` shape.
- Adapter execution remains blocked after all rejection paths.
- Arqueiro startup is browser/runtime guarded.
- Arqueiro remains shadow/inert and non-executing.
- ScoutSignal runtime was not implemented.

Settlement principle:

```text
ArcFlow não comemora execução.
ArcFlow só confia em liquidação verificada.
```

Implications:

- Dispatch is not settlement.
- A transaction hash alone is not final economic truth.
- Dashboard profit is provisional until settlement is verified.
- Net profit must account for gas, fees, slippage, failed attempts, time, and risk.
- DecisionAnchor proves the anchored payload, not lifecycle correctness unless the finalized canonical DecisionReport hash is complete.

Next recommended technical phase:

- TradingAdapter settlement correctness.
- Pending proposal -> execution -> receipt -> settlement reconciliation.
- Prevent false success before real on-chain settlement.
- Separate gross result, gas cost, slippage, failed transaction cost, and net result.

Future architecture phases:

- DecisionReport canonicalization.
- DecisionAnchor canonical hash over complete finalized DecisionReport.
- Audit KnowledgeReport enrichment.
- Arqueiro ScoutSignal / OpportunityCandidate as a pre-intent artifact.

---

# Fase 3 — Voting Inteligente

O sistema de votação deve utilizar:

- confiança do agente
- reputação
- confidenceModifier do Knowledge

A votação não deve bloquear automaticamente.

O objetivo é reduzir naturalmente o peso de propostas de baixa qualidade.

---

# Fase 4 — Audit Completo

Cada decisão precisa registrar:

- Intent
- KnowledgeReport
- Confidence Modifier
- Agentes participantes
- Resultado da votação
- Executor
- Lucro
- Gas
- Tempo
- Blockchain Proof

Objetivo:

Permitir rastreabilidade completa de qualquer decisão.

---

# Fase 5 — DecisionAnchor

Publicar o hash canônico do Decision Report junto com metadados compactos.

Payload canônico do DecisionAnchor:

- `decisionHash`: hash do Decision Report finalizado
- `metadata`: metadados compactos (`decisionId`, `network`, `domain`, `adapterId`, `timestamp`, `knowledgeReportHash`)

Objetivos:

- Integridade
- Auditoria
- Baixo custo de gas

Não armazenar Decision Reports completos nem KnowledgeReports completos na blockchain.

---

# Fase 6 — Policy Engine

Criar uma camada responsável por políticas globais.

Exemplos:

- Gas elevado
- Rede congestionada
- Horário
- Liquidez mínima
- Modo econômico
- Modo aprendizado

Nenhum agente deve implementar regras globais.

Toda política pertence ao Policy Engine.

---

# Fase 7 — SDK

Criar uma API pública.

Exemplo:

```typescript
const framework = new ArcFlow()

framework.createAgent()

framework.submitIntent()

framework.vote()

framework.execute()

framework.audit()
```

Objetivo:

Permitir que qualquer desenvolvedor utilize o ArcFlow sem conhecer sua implementação interna.

---

# Fase 8 — Adapters

O Framework não deve conhecer Trading.

Trading passa a ser apenas um Adapter.

Adapters previstos:

- TradingAdapter
- LendingAdapter
- ArbitrageAdapter
- JobMarketplaceAdapter
- GovernanceAdapter
- MonitoringAdapter

Todos implementam IExecutor.

---

# Fase 9 — Interface (UX)

Somente iniciar após estabilização da arquitetura.

Objetivo:

Transformar a aplicação em um Centro de Controle de Agentes.

Perfis:

### Operador

Interface simples.

Mostra:

- saldo
- agentes
- saúde
- blockchain
- atividade

### Desenvolvedor

Interface técnica.

Mostra:

- Knowledge
- Coordinator
- Intent
- Voting
- Audit
- Reputation
- Blockchain
- Logs

---

# Fase 10 — Framework Live

Criar uma visualização animada do funcionamento interno.

Fluxo:

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

O usuário deve conseguir acompanhar o ciclo completo em tempo real.

---

# Fase 11 — Memory Service

Após estabilização do Knowledge Service.

Responsabilidades:

- Aprender padrões
- Memorizar sucessos
- Memorizar falhas
- Horários ideais
- Estratégias vencedoras
- Comportamentos históricos

Knowledge responde:

"O que sabemos agora?"

Memory responde:

"O que aprendemos ao longo do tempo?"

---

# Fase 12 — Plataforma

Objetivo final.

ArcFlow deixa de ser um sistema de trading.

Passa a ser um Framework para Coordenação de Agentes Autônomos.

O Trading torna-se apenas uma aplicação de referência.

Outros desenvolvedores poderão criar:

- agentes financeiros
- agentes de governança
- agentes de monitoramento
- agentes de automação
- agentes de pesquisa
- agentes para marketplaces
- agentes de contratos inteligentes

utilizando o mesmo Framework.

---

# Princípios do Projeto

Toda implementação futura deve respeitar estes princípios.

- O Framework nunca depende de um domínio específico.
- Todo conhecimento passa pelo Knowledge Service.
- Toda decisão passa pelo Coordinator.
- Toda execução passa por um Adapter.
- Todo resultado é auditável.
- Toda identidade possui reputação.
- Toda decisão pode ser explicada.
- O Framework deve ser reutilizável por terceiros.
- Trading é apenas um exemplo de uso.
- A arquitetura sempre tem prioridade sobre novas funcionalidades.

---

# Missão do ArcFlow

Construir um Framework Open Source para Coordenação de Agentes Autônomos baseado em conhecimento compartilhado, reputação, auditoria e prova on-chain, permitindo que qualquer desenvolvedor crie agentes inteligentes reutilizando a mesma infraestrutura.
