# RI-BANK-15 — Relatório de mapeamento do cron híbrido

```text
DOCUMENT_KIND=MAPPING_REPORT
STATUS=CONCLUÍDO — INVESTIGAÇÃO SOMENTE
CODE_CHANGE_AUTHORIZED=NÃO
CODE_CHANGE_PERFORMED=NÃO
EXECUTION_AUTHORIZED=NÃO
EXECUTION_PERFORMED=NÃO
DATE=2026-07-31
MANDATE=RI-BANK-15
DEPENDE_DE=RI-BANK-14-EXECUTION-REPORT-CODEX.md
BLOQUEIA=qualquer implementação real de conexão do cron
AUTOR=Codex
WORKSPACE=C:\Users\silvi\arcflow
```

## Resultado executivo

O cron continua inativo e desconectado de trading real. O workflow só aceita disparo manual e a agenda segue comentada; o endpoint só valida `CRON_SECRET`, lê o circuit breaker global e devolve `executed: false`.

Há três conclusões de código com impacto direto no desenho:

1. **A rota não deve chamar `pregãoEngine.start()` como ele existe hoje.** O método abre, em fire-and-forget, um loop indefinido em memória. Isso não oferece uma unidade de trabalho limitada e aguardável para uma função serverless. Além disso, o setup e cada iteração chamam `resumeFromPanic()`, limpando o freio que o Modo 1 deveria apenas consultar.
2. **O clique em `start()` não consegue provar que um par/estratégia específico rodou.** O método só recebe `confirmMainnet`; par, estratégia, caixa e valor não fazem parte da chamada. A autorização manual precisa ser registrada num evento posterior, no qual já existam rota e proveniência suficientes.
3. **O código não define as políticas necessárias para concluir sozinho o desenho.** Precisam de decisão do Silvio: validade da confirmação de mainnet; evento que constitui “rodou manualmente”; granularidade da rota autorizada; origem do plano do cron; autenticação do kill switch; retenção da auditoria.

Essas pendências são impeditivas e foram mantidas abertas. Nenhum teste, ciclo ou trade foi executado.

## 1. Estado atual do endpoint e workflow

### `app/api/cron/trigger/route.ts`

- Define runtime Node e resposta dinâmica (`linhas 20–21`).
- `POST` valida apenas o Bearer token via `isValidCronRequest()` (`linhas 23–26`).
- Lê o circuit breaker global de forma fresca por `getCircuitBreakerStateFresh()` (`linha 28`).
- Se houver pânico, devolve `executed: false` e o motivo (`linhas 29–33`).
- Se não houver pânico, ainda devolve `executed: false`, declarando que nenhuma ação está conectada (`linhas 36–39`).
- Não lê corpo da requisição e, portanto, não conhece rede, par, estratégia, caixa ou valor.
- Não consulta caixa de risco, orçamento, confirmação de mainnet, autorização manual da rota ou kill switch próprio.
- Não cria registro persistente de auditoria.
- `GET` devolve 405 (`linhas 42–43`).

Os comentários do próprio arquivo ainda o classificam como “auth gate + circuit breaker gate only” e dizem que a Camada 2 está pendente (`linhas 5–19`).

### `.github/workflows/cron-trigger.yml`

- Só `workflow_dispatch` está habilitado (`linhas 18–21`).
- O `schedule` de 15 minutos permanece comentado (`linhas 20–21`).
- O job faz um único `curl POST`, com `CRON_SECRET`, para `ARCFLOW_BASE_URL/api/cron/trigger` (`linhas 23–31`).
- Não envia corpo ou identificador de invocação.

### Mudou desde o RI-BANK-10 Estágio 1?

**Não houve mudança substancial em relação ao estado-base descrito no mandato do RI-BANK-15.** O estado atual ainda é exatamente: agenda desativada, auth + circuit breaker global e nenhuma conexão a trading. Não foi localizado no pacote atual um snapshot versionado do relatório original para uma comparação textual byte a byte; a conclusão histórica usa o baseline fornecido pelo mandato e é confirmada pelo conteúdo atual dos dois arquivos.

## 2. Onde `pregãoEngine.start()` é chamado

### Chamadas reais

1. **Auto-início de testnet no dashboard** — `app/components/PregãoDashboard.tsx:101–136`.
   - Usa `localStorage` (`arcflow_auto_ciclo`).
   - Mainnet é explicitamente excluída do auto-início (`linhas 118–125`).
   - Em testnet, define a rede e chama `pregãoEngine.start()` (`linhas 128–132`).

