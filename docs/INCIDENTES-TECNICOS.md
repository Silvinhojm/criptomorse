# Registro de Incidentes Técnicos — CriptoMorse

## [04/08/2026] A saga do RI-BANK-39 — do disparo manual ao primeiro swap real confirmado (RI-BANK-39 → RI-BANK-58)

**Severidade:** Alta (bloqueava validação do caminho de execução real antes de habilitar o cron automático)
**Status:** Resolvido — primeiro swap real confirmado on-chain

### 1. Resumo executivo

**Objetivo original:** antes de habilitar o cron automático de trading, validar manualmente — via uma rota de disparo único, protegida por bearer administrativo (`POST /operator/corretor/test-swap`) — que o caminho de execução real (KMS AWS → assinatura → RPC Arc Testnet → AMM on-chain) funcionava de ponta a ponta, com um valor mínimo (0.10 USDC, par USDC→EURC).

**Resultado final:** primeiro swap real confirmado on-chain:
```
txHash: 0xa1dd7fb6eeb7deed950aacb9f1fe2a7255ab76c940b7f18eeaf8666d5fd91938
bloco:  55298527
```

**Escala do problema:** vinte rodadas de investigação nomeadas (RI-BANK-39 até RI-BANK-58), ao longo de dois dias (03–04/08/2026), cada uma revelando uma camada diferente de falha — nenhuma delas fraude, perda de fundos ou bug de lógica de negócio; todas bugs de infraestrutura/integração (ambiente server-side, RPC público instável, branches divergentes, e um bug estrutural na biblioteca `ethers` sobre instâncias de classe). O padrão recorrente: cada correção destravava o disparo até o **próximo** ponto de falha, nunca até o sucesso — só a última camada (RI-BANK-58) finalmente permitiu a transação chegar confirmada on-chain.

### 2. Linha do tempo dos bugs encontrados

#### RI-BANK-39 / RI-BANK-45 — chave administrativa "Sensitive" impossível de revelar

- **Sintoma:** ao tentar preparar o disparo manual, não havia como obter o valor de `ADMIN_PANIC_KEY` (bearer da rota `test-swap`) para uso no `curl`.
- **Causa raiz:** `ADMIN_PANIC_KEY` e `CRON_SECRET` foram criadas na Vercel com a flag `--sensitive`. Variáveis `Sensitive` confirmam sua **existência** via `vercel env pull` (o nome aparece), mas a Vercel **nunca mais devolve o valor** — nem via CLI, nem via dashboard, para ninguém, depois de criada.
- **Correção:** nenhuma correção de código — decisão operacional. O disparo real sempre foi feito pelo operador humano, no terminal dele, nunca por um agente de IA (ver seção de Lições, item 4).
- **Por que não foi descoberto antes:** é uma característica da Vercel por design, não um bug — só vira "descoberta" quando alguém tenta recuperar o valor pela primeira vez, depois da criação.

#### RI-BANK-41 / RI-BANK-53 — preço de stablecoin zerado em server-side (fallback assimétrico)

- **Sintoma:** preflight de saldo bloqueava o disparo com `Saldo insuficiente de USDC: $0.0000 (19.999475 USDC)` — saldo em token correto, valor em USD zerado.
- **Causa raiz:** `_getTokenPrice()` (`lib/real-swap-executor.ts`) tinha 4 pontos de retorno; só 2 deles (`!priceUrl`, `!res.ok`) tinham fallback de `$1.00` para stablecoins quando a consulta de preço falhava. Os outros 2 (resposta sem preço válido, e o `catch` de falha de rede) retornavam `0` sem fallback — assimetria que zerava `fromBalanceUsd` mesmo com saldo real suficiente.
- **Correção (RI-BANK-41):** os 4 ramos passaram a usar `cached?.price ?? (isStable(token) ? 1.0 : 0)` de forma simétrica.
- **Regressão (RI-BANK-53):** essa correção existia numa branch (`codex/ri-bank-39-manual-test`) que nunca tinha sido reunificada com a branch usada nos deploys mais recentes — o bug voltou a aparecer, já corrigido antes, só que "esquecido" numa branch paralela. Ver RI-BANK-52/53 abaixo para a causa raiz completa desse padrão.
- **Por que não foi descoberto antes:** o fallback assimétrico só se manifesta quando a API de preço realmente falha ou não resolve — não é reproduzível toda vez.

#### RI-BANK-44 — falso positivo: execução sintética reportada como sucesso real

- **Sintoma:** o disparo manual retornou `success: true` com `txHash` composto só de zeros — parecia sucesso, mas nenhuma transação existia on-chain.
- **Causa raiz:** mismatch de maiúsculas/minúsculas em `AMM_PAIRS` (`lib/arc-direct-swap.ts`) — chaves em mixed-case (EIP-55) vs. lookup normalizado em lowercase — fazia o AMM real ficar inalcançável, caindo sempre no caminho *synthetic* (simulação sem transação real), mascarado como sucesso.
- **Correção:** normalização das chaves de `AMM_PAIRS` para lowercase; novo contrato de resposta explícito (`success`/`settled`/`canonicalSettlement`/`synthetic`/`settlementStatus`) que nunca mais permite `success:true` sem transação real confirmada; a rota `test-swap` passou a responder HTTP 409 (não 200) para qualquer execução sintética.
- **Por que não foi descoberto antes:** o retorno parecia um sucesso legítimo — só foi pego porque o hash era literalmente zero, um sinal chamativo o suficiente para levantar suspeita.

#### RI-BANK-46 / RI-BANK-54 — mensagem genérica mascarando o erro real; gás descartado como causa

- **Sintoma:** depois do RI-BANK-44, o disparo passou a falhar com `"Nenhuma rota disponível"` — mensagem genérica, sem pista da causa.
- **Causa raiz (RI-BANK-46):** rastreamento completo do caminho de execução (auditoria Redis, RPC direto, varredura on-chain de 40+ blocos) confirmou que o AMM tinha liquidez saudável e que a mensagem genérica descartava `directResult.error`, o erro real vindo de `executeDirectSwap()`. Hipótese levantada mas **não confirmada**: falta de ARC nativo para gás na signer KMS.
- **Investigação da hipótese (RI-BANK-54):** confirmado, com folga de ~3.383x, que a signer tinha gás suficiente. Achado importante: a Arc Testnet **usa USDC como o próprio token nativo de gás** — não existe um "ARC" separado. A hipótese de falta de gás foi formalmente descartada.
- **Correção:** nenhuma nesta etapa — só descartou uma hipótese e confirmou que a mensagem genérica precisava ser corrigida (isso veio a acontecer no RI-BANK-55).
- **Por que não foi descoberto antes:** a mensagem genérica em si impedia ver a causa; foi preciso rastrear via auditoria Redis + RPC direto para reconstituir o que realmente aconteceu.

#### RI-BANK-49 / RI-BANK-50 / RI-BANK-51 — saldo zerado por falha intermitente do RPC público sem fallback funcional

- **Sintoma:** depois de preencher `CRON_EXPECTED_SIGNER_ADDRESS` (RI-BANK-48), um novo disparo retornou saldo **zero** — nem em token, nem em USD — quando o saldo real era 19,999475 USDC.
- **Causa raiz (RI-BANK-49/50):** reprodução local, com log ao vivo, mostrou que o RPC público da Arc Testnet falha intermitentemente em chamadas `eth_call` (`CALL_EXCEPTION`/"missing revert data"). A rede `arc` não tinha nenhum RPC de backup configurado, e o único fallback existente (`fetch('/api/rpc-proxy')`) usava URL relativa — quebrada em execução server-side (sem `window`/origem).
- **Correção:** retry com backoff (até 4 tentativas) nas leituras de saldo; fallback de proxy corrigido para resolver URL absoluta em servidor (mesmo padrão já usado no RI-BANK-38 para preço). Limitação residual documentada: sem um segundo RPC genuinamente diferente, o retry reduz mas não elimina a falha.
- **RI-BANK-51:** criada rota de diagnóstico read-only (`GET /api/internal/ri-bank-51-balance-check`) para checar saúde/saldo da signer sem nenhum risco de disparar swap — usada para validar a correção em produção (achado extra: o RPC parecia sofrer influência de rajada de chamadas, não só aleatoriedade pura).
- **Por que não foi descoberto antes:** intermitência — o mesmo código funcionava na maioria das tentativas, só falhando em parte delas, dificultando reprodução determinística sem testes repetidos.

#### RI-BANK-52 / RI-BANK-53 — duas branches de desenvolvimento paralelas nunca reunificadas

- **Sintoma:** a rota `/operator/corretor/test-swap` retornava **404** (nem sequer existia no deploy), e, quando restaurada, o bug do RI-BANK-41 (preço zerado) reapareceu, já corrigido antes.
- **Causa raiz:** duas branches (`codex/ri-bank-34-cron-real`, usada nos deploys mais recentes, e `codex/ri-bank-39-manual-test`, onde a rota de disparo manual e várias correções — RI-BANK-39, 41, 44 — tinham sido implementadas) divergiram de um ponto comum e nunca foram reunificadas. Cada branch tinha metade das correções.
- **Correção:** cherry-pick dos commits específicos (`defe491` RI-BANK-39, `50566ac` RI-BANK-44, depois `62192d7` RI-BANK-41) para a branch de produção, resolvendo conflitos manualmente (a maioria só em documentação; um caso de merge automático limpo em código, verificado linha a linha, não presumido).
- **Por que não foi descoberto antes:** cada branch, isoladamente, parecia funcionar dentro do seu próprio histórico — só ficou visível quando a rota de uma branch precisou ser usada em produção, que rodava a outra.

