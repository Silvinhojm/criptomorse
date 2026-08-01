# RI-BANK-12 — Estágio 2 — Relatório de Execução Codex

```text
DOCUMENT_KIND=EXECUTION_REPORT
STATUS=CONCLUÍDO — C1/C2 + D1-D5 + TRILHA E
CODE_CHANGE_PERFORMED=YES
REAL_TRADES_EXECUTED=NO
TEST_TRADES_EXECUTED=NO
NETWORK_CALLS_FROM_TESTS=NO
REDIS_WRITES_FROM_TESTS=NO
DATE=2026-07-31
DEPENDS_ON=RI-BANK-12-STAGE-1-REPORT-CODEX.md
```

## Resultado executivo

- A auditoria C1 identificou 14 decisões/premissas relevantes na implementação não commitada anterior. Quatro divergiam diretamente das decisões oficiais: mainnet-only, high-water mark em B, ausência de origem A/B e teste com acesso potencial ao Redis.
- C2 corrigiu todas as divergências diretas. As decisões confirmadas pelo Silvio estão codificadas no cabeçalho de `lib/risk-boxes.ts`.
- D1-D5 foram resolvidos. A prova A4b apresenta **30/30 falhas antes** e **0/30 depois**.
- As correções RI-BANK-11 existem no repositório: reset condicional por mudança de modo, fila de `recordTradeResult()` e orçamento por janela com limite ainda `null`.
- Nenhuma transação, RPC, Redis ou `.env.local` foi usada na suíte RI-BANK-12.

## Trilha C — auditoria da implementação anterior

As linhas “anteriores” abaixo são as posições registradas no relatório do Estágio 1 antes da substituição do arquivo não rastreado.

| # | Decisão/premissa tomada anteriormente | Local anterior | Veredito oficial e correção |
|---|---|---|---|
| C1.1 | Criar módulo separado do circuit breaker global | `risk-boxes.ts:1-43` | Mantido. Os mecanismos têm semânticas diferentes. |
| C1.2 | B zerar sem afetar A | `risk-boxes.ts:225-243` | Confirmado oficialmente; mantido e testado com evento simultâneo. |
| C1.3 | Aplicar drawdown apenas em mainnet | `risk-boxes.ts:216,231` | **Divergia.** Removido o gate `!isTestnet`; teste comprova o mesmo limite em testnet. |
| C1.4 | Usar high-water mark em B a cada lucro | `risk-boxes.ts:263-268` | **Divergia.** B agora mantém baseline fixo; comentário de trade-off em `risk-boxes.ts:1-11,273`. |
| C1.5 | Configurar A e B por setters independentes | `risk-boxes.ts:115-151` | Substituído por `configureRiskBoxes()` atômico (`risk-boxes.ts:122`). Setters ficam apenas para reconfiguração compatível. |
| C1.6 | `investir=true` poder existir sem risco até setter posterior | gate anterior em `risk-boxes.ts:194-198` | Corrigido: configuração atômica rejeita `null`; setter true também exige risco já configurado. |
| C1.7 | Toggle de B reiniciar baseline/perda sem alterar saldo | `risk-boxes.ts:130-139` | Mantido; agora coberto por teste A3 dedicado. |
| C1.8 | Reconfigurar risco de B reiniciar a época de risco | `risk-boxes.ts:141-151` | Mantido e serializado. |
| C1.9 | Mudança de rede resetar acumuladores, sem zerar dinheiro | `risk-boxes.ts:160-176` | Mantido para impedir vazamento A3; limites continuam ativos nos dois ambientes. |
| C1.10 | Caixa A exigir retomada explícita após esgotar | `risk-boxes.ts:178-185` | Mantido via `resumeCaixaA()`; o gate agora consulta `esgotada`. |
| C1.11 | `investir=false` ser representado como risco efetivo zero após uma perda | `risk-boxes.ts:225-243` | **Inadequado.** Substituído por recusa ativa antes do swap (`authorizeRiskBoxTrade`). |
| C1.12 | Todo lucro realizado cair em B | `risk-boxes.ts:251-270` | Confirmado; centralizado em `recordRiskBoxEconomicResult()` (`risk-boxes.ts:279`). |
| C1.13 | Origem da caixa ficar fora do módulo/ordem | comentário anterior `risk-boxes.ts:37-43` | **Inviabilizava D1-D3.** `riskBox` agora atravessa proposta, sinal, ordem, posição e fechamento. |
| C1.14 | Teste recomendado com `--env-file=.env.local` | cabeçalho da suíte anterior | **Violava o mandato.** Suíte nova remove credenciais antes do import e ativa hook que bloqueia persistência (`risk-boxes.ts:286`). |

### Antes/depois das divergências C2

- Antes: `if (!state.isTestnet)` envolvia os dois cálculos. Depois: A e B avaliam os limites independentemente do ambiente.
- Antes: lucro adicional executava `baseline = saldo`. Depois: somente o primeiro lucro após saldo zero define baseline.
- Antes: `podeOperar()` não sabia qual caixa financiava a ordem. Depois: `authorizeRiskBoxTrade(box, amount)` exige origem e aplica o gate específico.
- Antes: testes podiam alcançar Upstash via `.env.local`. Depois: a suíte apaga as duas variáveis KV antes do import e o test hook torna `persist()` um no-op.

