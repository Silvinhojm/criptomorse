# RI-BANK-30 — Teste real de recovery na Arc Testnet

Data: 2026-08-02

Branch: `codex/ri-bank-30-arc-testnet-recovery`

Base: `fb1752d16050d0d2a18615077f13570dc7768f4b` (RI-BANK-29)

## ALERTA — BUG CRÍTICO CONFIRMADO EM E3

**O recovery após morte real do processo falhou.** O teste em memória do
RI-BANK-28 não reproduzia o comportamento do índice Redis.

No adapter Redis, `claimDue()` remove o item do ZSET `:due`. Em seguida,
`recordKnownProof()` grava `txHash`, `blockNumber` e
`status=reconciliation_pending`, mas **não reinsere o item no ZSET `:due`**.
Se o processo morre nesse ponto, o lease expira, porém uma nova instância não
encontra mais o item. A prova fica presente no Hash e on-chain, mas invisível
para o recovery normal.

Evidência real E3:

- processo filho terminou propositalmente com exit code `77` depois de
  persistir tx/bloco no Redis;
- a transação foi confirmada no bloco `55033183`;
- tx: `0x470b38a253384791404d449e98eacbb1446c0e2ca054d256d6393ed6de310b99`;
- a nova instância permaneceu `idle` mesmo após aguardar a expiração do lease;
- o teste terminou com `E3 cold process did not resume after lease expiry`.

Local do defeito: `lib/agent-framework/onchain-proof-outbox-redis.ts`, script
`KNOWN_PROOF_LUA`. A implementação em memória procura diretamente no Map e,
por isso, ocultava a ausência no ZSET.

## SEGUNDO BUG REAL — metadata on-chain corrompido

O Upstash com deserialização automática devolve o campo JSON
`compactPayload` como objeto. `RedisOnChainProofOutbox.parse()` aplica
`String(value.compactPayload)`, produzindo literalmente `"[object Object]"`.

Os quatro eventos reais emitidos pelo teste possuem `metadataURI` igual a
`[object Object]`. O `decisionHash` bytes32 foi preservado corretamente, mas o
metadata compacto legível foi perdido.

Esse defeito também não apareceu nos mocks, que preservavam `compactPayload`
como string.

## Veredito geral

| Etapa | Resultado | Veredito |
|---|---|---|
| E0 | Redis, wallet, rede e job isolados | PASS |
| E1 | Caminho feliz real | PASS |
| E2 | Falha RPC + retry/backoff | PASS |
| E3 | Morte do processo + cold start | **FAIL — BUG CRÍTICO** |
| E4 | Concorrência real | PASS, com retry de RPC |
| E5 | Exaustão/dead-letter | PASS |
| E6 | Limpeza do Redis teste | PASS |
| E7 | Produção intocada | PASS |

O RI-BANK-30 **não aprova o recovery para ativação operacional** enquanto o
bug E3 não for corrigido e retestado contra Redis real.

## E0 — isolamento

### Redis

- Fonte exclusiva: `.env.test.local`.
- Variáveis: `ARCFLOW_TEST_REDIS_URL` e `ARCFLOW_TEST_REDIS_TOKEN`.
- URL e token foram comparados em memória com `KV_REST_API_*` e são distintos.
- O helper dedicado não possui fallback para produção.
- Namespace aleatório desta execução:
  `arcflow:ri-bank-30:test:1785724082849:fee534c4-b777-431e-b8d0-ac58889ee04c:*`.

### Wallet

- Wallet nova e exclusiva: `0xF5c5350F07cEC22CD0e1Fa2A196A050c52e95B0A`.
- Não coincide com as três wallets documentadas no projeto.
- Chave mantida somente em `.env.ri-bank-30.local`, coberto por `.gitignore`;
  nunca impressa, copiada para relatório ou versionada.
- Financiamento: faucet público da Circle, Arc Testnet, 20 USDC.
- Saldo on-chain inicial confirmado: `20.0` USDC nativo e `20.0` no contrato
  USDC, chain ID `5042002`.

### Rede e job

- Somente Arc Testnet, chain ID `5042002`.
- Contrato DecisionAnchor de testnet:
  `0x7813e04338dc9d6b7676843a52152c57438cc7b2`.
- O endpoint antigo `.arc.network` respondeu `request limit reached`.
- O harness passou a usar os endpoints `.arc.io` atualmente listados pela
  documentação oficial da Arc.
- `ONCHAIN_PROOF_RECOVERY_JOB_ENABLED` não foi ativado nem localmente: o teste
  invocou o service diretamente. Vercel não foi acessada.

Referências oficiais consultadas:

- https://docs.arc.io/arc/references/connect-to-arc
- https://faucet.circle.com/

## E1 — caminho feliz

Antes:

- report `pending`, versão 1;
- audit `pending`, versão 1;
- outbox `pending`, attempts 0;
- `DecisionAnchor.totalReports() = 65`.

Depois:

- report `confirmed`, versão 2;
- audit `confirmed`, versão 2;
- outbox `confirmed`, attempts 1;
- `DecisionAnchor.totalReports() = 66`.

Transação:

- tx `0x00fff11cff647b88c209a6ebcfbda27fb1f0724304d9a8b65dc6a2aa93d465a2`;
- bloco `55032817`;
- https://testnet.arcscan.app/tx/0x00fff11cff647b88c209a6ebcfbda27fb1f0724304d9a8b65dc6a2aa93d465a2

## E2 — RPC instável e retry

Falha provocada:

- primeira execução usou endpoint local indisponível;
- erro real persistido: `ECONNREFUSED 127.0.0.1:1`;
- outbox: `retry_wait`, attempts 1;
- report/audit permaneceram `pending`.

Retry em processo/cache novos:

- endpoint oficial alternativo Blockdaemon;
- outbox `confirmed`, attempts 2;
- report/audit `confirmed`, versões 2;
- tx `0x351ce189ee496e44cde9fa75d791f29d8e5eccc8fa4cb225699e02fbbc95e543`;
- bloco `55033093`;
- https://testnet.arcscan.app/tx/0x351ce189ee496e44cde9fa75d791f29d8e5eccc8fa4cb225699e02fbbc95e543

Além da falha provocada, os endpoints públicos responderam várias vezes com
`code=-32011, request limit reached` em `eth_sendRawTransaction`. O retry
preservou o item, e a alternância para outro endpoint oficial permitiu concluir.

## E3 — processo morrendo e invocação fria

Sequência real:

1. processo filho reclamou o item;
2. enviou e confirmou a âncora na Arc Testnet;
3. persistiu tx/bloco com `recordKnownProof()`;
4. terminou imediatamente com exit code 77, antes da reconciliação;
5. processo novo nasceu com caches vazios;
6. aguardou mais que o TTL do lease;
7. permaneceu `idle` até o deadline.

Tx on-chain:

- `0x470b38a253384791404d449e98eacbb1446c0e2ca054d256d6393ed6de310b99`;
- bloco `55033183`;
- https://testnet.arcscan.app/tx/0x470b38a253384791404d449e98eacbb1446c0e2ca054d256d6393ed6de310b99

Resultado: **FAIL**, pela ausência do item no ZSET `:due` após
`recordKnownProof()`.

## E4 — concorrência real

Duas instâncias, clientes Redis e reconciliadores independentes chamaram
`runOnce()` simultaneamente para o mesmo item.

Primeira rodada:

- worker A: `idle`;
- worker B: `retry_scheduled` após rate limit;
- attempts final: 1 — apenas um claim;
- report/audit permaneceram `pending`;
- nenhuma duplicação ocorreu.

Retry único do vencedor retido:

- `retryStatus=confirmed`;
- report/audit versão 2 e `confirmed`;
- outbox `confirmed`, attempts 2;
- `totalReports` avançou exatamente de 68 para 69;
- tx `0x974f85ca1edfc58798d66073ccf907163aef15fa1e408b2caa707b0e35c3fed3`;
- bloco `55033679`;
- https://testnet.arcscan.app/tx/0x974f85ca1edfc58798d66073ccf907163aef15fa1e408b2caa707b0e35c3fed3

Resultado: lease/CAS impediu claim e âncora duplicados contra Redis real.

## E5 — exaustão

Falha persistente provocada: `forced_persistent_rpc_failure`.

Estados observados:

1. `retry_scheduled`;
2. `retry_scheduled`;
3. `dead_letter`.

Estado final:

- outbox `dead_letter`, attempts 3;
- report `failed`, versão 2;
- audit `failed`, versão 2;
- nenhum envio on-chain ocorreu neste cenário.

## E6/E7 — limpeza e produção

- O `finally` removeu as 19 chaves possíveis do harness em cada rodada.
- Uma varredura final `SCAN` restrita ao prefixo aleatório retornou:
  `RI_BANK_30_REDIS_KEYS_REMAINING=0`.
- Nenhuma chave fora do prefixo de teste foi enumerada ou removida.
- Nenhuma variável `KV_REST_API_*` foi carregada pelo harness.
- Nenhuma chave de produção, wallet operacional, mainnet, trade, KMS, cron,
  Vercel ou deploy foi usada.
- Saldo final da wallet exclusiva: `19.9901694951488` USDC nativo de testnet.
- Gasto total de faucet nas quatro âncoras reais: `0.0098305048512` USDC de
  testnet, sem valor real.

## Arquivos criados

- `lib/security/ri-bank-30-arc-testnet-recovery-real.test.ts`
- `scripts/ri-bank-30-prepare-wallet.mjs`
- este relatório.

Nenhum arquivo de produção foi modificado. Os bugs foram documentados, não
corrigidos, conforme o limite de autorização do mandato.

## Validação local final

- `tsc --noEmit`: PASS, zero erros.
- `git diff --check`: PASS.
- Diff antes do relatório: somente os dois arquivos de teste/configuração.

## Próxima decisão necessária

Um novo mandato deve autorizar a correção de produção para:

1. reinserir atomicamente o item `reconciliation_pending` no ZSET `:due` ao
   persistir prova conhecida, preservando lease/owner e evitando busy loop;
2. preservar/normalizar `compactPayload` como JSON string quando o Upstash já
   o tiver deserializado;
3. adicionar testes Redis reais de regressão para ambos;
4. repetir E3 e confirmar cold recovery + ACK após correção.