#### RI-BANK-55 — erro real descartado em dois pontos do código

- **Sintoma:** com as branches reunificadas, "Nenhuma rota disponível" continuava aparecendo sem detalhe.
- **Causa raiz:** dois pontos de mascaramento de erro, não um só. (1) `lib/real-swap-executor.ts`: `directResult.error` descartado e substituído por texto fixo. (2) Um segundo ponto, não documentado antes, dentro de `lib/arc-direct-swap.ts`: o fallback de approve+transfer também descartava o erro real (`contractErr`) e lançava uma string fixa.
- **Correção:** os dois pontos passaram a interpolar o erro real na mensagem final (`Nenhuma rota disponível (${motivo real})`), sem alterar nenhuma lógica de decisão.
- **Por que não foi descoberto antes:** o primeiro ponto (mais óbvio) já tinha sido sinalizado no RI-BANK-46 mas nunca corrigido; o segundo só apareceu ao investigar sistematicamente todo o arquivo `arc-direct-swap.ts`, não só o ponto já suspeito.

#### RI-BANK-56 — instabilidade de `provider.getNetwork()` sem `staticNetwork: true`

- **Sintoma:** com o erro real finalmente exposto, apareceu `{"code": -32000, "message": "invalid chain ID"}` no `eth_sendRawTransaction`.
- **Causa raiz:** o provider usado no caminho do cron/disparo manual (`lib/cron-trading-runtime.ts`) era construído **sem** `{ staticNetwork: true }` — cada `getNetwork()` reconsultava `eth_chainId` via RPC, no mesmo RPC público já provado instável (RI-BANK-50/51). A prova original do KMS (RI-BANK-32) já usava `staticNetwork: true` e nunca teve esse problema.
- **Correção:** adicionado `{ staticNetwork: true }` ao provider do cron, mesmo padrão já usado no RI-BANK-32 e em outros pontos do projeto.
- **Por que não foi descoberto antes:** não é regressão — confirmado via `git log --all`/`git grep` que essa opção nunca existiu nesse arquivo, em nenhuma branch, desde a criação. Simplesmente nunca tinha sido alcançado antes, porque os bugs anteriores sempre bloqueavam a execução mais cedo.

#### RI-BANK-57 / RI-BANK-58 — bug estrutural: `resolveProperties()` do `ethers` não enxerga getters de protótipo

- **Sintoma:** mesmo depois do RI-BANK-56, o mesmíssimo erro `"invalid chain ID"` persistiu, agora na primeira transação tentada (o `approve`).
- **Causa raiz (RI-BANK-57, reproduzida com valores capturados, não suposição):** o `ethers`, internamente, entrega ao adaptador `KmsEthersSigner.signTransaction()` uma **instância real** da classe `Transaction` — cujos campos (`chainId`, `to`, `data`, `nonce`, `gasLimit`, ...) são getters de protótipo, não propriedades próprias enumeráveis. O código usava `resolveProperties()` (utilitário do próprio `ethers`), que internamente faz `Object.keys(value)` — método que **não enxerga getters de protótipo** — retornando um objeto vazio (`{}`) e zerando todos os campos da transação, incluindo `chainId: 0`, rejeitado pelo nó como "invalid chain ID". Reproduzido de forma determinística: `Object.keys(transactionInstance)` retorna `[]` mesmo com todos os valores acessíveis diretamente.
- **Correção (RI-BANK-58):** `signTransaction()` passou a detectar `transaction instanceof Transaction` e, nesse caso, usar `Transaction.from(transaction)` diretamente — que lê campos por acesso direto de propriedade, não por `Object.keys()`, funcionando corretamente com getters. O caminho de objeto plano foi preservado sem alteração.
- **Por que não foi descoberto antes:** a prova original do KMS (RI-BANK-32) nunca passou por esse adaptador — usava `KmsEvmSigner` diretamente com uma `Transaction` montada manualmente, sem nunca chamar `resolveProperties()`. O bug sempre esteve lá, latente, só nunca tinha sido exercitado por uma assinatura real via KMS em produção até essa etapa.
- **Nota lateral:** durante essa investigação, foram encontrados dois artefatos de trabalho concorrente não commitado de outro processo (Codex) no mesmo repositório local — instrumentação de trace temporária e um script incompleto — tratados com cuidado (removidos só onde estavam dentro do escopo da correção; deixados intocados fora dele). Um deles chegou a quebrar um deploy de produção por não estar coberto por `.vercelignore` (corrigido separadamente, sem relação com a lógica do bug).

### 3. Lições para o futuro

1. **Nunca aceitar "sucesso" sem verificação independente.** O RI-BANK-44 mostrou que uma resposta `success:true` pode mentir — só o `txHash` (e a confirmação on-chain real, via RPC ou explorer) é prova de settlement de verdade. Toda validação de swap real deve checar a transação na cadeia, não confiar na resposta HTTP isoladamente.
2. **Branches de trabalho paralelas precisam de merge periódico.** O RI-BANK-52/53 mostrou como duas branches, cada uma "funcionando" isoladamente, podem re-regredir bugs já corrigidos assim que uma reunificação tardia acontece. Preferir merges/cherry-picks frequentes e pequenos a uma reunificação única e grande no fim.
3. **Ao integrar bibliotecas como `ethers`, checar compatibilidade de utilitários genéricos com instâncias de classe.** `resolveProperties()` funciona bem em objetos planos, mas silenciosamente falha (sem lançar erro) em instâncias com getters de protótipo. Qualquer utilitário que use `Object.keys()`/`Object.entries()`/spread (`{...obj}`) sobre um valor que pode ser uma instância de classe merece essa checagem explícita.
4. **Variáveis de ambiente `Sensitive` na Vercel são uma decisão definitiva, não reversível.** Decidir conscientemente, na criação, quais variáveis realmente precisam ser `Sensitive` (nunca mais lidas por ninguém, nem pela própria equipe) vs. variáveis normais (protegidas, mas recuperáveis). `ADMIN_PANIC_KEY`/`CRON_SECRET` sendo `Sensitive` reforça, como efeito colateral positivo, que o disparo real do RI-BANK-39 só pode ser feito pelo operador humano — nunca por um agente de IA, mesmo autorizado.
5. **Múltiplos executores de IA operando em paralelo no mesmo repositório local precisam de coordenação.** O RI-BANK-58 encontrou instrumentação de trace e um script quebrado deixados por outro processo, sem aviso — um deles chegou a quebrar um deploy de produção. Preferir sinalizar/registrar quando mais de um agente está ativo no mesmo working directory, e usar `.vercelignore`/`.gitignore` para que artefatos de diagnóstico temporário nunca cheguem a um deploy real.

### 4. Referências aos relatórios originais

