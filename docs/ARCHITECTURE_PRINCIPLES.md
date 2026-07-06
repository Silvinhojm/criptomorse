# ArcFlow — Princípios Arquiteturais Imutáveis

> Este documento contém as regras arquiteturais do ArcFlow.
> Nenhuma implementação pode violá-las.
> Se uma nova funcionalidade exigir violar um princípio, repense a abordagem.

---

## 1. O Coordinator é o único entry point público

Nenhum agente, adapter ou componente externo chama o Pregão (ou qualquer outro domínio) diretamente.

```
✅ Agente → Coordinator.submitProposal() → ... → Executor
❌ Agente → pregão.receberOK()
❌ Agente → qualquer método interno de domínio
```

## 2. Nenhum Executor chama a API pública do Coordinator

Um adapter de execução (IExecutor) nunca chama `submitProposal()`, `receberOK()` ou qualquer entry point público. Fazer isso cria ciclo infinito: o Coordinator chama o Executor, que chama o Coordinator de volta.

```
✅ TradingAdapter → pregão.injetarSinal()   (método interno)
❌ TradingAdapter → pregão.receberOK()       (entry point público → ciclo)
❌ TradingAdapter → coordinator.submitProposal()
```

Todo adapter tem acesso apenas ao método interno do motor que executa. A API pública pertence exclusivamente ao Coordinator.

## 3. Separe API pública do motor interno

Todo módulo que tem um ponto de interceptação pública deve expor duas rotas:

| Público | Interno |
|---------|---------|
| `receberOK()` | `injetarSinal()` |
| Processa validação, roteia para Coordinator | Executa diretamente, sem interceptação |

O método público pode redirecionar. O método interno nunca redireciona.

## 4. Proibido usar flags de atalho

São proibidas:

- `if (inCoordinator) return`
- `isExecuting = true`
- `skipCoordinator = true`
- Qualquer flag booleana que mude o comportamento do método com base em "quem chamou"

A solução correta é sempre separar responsabilidades (Princípio 3), nunca adicionar branch condicional.

## 5. Todo fluxo passa pelo Coordinator

O Coordinator coordena:

1. Knowledge — contexto situacional
2. Recebimento da proposta
3. Votação (se houver agentes registrados)
4. Resolução de consenso
5. Execução via adapter
6. Auditoria
7. Feedback

Nenhum passo pode ser pulado. Nenhuma decisão é tomada fora do Coordinator.

## 6. Todo domínio é um Adapter

O ArcFlow não conhece trading, lending, governança ou qualquer domínio específico.

```
Framework:
  Coordinator, Knowledge, Identity, Reputation, Intent, Voting, Audit

Adapter (domínio):
  IExecutor.execute() → lógica específica do domínio
```

Trading é apenas o primeiro adapter de referência.

## 7. Toda decisão gera Audit

Toda execução que passa pelo Coordinator deve ter entrada no Audit contendo:

- Proposta original
- KnowledgeReport (com confidenceModifier)
- Votos (agentes, confiança, reputação)
- Resultado da votação
- Resultado da execução
- Hash on-chain (Fase 5)

## 8. Nenhum agente consulta fonte externa diretamente

Todo conhecimento vem do Knowledge Service.

```
✅ Agente → frameworkKnowledge.query(request)
❌ Agente → fetch("api.somewhere.com/price")
❌ Agente → SoSoValue, Chainlink, DEX diretamente
```

O Knowledge Service é a única fonte de verdade consolidada.

## 9. O Framework não depende de nenhum domínio

Nenhum import de `lib/` (Pregão, agente de trading, swap, DEX) pode estar no core do framework (`lib/agent-framework/`).

O core depende apenas de:
- Interfaces e tipos abstratos
- Serviços genéricos (Knowledge, Audit, Reputation)

Adapters importam o core, nunca o contrário.

## 10. Toda identidade tem reputação

Nenhum ator no sistema (agente, desenvolvedor, módulo) opera sem identidade. Toda identidade acumula reputação baseada em resultados passados.

## 11. Prefira extrair a recriar

Nunca reescreva um módulo existente. Extraia sua interface para um arquivo novo, adapte o original para implementá-la, e deprecie o acesso direto.

```
Novo: lib/agent-framework/ICoordinator.ts (interface)
Adaptado: lib/pregão.ts → injetarSinal() interno
Depreciado: acesso direto a pregão.receberOK() via import
```

## 12. Toda regra global pertence ao Policy Engine

Nenhum agente, adapter ou módulo implementa regras que afetam o sistema como um todo.

- Gas elevado → Policy Engine
- Rede congestionada → Policy Engine
- Horário de funcionamento → Policy Engine
- Liquidez mínima global → Policy Engine
- Modo econômico / aprendizado → Policy Engine

Agentes só tomam decisões locais baseadas no Knowledge + Policy vigente.
