# RI-BANK-13 — Relatório final de execução (Codex)

Data: 31/07/2026  
Repositório: `C:\Users\silvi\arcflow`  
Escopo: persistência/concorrência de `risk-boxes.ts` e `trading-budget.ts`; nenhum trade.

## Resultado em destaque

1. **Confirmação:** sim, `trading-budget.ts` tinha a mesma classe de corrida entre instâncias que `risk-boxes.ts`. `recordTradingSpend()` somava no estado local e `persist()` regravava `spentToday` calculado a partir daquele snapshot. Duas instâncias podiam perder um dos incrementos.
2. **Prova antes/depois segura:** o padrão vulnerável perdeu atualizações em **30/30** tentativas. Com dois clientes independentes e servidor compartilhado em memória, a correção preservou **100/100** incrementos do orçamento e **100/100** lucros da Caixa B, com **0 inconsistências** e versões únicas.
3. **Mecanismo:** deltas usam `HINCRBYFLOAT`, seguindo `cbCounterOp`. As caixas usam um script Lua Redis atômico, equivalente a uma transação otimista sem janela de retry no cliente, porque uma única mutação precisa preservar simultaneamente saldo, perda, baseline, esgotamento e versão. Configurações do orçamento usam `HSET` somente dos campos pertencentes à operação.

## 1. Diagnóstico por leitura de código

O circuit breaker já usa operações de delta no Redis (`HINCRBY`/`HINCRBYFLOAT`), evitando o ciclo read-modify-write.

Antes do RI-BANK-13:

- `trading-budget.ts`: `state.spentToday += amountUsd` seguido de `HSET` do Hash inteiro;
- `risk-boxes.ts`: mutação do estado local seguida de `SET JSON.stringify(state)`;
- a fila de `risk-boxes.ts` protegia apenas chamadas no mesmo processo;
- duas invocações serverless independentes não compartilhavam a fila e podiam sobrescrever alterações.

Classificação dos campos:

| Tipo | Campos |
|---|---|
| Delta/cumulativo | `spentToday`, `a.perdaAcumulada`, `b.perdaAcumulada`, `b.saldo` |
| Configuração/substituição | `dailyLimitUsd`, `lastResetAt`, `a.valorPrincipal`, riscos A/B, `b.investir`, `isTestnet` |
| Derivado/acoplado | `a.esgotada`, `b.baseline`, `version` |

## 2. Implementação

### Trading budget

- `recordTradingSpend()` aplica o delta com `HINCRBYFLOAT`.
- `setTradingBudgetDaily()` altera somente `dailyLimitUsd`.
- `resetTradingBudgetManual()` altera somente `spentToday` e `lastResetAt` em um comando.
- Nenhum valor real de `dailyLimitUsd` foi definido e nenhum reset automático foi criado.

### Caixas de risco

Foi criado `lib/risk-boxes-redis.ts` com dois scripts:

- inicialização/migração atômica de JSON legado para Hash;
- mutação atômica por operação, incluindo deltas, invariantes e incremento de `version`.

O script usa `HINCRBYFLOAT` para deltas e atualiza os campos dependentes no mesmo comando Lua. Assim, lucro/perda concorrente com reconfiguração equivale a alguma ordem serial válida, sem lost update.

`authorizeRiskBoxTradeFresh()` lê o Hash antes do gate pré-swap. Falha de Redis é propagada, mantendo comportamento fail-closed.

As decisões financeiras do RI-BANK-12 foram preservadas: A/B independentes; lucros para B; perdas para a caixa de origem; B com baseline fixo; limites iguais em testnet/mainnet; configuração inválida bloqueia.

## 3. Testes e resultados

### RI-BANK-12 integral

Arquivo anexado neste pacote: `ANEXO-RI-BANK-12-risk-boxes-verification.test.ts`.

Resultado:

```text
[STRUCTURAL] gates A/B e alimentação econômica presentes no caminho real.
[A4b BEFORE] atualização perdida em 30/30.
[A4b AFTER] inconsistência em 0/30.
ALL_RI_BANK_12_RISK_BOXES_VERIFICATION_ASSERTIONS_PASSED=YES
```

### RI-BANK-13 — alternativa autorizada em memória/mock

Dois objetos-client independentes apontam para o mesmo servidor simulado; os clientes não compartilham fila. Somente o servidor serializa os comandos atômicos, reproduzindo a fronteira relevante.

```text
[CROSS_INSTANCE SAFE BEFORE] atualização perdida em 30/30.
[CROSS_INSTANCE SAFE AFTER] trading-budget=100/100; risk-boxes=100/100; inconsistências=0.
ALL_RI_BANK_13_CROSS_INSTANCE_MEMORY_ASSERTIONS_PASSED=YES
```

### Redis real — preparado, não executado

`ri-bank-13-cross-instance-redis.test.ts` cria dois clientes Upstash independentes, usa somente chaves aleatórias `arcflow:ri-bank-13:test:*` e as remove no `finally`.

A execução foi solicitada, mas recusada pelo controle de segurança porque `EXECUTION_AUTHORIZED=NO` no cabeçalho limita testes a memória/mock. Não houve tentativa de contorno e nenhuma chave externa foi criada. Apesar de o Estágio 3 pedir Redis real, a restrição explícita de execução prevaleceu. A compatibilidade do Lua com o Upstash conectado permanece validação pendente até autorização explícita.

## 4. Validação técnica

| Verificação | Resultado |
|---|---|
| `npx tsc --noEmit` | aprovado, zero erros |
| RI-BANK-12 | aprovado |
| RI-BANK-13 memória/dois clientes | aprovado |
| `npm run lint` | aprovado; warnings preexistentes |
| `npm run build` | aprovado; build Next.js completo |
| Redis externo | não executado por restrição do mandato |
| Trades/cron/wallet | não executados |

## 5. Arquivos alterados/criados neste mandato

- `lib/risk-boxes-redis.ts` — coordenação atômica e migração;
- `lib/risk-boxes.ts` — persistência Hash/Lua e gate fresh;
- `lib/trading-budget.ts` — incrementos e writes de campo atômicos;
- `lib/corretor.ts` — gate fresh antes de swap/batch;
- `lib/kv.ts` — documentação da chave;
- `lib/security/ri-bank-12-risk-boxes-verification.test.ts` — assert estrutural atualizado para o gate fresh;
- `lib/security/ri-bank-13-cross-instance-memory.test.ts` — prova segura executada;
- `lib/security/ri-bank-13-cross-instance-redis.test.ts` — prova real isolada preparada;
- `ARCFLOW.md` — arquitetura e limitação documentadas.

## 6. Observação de Git

O worktree já continha muitas alterações não commitadas de mandatos anteriores, inclusive nos mesmos fluxos. Para não misturar nem assumir autoria dessas mudanças, este mandato não criou commit nem fez push. O pacote registra os arquivos e resultados para revisão do Claude.