Cada RI-BANK mencionado tem relatório completo salvo em `C:\Users\silvi\Desktop\ARCFLOW_AI\` (pastas `DEEPSEEK`, `CLAUDE EXECUTOR`, `CODEX EXECUTOR`, conforme quem executou):

- RI-BANK-45 — `DEEPSEEK/RI-BANK-45-SCOPE-CORRECTION.md`
- RI-BANK-46 — `DEEPSEEK/RI-BANK-46-NENHUMA-ROTA-DISPONIVEL.md`
- RI-BANK-48 — `DEEPSEEK/RI-BANK-48-ENDERECO-SIGNER-CONFIRMADO.md`
- RI-BANK-49 — `DEEPSEEK/RI-BANK-49-SALDO-USDC-ZERADO-DIAGNOSTICO.md`
- RI-BANK-50 — `DEEPSEEK/RI-BANK-50-FIX-LEITURA-SALDO-SERVER-SIDE.md`, `CLAUDE EXECUTOR/RI-BANK-50-COMMIT-DEPLOY-RESULTADO.md`
- RI-BANK-51 — `CLAUDE EXECUTOR/RI-BANK-51-ROTA-DIAGNOSTICO-RESULTADO.md`
- RI-BANK-52 — `CLAUDE EXECUTOR/RI-BANK-52-CHERRY-PICK-RESULTADO.md`, `RI-BANK-52-PUSH-DEPLOY-RESULTADO.md`
- RI-BANK-53 — `CLAUDE EXECUTOR/RI-BANK-53-REGRESSAO-RI-BANK-41-DIAGNOSTICO.md`, `RI-BANK-53-CHERRY-PICK-RESULTADO.md`, `RI-BANK-53-PUSH-DEPLOY-RESULTADO.md`
- RI-BANK-54 — `CLAUDE EXECUTOR/RI-BANK-54-SALDO-GAS-CONFIRMADO.md`
- RI-BANK-55 — `CLAUDE EXECUTOR/RI-BANK-55-DESMASCARAR-ERRO-RESULTADO.md`, `RI-BANK-55-PUSH-DEPLOY-RESULTADO.md`
- RI-BANK-56 — `CLAUDE EXECUTOR/RI-BANK-56-INVALID-CHAIN-ID-DIAGNOSTICO.md`, `RI-BANK-56-CORRECAO-RESULTADO.md`, `RI-BANK-56-PUSH-DEPLOY-RESULTADO.md`
- RI-BANK-57 — `CLAUDE EXECUTOR/RI-BANK-57-CAUSA-RAIZ-CONFIRMADA.md`
- RI-BANK-58 — `CLAUDE EXECUTOR/RI-BANK-58-CORRECAO-RESULTADO.md`, `RI-BANK-58-PUSH-DEPLOY-RESULTADO.md`

Correções de código correspondentes documentadas em `ARCFLOW.md` (seções "RI-BANK-41", "RI-BANK-44", "RI-BANK-50", "RI-BANK-51", "RI-BANK-56", "RI-BANK-57/58"). Esta seção é um resumo consolidado e cronológico — não substitui nem contradiz o detalhe técnico de cada RI-BANK individual.

## [09/07/2026] Phase 2e.2f Settlement Replay/Sync Race Closure

**Severidade:** Media
**Status:** Implementado

### Race fechada

Ouvinte do `SettlementRegistry` podia rodar antes do `Coordinator._saveDecisionReport()` salvar o `DecisionReport`, resultando em:

```
[SETTLEMENT] ⚠️ DecisionReport not found for settlement update ... — queued for replay
```

Antes: o update ficava apenas no `SettlementRegistry` e o `DecisionReport` nunca recebia o estado mais recente a menos que outro update chegasse depois.

Depois: dois mecanismos garantem consistência:

1. **Pending queue no listener** — quando o `DecisionReport` não existe ainda, o registro de settlement é enfileirado em `pendingSettlementReplays[]` em vez de ser descartado.

2. **Post-save replay no Coordinator** — após `_saveDecisionReport()`, chama `_syncSettlementFromRegistry()` que busca registros por `correlationId` (que é o `intentId`) e reaplica no `DecisionReport` usando a mesma lógica monotônica do listener.

### Arquivos modificados

| Arquivo | Mudança |
|---------|---------|
| `lib/agent-framework/singletons.ts` | `pendingSettlementReplays[]`, `replaySettlementToDecisionRecord()`, `replaySettlementForCorrelationId()`, `flushPendingSettlementReplays()` |
| `lib/agent-framework/coordinator.ts` | `_syncSettlementFromRegistry()` pós-save, import dos replay helpers |

### Garantias de segurança

- Replay é idempotente — executar múltiplas vezes produz o mesmo `DecisionReport` final
- `confirmed`/`canonicalSettlement=true` não é rebaixado por updates `submitted`/`failed`/`synthetic` posteriores
- `txHash` all-zero não vira `canonicalSettlement=true`
- `settlementStatus` progressão monotônica é preservada
- Sempre que o listener roda DEPOIS do report existir, o caminho original funciona sem mudanças
- Nenhuma chamada ao `DecisionAnchor`, `accounting`, `BotBank`, lucro verificado, win-rate ou reconciliação

### Testes controlados

`scripts/phase-2e2f-settlement-replay-test.ts` — 26 asserts, 0 falhas. Cenários:

- A: update antes do report → replay pós-save recupera
- B: report antes do update → listener original funciona
- C: confirmed canônico preservado contra updates stale
- D: synthetic/all-zero txHash não vira canônico
- E: sem match → replay é no-op

### Bloqueios preservados

`DecisionAnchor`, `accounting`, `BotBank`, lucro verificado, win-rate e reconciliação continuam bloqueados — exigem E2E real na Arc testnet.


## [09/07/2026] Phase 2e.2e Race Observation - Settlement Update Before DecisionReport Save

**Severidade:** Media
**Status:** Divida tecnica documentada

Durante a validacao controlada de runtime da Phase 2e.2e / 2e.2e.1, o caminho:

`Coordinator -> TradingAdapter -> Pregao -> Corretor -> SettlementRegistry -> DecisionReport`

foi exercitado em dois modos controlados:

- synthetic: `settlementStatus = synthetic`, `synthetic = true`, `canonicalSettlement = false`, `txHash = 0x00000000`
- confirmed/canonical mock: `settlementStatus = confirmed`, `synthetic = false`, `canonicalSettlement = true`, `txHash` nao-zero controlado

As validacoes confirmaram que o DecisionReport nao marcou lucro verificado, win-rate,
BotBank/accounting, reconciliacao ou DecisionAnchor final. Tambem confirmaram que um
DecisionReport confirmado/canonico preserva `settlementStatus = confirmed`,
`canonicalSettlement = true` e `synthetic = false` quando recebe updates stale ou
terminais posteriores (`submitted`, `failed`, `synthetic`).

### Observacao de race

Durante a validacao, o listener do `SettlementRegistry` pode rodar antes do
`Coordinator` concluir o `_saveDecisionReport()` final. Nesse caso, o primeiro update
do registry e logado como:

`[SETTLEMENT] DecisionReport not found for settlement update ...`

No cenario observado, isso foi benigno porque o update posterior do Corretor encontrou
e atualizou corretamente o DecisionReport. O comportamento atual e seguro no sentido de
que nao lanca erro, nao cria DecisionReport falso e nao muta accounting. Porem, sob
timing real ou concorrencia, um settlement update pode chegar antes de o DecisionReport
existir, ficar apenas no `SettlementRegistry`, e nao ser automaticamente reaplicado ao
DecisionReport depois.

### Risco

O risco nao e execucao financeira indevida. O risco e o DecisionReport ficar stale ou
incompleto enquanto o SettlementRegistry contem a informacao mais nova. Isso bloquearia
com seguranca qualquer uso futuro desses campos para prova final, mas tambem poderia
confundir auditoria se nao houver reconciliacao posterior.

Antes de usar campos de settlement do DecisionReport para DecisionAnchor final, accounting,
BotBank, lucro verificado, win-rate ou reconciliacao, e obrigatorio implementar ou
validar pelo menos um destes mecanismos:

- replay de updates pendentes do SettlementRegistry apos criacao/salvamento do DecisionReport;
- reconciliation pass por `correlationId`;
- fila/retry deferido no listener;
- sync explicito pos-save do SettlementRegistry para DecisionReport.

### Limitacao preservada

Phase 2e.2e / 2e.2e.1 ainda nao provam settlement real ponta a ponta na Arc testnet.
O caminho confirmed/canonical exercitado foi mock/controlado, sem swap real e sem fundos.
Portanto continuam bloqueados ate validacao real:

- DecisionAnchor final proof;
- accounting;
- BotBank;
- lucro verificado;
- win-rate;
- reconciliacao.


## [09/07/2026] Phase 2e.2d Validation Limitation

**Severidade:** Informativo
**Status:** Documentado

O caminho de atualizacao `SettlementRegistry -> DecisionReport.execution` foi validado
com testes isolados/em memoria. Um ciclo real ponta a ponta na Arc testnet nao foi
executado nesta validacao.

Antes de usar campos de settlement do DecisionReport para DecisionAnchor final, accounting,
BotBank, lucro verificado, win-rate ou reconciliacao, e obrigatorio validar um ciclo real:

`Coordinator -> TradingAdapter -> Pregao -> Corretor -> SettlementRegistry -> DecisionReport`

com estados `dispatched -> submitted/confirmed` e evidencia real de transacao. Esta
limitacao e intencional e evita falsa confianca.

## [05/07/2026] Memory Leak — Arrays unbounded no frontend

**Severidade:** Crítica
**Status:** Corrigido

### Sintoma
Dashboard CriptoMorse (Next.js 15.5 + React 19.2), quando deixado aberto por horas, causava **"Out of Memory"** na aba do Chrome. O heap JS do navegador crescia continuamente sem garbage collection efetivo.

### Causa Raiz
5 módulos no `lib/` mantinham arrays em memória que **nunca eram podados**, acumulando cada trade/ordem/avaliação do histórico. Adicionalmente, o `PregãoDashboard.tsx` não limpava o intervalo do ciclo (`cicloRef.current`) ao desmontar.

### Bugs Corrigidos

| # | Arquivo | Linha | Array | Correção |
|---|---------|-------|-------|----------|
| 1 | `lib/pregão.ts:442` | `this.ordens` | Cap 500 via `.slice(-500)` após push |
| 2 | `lib/pregão.ts:829` | `this.packageResults` | Cap 100 via `.slice(-100)` após push |
| 3 | `lib/accountant.ts:142` | `this.reports` | Cap 1000 via `.slice(-1000)` após push (já tinha na persistência, faltava em RAM) |
| 4 | `lib/real-automated-trader.ts:241` | `this.tradeHistory` | Cap 500 via `.slice(-500)` em `_persist()` (já tinha no localStorage, faltava em RAM) |
| 5 | `lib/pair-sector.ts:50` | `this.avaliacoes` | Cap 500 via `.slice(-500)` após push (já tinha na persistência, faltava em RAM) |
| 6 | `lib/batch-executor.ts:90` | `this.history` | Cap 100 via `.slice(-100)` após push |
| 7 | `lib/contratante.ts:133` | `this._reports` | Cap 100 via `.slice(-100)` após push |
| 8 | `lib/nanopayment-system.ts:132,225` | `this.payments` | Cap 500 via `.slice(-500)` após push |
| 9 | `app/components/PregãoDashboard.tsx:574` | `cicloRef.current` | Adicionado `clearInterval(cicloRef.current)` e `clearInterval(balanceTimerRef.current)` no cleanup effect (antes só limpava `stressTestIntervalRef`) |

### Arrays já limitados (verificados, não precisaram de correção)
- `lib/arqueiro.ts` — `ps.history` cap 500 (linha 254), `ps.prices` cap `LONG_WINDOW+1` (linha 212)
- `lib/agent-voting.ts` — `this.votes` = [] após cada `resolve()` (linha 162)
- `lib/professor.ts` — `this.palpites` filtrados por TTL de 1h (linha 160)
- `lib/quantum-oracle.ts` — `this.history` cap 100 via `shift()` (linha 149)
- `lib/quantum-wave.ts` — `this.waveMemory` cap 50 via `shift()` (linha 123)
- `lib/stress-test-arc.ts` — `this.results` = [] a cada `run()` (linha 27)
- `lib/agentes-do-pregão.ts` — `historicoVotos` cap 500 (linha 129), `hist` bounded por TTL (linha 42-44)

### Impacto
- Heap JS do navegador agora tem limite máximo previsível: ~2-3MB para os arrays de histórico em vez de crescimento ilimitado
- Intervalo do ciclo não vaza se o componente desmontar
- Build: limpo (zero erros TS)

---

Este documento registra problemas técnicos reais encontrados durante o desenvolvimento, a
investigação até a causa raiz, e a decisão tomada — incluindo casos onde a decisão foi
**não** avançar com algo. Não é um changelog de features; é um registro de engenharia
responsável, pensado para dar transparência a quem avaliar o projeto.

**Regra:** a partir de 04/07/2026, todo bug de severidade Média ou superior (corrigido ou
não) ou decisão de não avançar por motivo de segurança/risco gera uma entrada neste
arquivo, no mesmo formato, antes de o item ser considerado fechado.

---

## [04/07/2026] Fallback cego mascarando falha real — duas ocorrências da mesma classe

**Severidade:** Alta
**Status:** Resolvido

### O que aconteceu

**(Ocorrência A — JobRobot)** A carteira `0x77f5C3A1079B86ef8490E7c5Ec1F9bcfbaAE5894` criou
46+ contratos `JobProof` em sequência na Arc Testnet, todos com o argumento do construtor
contendo a string "Contratante". O sistema deveria estar apenas simulando jobs com
transações simples de 1 wei, mas estava deployando um contrato novo por job simulado.
Isso só foi descoberto porque o bytecode foi decodificado manualmente no explorador de
blocos; o sistema não reportava nenhum problema.

**(Ocorrência B — LI.FI → DEX)** O caminho de execução de swaps no `real-swap-executor.ts`
tenta LI.FI primeiro e, se falha, cai no fallback DEX direto (SushiSwap/QuickSwap).
Se o fallback DEX obtém lucro, o sistema registra um trade bem-sucedido — sem nunca
saber que o LI.FI falhou. Auditando todos os pontos de fallback do sistema, descobriu-se
que **nenhum deles** registra falha da rota primária quando o fallback tem sucesso.

O mesmo padrão apareceu em:

| Local | Fallback | Falha primária invisível? |
|-------|----------|---------------------------|
| `real-swap-executor.ts:1234` | LI.FI → DEX | Sim |
| `lib/corretor.ts:82` (delega para `executeSwap()`) | idem | Sim |
| `arc-direct-swap.ts:147` | AMM → synthetic 1:1 | Sim (testnet) |
| `pregão.ts:_quoteTrade()` | V3 → V2 → LI.FI | Sim (quoting, não execução) |

### Causa raiz

O circuit breaker (`lib/circuit-breaker.ts`) tem duas funções: `recordTradeResult(profit)`
e `recordError(name, msg)`. Ambas incrementam o mesmo contador `consecutiveLosses`.
O `recordError` só é chamado quando uma **exceção** ocorre (catch block), não quando uma
rota retorna `{ success: false }` (erro esperado). Como o fallback converte erros
esperados em `success: true`, o `recordTradeResult` nunca vê perda — e `consecutiveLosses`
nunca sobe.

Na ocorrência A (JobRobot), o efeito era agravado: `deployJobProof()` sempre tinha sucesso
(todo deploy era bem-sucedido na testnet), então `consecutiveFails` no `job-robot.ts`
nunca era incrementado — o circuit breaker local (`consecutiveFails >= 3`) nunca disparava.
Resultado: loop infinito de swap→fail→deploy→sucesso→swap→fail→...

Na ocorrência B (LI.FI→DEX), o mecanismo é sutilmente diferente: o `recordError` agora
é chamado (fix parcial), mas `recordTradeResult` zera `consecutiveLosses` no mesmo ciclo
se o fallback der lucro. O contador sobe e desce dentro do mesmo trade — nunca passa de 1.

### Como foi descoberto

1. **Ocorrência A**: Usuário decodificou bytecode de contratos no explorador da Arc
   Testnet e encontrou a string "Contratante" no argumento do construtor. Investigação
   cruzada com histórico do git revelou que o método `deployJobProof()` (removido no
   commit `cd53194` de 02/07/2026) usava `new ethers.ContractFactory(...).deploy()`
   por job, e o fallback bem-sucedido (deploy sempre funcionava) impedia o circuit
   breaker de detectar que o swap primário estava quebrado.
2. **Ocorrência B — descoberta inicial**: Auditoria sistemática de todos os pontos de
   fallback do sistema, encomendada após a ocorrência A. Cada local foi verificado
   manualmente: se o fallback mascarava a falha primária no mesmo padrão.
3. **Ocorrência B — fix inócuo descoberto**: O primeiro fix (commit `38ad79f`) adicionou
   `recordError("executeSwap", ...)` na linha 1235 antes do fallback DEX. Durante a
   revisão, um agente humano simulou o ciclo completo do trade: `recordError` sobe
   `consecutiveLosses` pra 1 → fallback DEX executa e lucra → `recordTradeResult` zera
   `consecutiveLosses` no mesmo ciclo. Conclusão: o contador sobe e desce dentro do
   mesmo trade, nunca passa de 1. O fix não impedia que o LI.FI falhasse 100 vezes
   seguidas sem o circuit breaker disparar.
   **Lições do processo de revisão:** a explicação teórica ("agora registramos o erro
   antes do fallback") parecia correta. Só a simulação passo a passo do fluxo real
   revelou que o resultado prático era zero. Isso estabeleceu um padrão de verificação
   para o projeto: **não aceitar "explicação parece correta" sem rastrear o dado
   concreto que muda.**

### Correção aplicada

- **Ocorrência A**: Commit `cd53194` (02/07/2026) substituiu `deployJobProof()` por
  `sendStressTx()`, que envia 1 wei para burn address (`0x00...01`) em vez de deploy.
  Commit `1b014f3` (03/07/2026) adicionou `sendStressTx` com NonceManager.
- **Ocorrência B (fix inócuo — revertido na prática)**: Commit `38ad79f` (04/07/2026)
  adicionou `recordError` em `real-swap-executor.ts:1234`. Revisão revelou que
  `consecutiveLosses` subia pra 1 com o `recordError` e era zerado segundos depois
  pelo `recordTradeResult` — zero efeito real.
- **Ocorrência B (fix definitivo)**: Commit `64027ee` (04/07/2026):

  a) **Contador separado** `routeHealth: Record<string, RouteHealth>` no
     `circuit-breaker.ts` — `consecutiveErrors` por rota, **imune** a
     `recordTradeResult`. `consecutiveLosses` (financeiro) e
     `consecutiveErrors` (infraestrutura) são independentes.

  b) **Ação real no limiar**: 5 falhas consecutivas da mesma rota ativam
     `cooldownUntil` de 20 minutos — LI.FI é excluído da montagem de rotas
     durante o cooldown, não apenas ignorado após falhar.

  c) **Novas funções no circuit-breaker.ts**:
     - `recordRouteError(routeName)` — incrementa `routeHealth[n].consecutiveErrors`
     - `onRouteSuccess(routeName)` — zera `consecutiveErrors` e `cooldownUntil`
     - `isRouteDisabled(routeName)` — retorna `true` se em cooldown; expira
       automaticamente ao passar do timestamp

  d) **Uso em `real-swap-executor.ts`**:
     - Linha 1087: LI.FI só é tentado se `!isRouteDisabled("LI.FI")`
     - Linha 1232-1235: rota primária com sucesso chama `onRouteSuccess(label)`;
       rota primária com falha chama `recordRouteError(label)` em vez de
       `recordError`
     - Linha 1244-1246: `recordError` financeiro só quando **ambas** as rotas
       falham (trade não executou — perda real)

  e) **Generalizado por nome de rota**: `routeHealth` é um `Record<string, ...>`,
     não campo fixo `lifiCooldownUntil`. Quando `arc-direct-swap.ts` precisar do
     mesmo tratamento, é só passar o nome — sem duplicar estrutura.

### Lição para o sistema

**Um fallback que "funciona" tecnicamente (retorna `success: true`) mas mascara uma falha
real do caminho primário é uma vulnerabilidade de design, não um bug localizado.** O
circuit breaker monitora resultado financeiro (lucro/prejuízo), não saúde de
infraestrutura (LI.FI está respondendo?). São métricas ortogonais que precisam de
contadores independentes e ações diferentes:

- Falha financeira → pânico (para trades)
- Falha de infraestrutura → cooldown de rota (tenta fallback, não para o sistema)

Esse padrão de "fallback silenciosamente bem-sucedido" pode existir em qualquer ponto
onde o sistema tem dois caminhos de execução. Sempre que um fallback é adicionado,
verificar se a falha do primário é registrada em contador independente do resultado
do fallback.

**Sobre o processo de verificação:** a primeira correção (commit `38ad79f`) parecia
correta na descrição — adicionar `recordError` antes do fallback. Mas simular o ciclo
completo (`recordError → fallback → recordTradeResult → consecutiveLosses = 0`) revelou
que o contador nunca passava de 1. A lição é que, para bugs que envolvem fluxo de
dados entre módulos, a **explicação teórica** não basta — é necessário rastrear o
valor concreto de saída de cada passo antes de considerar resolvido. Esse padrão de
revisão (simulação passo a passo por um segundo revisor) agora é parte do processo
de fechamento de bugs de severidade Alta ou superior.

---

## [04/07/2026] Ausência de OHLC para pares DEX na Arc/Polygon

**Severidade:** Média
**Status:** Resolvido (decisão de design documentada e implementada)

### O que aconteceu

O módulo Arqueiro (`lib/arqueiro.ts`) foi projetado para detectar compressão de
volatilidade em pares de tokens (ex: WMATIC/USDC na Polygon, mcirBTC/USDC na Arc) e
modular o score de trades no Pregão com um `tensionScore` (0-100). Para isso, precisa
de uma métrica de volatilidade.

Contudo, pares DEX (via RPC) não expõem dados OHLC (Open-High-Low-Close) — não há
endpoint `klines` para pools como há em exchanges centralizadas. A única informação
disponível é o preço pontual (`getAmountOut` do pool ou preço do feed Chainlink).

### Causa raiz

Não é um bug — é uma limitação de dados do ambiente DEX. Sem OHLC, não é possível
calcular True Range (TR) nem ATR (Average True Range) verdadeiros, que dependem de
`max(high - low, |high - prev_close|, |low - prev_close|)`.

### Decisão tomada

Em vez de descartar o Arqueiro, adotou-se **pseudo-ATR via retorno absoluto médio**:

```
absoluteReturn = |price_t - price_{t-1}| / price_{t-1}
pseudoATR = média móvel dos absoluteReturns
```

Duas janelas são mantidas:

| Janela | Períodos | Uso |
|--------|----------|-----|
| Curta (pseudoATRShort) | 20 | Bollinger superior/inferior + squeeze Keltner |
| Longa (pseudoATRLong) | 100 | Percentil do ATR curto vs longo (`atrPercentile`) |

**Cuidado de design:** Bollinger Bands (stddev × 2) e "Keltner Channels" (pseudoATR × 1.5)
usam **a mesma janela** (20 períodos). Isso é intencional: se usassem janelas diferentes,
o squeeze Bollinger/Keltner seria redundante com `atrPercentile` (curto vs longo).
Usando a mesma janela, o squeeze captura informação ortogonal — formato da distribuição
(stddev) vs magnitude do movimento (ATR) — enquanto `atrPercentile` captura a mudança
de regime entre curto e longo prazo.

### Onde está documentado

- `lib/arqueiro.ts`: constante `SHORT_WINDOW = 20`, `LONG_WINDOW = 100`
- `lib/arqueiro.ts:111-118`: `absoluteReturns()` — implementação do pseudo-ATR
- `lib/arqueiro.ts:120-129`: `detectSqueeze()` — Bollinger e Keltner na mesma janela
- `docs/arqueiro-visual.md`: diagrama de estados, curva de tensionScore, parâmetros

### Lição para o sistema

A falta de OHLC não é um problema exclusivo deste projeto — qualquer sistema que opere
apenas com DEX (sem exchange centralizada) enfrenta a mesma limitação. A solução de
pseudo-ATR via retorno absoluto é aceitável para detecção de compressão (o sinal de
squeeze não depende do valor absoluto do ATR, só da relação entre Bollinger e Keltner).
Mas métricas que dependem de valores precisos de volatilidade (ex: stop-loss baseado em
ATR) não devem usar pseudo-ATR sem validação.

Se no futuro o sistema integrar dados de exchanges centralizadas,
os pares com OHLC disponível devem usar ATR verdadeiro, com fallback para pseudo-ATR
apenas em pares DEX puros.

---

## [04/07/2026] Decisão de não avançar com MicroVault sem base auditada

**Severidade:** Crítica (potencial)
**Status:** Decisão de não avançar (pausado até padrão auditado)

### O que aconteceu

Durante a discussão sobre o teste de eficiência de gas no GenericAMMPair (comparação
swap individual vs lote Multicall3), foi proposta a criação de um contrato `MicroVault`
que receberia depósitos de USDC de terceiros, executaria estratégias de micro-trading
em lote, e distribuiria lucros proporcionalmente aos depositantes.

### Motivo da decisão

Todo contrato existente no projeto até hoje opera em uma de duas categorias:

1. **Registro de identidade** (AgentIdentity ERC-8004) — não movimenta valor.
2. **Fundo do próprio operador** (GenericAMMPair, AgenticCommerce) — só mexe com
   tokens que são do próprio desenvolvedor.

Um Vault que recebe depósito de terceiros é uma **terceira categoria**: custódia de
fundos alheios. A partir do momento que alguém além do desenvolvedor deposita USDC,
o contrato está custodlando dinheiro de outra pessoa. As consequências de um bug mudam
de "custa gas" para "rouba ou trava o dinheiro de alguém que confiou no sistema".

Dado que esta mesma sessão de desenvolvimento revelou **três problemas de lógica em
componentes bem mais simples** (fallback mascarado, discrepância de endereço em
documentação, confusão sobre qual arquivo continha o bug de deploy), avançar com um
contrato de custódia seria prematuro.

### Condições para reabrir

1. A lógica de shares (cotas) deve ser baseada no padrão **ERC-4626** do OpenZeppelin,
   não em implementação própria. A matemática de depósito/resgate tem armadilhas
   conhecidas (inflação de share na primeira depositante, manipulação de preço via
   reservas) que o ERC-4626 já resolve.
2. Testes adversariais em testnet por tempo prolongado, incluindo tentativas
   deliberadas de drenar o vault.
3. Auditoria adversarial por pelo menos um modelo de IA diferente do que escreveu
   o código (conforme prática já estabelecida no projeto — ex: revisão cruzada do
   Arqueiro).
4. Nada disso na mainnet sem auditoria de terceiro, mesmo que informal.

### Lição para o sistema

Categoria de risco muda o processo. Bugs em contratos de identidade ou AMM próprio
são gerenciáveis. Bugs em contratos de custódia de terceiros são perda de reputação
e potencial passivo legal. A decisão de avançar com um contrato de custódia deve ser
**separada** da decisão técnica de implementá-lo — e tomada conscientemente, não por
arrastamento de uma discussão sobre gas.

---

## [04/07/2026] Nonce collision entre stress test e swaps reais — wallet separada

**Severidade:** Alta
**Status:** Resolvido

### O que aconteceu

O `JobRobot` (`lib/job-robot.ts:sendStressTx()`) envia transações de 1 wei para burn address
como stress test na Arc testnet. Essas transações usam a **mesma private key** que os swaps reais
do sistema (corretor em `real-swap-executor.ts`), e ambas passam pelo `NonceManager` singleton
(`lib/nonce-manager.ts`). Mesmo com o mutex do NonceManager, duas chamadas `getNonce()` em
provedores diferentes (provider do signer vs provider do stress test) podiam colidir quando
executadas em concorrência real — resultado: `"nonce has already been used"`.

### Causa raiz

O NonceManager serializa chamadas `getNonce()` via Promise-mutex, mas:
1. `job-robot.ts:sendStressTx()` e `arc-direct-swap.ts:executeDirectSwap()` são chamados em
   caminhos de código independentes (um no ciclo do Contratante, outro no Pregão), sem
   coordenação entre si.
2. Ambos usam `NonceManager.getInstance().getNonce(provider, chainId, address)` com o **mesmo
   endereço** (mesma private key).
3. O NonceManager rastreia nonces por `chainId:address` — mesmo endereço = mesma sequência.

### Segunda opinião técnica

Uma segunda opinião (Qwen) foi consultada sobre a arquitetura de longo prazo (wallet pool com
Redis, fila distribuída). A recomendação foi: wallet pool é correta para escala futura (3+
fluxos concorrentes), mas desproporcional para os 2 fluxos atuais. Decisão: manter wallet
separada e documentar wallet pool como próximo passo conhecido.

### Correção aplicada

- `lib/job-robot.ts:sendStressTx()`: lê `PRIVATE_KEY_STRESS` (env ou localStorage key
  `arcflow_private_key_stress`) e cria wallet separada para stress tx. Se vazia, stress tx
  é desativado com erro `"PRIVATE_KEY_STRESS não configurada"`.
- NonceManager passa a gerenciar nonces de **dois endereços diferentes** (main + stress) →
  sequências independentes → zero colisão.
- `.env.example`: documentado `PRIVATE_KEY_STRESS`.
- `app/api/stress-test/route.ts`: continua aceitando `body.privateKey` da UI (já lia
  `arcflow_stress_test_key` do localStorage) — compatível com ambas as chaves.

### Não implementado (documentado como próximo passo)

- Wallet pool com Redis para gerenciamento de nonce distribuído — implementar quando houver
  3+ fluxos concorrentes reais.
- NonceManager nativo do ethers.js v6 — suficiente para o estágio atual (2 endereços).

---

## [04/07/2026] RouteVerifier: verificação de rota de venda via Multicall3 + gate pré-trade

**Severidade:** Alta
**Status:** Resolvido

### O que aconteceu

O sistema abriu posições em `cirBTC` e `mcirBTC` na Arc testnet (3 transações confirmadas:
`0x3a3aac0f`, `0x46ed395a`, `0xf673260c`) sem que existisse rota de venda (DEX pool) para
revendê-las. A única pool existente na Arc (`GenericAMMPair` em `0xA1e418D16C969FDb9482716C7e2bD3d31872EBfb`)
só suporta o par USDC/EURC. Isso gerou posições permanentemente presas — o token comprado
não pode ser vendido de volta.

### Causa raiz

Nenhum gate pré-trade verificava se o token comprado tinha uma rota de venda registrada antes
de executar a compra. O `arc-direct-swap.ts` só bloqueava `value transfer` para tokens não-nativos,
mas não impedia a compra em primeiro lugar.

### Método: Multicall3 + cálculo local de AMM

Implementado em `lib/route-verifier.ts`:

1. **Registro de pools conhecidas**: mapa `KNOWN_POOLS[chainId]` com endereço, token0, token1,
   fee, e flag stablecoin. Arc testnet: GenericAMMPair (USDC/EURC). Polygon: dinâmico via
   PoolProfiler (preenchido sob demanda).

2. **Multicall3 para batch de reservas**: `checkRouteViaMulticall()` usa `Multicall3.aggregate3`
   (mesmo contrato `0xcA11bde05977b3631167028862bE2a173976CA11` usado em `ultraflash.ts`) para
   buscar `getReserves()` de todas as pools relevantes em uma única chamada RPC — em vez de
   N chamadas individuais.

3. **Cálculo local de output**: `estimateAMMOutput()` implementa a fórmula `x*y=k` com fee:
   ```
   amountInWithFee = amountIn * feeBps / 10000
   numerator = amountInWithFee * reserveOut
   denominator = reserveIn + amountInWithFee
   output = numerator / denominator
   ```
   Sem `staticCall` durante a verificação — só no momento de assinar a transação.

4. **Cache de 60s**: resultados de `hasSellRoute()` são cacheados para evitar repetir chamadas
   Multicall3 em ciclos rápidos.

### Gate aplicado em dois pontos

| Local | Arquivo | Comportamento |
|-------|---------|---------------|
| JobRobot | `lib/job-robot.ts:executeSwap()` | Antes de executar swap no ciclo do Contratante |
| RealSwapExecutor | `lib/real-swap-executor.ts:1165` | Antes de cair em `executeDirectSwap()` na testnet |

Ambos chamam `hasSellRoute(toToken, networkKey)`. Se o token não tem rota de venda, o swap
é abortado com `"Par bloqueado: X sem rota de saída"` e o erro é registrado.

### Posições já presas

As 3 posições abertas antes do gate não são resgatadas automaticamente. Para resgatá-las:
1. Verificar se `GenericAMMPair` pode receber liquidez do par cirBTC/USDC (requer deploy de
   novo par ou adicionar liquidez ao existente).
2. **Alternativa preferida**: aceitar a perda e documentar como custo de aprendizado.

### Segunda opinião

A segunda opinião (Qwen) recomendou usar Multicall3 para batch-fetch de reservas + cálculo
local de AMM em vez de `staticCall`s individuais, e reservar `staticCall` só para o momento
de assinar. Implementado conforme recomendado. A recomendação de não criar "walled garden"
(liquidez própria) para validar fechamento foi acatada — o gate pré-trade é a barreira
correta, não liquidez simulada.

---

## [04/07/2026] ICircuitBreaker: interface unificada para saúde de rota e financeira

**Severidade:** Média
**Status:** Resolvido

### O que aconteceu

O `circuit-breaker.ts` existente tinha funções soltas (`recordRouteError`, `recordTradeResult`,
`blockIfPanicked`) sem interface comum. Todo novo módulo que precisava de proteção contra
falhas repetidas reinventava sua própria lógica de contagem (ex: `contratante.ts` com
`consecutiveFails`, `job-robot.ts` com `consecutiveFails`). Isso levou a:
- Duas implementações paralelas de circuit breaker com políticas diferentes
- Nenhuma maneira padronizada de consultar estado
- Nenhuma interface que permitisse ao orquestrador executar `if (routeCB.isOpen() || financialCB.isOpen()) return halt()`

### Correção aplicada

Interface `ICircuitBreaker` em `lib/circuit-breaker.ts`:

```typescript
interface ICircuitBreaker {
  recordSuccess(): void
  recordFailure(reason?: string): void
  isOpen(): boolean
  getName(): string
  getStatus(): { open: boolean; consecutiveFailures: number; cooldownUntil: number | null }
}
```

Duas implementações:

| Classe | Política | Cooldown | Uso |
|--------|----------|----------|-----|
| `RouteCircuitBreaker` | 5 falhas consecutivas | 20 min | LI.FI, DEX direto |
| `FinancialCircuitBreaker` | Perdas/drawdown | Pânico global | Trades |

Singletons exportados: `lifiRouteCB`, `dexDirectRouteCB`, `financialCB`.

### Próximo passo (não implementado agora)

Integrar `ICircuitBreaker` no orquestrador de trades (`pregão.ts`):
```typescript
if (lifiRouteCB.isOpen() || financialCB.isOpen()) {
  return halt('Circuit breaker aberto')
}
```
Isso requer mudança no fluxo do Pregão que foge do escopo desta sessão. Fica como próximo
passo documentado.

---

## [04/07/2026] Arc Testnet: `eth_subscribe` não suportado

**Severidade:** Informativo
**Status:** Verificado

### Resultado do teste

Testado contra ambos os endpoints RPC da Arc testnet:
- `https://rpc.testnet.arc.network` → `"code":-32603,"message":"Internal error"`
- `https://rpc.testnet.arc.io` → resposta vazia

