# K-2 — Policy Authority and Rejection Contract

## 1. Propósito

Este documento define:

- a autoridade oficial das políticas do ArcFlow;
- o contrato canônico de rejeição;
- a paridade entre `submitProposal()` e `runCycle()`;
- a operação fail-closed quando Audit ou DecisionReport terminal falhar.

Princípios:

> Nenhuma proposta rejeitada pode alcançar o Adapter.

> Nenhuma decisão econômica pode prosseguir quando o Coordinator perdeu a capacidade de registrar sua causa.

O PolicyEngine não representa todos os mecanismos de bloqueio. O fluxo possui quatro categorias distintas.

## 2. Categorias oficiais

### 2.1 Invariante arquitetural obrigatório

Não pode ser desligado:

- rejeição nunca alcança `execute()`;
- `settled` permanece reservado;
- rejeição terminal é rastreável;
- execução exige executor disponível;
- `canExecute=false` impede execução;
- Terminal Audit é obrigatório;
- falha de Audit ou DecisionReport terminal causa degradação fail-closed;
- códigos estáveis, não mensagens humanas, identificam causas.

### 2.2 Política configurável

Pode variar por rede ou ambiente:

- `allowSyntheticRoutes`;
- `allowDirectStressTransactions`;
- `requireMinimumConfidence`;
- `requireVotingConsensus`;
- `allowKnowledgeOverride`.

Toda política ativa deve possuir configuração tipada, consulta real no runtime e valor aplicado no DecisionReport.

### 2.3 Guard operacional global

Bloqueia ciclo ou sistema antes de existir proposta individual.

Exemplo:

- Safety Guard aberto no início de `runCycle()`.

O bloqueio gera `CycleGuardEvent`, não DecisionReport fictício.

### 2.4 Autoridade externa ou subsistema

Não é `PolicyRule`, mas controla o fluxo:

- deduplicador;
- Knowledge `canTrade`;
- Voting;
- presença do executor;
- `executor.canExecute`.

Suas rejeições usam o contrato canônico compartilhado.

## 3. Estado operacional

```ts
type CoordinatorOperationalState =
  | "HEALTHY"
  | "AUDIT_DEGRADED"
```

Semântica:

### `HEALTHY`

- Audit e persistência terminal estão funcionais;
- propostas econômicas podem seguir pelo pipeline;
- todos os gates continuam obrigatórios.

### `AUDIT_DEGRADED`

- novas execuções econômicas são bloqueadas;
- nenhuma proposta pode alcançar Adapter ou `execute()`;
- health checks, diagnóstico, leitura, observabilidade e recuperação permanecem disponíveis;
- retornar a `HEALTHY` exige verificação explícita da saúde do Audit;
- reiniciar ou matar o processo não é requisito arquitetural.

## 4. Matriz oficial revisada

| Mecanismo | Categoria | Estágio | Fonte de verdade | Default | Configurável? | Override por rede? | `submitProposal` | `runCycle` | Pode bloquear? | Audit obrigatório? | DecisionReport individual? |
|---|---|---|---|---|---:|---:|---|---|---:|---:|---:|
| Estado operacional | Invariante | cycle-start/intake | Coordinator | `HEALTHY` | Não | Não | Bloqueia em degradação | Bloqueia ciclo econômico | Sim | Evento obrigatório | Quando houver proposta |
| Safety Guard | Guard global/intake | cycle-start/intake | `ISafetyGuard` | Fechado | Operacional | Não | Rejeita proposta | Bloqueia ciclo | Sim | Sim | Proposta: sim; ciclo global: não |
| Deduplicação | Subsistema | intake | `IntentDeduplicator` | Ativa | Internamente | Não | Obrigatória | Obrigatória | Sim | Sim | Sim |
| Knowledge `canTrade` | Autoridade | knowledge | `ResolvedKnowledgeContext` | Resultado canônico | Não como flag | Não | Obrigatório | Obrigatório | Sim | Sim | Sim |
| `allowKnowledgeOverride` | Política | knowledge | PolicyEngine | `true` | Sim | Sim | Aplicar | Aplicar | Não diretamente | Registrar aplicação | Sim |
| `requireMinimumConfidence` | Política | pre-vote | Config tipada | Ativa; 10% | Sim | Sim | Aplicar | Aplicar | Sim | Sim | Sim |
| `requireVotingConsensus` | Política | voting | PolicyEngine | `true` | Restrita | Somente ambiente não econômico | Aplicar | Aplicar | Sim | Sim | Sim |
| Voting result | Autoridade | voting | `Voting.resolve()` | N/A | Parâmetros próprios | Não | Autoritativo quando exigido | Igual | Sim | Sim | Sim |
| Ausência de executor | Invariante | capability | Coordinator | Executor obrigatório | Não | Não | Rejeição específica | Rejeição específica | Sim | Sim | Sim |
| `allowSyntheticRoutes` | Política | pre-exec | PolicyEngine | Configuração atual por rede | Sim | Sim | Aplicar | Aplicar | Sim | Sim | Sim |
| `allowDirectStressTransactions` | Política | pre-exec | PolicyEngine | Configuração atual por rede | Sim | Sim | Aplicar | Aplicar | Sim | Sim | Sim |
| `executor.canExecute` | Autoridade | capability | Executor | N/A | Pelo executor | Indiretamente | Obrigatório | Obrigatório | Sim | Sim | Sim |
| Terminal Audit | Invariante obrigatório | terminal | Coordinator + Audit | Sempre obrigatório | Não | Não | Obrigatório | Obrigatório | Falha degrada sistema | Sim | Sim |
| Compliance | API experimental | pre-exec futuro | `Compliance` | Inativa | Não autoritativa | Não | Não conectar em K-2c | Não conectar em K-2c | Não atualmente | Não atualmente | Não atualmente |

