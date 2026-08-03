# RI-BANK-29 — Relatório final de implementação

Data: 2026-08-02

Decisões aplicadas: **A1 + B1, sem B2**

Branch isolada: `codex/ri-bank-29-decision-evidence-redis`

Base: `3094915652284ee908734d31a7a81dcdc7b88d7a` (RI-BANK-28)

## Resultado

O Estágio 3 foi implementado e o Estágio 4 foi validado sem executar Redis real,
RPC, KMS, trade, transação on-chain, cron ou deploy. `DecisionReport` e `Audit`
novos agora possuem uma fonte durável assíncrona injetável; as fachadas
`IntentPublisher` e `Audit` continuam síncronas e compatíveis com dashboards,
mocks e suítes existentes.

O reconciliador de prova não depende mais dos Maps após uma invocação fria.
Quando o store Redis está disponível, ele carrega report e audit, valida o
vínculo entre ambos, atualiza os dois documentos atomicamente por Lua, relê e
verifica o resultado, hidrata os caches somente por compatibilidade e apenas
então permite o ACK da outbox.

## Arquitetura entregue

- `IDecisionEvidenceStore`: contrato assíncrono para leitura, escrita CAS e
  reconciliação atômica de prova.
- `RedisDecisionEvidenceStore`: adapter Redis com documentos versionados,
  cinco tentativas CAS e merge monotônico.
- `MemoryDecisionEvidenceStore`: implementação serializada usada para provar
  cold start e concorrência sem infraestrutura externa.
- Coordinator: aguarda as gravações duráveis nos funis canônicos de
  `DecisionReport` e `Audit`; falha de persistência permanece fail-closed.
- `OnChainProofReconciler`: usa Redis como fonte canônica quando injetado e
  conserva o caminho em memória para testes/compatibilidade.
- Recovery/outbox: registros anteriores sem evidência Redis tornam-se
  terminalmente observáveis como `legacy_evidence_missing`; não são
  reconstruídos, não recebem ACK de sucesso e não são retransmitidos.

## Esquema Redis implementado

Namespace por `kvEnvNamespace()`:

- `arcflow:<env>:decision-report:<intentId>` — Hash com `version`, `intentId`,
  `decisionReportId`, `payload`, `createdAt`, `updatedAt`.
- `arcflow:<env>:audit:<auditId>` — Hash com `version`, `auditId`, `payload`,
  `createdAt`, `updatedAt`.
- `arcflow:<env>:decision-reports:index` — ZSET por `createdAt`.
- `arcflow:<env>:audits:index` — ZSET por `timestamp`.

Escritas normais usam versão esperada em script CAS. A reconciliação usa um
script Lua único que lê os dois payloads, exige `report.auditId === auditId`,
recusa conflito de prova confirmada, trata repetição como idempotente e grava
report + audit na mesma operação Redis.

Uma escrita completa atrasada não pode rebaixar `onChainStatus: confirmed` nem
substituir hash/tx já confirmados. O merge também preserva settlement canônico
confirmado contra documento atrasado.

## Fluxo de invocação fria comprovado

1. Uma instância grava report e audit no store compartilhado.
2. Uma segunda instância nasce com `IntentPublisher` e `Audit` vazios.
3. O reconciliador lê exclusivamente o store, confirma a prova nos dois
   documentos e verifica a releitura.
4. Os caches vazios são hidratados depois da confirmação durável.
5. Duas instâncias concorrentes aplicando a mesma prova terminam alinhadas e
   idempotentes; uma prova conflitante é recusada.

## B1 — legado prospectivo

Não foi implementado backfill, cópia best-effort de Maps nem fabricação de
documentos a partir da outbox. Um item legado com tx conhecida, mas sem report
ou audit Redis, resulta em `legacy_evidence_missing`; o broadcaster não é
chamado e o estado fica observável no registro da outbox.

## Arquivos principais

Criados:

- `lib/agent-framework/decision-evidence-store.ts`
- `lib/agent-framework/decision-evidence-store-redis.ts`
- `lib/security/ri-bank-29-decision-evidence-persistence.test.ts`

Integrados/ajustados:

- `lib/agent-framework/coordinator.ts`
- `lib/agent-framework/onchain-proof-reconciler.ts`
- `lib/agent-framework/onchain-proof-recovery.ts`
- `lib/agent-framework/onchain-proof-outbox.ts`
- `lib/agent-framework/onchain-proof-outbox-redis.ts`
- `lib/agent-framework/onchain-intent-publisher.ts`
- `lib/agent-framework/singletons.ts`
- `lib/agent-framework/index.ts`
- `lib/agent-framework/types/index.ts`
- `lib/kv.ts`
- `lib/security/ri-bank-28-onchain-proof-recovery.test.ts`
- `ARCFLOW.md`

## Validação

- `tsc --noEmit`: **PASS**, zero erros.
- `npm run build`: **PASS**, build Next.js completo. Os warnings de lint já
  existentes permanecem não bloqueantes.
- RI-BANK-29 persistence/cold-start/concurrency: **PASS** —
  `ALL_RI_BANK_29_DECISION_EVIDENCE_ASSERTIONS_PASSED=YES`.
- RI-BANK-28 recovery regression: **PASS** —
  `ALL_RI_BANK_28_ONCHAIN_PROOF_RECOVERY_ASSERTIONS_PASSED=YES`.
- Centralized rejection: **136/136 PASS**.
- Cycle parity: **96/96 PASS**.
- Operational fail-closed: **90/90 PASS**.
- Settlement replay: **371/371 PASS**.
- Server factory: os 49 checks anteriores ao build interno passaram; o harness
  expirou ao iniciar um segundo `next build` e deixou um diretório-prova, que
  foi removido após validação exata. O mesmo build foi executado diretamente e
  terminou com sucesso.
- `git diff --check`: **PASS**.

## Confirmações negativas

- Nenhuma variável de ambiente ou segredo foi alterado.
- Nenhuma conexão com Redis real foi feita.
- Nenhuma chamada RPC, assinatura KMS, trade ou transação foi executada.
- Nenhum cron/job foi ativado.
- Nenhum deploy foi feito.
- `ONCHAIN_PROOF_RECOVERY_JOB_ENABLED` continua opt-in e a rota continua usando
  `DisabledOnChainProofBroadcaster`.

## Estado final

Implementação A1 + B1 concluída, validada e pronta para revisão. A ativação
operacional permanece fora do escopo e bloqueada.