Conclusão: `eth_subscribe` **não é suportado** via HTTP. WebSocket subscriptions requerem
URL ws/wss que não está disponível publicamente para a Arc testnet.

### Implicação

O monitoramento de blocos e eventos continua usando polling (atual: 2-8s de intervalo).
Nenhuma mudança de arquitetura necessária. Se no futuro um endpoint WebSocket for disponibilizado
para a Arc, migrar para event-driven reduz latência de detecção de novos blocos, mas não
altera a lógica de negócio — apenas a eficiência de polling.

---

## [07/07/2026] cirBTC na Arc testnet — BUY bloqueado, SELL com validação forte

**Severidade:** Média
**Status:** Corrigido

### Sintoma

Até 4 ordens por ciclo tentavam comprar cirBTC na Arc testnet, todas falhando com `"Nenhuma rota disponível"` porque o pool USDC/cirBTC (`0x1855...`) tem liquidez simbólica (~1 USDC + 0,0001 cirBTC, preço implícito ~$10k/BTC). As ordens acumulavam blocking o CapitalController e geravam ruído no log.

Log típico:
```
[CORRETOR] ❌ Falha na execução: ❌ USDC→cirBTC falhou: Nenhuma rota disponível
[KNOWLEDGE] 🚫 Grid:Compra → USDC→cirBTC bloqueado: condições desfavoráveis
[PREGÃO] ⏰ Ordem grid_xxx expirou (73s em "executando") — marcando como falha
```