Nota:

> `enableAuditTrail` é flag legada e inoperante, a ser removida em K-2c. Ela não representa a autoridade futura de Audit.

## 5. Contrato canônico de rejeição

```ts
export type RejectionStage =
  | "intake"
  | "knowledge"
  | "pre_vote_policy"
  | "voting"
  | "capability"
  | "pre_exec_policy"
  | "execution_guard"

export type RejectedBy =
  | "safety_guard"
  | "deduplicator"
  | "knowledge"
  | "policy"
  | "voting"
  | "coordinator"
  | "executor"

export type RejectionCode =
  | "SAFETY_GUARD_OPEN"
  | "DUPLICATE_INTENT"
  | "KNOWLEDGE_CAN_TRADE_FALSE"
  | "PRE_VOTE_POLICY_REJECTED"
  | "VOTING_REJECTED"
  | "NO_EXECUTOR"
  | "PRE_EXEC_POLICY_REJECTED"
  | "EXECUTOR_CAN_EXECUTE_FALSE"

export interface RejectionMetadata {
  rejectedBy: RejectedBy
  rejectionCode: RejectionCode
  rejectionStage: RejectionStage
  rejectionReason: string
  sourcePath: "submitProposal" | "runCycle"
  occurredAt: number
}
```

Regras:

- `rejectionCode` é identificador estável de máquina;
- `rejectionReason` é mensagem humana;
- DecisionReport, Audit e retorno público usam os mesmos metadados;
- a primeira rejeição encontrada é canônica;
- rejeição terminal não pode ser substituída por estágio posterior.

## 6. Falhas de infraestrutura terminal

```ts
interface AuditWriteFailure {
  code: "AUDIT_WRITE_FAILED"
  intentId?: string
  decisionReportId?: string
  rejectionCode?: RejectionCode
  sourcePath: "submitProposal" | "runCycle"
  occurredAt: number
  message: string
}

class AuditInfrastructureError extends Error {
  readonly failure: AuditWriteFailure
}
```

Falha de persistência do DecisionReport deverá possuir contrato equivalente:

```ts
interface DecisionReportWriteFailure {
  code: "DECISION_REPORT_WRITE_FAILED"
  intentId: string
  decisionReportId: string
  rejectionCode?: RejectionCode
  sourcePath: "submitProposal" | "runCycle"
  occurredAt: number
  message: string
}
```

Uma falha de Audit ou DecisionReport terminal:

- mantém a rejeição em memória;
- mantém Intent como `REJECTED`;
- proíbe `execute()`;
- coloca o Coordinator em `AUDIT_DEGRADED`;
- interrompe o fluxo econômico atual;
- bloqueia futuras execuções econômicas;
- emite erro estruturado por canal independente;
- não exige encerramento do processo.

Uma exceção tipada pode interromper o caminho atual. Matar o processo não é requisito. O requisito é impedir continuidade econômica.

## 7. `_recordRejection()` revisada

Contrato conceitual:

```ts
interface RecordRejectionArgs {
  proposal: AgentProposal
  intentId: string
  decisionReport: DecisionReport
  rejection: RejectionMetadata
  consensus?: ConsensusResult
}

interface RecordedRejection {
  consensus: ConsensusResult
  decisionReport: DecisionReport
  auditRecorded: true
}
```

`auditRecorded=false` não representa conclusão normal. Se Audit falhar, o Coordinator degrada e interrompe o caminho.

Ordem:

1. validar `RejectionMetadata`;
2. atualizar DecisionReport:

```ts
outcome: "rejected"
rejection: RejectionMetadata
```

3. manter estado rejeitado em memória;
4. transicionar Intent para `REJECTED`;
5. persistir DecisionReport;
6. tentar criar `AuditEntry`;
7. se Audit funcionar:
   - concluir rejeição;
   - manter `HEALTHY`;
   - devolver resultado consistente;
8. se DecisionReport ou Audit falhar:
   - preservar rejeição terminal;
   - nunca executar;
   - registrar falha operacional;
   - emitir fallback estruturado;
   - entrar em `AUDIT_DEGRADED`;
   - interromper o fluxo econômico com erro tipado.

O bloqueio acontece dentro do Coordinator. Não depende do chamador interpretar `auditRecorded`.

## 8. Política fail-closed

Quando `_recordRejection()` não consegue gravar Audit:

```text
proposta permanece REJECTED
→ Intent permanece REJECTED
→ DecisionReport permanece rejeitado em memória
→ execute() permanece proibido
→ falha independente é emitida
→ Coordinator entra em AUDIT_DEGRADED
→ ciclo econômico atual é interrompido
→ novas execuções econômicas são bloqueadas
→ recuperação explícita é exigida
```

Atividades permitidas em degradação:

- health check;
- diagnóstico;
- leitura;
- observabilidade;
- recuperação;
- operações inequivocamente não econômicas.

O fallback independente deve usar JSON estruturado em `console.error`/stderr. Esse fallback não substitui o Audit.

## 9. `CycleGuardEvent`

```ts
interface CycleGuardEvent {
  type: "cycle_guard_event"
  cycleId: number
  blockedBy: "safety_guard" | "operational_state"
  code: "SAFETY_GUARD_OPEN" | "AUDIT_DEGRADED"
  reason: string
  occurredAt: number
  sourcePath: "runCycle"
  auditRecorded: boolean
}
```

Sequência:

1. criar `CycleGuardEvent`;
2. tentar gravar no Audit operacional;
3. se funcionar, `auditRecorded=true`;
4. se falhar:
   - emitir JSON estruturado em stderr;
   - guardar em buffer operacional em memória, quando disponível;
   - manter `auditRecorded=false`;
   - Safety Guard continua bloqueando;
   - falha persistente ou perda de evento terminal economicamente relevante coloca o Coordinator em `AUDIT_DEGRADED`.

Exemplo:

```json
{
  "type": "cycle_guard_event",
  "code": "SAFETY_GUARD_OPEN",
  "cycleId": 123,
  "sourcePath": "runCycle",
  "occurredAt": 0,
  "auditRecorded": false
}
```

## 10. DecisionReport em rejeições

As oito rejeições individuais devem gerar DecisionReport:

- Safety Guard;
- dedup;
- Knowledge;
- pre-vote Policy;
- Voting;
- no executor;
- pre-exec Policy;
- `canExecute`.

Campos mínimos:

```ts
interface RejectedDecisionReportFields {
  outcome: "rejected"
  rejection: RejectionMetadata
  auditStatus: "recorded" | "write_failed"
}
```

Em `runCycle()`:

- rejeição individual gera DecisionReport ligado ao `cycleIntentId`;
- bloqueio anterior à coleta de propostas gera `CycleGuardEvent`;
- não se cria proposta ou DecisionReport fictício.

## 11. Knowledge canônico

`proposal.params.knowledgeCanTrade` é compatibilidade legada. Não é fonte de autoridade.

Um booleano isolado em `params`:

- não pode aprovar;
- não pode rejeitar;
- não substitui KnowledgeReport;
- não substitui consulta do framework.

Contrato compartilhado:

```ts
interface ResolvedKnowledgeContext {
  report?: KnowledgeReport
  canTrade: boolean
  modifier: number
  source: "provided" | "queried" | "unavailable" | "failed"
}
```

Processo em ambos os caminhos:

