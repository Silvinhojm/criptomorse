# RI-BANK-31 — Correção e reteste real do recovery on-chain

Data: 2026-08-02

Branch: `codex/ri-bank-31-fix-real-recovery`

Base: `27935c245a0ae57b95b39f8ab4b4187324089ca7` (RI-BANK-30)

## Resultado

**Os dois bugs reais do RI-BANK-30 foram corrigidos e o cenário crítico E3
passou ponta a ponta contra Redis real + Arc Testnet real.**

- Bug 1, item invisível após morte do processo: corrigido.
- Bug 2, metadata `"[object Object]"`: corrigido.
- Processo novo encontrou a prova após o lease expirar, sem rebroadcast.
- Report, Audit e outbox terminaram `confirmed` com a mesma tx/bloco.
- Metadata do evento on-chain é JSON válido e legível.
- Todas as regressões obrigatórias passaram.
- Redis de teste terminou com zero chaves do prefixo.
- Job de produção continua desativado; nenhum deploy foi feito.

## Correção 1 — reinserção atômica no ZSET

Arquivo: `lib/agent-framework/onchain-proof-outbox-redis.ts`.

- linha 38: script `KNOWN_PROOF_LUA`;
- linha 41: `ZADD` no ZSET `:due` dentro do mesmo Lua que grava
  tx/bloco/status;
- linha 65: `recordKnownProof()`;
- linhas 67–69: o eval recebe item Hash + due ZSET e envia score atual +
  `intentId`.

Semântica:

1. o owner atual continua obrigatório;
2. `HSET` e `ZADD` são indivisíveis no servidor Redis;
3. o item volta ao índice como `reconciliation_pending`;
4. o lease global existente impede outro worker de reclamá-lo antes do TTL;
5. se o processo morrer, após o TTL o item já está due e pode ser retomado;
6. se o processo continuar, `complete()` remove o item do ZSET, sem busy-loop.

### Prova Redis real antes/depois

O teste `lib/security/ri-bank-31-redis-real-regression.test.ts` executou contra
o Redis dedicado:

```text
BUG1_BEFORE_REPRODUCED=YES
BUG1_AFTER_FIXED=YES
BUG1_ACTIVE_LEASE_PROTECTED=YES
```

Antes: o Lua vulnerável gravou a prova, o item não estava no ZSET, o lease foi
considerado expirado e uma nova instância recebeu `null`.

Depois: o adapter corrigido preservou a prova, reinseriu o intent, bloqueou um
segundo owner enquanto o lease estava ativo e permitiu o claim pela nova
instância após a expiração simulada. O item reapareceu com `attempts=2`, tx e
bloco originais.

## Correção 2 — normalização do compactPayload

Arquivo: `lib/agent-framework/onchain-proof-outbox-redis.ts`.

- linha 116: o parser chama `normalizeCompactPayload()`;
- linhas 124–128: string é preservada; objeto/valor deserializado pelo Upstash
  é convertido de volta com `JSON.stringify()`.

### Prova Redis real antes/depois

```text
BUG2_BEFORE_REPRODUCED=YES
BUG2_AFTER_FIXED=YES
```

O `HGETALL` real devolveu `compactPayload` como objeto. A lógica antiga
`String(object)` reproduziu literalmente `"[object Object]"`. O parser
corrigido devolveu JSON válido e estruturalmente igual ao payload original.

O teste removeu cinco chaves e confirmou:

```text
RI_BANK_31_REDIS_KEYS_REMAINING=0
```

## E3 real repetido — PASS

Ambiente reaproveitado do RI-BANK-30:

- wallet exclusiva: `0xF5c5350F07cEC22CD0e1Fa2A196A050c52e95B0A`;
- mesma chave local ignorada, nunca impressa/versionada;
- mesmo Redis dedicado `ARCFLOW_TEST_REDIS_*`;
- mesmo namespace aleatório `arcflow:ri-bank-30:test:*`;
- Arc Testnet chain ID `5042002`;
- DecisionAnchor `0x7813e04338dc9d6b7676843a52152c57438cc7b2`.

