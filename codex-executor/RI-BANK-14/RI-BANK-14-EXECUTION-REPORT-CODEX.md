# RI-BANK-14 — Relatório final de execução (Codex)

Data: 31/07/2026  
Status: **APROVADO**  
Execução financeira: **nenhuma**

## Resultado em destaque

1. **Estágio 1:** o circuit breaker global continua conectado ao settlement real. `recordTradeResult()` é aguardado no fluxo individual (`lib/corretor.ts:286`), na perda estimada com transação e no batch (`lib/corretor.ts:617`). A introdução das caixas não o tornou órfão.
2. **Orçamento diário:** `$50`, definido por `INITIAL_TRADING_BUDGET_DAILY_USD` em `lib/trading-budget.ts:37`. `initializeTradingBudgetDailyLimit()` (`:109`) só chama a configuração atômica quando o campo ainda está null, preservando qualquer valor posterior.
3. **Teto por trade:** `$15` para A e B em `lib/risk-boxes.ts:59`; a checagem está em `:273–274` e bloqueia com `trade_amount_exceeds_per_trade_cap`. O setter dedicado permite reconfiguração.
4. **Backstop global:** `60%` em `lib/circuit-breaker.ts:129`, também aplicado nas transições mainnet/testnet em `:228` e `:232`. Testnet espelha o valor, embora o bloco de drawdown continue desativado nesse modo.

## Implementação

### Orçamento de `$50`

Foi escolhida inicialização protegida, não um valor regravado a cada start:

- o estado ainda nasce `null`, distinguindo “não inicializado” de “configurado”;
- antes do gate diário, o Corretor chama `initializeTradingBudgetDailyLimit()` (`lib/corretor.ts:147`);
- sem Redis, o valor é preenchido apenas se null;
- com Redis, um script Lua faz `HGET` + `HSET` somente se ausente/vazio, atomicamente;
- valores já configurados não são sobrescritos;
- reset permanece exclusivamente manual.

### Teto configurável de `$15`

`perTradeCapUsd` faz parte do estado das caixas e do Hash Redis. `HSETNX` adiciona `$15` a hashes existentes sem substituir configuração. `setRiskBoxesPerTradeCap()` permite alteração explícita. O gate comum ocorre depois da validação do valor e antes dos ramos A/B, logo a mesma regra vale para ambos.

O caminho real usa `authorizeRiskBoxTradeFresh()` antes do primeiro swap individual (`lib/corretor.ts:156`) e para cada item do batch (`:381`).

### Backstop de `60%`

O comentário do código registra o novo papel: as caixas são a primeira linha de defesa e o drawdown global fica acima do risco máximo configurável de B (`50%`). O gatilho separado de perdas consecutivas foi preservado; este mandato alterou apenas o drawdown global solicitado.

## Testes

### RI-BANK-14

```text
[STRUCTURAL] teto A/B e orçamento precedem swap; circuit breaker segue conectado ao settlement.
[BEHAVIORAL] A/B: $15 permitido; $15.01 bloqueado; teto configurável confirmado.
[BEHAVIORAL] orçamento diário $50 acumulou 25+25 e bloqueou valor adicional.
[BEHAVIORAL] circuit breaker: 20% não dispara; 60% dispara o backstop global.
ALL_RI_BANK_14_D3_ASSERTIONS_PASSED=YES
```

### Regressões

- RI-BANK-11 orçamento: aprovado com `$50`, inicialização idempotente e reset manual.
- RI-BANK-11 drawdown: aprovado após atualização integral de `10%` para `60%`; `59%` não dispara e `61%` dispara.
- RI-BANK-12 caixas: aprovado, incluindo corrida `30/30 → 0/30`.
- `npx tsc --noEmit`: aprovado, zero erros.
- `npm run lint`: aprovado; warnings preexistentes.
- `npm run build`: aprovado; build Next.js completo.

Todos os testes foram executados sem credenciais Redis. Nenhum trade, cron, wallet ou rede externa foi acessado.

## Isolamento do fallback local

Na primeira execução da nova suíte, foi identificado que `circuit-breaker.ts` usa `.data/circuit-breaker-state.json` quando Redis está ausente. A suíte foi corrigida para copiar e restaurar esse arquivo no `finally`. O estado de pânico produzido pela primeira execução foi removido e o fallback local ficou neutro (`isPanicActive=false`, contadores zero, limite `60%`). A repetição confirmou aprovação e restauração do arquivo.

## Arquivos alterados

- `lib/circuit-breaker.ts`
- `lib/trading-budget.ts`
- `lib/risk-boxes.ts`
- `lib/risk-boxes-redis.ts`
- `lib/corretor.ts`
- `lib/security/ri-bank-14-d3-verification.test.ts`
- `lib/security/ri-bank-11-trilha-a-drawdown-verification.test.ts`
- `lib/security/ri-bank-11-trilha-b-trading-budget.test.ts`
- `ARCFLOW.md`

## Git

Não foi criado commit nem push: o worktree já continha muitas alterações não commitadas de mandatos anteriores, inclusive nos mesmos arquivos. Um commit seletivo incluiria trabalho preexistente sem autoria isolável.

