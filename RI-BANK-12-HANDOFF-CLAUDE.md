# RI-BANK-12 — Handoff Codex → Claude

Data: 2026-07-31

## Ordem de leitura

1. `01-RI-BANK-12-MANDATO-ORIGINAL.txt`
2. `02-RI-BANK-12-STAGE-1-REPORT-CODEX.md`
3. `03-RI-BANK-12-ESTAGIO-2-MANDATO.txt`
4. `04-RI-BANK-12-STAGE-2-EXECUTION-REPORT-CODEX.md`
5. `05-ARCFLOW.md` — especialmente a seção 59
6. `codigo/lib/risk-boxes.ts`
7. `codigo/lib/security/ri-bank-12-risk-boxes-verification.test.ts`
8. Demais arquivos em `codigo/` para conferir a integração.

## Estado entregue

- Modelo A/B implementado com configuração atômica e fail-closed.
- `riskBox: "A" | "B"` obrigatório no TradingAdapter e novamente validado no Corretor.
- Caixa A esgotada e Caixa B com `investir=false` bloqueiam antes do swap.
- Lucro realizado vai para B; perda é debitada da caixa que financiou o trade.
- B usa baseline fixo, não high-water mark.
- Mesmos limites em mainnet e testnet.
- Posições preservam `riskBox` para o fechamento.
- Suíte sem `.env.local`, rede ou Redis.
- A4b: 30/30 falhas na reprodução vulnerável; 0/30 depois da serialização.
- TypeScript, lint e build passaram. Lint contém warnings preexistentes.
- Nenhum trade real ou de teste foi executado.

## Atenção antes de continuar

- O worktree original está muito sujo e contém mudanças de várias trilhas. Não houve commit/push para evitar misturar alterações preexistentes.
- Algumas modificações RI-BANK-12 estão em arquivos que também contêm trabalho anterior não relacionado. Compare com cuidado antes de commitar.
- A fila de mutações protege concorrência dentro do processo. O snapshot JSON no Redis ainda não tem CAS/lock entre instâncias serverless.
- Ordens/posições legadas sem `riskBox` são bloqueadas propositalmente; não assumir Caixa A como padrão.
- `dailyLimitUsd` permanece `null`, aguardando decisão D3 do RI-BANK-10.

## Arquivos copiados

- Relatórios e mandatos RI-BANK-12.
- `ARCFLOW.md` atualizado.
- Núcleo `risk-boxes.ts` e suíte dedicada.
- Integração em TradingAdapter, Pregão, Corretor, PositionManager, agentes e TradingNanopayments.
- Dependências de contexto `kv.ts`, `trading-budget.ts` e `circuit-breaker.ts`.

Este pacote é uma cópia para leitura. Os arquivos de trabalho continuam em `C:\Users\silvi\arcflow`.
