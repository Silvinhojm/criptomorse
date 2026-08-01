# RI-BANK-16 — Proposta técnica para signer, plano e idempotência do cron híbrido

```text
DOCUMENT_KIND=TECHNICAL_PROPOSAL
STATUS=CONCLUÍDO — RECOMENDAÇÕES NÃO VINCULANTES
CODE_CHANGE_AUTHORIZED=NÃO
CODE_CHANGE_PERFORMED=NÃO
EXECUTION_AUTHORIZED=NÃO
EXECUTION_PERFORMED=NÃO
DATE=2026-07-31
MANDATE=RI-BANK-16
DEPENDE_DE=RI-BANK-15-MAPPING-REPORT-CODEX.md
BLOQUEIA=qualquer implementação real de conexão do cron
AUTOR=Codex
WORKSPACE=C:\Users\silvi\arcflow
```

## Resumo das recomendações

| Item | Recomendação técnica | Por quê |
|---|---|---|
| P1 — signer | **Chave EVM não exportável em AWS KMS, acessada pela função Vercel com OIDC e role limitada a `kms:Sign`** | A chave privada não entra no Redis, no deploy, em variável de ambiente nem na memória da função; OIDC evita credenciais AWS permanentes. |
| P2 — plano | **Fila Redis de planos unitários, criada por operação administrativa; o workflow apenas dispara** | É o primeiro rollout mais previsível, auditável e limitado. O plano contém intenção de domínio, nunca calldata arbitrária. |
| P3 — concorrência | **Lease global Redis + máquina de estados idempotente por `planId`, ambos atualizados por Lua/CAS** | O lock impede sobreposição; o estado por plano impede repetição depois de retry/crash. Um sem o outro não basta. |

As três escolhas se reforçam: um plano Redis fornece o `planId` estável; o `planId` ancora idempotência e auditoria; uma wallet exclusiva do cron elimina colisão de nonce com a UI. A recomendação final continua dependendo de aprovação do Silvio, especialmente a escolha/migração da wallet de P1.

## 0. Decisões de política recebidas e travadas

Esta proposta assume, sem reabrir:

1. uma única operação aguardável e limitada por invocação;
2. Redis indisponível => fail-closed;
3. “rodou manualmente” => **ordem despachada**;
4. identidade mínima => rede + par + estratégia;
5. autorização manual permanente até mudança material da estratégia;
6. confirmação de mainnet sem expiração, até desligamento manual;
7. kill switch com segredo administrativo próprio, no padrão de `ADMIN_PANIC_KEY`, nunca `CRON_SECRET`;
8. auditoria retida por 30 dias.

## 1. Evidências relevantes do código atual

### Signer

- `realSwap` nasce com `signer = null` e mantém também uma string `privateKey` no singleton (`lib/real-swap-executor.ts:302–309`).
- `setSignerFromPrivateKey()` constrói `ethers.Wallet`, grava a chave no objeto e deriva o endereço (`lib/real-swap-executor.ts:1345–1369`).
- Há precedente server-side em `OnChainIntentPublisher.autoConfigureFromEnv()`, que lê `PRIVATE_KEY` e constrói `ethers.Wallet` (`lib/agent-framework/onchain-intent-publisher.ts:24–50`). Esse precedente prova viabilidade funcional, não isolamento forte.
- As rotas genéricas `/api/swap/sign` e `/api/swap/execute` permanecem bloqueadas justamente porque permitiam assinatura/execução arbitrária com a chave do servidor (`app/api/swap/sign/route.js:1–17`; `app/api/swap/execute/route.js:1–16`). O cron não pode recriar essa classe de endpoint.
- `.env.example:1–16` documenta uma chave principal e outra de stress. Não existe chave dedicada ao cron.

### Plano e despacho manual

- `AgentProposal.params` é um `Record<string, unknown>` sem `strategyId` ou origem tipada (`lib/agent-framework/IAgent.ts:1–8`).
- `TradeSignal` e seus metadados carregam par/rede/caixa e correlações, mas não estratégia nem origem manual/cron (`lib/agent-framework/trading-adapter.ts:5–26`).
- O TradingAdapter conhece o resultado exato do despacho: `accepted`, `orderCreated` e `ordemId` (`lib/agent-framework/trading-adapter.ts:29–34,89–123`).
- O Pregão só retorna sucesso de despacho quando criou uma ordem nova (`lib/pregão.ts:317–376`). A ordem nasce em `status: "preparando"` (`lib/pregão.ts:552–578`).

