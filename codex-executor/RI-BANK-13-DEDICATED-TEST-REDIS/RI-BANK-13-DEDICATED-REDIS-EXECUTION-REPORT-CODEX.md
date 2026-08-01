# RI-BANK-13 — Relatório de execução no Redis dedicado

Data: 31/07/2026  
Status: **APROVADO**

## Isolamento confirmado

- Arquivo de credenciais carregado: `.env.test.local`.
- Variáveis usadas: `ARCFLOW_TEST_REDIS_URL` e `ARCFLOW_TEST_REDIS_TOKEN`.
- Host sanitizado: `light-penguin-107097.upstash.io`.
- Host compartilhado anterior, não utilizado: `ace-labrador-88457.upstash.io`.
- `.env.test.local` está coberto por `.env*` e também listado explicitamente no `.gitignore`.
- Nenhum token foi exibido ou copiado para o relatório.

Foi criado `lib/security/test-redis-client.ts`. A leitura direta confirmou que esse helper:

- não importa `lib/kv.ts`;
- não contém `KV_REST_API_URL` nem `KV_REST_API_TOKEN`;
- exige as duas variáveis `ARCFLOW_TEST_REDIS_*` e lança erro se qualquer uma faltar;
- não possui fallback.

O teste atualizado também não contém nenhuma referência a `KV_REST_API_*` e obtém seus dois clientes exclusivamente por `createTestRedisClient()`.

## Execução real

Somente `lib/security/ri-bank-13-cross-instance-redis.test.ts` foi compilado e executado. Nenhum outro teste, script, trade, cron ou wallet foi executado.

```text
[CROSS_INSTANCE BEFORE] atualização perdida em 30/30.
[CROSS_INSTANCE AFTER] trading-budget=100/100; risk-boxes=100/100; inconsistências=0.
ALL_RI_BANK_13_CROSS_INSTANCE_REDIS_ASSERTIONS_PASSED=YES
```

Processo final: código de saída `0`.

## Limpeza das chaves

O teste criou três chaves sob um único prefixo aleatório `arcflow:ri-bank-13:test:<timestamp>:<random>`:

- `:vulnerable-budget`
- `:fixed-budget`
- `:fixed-risk-boxes`

O bloco `finally` executou `await clientA.del(...keys)` antes da saída bem-sucedida. Como o processo chegou ao código 0 sem erro no `finally`, o comando de remoção das três chaves concluiu com sucesso. Nenhuma chave de produção foi referenciada pelo teste.

## Arquivos deste passo

- `lib/security/test-redis-client.ts` — helper dedicado, sem fallback;
- `lib/security/ri-bank-13-cross-instance-redis.test.ts` — passou a usar o helper;
- anexos integrais desses dois arquivos neste pacote.

