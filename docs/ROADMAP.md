# ArcFlow — Roadmap do Construtor (Fases Arquiteturais)

> **Objetivo:** Este documento descreve a visão arquitetural do ArcFlow e a ordem correta de evolução do framework. Antes de implementar qualquer nova funcionalidade, verifique se ela está alinhada com estas fases. O objetivo é evitar acoplamento desnecessário e preservar o ArcFlow como um framework de coordenação de agentes autônomos, e não apenas uma aplicação de trading.

---

# Visão Final

O ArcFlow deve evoluir para uma plataforma reutilizável de coordenação de agentes autônomos.

O trading será apenas um **Adapter** construído sobre o Framework.

Arquitetura alvo:

```
Identity
      │
Knowledge
      │
Intent
      │
Voting
      │
Coordinator
      │
Policy Engine
      │
Adapter
      │
Execution
      │
Audit
      │
On-chain Proof
```

---

# Fase 1 — Coordinator como núcleo (Em andamento)

Objetivo:

Remover o Pregão como ponto central do sistema.

O fluxo oficial deve ser:

```
Agente

↓

Knowledge

↓

Intent

↓

Coordinator

↓

Voting

↓

Execution

↓

Audit
```

Implementações:

- Coordinator torna-se entry point oficial
- TradingAdapter implementa IExecutor
- Pregão passa a ser implementação interna
- UI conversa somente com Coordinator

Resultado esperado:

O Framework deixa de depender do domínio de trading.

---

# Fase 2 — Knowledge First (Concluída)

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

# Fase 5 — On-chain Proof

Publicar apenas o hash do KnowledgeReport junto com a Intent.

Objetivos:

- Integridade
- Auditoria
- Baixo custo de gas

Não armazenar dados completos na blockchain.

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

```
Knowledge
    ↓
Agente
    ↓
Intent
    ↓
Voting
    ↓
Coordinator
    ↓
Adapter
    ↓
Execution
    ↓
Audit
    ↓
Blockchain
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