Portanto, o gancho técnico mais fiel à decisão “ORDEM DESPACHADA” é: **retorno do TradingAdapter com `accepted=true`, `orderCreated=true` e `ordemId`**, desde que a proveniência `manual_ui` tenha sido carregada desde a submissão. Não é proposta emitida e não afirma settlement.

### Atomicidade

- O repositório já usa Lua para preservar invariantes de uma mutação Redis inteira (`lib/risk-boxes-redis.ts:1–6,64–149`).
- `trading-budget.ts` usa atualização atômica no Redis para o gasto (`lib/trading-budget.ts:124–143`).
- `lib/kv.ts:33–62` já separa chaves por ambiente Vercel e centraliza os namespaces de circuit breaker, orçamento e caixas.

## 2. P1 — modelo do signer server-side

### Requisitos mínimos comuns a qualquer opção

Independentemente do armazenamento escolhido:

1. usar uma **wallet dedicada exclusivamente ao cron**, com saldo operacional mínimo e allowances limitadas;
2. manter um `CRON_EXPECTED_SIGNER_ADDRESS` server-only e comparar o endereço derivado/obtido antes de qualquer assinatura;
3. validar `chainId` real do provider contra o plano e uma allowlist server-side;
4. não aceitar do request `to`, calldata, RPC URL, nonce, gas ou chain arbitrários;
5. construir a transação somente pelo Adapter/serviços canônicos depois de todos os gates;
6. nunca registrar secret, raw key, assinatura completa, raw transaction ou objeto de erro que possa embutir credenciais;
7. responder HTTP apenas com códigos públicos, `planId`, `invocationId` e evidências não secretas;
8. separar produção de preview/development e negar mainnet fora de `VERCEL_ENV=production`;
9. possuir procedimento de rotação/revogação e kill switch independente;
10. impedir assinatura genérica: a camada de signer só recebe um `ValidatedExecutionPlan`, não JSON arbitrário do caller.

O endereço esperado é obrigatório em todas as alternativas. Ele impede que uma variável, secret ARN ou alias KMS errado faça o cron operar a carteira errada. A verificação precisa ser checksum-normalized e ocorrer antes do claim definitivo do plano.

### Opção P1-A — variável sensível da Vercel com hot wallet dedicada

Modelo:

```text
CRON_TRADING_PRIVATE_KEY      (Sensitive Environment Variable, production only)
CRON_EXPECTED_SIGNER_ADDRESS (server-only)
```

A função lê a chave somente dentro da invocação, cria um signer local e elimina referências ao final. Não deve usar a chave geral `PRIVATE_KEY` nem fallback para ela.

Prós:

- menor mudança em relação ao uso atual de `ethers.Wallet`;
- implementação e diagnóstico simples;
- Vercel criptografa variáveis em repouso e permite marcá-las como “sensitive”, tornando o valor não legível depois de criado;
- baixa latência e nenhuma dependência externa de assinatura.

Contras:

- a chave bruta necessariamente entra na memória da função;
- comprometimento do runtime, dependência ou log acidental pode expor controle completo da wallet;
- qualquer pessoa/processo com capacidade suficiente sobre o projeto/deploy amplia o raio de risco;
- rotação muda o endereço, salvo se a mesma chave comprometida for reutilizada — o que não é rotação real;
- alterações de environment variable só alcançam novos deployments, exigindo disciplina operacional.

Raio de exposição: todo o saldo da wallet, tokens aprovados e qualquer ação permitida pela chave nas chains em que ela exista. O limite de $15/$50 reduz o caminho normal do aplicativo, mas não limita um atacante que roubou a chave.

Uso recomendado: **somente piloto transitório**, com wallet nova de baixo saldo, nenhuma permissão administrativa e monitoramento. Não usar a wallet principal atual como atalho.