### Causa Raiz

`TRADING_PAIRS.arc` incluía `USDC→cirBTC` e `EURC→cirBTC` como pares ativos de compra. Mesmo sem rota real, agentes geravam sinais, e o ciclo tentava executá-los repetidamente. O `hasSellRoute()` retornava `true` para cirBTC (pool registrado em `KNOWN_POOLS`), mas o pool não tinha liquidez real — a função verificava existência, não magnitude das reservas.

### Correção Aplicada

**Tarefa 1 — BUY cirBTC bloqueado, SELL com validação forte:**

| # | Arquivo | Mudança |
|---|---------|---------|
| 1a | `lib/real-swap-executor.ts:157-160` | `TRADING_PAIRS.arc`: removidos `USDC→cirBTC` e `EURC→cirBTC`; mantidos `cirBTC→USDC` e `cirBTC→EURC` com comentário explicativo |
| 1b | `lib/agentes-do-pregão.ts:269-273` | `AGENTE_PARES`: removidas entries `USDC→cirBTC` e `EURC→cirBTC`; mantidas `cirBTC→USDC` e `cirBTC→EURC` com comentário |
| 1c | `lib/agentes-do-pregão.ts:593-606` | `receberOK()`: nova validação forte para cirBTC sell na Arc — chama `checkRouteViaMulticall()` com `minReserve0=10_000_000n` (≥ $10 USDC). Pool simbólico é rejeitado; trueiros ao adicionar liquidez real, sells passam automaticamente |
| 1d | `lib/route-verifier.ts:133,165-168` | `checkRouteViaMulticall()` ganha parâmetros `minReserve0?` e `minReserve1?` (default `1n`, preservando comportamento original `> 0n`) |

