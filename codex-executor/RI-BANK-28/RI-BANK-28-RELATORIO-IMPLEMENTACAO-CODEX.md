# RI-BANK-28 — Relatório de implementação

Data: 2026-08-02

Branch isolada: `codex/ri-bank-28-onchain-recovery`

Base: `versao-polygon` (`cafd2320cfb88cd84e04bc58fb5e3d692018395c`)

## Resultado executivo

Foi implementado o mecanismo da Opção B: reconciliador único,
outbox Redis com concorrência atômica, recovery service e rota autenticada.
A entrega permanece **inativa e incapaz de transmitir transações**: não houve
trade, RPC, KMS, Redis externo, deploy ou transação on-chain real.

Há uma limitação pré-existente que precisa permanecer explícita antes de um
mandato de ativação: `IntentPublisher` e `Audit` ainda guardam seus registros
em memória da instância. A outbox é durável, mas uma invocação serverless fria
sem os registros em memória não consegue concluir a reconciliação; nesse caso
o item permanece observável e não recebe ACK. Ativar em produção exige primeiro
uma fonte durável/hidratação canônica para `DecisionReport` e `Audit`, além do
signer KMS. A implementação falha fechada diante dessa situação.

## Estágio 1 — reaproveitamento

1. `anchorDecision` requer uma transação assinada. Hoje o caminho servidor em
   `lib/agent-framework/onchain-intent-publisher.ts` usa `PRIVATE_KEY` com
   `ethers.Wallet`; a rota legada `/api/anchor-decision` aceita
   `PRIVATE_KEY || PRIVATE_KEY_STRESS`. Não usa a wallet KMS.
2. O RI-BANK-17 configurou KMS secp256k1/OIDC e permissões `GetPublicKey/Sign`,
   mas não entregou um adaptador signer. Essa configuração é reutilizável em
   uma ativação futura; nenhum signer KMS foi inventado neste mandato.
3. O padrão P3-B do RI-BANK-16 foi reaproveitado: lease global com owner token,
   item state machine e transições Lua/CAS no Redis. A razão é impedir duas
   invocações de consumir/retransmitir a mesma prova.

## Estágios 2 e 3 — implementação

- `lib/agent-framework/onchain-proof-reconciler.ts:21`: serviço único. Relê o
  report, deriva `auditId`, escreve os dois registros, verifica ambos e compensa
  a primeira escrita se a segunda falhar. Duplicatas idênticas são idempotentes;
  uma prova confirmada conflitante é recusada.
- `lib/agent-framework/coordinator.ts:818` e `:1207`: os dois sucessos originais
  passaram a chamar o reconciliador.
- `lib/agent-framework/onchain-intent-publisher.ts:70`: o fallback legado corrige
  o contador sem substituir a entrada; só remove após reconciliação confirmada;
  ao esgotar, reconcilia `failed` em report e audit.
- `lib/agent-framework/onchain-intent-publisher.ts:229`: com Redis configurado,
  a outbox durável é autoritativa e a fila em memória não roda em paralelo.
- `lib/agent-framework/onchain-proof-outbox.ts`: contrato do item com todos os
  campos exigidos e adapter em memória exclusivo para testes.
- `lib/agent-framework/onchain-proof-outbox-redis.ts:5`: claim atômico, lease
  global de 60 s, incremento de tentativas e transições observáveis.
- Backoff: 30 s exponencial, teto de 15 min, máximo de 5 tentativas. Após isso,
  `dead_letter` permanece no Redis; só entra nesse estado depois de report e
  audit serem verificados como `failed`.
- Idempotência de transmissão: `txHash`/bloco conhecidos desviam diretamente
  para reconciliação. Um broadcaster futuro é contratualmente obrigado a
  persistir a transação preparada antes de transmiti-la.

## Estágio 4 — rota sem execução

`app/api/onchain-proof-recovery/route.ts:11` aceita apenas `POST`, exige bearer
`CRON_SECRET`, Redis configurado e `ONCHAIN_PROOF_RECOVERY_JOB_ENABLED=true`.
O flag não foi configurado. Além disso, a rota injeta
`DisabledOnChainProofBroadcaster`, que sempre recusa assinar/transmitir. A
verificação estrutural confirmou ausência de `submitProposal`, `runCycle`,
`anchorDecision`, `ethers`, chaves privadas e `kms:Sign` nessa rota.

## Testes e verificações

- `npx.cmd tsx lib/security/ri-bank-28-onchain-proof-recovery.test.ts`:
  `ALL_RI_BANK_28_ONCHAIN_PROOF_RECOVERY_ASSERTIONS_PASSED=YES`.
- Cobertura comportamental: escrita conjunta e compensação; ACK posterior à
  verificação; concorrência sem perda do contador; exaustão com `failed` nos
  dois registros e dead-letter; duplicata idempotente; broadcaster preparado
  persistido antes do retorno.
- Cobertura estrutural: a rota não contém os caminhos proibidos e está inativa.
- `npx tsc --noEmit`: zero erros.
- `npm run build`: sucesso. Os warnings exibidos são preexistentes; a rota nova
  apareceu no manifesto do build.
- `git diff --check`: sem erro (somente avisos de conversão LF/CRLF do Git).

## Arquivos alterados/criados

`ARCFLOW.md`, `lib/kv.ts`, `coordinator.ts`, `onchain-intent-publisher.ts`,
`singletons.ts`, `onchain-proof-reconciler.ts`, `onchain-proof-outbox.ts`,
`onchain-proof-outbox-redis.ts`, `onchain-proof-recovery.ts`,
`app/api/onchain-proof-recovery/route.ts`, `lib/security/cron-auth.ts`,
`lib/security/timing-safe-compare.ts` e o teste RI-BANK-28.

## Confirmações negativas

- Nenhuma transação on-chain ou trade foi executado.
- Nenhum Redis externo, RPC ou KMS foi chamado.
- Nenhuma variável Vercel/AWS foi alterada.
- Nenhum deploy foi feito e o job não foi ativado.