Fonte primária: [Vercel Environment Variables](https://vercel.com/docs/environment-variables) e [Sensitive Environment Variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables).

### Opção P1-B — secret manager externo, entregando a chave à função

Exemplos de classe: AWS Secrets Manager, Google Secret Manager ou equivalente. A função obtém credenciais curtas via OIDC, lê o secret durante a invocação e constrói `ethers.Wallet`.

Prós:

- auditoria e rotação centralizadas;
- políticas de acesso mais granulares que uma variável compartilhada de projeto;
- OIDC Vercel permite trocar identidade da função por credenciais cloud temporárias, sem armazenar access key AWS permanente;
- separação clara entre secret de produção e demais ambientes.

Contras:

- a chave bruta ainda entra na memória da função; melhora custódia, não elimina exfiltração em runtime;
- adiciona latência, custo e dependência de rede/cloud;
- cache em singleton para “otimizar” recriaria exposição longa e deve ser proibido;
- uma role permissiva ou secret manager comprometido continua entregando a chave completa.

Raio de exposição: igual ao da P1-A depois que a chave é lida. A melhora principal é governança e rotação, não a fronteira criptográfica.

Uso recomendado: aceitável se houver exigência de preservar uma chave exportável existente, mas inferior a KMS/HSM para mainnet autônoma.

Fonte primária: [Vercel OIDC Federation](https://vercel.com/docs/oidc).

### Opção P1-C — KMS/HSM ou signer gerenciado não exportável

Modelo recomendado concreto:

- chave assimétrica `ECC_SECG_P256K1`, uso `SIGN_VERIFY`, em AWS KMS;
- Vercel OIDC limitado ao projeto + ambiente `production` assume uma role curta;
- role permite somente `kms:GetPublicKey`/`kms:Sign` na chave específica;
- um `ethers.AbstractSigner`/adaptador dedicado serializa a transação EVM, solicita assinatura do digest, normaliza a assinatura e produz a transação assinada;
- endereço derivado da public key KMS é comparado a `CRON_EXPECTED_SIGNER_ADDRESS` antes de operar.

Prós:

- a private key é criada/guardada no KMS e não sai de lá em claro;
- vazamento do código ou memória da função não revela a chave permanente;
- IAM, CloudTrail, disable da key e revogação da role melhoram resposta a incidentes;
- Vercel OIDC evita credenciais AWS duradouras na Vercel;
- separação por projeto/ambiente e menor privilégio são auditáveis.

Contras:

- integração EVM é significativamente mais complexa: KMS devolve assinatura ECDSA em DER; o adaptador precisa normalizar `s`, determinar recovery bit e serializar corretamente;
- cada assinatura envolve chamada externa, latência e custo;
- KMS puro autoriza “assinar digest”, não entende sozinho teto, router ou calldata. Os gates de domínio continuam obrigatórios;
- indisponibilidade de KMS/OIDC deve bloquear o cron;
- migrar a wallet principal para chave não exportável exige nova wallet ou importação controlada. Uma wallet nova é mais limpa, mas muda endereço, saldos e approvals.

Raio de exposição se apenas a credencial temporária vazar: o atacante pode pedir assinaturas durante a validade/permissão da role, mas não extrai a chave. O raio ainda pode ser grave se `kms:Sign` estiver amplo; por isso, role curta, key policy restrita, kill switch, limites da wallet e observabilidade continuam necessários.

Fontes primárias:

- [AWS KMS — asymmetric keys](https://docs.aws.amazon.com/kms/latest/developerguide/symmetric-asymmetric.html)
- [AWS KMS — key specs, incluindo ECC_SECG_P256K1](https://docs.aws.amazon.com/kms/latest/developerguide/symm-asymm-choose-key-spec.html)
- [AWS KMS Sign API](https://docs.aws.amazon.com/kms/latest/APIReference/API_Sign.html)
- [Vercel OIDC Federation](https://vercel.com/docs/oidc)

### Recomendação P1

**Recomendo P1-C: AWS KMS + Vercel OIDC + wallet exclusiva do cron.** É a única opção apresentada em que a chave permanente não precisa aparecer na função.

Como rollout pragmático, P1-A pode ser autorizada separadamente para um piloto de capital mínimo, desde que use uma wallet nova e exclusiva, variable “sensitive”, expected-address check e nenhuma reutilização de `PRIVATE_KEY`. P1-A não deve virar o estado final por inércia.

Mudança arquitetural futura necessária: o executor não deve receber uma raw key. Ele deve depender de uma interface de signer. Hoje `RealSwapExecutor` mantém `privateKey` e recria wallets em outros providers (`lib/real-swap-executor.ts:878,1431`), portanto KMS exige remover essa suposição do caminho cron.

Decisão pedida ao Silvio:

- aprovar P1-C diretamente; ou
- autorizar P1-A apenas como fase piloto e definir a condição objetiva de migração para P1-C;
- decidir se será wallet nova exclusiva (recomendado) ou preservação/importação da wallet atual.

## 3. P2 — origem do plano executado

### Contrato conceitual do plano

Qualquer alternativa deve convergir para um tipo validado, sem calldata:

```text
CronPlan
  planId
  createdAt / createdBy
  notBefore / expiresAt
  networkKey / chainId
  pairCanonical
  fromToken / toToken
  strategyId
  strategyFingerprint
  riskBox (A|B)
  amountUsd
  status
  version
```

`strategyFingerprint` é necessário para tornar executável a decisão “permanente até mudança material”. A chave mínima continua rede+par+estratégia; o fingerprint não muda a identidade de negócio, mas invalida tecnicamente a autorização quando muda a versão material da estratégia.

O plano deve conter intenção de domínio, nunca router, `to`, calldata ou transação montada. Coordinator → TradingAdapter → internos do Pregão permanece o fluxo canônico definido no `ARCFLOW.md`.

### Opção P2-A — plano unitário/consumível no Redis

Um endpoint administrativo autenticado cria o próximo plano em Redis. O workflow só envia o gatilho; a rota cron faz claim atômico de no máximo um plano elegível.

Prós:

- separa “quando tentar” (GitHub) de “o que está autorizado” (estado server-side);
- `planId` estável simplifica idempotência, auditoria e recuperação;
- corpo do workflow não ganha autoridade financeira;
- permite revisão humana, pausa e cancelamento antes do claim;
- rollout inicial pode limitar o universo a um plano por vez.

Contras:

- exige superfície administrativa para criar/cancelar planos;
- um plano pode ficar obsoleto, portanto `expiresAt` do plano é necessário mesmo que a autorização manual da rota nunca expire;
- menor autonomia: alguém ou outro serviço precisa abastecer a fila;
- Redis vira dependência central; pela decisão fechada, falha deve bloquear.

### Opção P2-B — plano no body autenticado do GitHub Actions

O workflow envia rede/par/estratégia/caixa/valor no POST e um `planId` estável.

Prós:

- implementação operacional simples;
- mudança de plano via workflow/repository é visível no histórico Git;
- não requer UI administrativa para enfileirar.

Contras:

- comprometimento do repositório/workflow passa a escolher intenção financeira;
- `CRON_SECRET` autentica o caller, mas não prova aprovação humana do conteúdo;
- retries e edições podem produzir IDs/planos diferentes;
- valores ficam acoplados ao deploy/repo e são pouco dinâmicos;
- ainda exige Redis para gates, idempotência e auditoria, então não elimina a dependência.

Mesmo nesta opção, o servidor teria de validar tudo contra autorização manual, confirmação mainnet, caixa, orçamento e allowlists; o body nunca seria autoridade final.

### Opção P2-C — scanner/agentes geram candidato dentro da invocação

O workflow envia apenas o gatilho. Uma operação limitada consulta Knowledge/agents, obtém candidatos, filtra pelas autorizações persistidas e seleciona determinísticamente no máximo um.

Prós:

- maior autonomia e adaptação ao mercado;
- mantém a decisão econômica dentro do framework/Coordinator;
- não exige operador criando cada plano.

Contras:

- o ciclo atual não é server-ready: usa fetch relativo e dependências/estado de browser já identificados no RI-BANK-15;
- o engine atual pode gerar vários sinais/ordens, incompatível com “uma unidade limitada” sem refatoração;
- é mais difícil reproduzir exatamente por que um candidato venceu;
- um `planId` precisa ser criado antes do despacho, com snapshot canônico da decisão;
- aumenta o escopo do primeiro rollout e a superfície de falha.

### Opção P2-D — híbrido em duas fases

Um scanner produz candidatos, mas grava um plano Redis; o cron posterior consome o plano. Pode haver aprovação humana ou policy auto-approval somente para rotas previamente autorizadas.

Prós:

- separa descoberta de execução;
- mantém snapshot auditável e `planId` estável;
- permite evoluir de revisão humana para seleção automática sem mudar o runner.

Contras:

- duas etapas e mais estados intermediários;
- oportunidade pode expirar entre descoberta e execução;
- exige política clara de TTL/revalidação de preço.

### Recomendação P2

**Recomendo P2-A no primeiro rollout**, com plano Redis unitário, consumível, de vida curta e criado por operação administrativa. O workflow contém apenas trigger e identificadores técnicos do run; nunca parâmetros financeiros nem calldata.

Depois de provar server compatibility, auditoria e recuperação, evoluir para P2-D: scanner produz um plano canônico e o mesmo runner seguro o consome. P2-C direto é um salto grande demais para o primeiro cron mainnet.

### Registro da autorização manual

Para cumprir a decisão já fechada:

1. UI cria a proposta com `executionOrigin=manual_ui`, `strategyId` e `strategyFingerprint` tipados;
2. Coordinator preserva a proveniência;
3. TradingAdapter despacha;
4. somente após `accepted=true`, `orderCreated=true` e `ordemId` grava-se atomicamente a autorização permanente de `network+pair+strategy`, incluindo o fingerprint;
5. se o fingerprint atual divergir, o cron bloqueia até nova ordem manual despachada.

Isso não confunde despacho com settlement. A evidência guardada deve dizer explicitamente `evidenceType=order_dispatched`.

## 4. P3 — idempotência e lease cross-instance

### O problema que um lock simples não resolve

`SET NX PX` impede duas funções de entrarem ao mesmo tempo, mas não impede:

- o mesmo plano ser reexecutado depois que o TTL expirou;
- retry do GitHub repetir um plano já concluído;
- crash depois do broadcast e antes de persistir o resultado;
- uma invocação antiga liberar o lock de uma nova.

É necessário combinar exclusão mútua com estado idempotente durável.

### Opção P3-A — lock global simples com TTL

```text
SET arcflow:<env>:cron:lease <ownerToken> NX PX <leaseMs>
```

Release por Lua: apagar somente se o valor ainda for o `ownerToken`.

Prós:

- simples;
- impede sobreposição enquanto o TTL está válido;
- encaixa no Upstash atual.

Contras:

- não sabe qual plano foi executado;
- não sobrevive semanticamente a retry/crash;
- TTL curto pode duplicar; TTL longo pode bloquear liveness;
- isoladamente é insuficiente para mainnet.

### Opção P3-B — lease global + máquina de estados por `planId` via Lua

Chaves conceituais:

```text
arcflow:<env>:cron:lease
arcflow:<env>:cron:plan:<planId>
arcflow:<env>:cron:audit
```

Estados sugeridos:

```text
QUEUED
CLAIMED
VALIDATED
TX_PREPARED
SUBMITTED
SETTLED
BLOCKED
FAILED_SAFE_TO_RETRY
RECOVERY_REQUIRED
CANCELLED
```

Um script Lua de claim:

1. rejeita se o lease global pertence a outro token;
2. rejeita/reporta se o plano já é terminal;
3. só permite `QUEUED` ou `FAILED_SAFE_TO_RETRY`;
4. grava `CLAIMED`, owner token, attempt, timestamps e lease numa operação atômica;
5. retorna o snapshot reclamado.

Renovação e release também com compare-by-token em Lua. Um processo antigo nunca pode apagar o lease de outro.

Prós:

- cobre sobreposição e repetição do mesmo plano;
- histórico de estados é auditável e recuperável;
- integra naturalmente com plano Redis e retenção de auditoria;
- reutiliza o padrão Lua já validado no RI-BANK-13.

Contras:

- maior número de estados e testes de crash-window;
- exige política explícita para recuperação;
- uma transição mal desenhada pode travar o plano ou permitir retry indevido.

### Opção P3-C — Redis Stream/consumer group

Planos entram numa Stream e consumidores usam consumer group/claim.

Prós:

- fila e histórico são conceitos nativos;
- facilita múltiplos produtores e observabilidade;
- Upstash declara suporte a Streams, exceto operações blocking.

Contras:

- consumer groups são tipicamente at-least-once, não eliminam duplicata de efeito financeiro;
- ainda exige idempotência por `planId` e lease/estado de transação;
- complexidade desnecessária para um único plano por invocação inicial.

Fonte primária: [Upstash REST API — transações, scripting e Streams](https://upstash.com/docs/redis/features/restapi).

### Recomendação P3

**Recomendo P3-B.** O lease deve ser global para o cron e o registro por `planId` deve ser a verdade idempotente.

Regras de segurança da máquina de estados:

- o `planId` é gerado server-side quando o plano é criado; GitHub run ID é metadado, não chave idempotente principal;
- lease tem owner token aleatório, TTL e heartbeat; valores numéricos devem ser definidos abaixo do limite verificado da função, não presumidos;
- perder heartbeat antes de preparar transação permite retry apenas se o estado estiver explicitamente `FAILED_SAFE_TO_RETRY`;
- depois de `TX_PREPARED`, nenhuma instância faz retry automático cego;
- a transação deve ser assinada com nonce conhecido e seu hash calculado/persistido **antes** do broadcast;
- após broadcast, retries consultam o mesmo `txHash`; nunca montam uma segunda transação para o plano;
- se houver crash em `TX_PREPARED` e a chain não mostrar o hash, o plano entra em `RECOVERY_REQUIRED`, não volta automaticamente a `QUEUED`;
- estados `SUBMITTED`/`RECOVERY_REQUIRED` nunca são roubados apenas porque o lease expirou;
- release do lease sempre compara o token;
- toda transição gera evento de auditoria com retenção de 30 dias.

Esse desenho privilegia safety sobre liveness: uma janela ambígua pode exigir reconciliação manual, mas não cria uma segunda ordem.

### Nonce e wallet compartilhada

O lease coordena apenas invocações do cron. Se a UI usar simultaneamente a mesma wallet, ainda existe risco de colisão de nonce fora desse lock. Por isso, a wallet dedicada de P1 não é apenas higiene de secrets; ela é parte do desenho de concorrência.

## 5. Desenho combinado recomendado

```text
GitHub workflow (sem plano financeiro)
  -> POST /api/cron/trigger + CRON_SECRET
  -> auth
  -> Redis disponível?
  -> cron enabled + mainnet confirmed?
  -> claim lease global + 1 CronPlan por Lua
  -> validar autorização manual network+pair+strategy+fingerprint
  -> validar CB global, Caixa A/B, teto $15, orçamento $50
  -> validar signer address + chainId
  -> Coordinator recebe proposta canônica origin=cron
  -> TradingAdapter / internos criam no máximo 1 ordem
  -> preparar tx, persistir txHash, broadcast
  -> settlement/reconciliação
  -> estado terminal + audit event (30 dias)
  -> release compare-by-token
```

Em qualquer falha de Redis, KMS/OIDC, expected address, chainId, gate, lease ou estado ambíguo: `executed=false`, motivo auditável e nenhuma assinatura.

## 6. Chaves Redis conceituais

Seguindo `lib/kv.ts`:

```text
arcflow:<env>:cron-control:state
arcflow:<env>:cron-control:manual-routes
arcflow:<env>:cron:plans
arcflow:<env>:cron:plan:<planId>
arcflow:<env>:cron:lease
arcflow:<env>:cron:audit
```

Observações:

- confirmação de mainnet e autorização manual não expiram por tempo, conforme decisão fechada;
- cada plano operacional possui `expiresAt` próprio para não executar intenção econômica velha;
- audit tem retenção de 30 dias; para Stream, retenção temporal requer trim por timestamp/ID, pois TTL da chave inteira não representa TTL individual por evento;
- hashes/streams nunca recebem secret, raw key ou header Authorization.

## 7. Decisões finais solicitadas ao Silvio

### P1

- [ ] P1-C diretamente: KMS + OIDC + wallet nova exclusiva — **recomendado**.
- [ ] P1-A como piloto transitório, com data/condição de migração.
- [ ] P1-B secret manager exportável.
- [ ] Wallet nova versus preservação/importação do endereço atual.

### P2

- [ ] P2-A primeiro e P2-D depois — **recomendado**.
- [ ] P2-B body do workflow.
- [ ] P2-C scanner direto desde o início.

### P3

- [ ] P3-B lease + state machine por `planId` — **recomendado**.
- [ ] P3-A lock simples, não recomendado para mainnet.
- [ ] P3-C Stream, ainda com idempotência adicional.

Depois dessas escolhas, ainda será necessário um mandato separado de implementação com testes de falhas/crash e sem autorização automática para trade real.

## 8. Verificação de escopo

- Nenhum arquivo de código ou documentação canônica foi modificado.
- Nenhum teste, build, script, endpoint, workflow ou ciclo foi executado.
- Nenhuma credencial foi lida.
- Nenhuma wallet, RPC, KMS, Redis externo ou rede foi acionada.
- Foram criados apenas os arquivos de proposta do RI-BANK-16 em `codex-executor/RI-BANK-16`.