**Tarefa 2 — Unlock em falha de rota (verificado, não exigiu correção):**

| # | Arquivo | Verificação |
|---|---------|-------------|
| 2a | `lib/corretor.ts:213-215` | `finally { capitalController.unlock(...) }` já executa imediatamente após falha de rota — lock é liberado na mesma chamada |
| 2b | `lib/pregão.ts:540` | `getOrdensAtivas()` chama `capitalController.forceUnlock()` (sem argumento = `releaseAll()`) como safety net em timeout de 120s |

### Decisão Arquitetural

**Não adicionar liquidez ao pool self-seeded.** Injetar USDC no pool `0x1855...` criaria um "walled garden" — preço e liquidez fictícios que não refletem mercado real. A decisão correta é:
- Bloquear compras (ninguém deve comprar cirBTC sem liquidez real)
- Permitir vendas apenas com validação forte (se a carteira já tem cirBTC, pode sair quando houver liquidez)
- Adicionar o par verdadeiro quando o pool de terceiros tiver liquidez real ou quando um bridge CCTP para cirBTC estiver operacional

### Verificação Empírica (07/07/2026)

**Análise de Código — Gap Estrutural no Corretor:**

Entre `capitalController.request()` (aquisição do lock) e o bloco `try/finally` (que contém `unlock()`), havia código que podia lançar exceção sem proteção — especificamente `realSwap.switchNetwork()` e `blockIfPanicked()`. Se qualquer um desses lançasse exceção, o lock vazava.

