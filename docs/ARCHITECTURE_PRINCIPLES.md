# ArcFlow — Princípios Arquiteturais Imutáveis

> Este documento contém as regras arquiteturais do ArcFlow.
> Nenhuma implementação pode violá-las.
> Se uma nova funcionalidade exigir violar um princípio, repense a abordagem.
> `PROJECT_VISION.md` is the canonical architecture source of truth.

---

## 0. Ciclo canônico

Todo documento e implementação futura deve seguir o ciclo canônico definido em `PROJECT_VISION.md`:

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

## 1. O Coordinator é o único entry point público

Nenhum agente, adapter ou componente externo chama o Pregão (ou qualquer outro domínio) diretamente.

O Coordinator é o único responsável por rotear decisões econômicas autônomas. Chamadas manuais, administrativas, demo e teste podem existir como utilitários classificados, mas não são o runtime autônomo canônico.

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

1. Knowledge Service — contexto situacional
2. Recebimento da proposta / Intent
3. Policy Engine — regras globais
4. Voting Engine — votação e consenso
5. Execução via Adapter
6. Audit
7. Decision Report
8. DecisionAnchor — hash do Decision Report + metadados compactos
9. Feedback

Nenhum passo pode ser pulado. Nenhuma decisão é tomada fora do Coordinator.

## 6. Todo domínio é um Adapter

O ArcFlow não conhece trading, lending, governança ou qualquer domínio específico.

```
Framework:
  Coordinator, Knowledge Service, Identity, Reputation, Intent, Policy Engine, Voting Engine, Adapter, Audit, Decision Report, DecisionAnchor

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
- Decision Report hash + compact metadata anchored by DecisionAnchor

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

Policy deve bloquear quando uma regra global falha. Policy não é apenas aconselhamento ou decoração de dashboard.

## 13. Knowledge não é decoração opcional

Knowledge Service é um gate real dentro do Coordinator.

- `KnowledgeReport.canTrade = false` bloqueia execução.
- `knowledgeStatus` e `knowledgeError` devem ser preservados quando disponíveis.
- Agentes podem propor, mas o contexto oficial pertence ao Knowledge Service.

## 14. Voting Engine é autoridade canônica de consenso

Consenso é resolvido pelo Voting Engine canônico.

- `Voting.resolve()` é a autoridade de consenso.
- Coordinator não deve manter lógica paralela de consenso.
- Zero voting agents não autoriza execução autônoma.
- O resultado de consenso deve permanecer auditável e compatível com `SubmissionResult.consensus`.

## 15. Execução não é liquidação

ArcFlow não comemora execução. ArcFlow só confia em liquidação verificada.

Princípios derivados:

- Adapter dispatch não é settlement.
- Execution não é profit.
- Hash de transação sozinho não é verdade econômica final.
- Valores de dashboard são provisionais salvo quando respaldados por settlement/accounting.
- Lucro líquido deve considerar gas, fees, slippage, tentativas falhas, tempo e risco.
- DecisionAnchor prova o payload ancorado; ele só prova lifecycle completo quando o hash canônico do DecisionReport finalizado está correto.

## 16. Arqueiro observa, não decide

Arqueiro pode observar mercado, detectar zonas de foco e guiar atenção futura como Opportunity Scout / Pre-Intent Router.

Arqueiro não pode:

- executar transações;
- possuir signer ou private key;
- submeter decisões econômicas fora do Coordinator;
- sobrescrever Policy ou Voting;
- mutar confiança final após Voting;
- contaminar lucro de dashboard com sinais não liquidados.

Antes de qualquer ativação real, Arqueiro deve emitir artefatos de dados pre-intent com TTL, qualidade de dados e `executionAllowed: false`.