2. **Início manual pela UI** — `app/components/PregãoDashboard.tsx:318–335`.
   - O primeiro clique chama `pregãoEngine.toggle()` (`linhas 323–326`).
   - Se mainnet exigir confirmação, a UI abre o painel (`linhas 326–328`).
   - O segundo clique chama `pregãoEngine.start({ confirmMainnet: true })` (`linhas 331–334`).

As demais ocorrências localizadas são testes estruturais. Não há chamada em API/servidor.

### Caminho manual separado

O botão de um ciclo usa `rodarUmCiclo()` em `app/components/PregãoDashboard.tsx:376–396`; ele não chama o engine. Ele limpa o pânico, roda Pregueiros e Agentes diretamente e, em testnet, também `pregao-arc`. Esse caminho:

- não usa o gate `confirmMainnet` do engine;
- não carrega uma origem estruturada “manual” para as ordens;
- não identifica antecipadamente um único par/estratégia;
- não executa o mesmo corpo completo de mainnet de `runOneCycle()` (não chama ali `professor.gerarPacotes()`/`pregão.executarPacotes()`).

### Há distinção manual versus programática?

**Não no contrato do engine.** `pregãoEngine.start()` só aceita `{ confirmMainnet?: boolean }` (`lib/pregão-engine.ts:164`). O estado `_mainnetConfirmado` é memória do singleton (`linhas 168–173`) e não há `source`, `actor`, `invocationId`, par, estratégia, caixa ou valor.

A distinção existente é apenas contextual no caller: efeito automático de testnet versus handlers de UI. Ela se perde ao entrar no engine e não pode ser usada como prova persistente.

## 3. Como o engine funciona e por que `start()` não serve à rota

- `start()` marca `_ativo`, dispara `void this.armar()` e retorna imediatamente (`lib/pregão-engine.ts:164–186`).
- `armar()` chama `resumeFromPanic()` (`linha 218`), inicia o scanner (`linhas 220–227`) e dispara `this.loop()` sem aguardar (`linha 238`).
- `loop()` permanece em `while (this._ativo)` (`linhas 244–268`).
- `runOneCycle()` também chama `resumeFromPanic()` em toda iteração (`linha 276`) e depois roda Pregueiros, Agentes e, em mainnet, Professor/pacotes (`linhas 273–289`).

Consequências:

- uma resposta HTTP não representa a conclusão de uma operação limitada;
- a instância serverless pode ser congelada/encerrada depois da resposta;
- duas invocações podem criar loops em instâncias diferentes, pois `_ativo` é memória local;
- não existe lease/idempotência cross-instance;
- o código limpa o pânico em vez de falhar fechado;
- o método não recebe os dados necessários para verificar as condições híbridas.

O equivalente adequado precisa ser uma **operação server-side limitada e aguardável**, com no máximo um plano/ciclo autorizado por invocação e sem reset automático de freios. Hoje essa API pública não existe: `runOneCycle()` é privada (`lib/pregão-engine.ts:273`). A forma exata dessa operação é decisão/implementação futura.

## 4. Estado persistente proposto

### Precedente existente

`lib/kv.ts` centraliza o cliente Upstash e separa ambientes por `VERCEL_ENV` (`linhas 1–40`). As chaves atuais seguem:

- `arcflow:<env>:circuit-breaker:state` (`linhas 42–44`);
- `arcflow:<env>:trading-budget:state` (`linhas 50–55`);
- `arcflow:<env>:risk-boxes:state` (`linhas 57–62`).

O mesmo padrão deve ser reaproveitado. Não se propõe implementar nesta etapa.

### Chave de controle sugerida

Nome conceitual:

```text
arcflow:<env>:cron-control:state
```

Hash sugerido para o estado global:

```text
enabled                     boolean (fail-closed se ausente)
mainnetConfirmedAt          timestamp ISO/epoch
mainnetConfirmationExpiresAt timestamp ISO/epoch
mainnetConfirmedBy          identificador não secreto do operador
mainnetConfirmationNetwork  rede/chainId autorizada
updatedAt                   timestamp
version                     inteiro para evolução/concorrência
```

`enabled` é o kill switch específico do cron. A confirmação deve ser explicitamente escopada a uma rede/chainId; “mainnet” genérica permitiria que a confirmação da Polygon fosse reaproveitada acidentalmente em outra rede.

### Registro de rotas manualmente aprovadas

Usar uma chave/coleção separada evita misturar cardinalidade variável no hash global. Nome conceitual:

```text
arcflow:<env>:cron-control:manual-routes
```

Identidade mínima recomendada para avaliação:

```text
network/chainId + par canônico + strategyId
```

Campos úteis:

```text
firstManualRunAt
lastManualRunAt
confirmedBy
source=dashboard
evidenceId (ordem/proposta/settlement)
riskBox (se a autorização precisar ser distinta por caixa)
```

O uso de apenas `par` é insuficiente: a mesma dupla em chains e estratégias diferentes não representa o mesmo padrão observado. Ainda depende de decisão se direção, versão da estratégia e caixa fazem parte da identidade.

### Quando gravar

**Não no `pregãoEngine.start()`.** Nesse ponto só existe a rede; nenhum par/estratégia foi selecionado. A gravação precisa ocorrer quando houver uma proposta/ordem concreta proveniente de um ciclo manual, com a origem propagada de forma explícita.

O código não responde se a prova deve ser:

- proposta manual emitida;
- ordem autorizada/despachada;
- transação on-chain confirmada/settlement bem-sucedido.

Por segurança, “tentou iniciar um scanner” não deveria equivaler a “o padrão rodou manualmente”. A escolha do evento é política e precisa do Silvio.

## 5. Respostas às três perguntas

### Pergunta 1 — substituto de “confirmada nesta sessão”

Precedentes reais:

- o gate atual exige confirmação explícita separada e guarda apenas `_mainnetConfirmado` em memória (`lib/pregão-engine.ts:164–173`);
- o loop revalida essa memória a cada ciclo (`linhas 244–260`);
- `lib/kv.ts` já fornece o padrão de estado cross-instance por ambiente.

O código favorece tecnicamente **(c), combinação das duas provas**:

1. confirmação explícita de mainnet persistida, com timestamp/expiração e escopo de rede; e
2. autorização persistida para rota/estratégia previamente executada manualmente.

A opção (b) isolada fundiria duas decisões que hoje são separadas na UI e enfraqueceria o gate explícito do RI-BANK-8. Entretanto, isto é recomendação técnica, **não decisão fechada**.

Decisões do Silvio:

- validade/TTL da confirmação;
- quem pode confirmar e qual identificador auditável guardar;
- se a confirmação vale por rede, chainId ou conjunto de redes;
- comportamento após troca de configuração/deploy.

### Pergunta 2 — registrar par/estratégia já rodado manualmente

Não existe distinção interna manual/programática aproveitável. É necessário introduzir proveniência explícita (`source`, `actor`, `invocationId`) e registrar a rota num evento em que par e estratégia já existam.

Decisões do Silvio:

- qual evento constitui “rodou”: emissão, despacho ou settlement confirmado;
- chave exata: rede+par+estratégia, e se inclui direção, versão e caixa;
- se uma execução manual expira ou é permanente;
- como invalidar autorizações após mudança material de estratégia.

### Pergunta 3 — o endpoint precisa mudar de forma?

**Sim, substancialmente.** Não basta adicionar `pregãoEngine.start()`.

Fluxo mínimo conceitual, em ordem fail-closed:

1. validar `CRON_SECRET`;
2. criar `invocationId` e garantir idempotência/lease cross-instance;
3. ler `cron-control` fresco e bloquear se `enabled !== true`;
4. ler circuit breaker global e caixas frescos, sem chamar `resumeFromPanic()`;
5. obter um plano limitado com rede, par, estratégia, caixa e valor;
6. validar confirmação de mainnet vigente para a rede;
7. validar a rota manualmente aprovada;
8. validar teto por trade, orçamento e caixa;
9. executar uma única unidade aguardável;
10. persistir auditoria em toda saída, inclusive `executed: false`;
11. liberar o lease e devolver resultado estruturado.

O endpoint atual não recebe um plano. Precisa ser decidido se o plano vem de configuração Redis server-controlled ou do corpo autenticado do workflow. Também precisa ser definido se “cron pode iniciar/parar ciclos” significa uma unidade por invocação ou um serviço durável fora de serverless. No ambiente atual, a primeira opção é tecnicamente compatível; o loop permanente não é.

## 6. D4 — auditoria persistente

Existe um modelo estruturado de Audit no framework, porém a implementação atual é apenas memória:

- `private entries: AuditEntry[] = []` em `lib/agent-framework/audit.ts:9–16`;
- retenção limitada a 1.000 entradas no processo (`linhas 19–23`);
- o Coordinator declara explicitamente `durability: "instance_memory"` e limitação HIGH após restart (`lib/agent-framework/coordinator.ts:187–203`).