1. verificar se existe KnowledgeReport fornecido;
2. validar estrutura, origem e campos necessários;
3. se válido, utilizá-lo;
4. caso contrário, consultar Knowledge Service;
5. obter `canTrade` canônico;
6. obter modifier canônico;
7. aplicar `allowKnowledgeOverride` somente à confiança;
8. registrar relatório, origem, canTrade e modifier no DecisionReport.

`canTrade=false` sempre prevalece. `allowKnowledgeOverride` nunca pode convertê-lo em `true`.

O uso atual de `proposal.params.knowledgeCanTrade` é débito técnico a remover em K-2c.

## 12. `allowKnowledgeOverride`

Decisão:

- atua somente sobre confidence;
- aplica-se nos dois caminhos;
- ocorre após resolução canônica de Knowledge e antes de pre-vote;
- confidence original, modifier e confidence efetiva são registrados;
- quando desabilitada, mantém confidence original;
- override por rede é permitido;
- Knowledge fornecido e válido evita consulta duplicada.

```ts
interface KnowledgeConfidenceApplication {
  originalConfidence: number
  knowledgeModifier: number
  effectiveConfidence: number
  overrideAllowed: boolean
}
```

## 13. `requireVotingConsensus`

Decisão:

- `true`: exige `Voting.resolve().approved`;
- zero agentes: rejeição;
- pass-through sem agentes: proibido;
- `false`: Voting não é autoridade bloqueadora;
- produção não pode desabilitar;
- override apenas em ambiente explicitamente não econômico;
- modo desabilitado deve aparecer no DecisionReport e Audit;
- semântica idêntica nos dois caminhos.

## 14. Minimum confidence

```ts
interface MinimumConfidenceNetworkOverride {
  enabled?: boolean
  threshold?: number
}

interface MinimumConfidencePolicyConfig {
  enabled: boolean
  threshold: number
  networkOverrides?: Record<string, MinimumConfidenceNetworkOverride>
}
```

Contrato:

- unidade 0–100%;
- default `10`;
- intervalo válido `[0,100]`;
- `NaN`, infinito ou fora do intervalo: erro de configuração;
- sem clamp silencioso;
- ausência usa default;
- override pode alterar `enabled` e threshold;
- threshold aplicado vai para DecisionReport;
- número mágico sai do Coordinator.

## 15. `canExecute()` no ciclo

`runCycle()` deve chamar `executor.canExecute()`:

```text
pre-exec Policy
→ executor.canExecute
→ APPROVED
→ EXECUTING
→ execute
```

`allowed=false` gera:

```text
rejectionCode: EXECUTOR_CAN_EXECUTE_FALSE
rejectedBy: executor
rejectionStage: execution_guard
```

O comportamento deve ser igual nos dois caminhos.

## 16. Ausência de executor

Voting rejeitado e executor ausente são condições distintas.

Executor ausente:

```text
rejectionCode: NO_EXECUTOR
rejectedBy: coordinator
rejectionStage: capability
```

Efeitos:

- DecisionReport;
- Audit;
- Intent rejeitado;
- contador de erro no ciclo;
- mensagem explícita;
- zero chamadas ao Adapter.

## 17. Matriz de paridade

| Etapa | `submitProposal` atual | `runCycle` atual | Estado desejado | Mudança K-2c | Classificação |
|---|---|---|---|---|---|
| Estado operacional | Ausente | Ausente | Bloqueio econômico em degradação | Adicionar gate | Bug |
| Safety Guard | Report individual | Bloqueio global | Report ou evento conforme contexto | Padronizar | Diferença deliberada |
| Intent | Criado cedo | Por proposta | Helper comum | Extrair | Duplicação |
| Dedup | Report sem Audit | `continue` | Report + Audit | `_recordRejection` | Bug |
| Knowledge | Report/consulta | Parâmetros/consulta | Helper canônico | Remover booleano autoritativo | Bug |
| `canTrade` | Report sem Audit | Sem report/Audit | Report + Audit | Centralizar | Bug |
| Override | Aplicado | Assimétrico | Aplicar em ambos | Helper comum | Bug |
| Pre-vote | Report + Audit | Audit sem report | Ambos | Centralizar | Bug |
| Voting | Report sem Audit | Sem report/Audit | Ambos | Centralizar | Bug |
| No executor | Específico | Misturado ao Voting | Específico | Separar | Bug |
| Pre-exec | Report + Audit | Audit sem report | Ambos | Centralizar | Bug |
| `canExecute` | Presente | Ausente | Presente em ambos | Adicionar | Bug |
| Execute | Após gates | Após gates incompletos | Gates equivalentes | Pipeline comum | Bug |
| Terminal Audit | Parcial | Parcial | Obrigatório | Invariante | Bug |
| DecisionReport | Parcial | Parcial | Toda rejeição individual | Centralizar | Bug |
| Settlement | Correlation criada | Correlation criada | Mesmos campos | Helper comum | Duplicação |