## Trilha D — correções e provas

### D1 — Caixa A esgotada bloqueia execução

- Gate: `lib/risk-boxes.ts:212-221`.
- Caminho individual: `lib/corretor.ts:155`, antes de `executeSwap()` em `lib/corretor.ts:171`.
- Batch: `lib/corretor.ts:380`, antes de preparação/aprovação.
- Prova comportamental: após 11% de perda contra limite de 10%, autorização retorna `caixa_a_exhausted`.

### D2 — B com investir=false bloqueia pré-swap

- `lib/risk-boxes.ts:223` retorna `caixa_b_investment_disabled`.
- O teste confirma recusa sem alterar o saldo; não usa mais uma perda posterior como aproximação de autorização.

### D3 — resultados alimentam as caixas pela origem

- Origem obrigatória no adapter: `lib/agent-framework/trading-adapter.ts:53-54`.
- Propagação: `lib/pregão.ts:46,68,563` e `lib/position-manager.ts:36,111,133`.
- Fechamentos automáticos preservam origem: `lib/agentes-do-pregão.ts:791,1659,1796` e `lib/trading-nanopayments.ts:185`.
- Resultado individual: `lib/corretor.ts:280`; falha com tx: `lib/corretor.ts:338`; batch: `lib/corretor.ts:615`.
- Lucro sempre vai para B; perda vai para a caixa de origem.

### D4 — A4b antes/depois

- Pré-fix: modelo vulnerável isolado captura o mesmo snapshot em duas operações concorrentes e grava o objeto inteiro; perdeu atualização em **30/30**.
- Pós-fix: lucro concorrente com reconfiguração no módulo real, protegido pela fila única, apresentou **0/30** inconsistências.
- O teste não afirma que a corrida “já estava corrigida”; ele prova primeiro o mecanismo vulnerável e depois a correção.

### D5 — isolamento de Redis

Causa raiz anterior: a suíte recomendava `npx tsx --env-file=.env.local`; `isKvConfigured()` então ficava verdadeiro e `persist()` chamava `getRedis().set()`.

Correção:

1. salvar e remover `KV_REST_API_URL`/`KV_REST_API_TOKEN` antes de importar `kv` e `risk-boxes`;
2. exigir `ARCFLOW_RISK_BOXES_TEST_MODE=1` para o reset;
3. manter `persistenceDisabledForTests=true` durante toda a suíte;
4. afirmar `isKvConfigured() === false` no início e no fim.

## Trilha E — modelo final

- Configuração atômica com validações de faixas e valores finitos.
- Estado versionado em memória/persistência.
- Origem A/B obrigatória; ausência não assume A e bloqueia fail-closed.
- A: perda acumulada / principal fixo; esgotamento bloqueia novos trades de A.
- B: toggle ativo, saldo suficiente e risco explícito; baseline fixo por época.
- B zerada não afeta A.
- Limites idênticos em mainnet e testnet.
- Posições abertas carregam `riskBox`, permitindo atribuição correta no fechamento.

## Confirmação RI-BANK-11

- Reset somente quando o modo realmente muda: `lib/circuit-breaker.ts:197,215`.
- Fila de serialização: `lib/circuit-breaker.ts:248-253`.
- `dailyLimitUsd` permanece `null` sem decisão D3: `lib/trading-budget.ts:19,29,35`.
- Gate e registro do orçamento existem: `lib/trading-budget.ts:94-102`.

Conclusão: o código descrito pelo RI-BANK-11 foi persistido no worktree.

## Resultados de validação

| Validação | Resultado |
|---|---|
| RI-BANK-12 estrutural/comportamental | PASS |
| A4b pré-fix isolado | 30/30 inconsistências reproduzidas |
| A4b pós-fix | 0/30 inconsistências |
| TradingAdapter unitário | PASS |
| `tsc --noEmit` | PASS |
| `npm run lint` | PASS com warnings preexistentes |
| `npm run build` | PASS — Next.js 15.5.19 |

## Limitação residual explícita

A fila resolve concorrência dentro do processo. O snapshot JSON no Redis ainda não oferece CAS/lock entre múltiplas instâncias serverless. Isso não foi necessário para os testes locais autorizados e nenhum cron/trading real foi ativado. Antes de execução distribuída real, a persistência deverá adotar controle atômico cross-instance.

## Arquivos do escopo

- `lib/risk-boxes.ts`
- `lib/security/ri-bank-12-risk-boxes-verification.test.ts`
- `lib/agent-framework/trading-adapter.ts`
- `lib/agent-framework/trading-adapter.test.ts`
- `lib/pregão.ts`
- `lib/corretor.ts`
- `lib/position-manager.ts`
- `lib/agentes-do-pregão.ts`
- `lib/trading-nanopayments.ts`
- `ARCFLOW.md`

Nenhum trade real ou de teste foi executado.