Os logs do circuit breaker persistem o estado atual do freio, não um ledger de todas as decisões do cron. A âncora on-chain de decisões dos agentes também não cobre recusas do cron.

Conclusão: D4 precisa de persistência nova. Sugestão conceitual:

```text
arcflow:<env>:cron-audit
```

Redis Stream é apropriado para eventos append-only; lista/sorted set com retenção também é viável. Cada entrada deveria conter pelo menos:

```text
invocationId, timestamp, workflowRunId/requestId, source,
network, pair, strategyId, riskBox, amountUsd,
mode, executed, reasonCode, reasonPublic,
gate snapshots/versions, result/evidenceId, durationMs
```

Não armazenar secrets, private keys ou headers. Registrar também falhas internas e impossibilidade de ler Redis, com resposta fail-closed.

Decisões do Silvio: tecnologia (Stream/lista), retenção, acesso de revisão e nível de detalhes financeiros.

## 7. D5 — kill switch específico do cron

O `/api/panic` existente é precedente para comando remoto autenticado: exige `ADMIN_PANIC_KEY` e chama `activatePanic()`/`resumeFromPanic()` (`app/api/panic/route.ts:16–34`). Ele é global e não substitui o switch exclusivo do cron.

O encaixe recomendado é `enabled` no hash `cron-control`, lido diretamente do Redis em toda invocação. Regras conceituais:

- ausente, inválido ou Redis indisponível => cron desabilitado;
- desligar não depende do dashboard;
- reabilitar requer autenticação mais forte/igual à operação administrativa;
- não reutilizar `CRON_SECRET`, pois ele autentica o chamador agendado, não um operador;
- o pânico global continua sendo um backstop independente.

“Qualquer pessoa possa desligar remotamente” não define uma fronteira de confiança. O código atual só oferece precedente de segredo administrativo, não identidade/roles. O Silvio precisa decidir quem são os operadores e qual mecanismo autentica desabilitar/reabilitar.

## 8. Outros bloqueios encontrados antes de cron real

### Signer server-side não configurado

`realSwap` nasce com `signer = null` (`lib/real-swap-executor.ts:302–305`) e o signer só é injetado por `setSignerFromPrivateKey()` (`linhas 1345–1369`). As chamadas localizadas estão na UI; a rota cron não configura wallet server-side. Uma implementação real precisa de bootstrap server-only, escopado, sem expor chave ao browser e com verificação de endereço/rede antes de executar.

### Compatibilidade browser/server não demonstrada

O ciclo dos agentes usa URLs relativas como `fetch('/api/price?...')` (`lib/agentes-do-pregão.ts:334,357`) e vários módulos possuem estado/localStorage específico do navegador. Em Node server-side, fetch relativo não tem origem implícita. A unidade de execução escolhida precisa de auditoria própria de compatibilidade server-side antes de ser autorizada.

### Freios no hot path existem, mas não substituem preflight

- orçamento fresco/persistido: `lib/trading-budget.ts:57–73`, limite inicial $50 em `linhas 108–114`;
- caixa/teto: `lib/risk-boxes.ts:90–98`, `perTradeCapUsd` com default $15 em `linha 115`, autorização fresca em `linhas 290–297`;
- Corretor aplica budget e caixa antes do swap (`lib/corretor.ts:137–161`).

Esses gates são defesa em profundidade. O endpoint híbrido ainda deve fazer preflight para decidir Modo 1 versus Modo 2 e registrar o motivo sem iniciar trabalho desnecessário.

## 9. Decisões necessárias antes de autorizar implementação

1. TTL e escopo da confirmação persistida de mainnet.
2. Evento probatório de “rodou manualmente”.
3. Identidade canônica da autorização: rede/par/estratégia/direção/versão/caixa.
4. Origem do plano limitado que o cron executa.
5. Uma unidade por invocação versus serviço durável fora do serverless.
6. Identidade/autenticação de operadores do kill switch.
7. Formato e retenção da auditoria.
8. Modelo do signer server-side e endereço autorizado.
9. Política de idempotência, lease e concorrência.
10. Comportamento explícito diante de Redis indisponível (recomendado: fail-closed).

## 10. Verificação de escopo

- Nenhum arquivo de código foi modificado.
- Nenhum teste, script, build, endpoint, workflow ou ciclo foi executado.
- Nenhum trade, wallet ou rede foi acionado.
- Foram criados apenas este relatório e os arquivos de entrega do RI-BANK-15 em `codex-executor/RI-BANK-15`.