Fluxo observado:

1. processo filho confirmou a âncora;
2. persistiu tx/bloco no Redis;
3. terminou propositalmente com exit code `77` antes da reconciliação;
4. estado pós-morte: outbox `reconciliation_pending`, attempts 1; report e
   audit `pending`, versão 1;
5. processo novo nasceu com caches vazios;
6. antes do TTL, o lease impediu o claim;
7. depois do TTL, o item foi encontrado no ZSET;
8. nenhuma função de broadcast/find foi chamada pelo processo novo;
9. report e audit passaram para `confirmed`, versão 2;
10. outbox passou para `confirmed`, attempts 2;
11. tx e bloco permaneceram idênticos em todas as entidades.

Transação real:

- tx: `0x2722266c4982dfaf4d827cd3e876550dacf8a419b05ae8738438467e0eda3c54`;
- bloco: `55034873`;
- explorer:
  https://testnet.arcscan.app/tx/0x2722266c4982dfaf4d827cd3e876550dacf8a419b05ae8738438467e0eda3c54

Saída:

```text
childExit=77
afterCrash.outboxStatus=reconciliation_pending
after.outboxStatus=confirmed
after.reportStatus=confirmed
after.auditStatus=confirmed
finalRunStatus=confirmed
```

## Metadata on-chain — PASS

A receipt e o evento `ReportAnchored` foram relidos por RPC:

```text
TX_STATUS=CONFIRMED
BLOCK_NUMBER=55034873
METADATA_IS_OBJECT_OBJECT=NO
METADATA_JSON_VALID=YES
METADATA_MANDATE=RI-BANK-30
METADATA_SCENARIO=e3-crash
METADATA_INTENT_ID=ri30-e3-crash-intent
```

O valor `RI-BANK-30` permanece no metadata porque o mandato exigiu repetir
exatamente o harness E3 original; a serialização, porém, agora está correta.

## Regressões obrigatórias

- RI-BANK-28 recovery: PASS —
  `ALL_RI_BANK_28_ONCHAIN_PROOF_RECOVERY_ASSERTIONS_PASSED=YES`.
- RI-BANK-29 evidence persistence: PASS —
  `ALL_RI_BANK_29_DECISION_EVIDENCE_ASSERTIONS_PASSED=YES`.
- Rejection centralizada: PASS, 136/136.
- Cycle parity: PASS, 96/96.
- Operational fail-closed: PASS, 90/90.
- Settlement replay: PASS, 371/371.
- `tsc --noEmit`: PASS, zero erros.
- `npm.cmd run build`: PASS; apenas warnings preexistentes não bloqueantes.
- `git diff --check`: PASS.

## Limpeza e isolamento

- Harness E3 removeu as 19 chaves possíveis no `finally`.
- Teste antes/depois removeu suas cinco chaves.
- Varredura final `SCAN`, limitada ao prefixo RI-BANK-30/31:
  `RI_BANK_31_FINAL_REDIS_KEYS_REMAINING=0`.
- Saldo antes do reteste: `19.9901694951488` USDC nativo de testnet.
- Saldo depois: `19.9876656282272`.
- Custo: `0.0025038669216` USDC de faucet, sem valor real.
- Nenhuma variável `KV_REST_API_*`, wallet de produção, mainnet, trade, KMS,
  Vercel, cron ou deploy foi usado.

## Arquivos alterados

- `lib/agent-framework/onchain-proof-outbox-redis.ts` — somente os dois bugs.
- `lib/security/ri-bank-31-redis-real-regression.test.ts` — prova Redis real
  antes/depois.
- `ARCFLOW.md` — documentação da correção e prova real.
- este relatório.

## Estado final

O bloqueio técnico específico descoberto no E3 foi resolvido e comprovado em
rede/Redis reais. Isso **não ativa** nem autoriza o recovery em produção; apenas
remove os dois bugs abrangidos pelo RI-BANK-31. Qualquer ativação futura ainda
exige mandato próprio e revisão operacional das credenciais/signer/job.