**Correção aplicada (07/07/2026):** `lib/corretor.ts:45-217` — todo o fluxo desde `request()` até `unlock()` agora está dentro de um único `try/catch/finally`. O `finally` sempre executa `unlock()`, independente de:
- `request()` retornar `!authorized` (no-op unlock — seguro)
- `blockIfPanicked()` disparar (lock liberado no finally)
- `switchNetwork()` lançar exceção (catch + finally)
- `executeSwap()` falhar com rota (else + finally)
- `executeSwap()` lançar exceção (catch + finally)
- `executeSwap()` concluir com sucesso (finally limpa o lock)

**Diagnóstico adicionado:** `🔓 Unlock: <key> (finally)` no log a cada execução do `finally`, permitindo monitoramento contínuo do tempo de liberação do lock.

**Resultado da análise:** o unlock em falha de rota SEMPRE acontece no mesmo ciclo (subsegundos), porque o `finally` é executado imediatamente após o retorno de `executeSwap()`. O lock NUNCA precisou do safety net de 120s para ser liberado — o timeout de 73s observado nos logs originais foi causado pela ORDEM SEGUINTE que ficou presa aguardando o lock, não pela ordem que falhou.

### Impacto (atualizado)
- Zero ordens de compra cirBTC sendo geradas na Arc
- SELL preservado para liquidação futura quando pool tiver liquidez real
- CapitalController não mais bloqueado por ordens que falham em cascata
- Lock liberado imediatamente após cada execução (finally, mesmo ciclo, subsegundos)
- Gap estrutural entre request() e try/finally eliminado (switchNetwork, circuit breaker cobertos)
- Log diagnóstico `🔓 Unlock` permite rastreio contínuo
- Threshold de liquidez configurável por ativo/rede via `MIN_POOL_RESERVE`
- Build: limpo (zero erros TS)

### MIN_POOL_RESERVE — Configuração Centralizada (07/07/2026)

**Problema:** o threshold `minReserve0=10M` estava hardcoded em unidades raw (assumindo 6 decimais USDC) em `agentes-do-pregão.ts:597`. Frágil para reuso com tokens de decimais diferentes.

**Correção:**

| # | Arquivo | Mudança |
|---|---------|---------|
| 3a | `lib/config/market-thresholds.ts` | ✨ Novo — `MIN_POOL_RESERVE` (human units por ativo/rede), `DEFAULT_MIN_RESERVE`, `toRawUnits()` com decimais arbitrários |
| 3b | `lib/agentes-do-pregão.ts:598-599` | Hardcoded `10_000_000n` substituído por `toRawUnits(MIN_POOL_RESERVE.arc.cirBTC ?? DEFAULT_MIN_RESERVE, 6)` |

**Valores atuais:**

| Rede | Ativo | Mínimo (USDC na pool) |
|------|-------|-----------------------|
| arc  | cirBTC | $10 |
| arc  | EURC   | $5 |
| arc  | USDC   | $5 |

**Design:**
- `toRawUnits("10", 6) = 10_000_000n` — equivalente a `ethers.parseUnits` sem dependência externa
- Suporta decimais fracionários: `toRawUnits(0.5, 6) = 500_000n`
- Mudar `MIN_POOL_RESERVE.arc.cirBTC` de `10` para `20` reflete no comportamento sem editar route-verifier.ts ou agentes-do-pregão.ts

---

## [07/07/2026] Wallet Investigation — Deploy wallets divergentes + DecisionAnchor inativo

**Severidade:** Média (investigação)
**Status:** Esclarecido

### Contexto

Auditoria via ArcScan revelou dois achados:
1. **DecisionAnchor.sol** (`0x7813E0...`) tem apenas 1 transação (deploy) — zero `anchor()` chamadas
2. **Dois contratos deployados por wallets diferentes da principal** (0x77f5...)

### Achado 1 — DecisionAnchor nunca ativado on-chain

**Causa raiz:** `frameworkIntents.configure()` NUNCA foi chamado em produção. Apesar do código da Fase 5 estar completo (retry, audit integration, anchorDecision()), nenhum ponto da aplicação chama `configure()` ou `runCycle()`. O coordinator framework existe mas não está integrado ao runtime.

**Correção:** Adicionado `autoConfigureFromEnv()` ao `OnChainIntentPublisher` (07/07/2026) — lê `process.env.PRIVATE_KEY` em server-side e auto-configura o signer. O método é chamado no construtor. Para ativar:
1. Setar `PRIVATE_KEY` no `.env` (com a chave da wallet principal 0x77f5...)
2. Iniciar o coordinator (chamar `frameworkCoordinator.runCycle()` ou integrar via CRON/interval)

**Impacto:** Sistema continua funcionando sem on-chain (fallback `📝 Off-chain anchor (not configured)`). Após configurar, cada execução bem-sucedida gerará `🔗 Decision anchored: intent_xxx → tx:0x...`.

### Achado 2 — Wallet de deploy do DecisionAnchor (0xfa03...7dDA)

**Investigação:**
- `PRIVATE_KEY_STRESS` no `.env.local` = `0x1aac73...` → corresponde a `0xfa033D...7dDA` ✅ confirmado via `ethers.Wallet`
- `deployDecisionAnchorArc.js` usa `PRIVATE_KEY_STRESS || PRIVATE_KEY` — como PRIVATE_KEY está vazia, usou PRIVATE_KEY_STRESS
- 0xfa03... NÃO é apenas wallet de deploy: tem 44 transações, 50+ token transfers, swaps LI.FI reais (36,7 USDC, 21,1 EURC), e deployou 3-4 GenericAMMPair adicionais
- **Não há risco de controle**: DecisionAnchor.sol não tem `onlyOwner` — qualquer wallet pode chamar `anchor()`

**Conclusão:** 0xfa03... foi usada como wallet operacional secundária durante o desenvolvimento, não apenas para deploy. O projeto tem duas wallets ativas de propriedade do desenvolvedor.

### Achado 3 — ERC-8183 v2 compartilhado (0x0747EE...)

O contrato ERC-8183 v2 (AgenticCommerce oficial da Arc Foundation) em `0x0747EE...` foi deployado por `0xcBe5B97...B620D` — wallet NÃO pertencente ao CriptoMorse. O volume de 494K+ transações / 129K transfers / $6.634 USDC retido é de uso **compartilhado** entre múltiplos projetos na Arc testnet. O CriptoMorse contribui com um subconjunto desse total.

### Wallet Mapping (consolidado)