## 18. Precedência

### `submitProposal()`

```text
estado operacional
→ Safety Guard
→ dedup
→ Knowledge canTrade
→ allowKnowledgeOverride
→ minimum confidence/pre-vote
→ Voting
→ executor presence
→ pre-exec Policy
→ executor.canExecute
→ execution
```

### `runCycle()`

```text
estado operacional global
→ Safety Guard global
→ coleta
→ por proposta:
  dedup
  → Knowledge canTrade
  → allowKnowledgeOverride
  → minimum confidence/pre-vote
  → Voting
  → executor presence
  → pre-exec Policy
  → executor.canExecute
  → execution
```

A primeira barreira encontrada é canônica:

- duplicata e confidence baixa: `DUPLICATE_INTENT`;
- Knowledge bloqueia e Voting rejeitaria: `KNOWLEDGE_CAN_TRADE_FALSE`;
- executor ausente e rota proibida: `NO_EXECUTOR`;
- rota proibida e `canExecute=false`: `PRE_EXEC_POLICY_REJECTED`.

## 19. Compliance

Decisão para K-2c: manter como API experimental explicitamente não ativa.

- não remover;
- não integrar;
- não atribuir autoridade;
- documentar que não protege o fluxo atual;
- decidir remoção ou integração em fase posterior.

## 20. Critérios atualizados para K-2c

1. Toda política ativa tem chamada de runtime.
2. Nenhuma regra habilitada permanece fantasma.
3. Toda rejeição individual gera metadados tipados.
4. Toda rejeição individual gera DecisionReport.
5. Toda rejeição individual gera Audit.
6. Bloqueio global gera evento operacional auditável.
7. Os dois caminhos têm paridade declarada.
8. Ausência de executor é tratada separadamente.
9. `runCycle()` chama `canExecute()`.
10. Threshold não está hardcoded.
11. Caminho rejeitado nunca alcança Adapter.
12. Testes negativos verificam zero chamadas a `execute()`.
13. Falha de Audit nunca permite execução.
14. Falha ao gravar Audit coloca Coordinator em fail-closed.
15. `AUDIT_DEGRADED` bloqueia novas execuções econômicas.
16. O bloqueio não depende do chamador.
17. Falha de Audit gera erro estruturado independente.
18. Recuperação exige health check explícito.
19. Falha de DecisionReport terminal também degrada e bloqueia.
20. `proposal.params.knowledgeCanTrade` deixa de ser autoridade.
21. Ambos usam o mesmo helper de Knowledge.
22. `enableAuditTrail` é removida.
23. Terminal Audit substitui a flag como invariante.
24. Audit indisponível resulta em zero chamadas a `execute()`.
25. Precedência das rejeições é testada.
26. Nenhuma mudança em settlement, `settled`, accounting ou persistência.

## 21. Não objetivos

K-2 não cobre:

- estratégia de trading;
- liquidez K-1;
- persistência 2e.2k;
- SettlementRegistry;
- replay queue;
- `settled`;
- DecisionAnchor;
- swaps;
- capital real;
- re-seed de cirBTC;
- deploy.

## 22. Questões ainda abertas

1. Implementação concreta do estado operacional.
2. Health check do Audit.
3. Política de recuperação para `HEALTHY`.
4. Backend de eventos operacionais.
5. Tamanho do buffer em memória.
6. Persistência futura do buffer.
7. Se erro tipado sobe à API ou vira resultado público.
8. Quando Compliance deixa de ser experimental.
9. Se Voting advisory será executado ou `not_run`.
10. Tratamento público de degradação durante operações não econômicas.

Essas questões não alteram o invariante fail-closed.

## 23. Confirmação de escopo

- Documento não criado durante a fase de desenho; materializado somente após aprovação do auditor.
- Runtime não alterado.
- Testes não alterados.
- Nenhum deploy.
- Branch de referência: `versao-polygon`.
- HEAD-base de referência: `9ced0e60358890e1e5a8ef0a5bd32970b4d4333b`.

K-2b DESIGN REVISADO — AGUARDANDO AUDITORIA FINAL