| Wallet | Papel | Controlada? |
|--------|-------|-------------|
| `0x77f5C3A1079B86ef8490E7c5Ec1F9bcfbaAE5894` | Operacional principal | ✅ Sim (PRIVATE_KEY) |
| `0xfa033D062d6ab8d49D611F5644d46f5380737dDA` | Operacional secundária / deploy | ✅ Sim (PRIVATE_KEY_STRESS) |
| `0xAD42458a2e98E62453F4B54FA6E7511E0A303B6F` | Não utilizada | ✅ Sim (nunca usada ativamente) |
| `0xcBe5B97a069be3E4B5398663790731fb76aB620D` | Deployer ERC-8183 v2 (Arc Foundation) | ❌ Não |

### Ações Tomadas

- `lib/agent-framework/onchain-intent-publisher.ts`: adicionado `autoConfigureFromEnv()` — auto-configura a partir de `PRIVATE_KEY` no `.env`
- `ARCFLOW.md` seção 58: wallet mapping completo com cadeia de custódia dos contratos
- `.env.example`: documentado que `PRIVATE_KEY` deve conter a chave da wallet principal

### Pendente para Ativação On-chain

| # | Tarefa | Depende de |
|---|--------|------------|
| 1 | Setar `PRIVATE_KEY` no `.env.local` com chave de 0x77f5... | Desenvolvedor |
| 2 | Iniciar coordinator (`frameworkCoordinator.runCycle()`) | Decisão de integração (server-side interval) |
| 3 | Verificar contratos no ArcScan (forge verify) | Instalar Foundry |
| 4 | Investigar 3 pools AMM não documentados (0x54..., 0xAc..., 0x38...) | Acessar ArcScan com endereços completos |

---

## [07/07/2026] Auditoria on-chain — cirBTC, Pool A, ownership e DecisionAnchor

**Severidade:** Média (investigação)
**Status:** Esclarecido / documentação corrigida

### Escopo

Auditoria read-only antes da Phase 2. Nenhuma transação foi enviada, nenhuma ownership foi transferida e nenhuma liquidez foi removida.

### Achado 1 — cirBTC no runtime atual da Arc Testnet

Chamadas RPC read-only em `https://rpc.testnet.arc.network` e `https://rpc.testnet.arc.io` mostraram:

| Endereço | Resultado |
|----------|-----------|
| `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` | Tem bytecode; `name() = Circle Wrapped Bitcoin`; `symbol() = cirBTC`; `decimals() = 8` |
| `0x171A4217b86A807A64eB94757Db6849fb4bDbAA0` | Sem bytecode nos RPCs testados |

Conclusão: não afirmar que `0x171A...` é o cirBTC deployado/oficial para o runtime atual da Arc Testnet sem prova primária Arc/Circle. A fonte operacional deve ser o estado on-chain atual, salvo evidência primária em contrário.

O antigo `PRICE_DIVIDER = 10^10` não é explicado pelos decimals do ERC-20 em `0xf0C4...`, que reporta 8 decimals. O divisor provavelmente compensava pressupostos de preço/feed, não o contrato ERC-20.

### Achado 2 — Pool A foi recuperada

Pool A: `0x8cdc84f93F6a5413667354F8fB516959D682423c`

Estado on-chain:

- `token0`: USDC `0x3600000000000000000000000000000000000000`
- `token1`: cirBTC runtime atual `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF`
- Reservas: `65.03 USDC` e `0.00117965 cirBTC`
- `totalLiquidity`: `123501`
- LP da wallet principal `0x77f5C3A1079B86ef8490E7c5Ec1F9bcfbaAE5894`: `0`
- LP da wallet stress/deploy `0xfa033D062d6ab8d49D611F5644d46f5380737dDA`: `123501`
- `owner()`: `0xfa033D062d6ab8d49D611F5644d46f5380737dDA`
- `paused()`: `false`

Simulação read-only:

- `eth_call removeLiquidity(123501)` a partir de `0xfa033D...`: OK
- `eth_call removeLiquidity(123501)` a partir de `0x77f5...`: reverte com `Insufficient liquidity`

Conclusão atualizada: Pool A não deve ser tratada como perda confirmada. A classificação anterior como "unrecoverable" foi corrigida após simulação read-only e recuperação bem-sucedida pela stress/deploy wallet `0xfa033D...`, não pela main wallet.

Recuperação executada:

- Tx: `0xe7efabca39944399179263711e38ab6f385dcea087baedac122c7db86300acfd`
- Bloco: `50639197`
- Status: confirmado (`status = 1`)
- Gas used: `85329`
- Signer / LP owner: `0xfa033D062d6ab8d49D611F5644d46f5380737dDA`
- Método: `removeLiquidity(123501)`
- LP burned: `123501`
- USDC recuperado: `65.03 USDC`
- cirBTC recuperado: `0.00117965 cirBTC`
- Novo LP balance: `0`
- Novo totalLiquidity: `0`
- Reservas finais: `0.0 USDC` e `0.0 cirBTC`
- Pool paused após recuperação: `false`

### Achado 3 — ownership dos pools

| Pool | Owner atual | Observação |
|------|-------------|------------|
| USDC/EURC `0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb` | `0x77f5C3A1079B86ef8490E7c5Ec1F9bcfbaAE5894` | Pool ativo/documentado, owned pela wallet principal |
| Pool A/B/C secundários | `0xfa033D...` | Pools demo/stress/deploy |

Recomendação: transferir ownership de qualquer pool secundário/demo que será mantido para a wallet operacional principal ou multisig antes de apresentação pública/demo.

### Achado 4 — DecisionAnchor funciona, mas lifecycle canônico ainda não está completo

Contrato configurado: `0x7813e04338dc9d6b7676843a52152c57438cc7b2`

Estado on-chain:

- Tem bytecode
- `totalReports() = 65`
- Eventos `ReportAnchored` existem

Conclusão: o contrato funciona e já foi chamado. Isso não prova completude do lifecycle canônico. O `anchorDecision()` atual ainda ancora hash de metadados compactos, não necessariamente o hash do DecisionReport finalizado com todos os campos obrigatórios.

### Fatos de infraestrutura antes da Phase 2

- A fonte de verdade do token Arc cirBTC deve partir da verificação on-chain atual, salvo prova primária Arc/Circle em contrário.
- Pool A foi recuperada com sucesso; a classificação anterior como "unrecoverable" foi corrigida por simulação read-only e tx confirmada.
- Ownership de pools está dividida entre wallet principal (`0x77f5...`) e wallet stress/deploy (`0xfa033D...`).
- DecisionAnchor funciona como contrato, mas a ancoragem canônica de DecisionReport no runtime ainda está incompleta.

---

## npx pode baixar executor ausente silenciosamente

**Data**: 2026-07-11

**Contexto**: Durante a auditoria da Phase 2e.2i, o runner de teste (`scripts/phase-2e2f-settlement-replay-test.ts`) foi executado com `npx tsx` em uma rodada intermediária.

**Fatos**:
- `tsx` não era dependência local: `npm ls tsx --depth=0` retornou vazio, `node_modules/tsx` ausente, `node_modules/.bin/tsx.cmd` ausente
- `npx` pode ter consultado ou baixado o executor do registry npm para o cache global, sem aviso explícito
- O resultado foi posteriormente reproduzido com TypeScript local (dependência comprovada: `typescript@5.9.3`)
- O método seguro aprovado usa exclusivamente recursos locais:
  - `node_modules/typescript/lib/typescript.js`
  - `ts.transpileModule()` para compilação in-memory
  - `Module._resolveFilename` personalizado para resolver alias `@/*`

**Regra**: Não usar `npx` para executores que não sejam dependência local comprovada. Quando `npx` for indispensável, usar `--no-install` (ou equivalente) e comprovar resolução local antes da execução.

**Arquivos envolvidos**: `scripts/phase-2e2f-settlement-replay-test.ts` (runner), `node_modules/typescript/` (dependência local)

---

## PowerShell 5.1 interpreta incorretamente UTF-8 sem BOM com caracteres não-ASCII

**Data**: 2026-07-11

**Contexto**: O script de checkpoint da Phase 2e.2i continha um em dash (`—`, U+2014) na string de mensagem da tag (`-m "Phase 2e.2i — Settlement replay exception safety"`). O script foi escrito em UTF-8 sem BOM e executado com `powershell.exe -File`.

**Fatos**:
- PowerShell 5.1 no Windows interpreta arquivos sem BOM como Windows-1252 (legacy), corrompendo caracteres não-ASCII
- O em dash (3 bytes em UTF-8: `E2 80 94`) foi interpretado como 3 caracteres Windows-1252 individuais, causando um erro de string não terminada (`A cadeia de caracteres não tem o terminador`)
- O parser do PowerShell falhou com: `'}' de fechamento ausente no bloco de instrução`
- A lógica do checkpoint não era o defeito — apenas o encoding do caractere
- Solução aplicada: substituir `—` (em dash) por `--` (dois hífens ASCII) e escrever o arquivo com BOM via `[System.Text.UTF8Encoding]::new($true)`

**Regra**: Usar exclusivamente caracteres ASCII em scripts PowerShell operacionais, ou salvar explicitamente como UTF-8 com BOM. Preferir `--` em vez de `—` (em dash) em strings de script. Validar scripts críticos em `powershell.exe 5.1` antes de uso em checkpoint automatizado.

**Arquivos envolvidos**: script de checkpoint temporário `%TEMP%\arcflow-checkpoint-*.ps1`