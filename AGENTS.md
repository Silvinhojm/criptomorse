<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:arcflow-rules -->
# ARCFLOW — Regras para IAs

1. **LEIA `ARCFLOW.md` PRIMEIRO** — contém o mapa completo do sistema, parâmetros, arquitetura e fluxos. Não modifique código sem consultá-lo.

2. **Mantenha a documentação atualizada** — toda alteração em parâmetros, novos módulos, mudanças de fluxo ou adição de tokens deve refletir em `ARCFLOW.md`. Se a IA não fizer isso automaticamente, o desenvolvedor vai pedir.

3. **Nunca duplique COIN_IDS** — ao adicionar um token, atualize em TODOS os 5 lugares (listados na seção 14 do ARCFLOW.md).

4. **Persistência primeiro** — qualquer estado que deve sobreviver a F5 precisa de localStorage com chave `arcflow_*`. Documente no ARCFLOW.md seção 5.

5. **Staircase sempre vende pra USDC** — o fechamento automático sempre gera ordem vendendo o token volátil → USDC, independente de como foi comprado.
<!-- END:arcflow-rules -->

- Ao verificar estado do sistema, commit alterações no ARCFLOW.md e no código e faça push

## Session Summary (21/06/2026)

### What's Changed
1. **Multi-chain volatile-only filter** — `agentes-do-pregão.ts:342`: filtro `VOLATEIS` (WETH, WBTC, WMATIC, ARB, cirBTC, mcirBTC) aplicado em multi-chain mode
2. **Skip minViableTrade for micro-trades** — `agentes-do-pregão.ts:1009`: pula o cálculo de trade mínimo quando `valorFinal < $5` (gas $0.08 na Polygon é trivial)
3. **OrdemExecucao carries amountUsd** — `pregão.ts` interfaces `OkSignal` + `OrdemExecucao` ganharam campo `amountUsd?`; `escriturario.ts` usa `ordem.amountUsd` em vez de `saldo * 0.9`; removeu o `$5` fixo duplicado (executeSwap já check com `$2`)
4. **okAgentes sorted by confidence** — `pregão.ts:160-165`: ordena agentes por confiança decrescente e filtra >= 30% antes de selecionar participantes (evita que BTCTrader 28% + primeiro agente qualquer dê média < 40%)
5. **Auto-reabastecimento** — `agentes-do-pregão.ts:315-330`: quando `saldoEfetivo < minTradeSize` e existem posições abertas com saldo on-chain, injeta 3 OKs de venda (Cleanup, ForcarVenda, MeanReversion) com 90% de confiança e retorna cedo

### Current State
- **Arc testnet**: funcionando (single-network, todos os pares)
- **Polygon Mainnet**: bot fez 6 trades reais ($18.77 lucro), consumiu todo USDC. Agora com auto-reabastecimento deve vender WMATIC/WETH automaticamente
- **CCTP Bridge**: ainda não testado com sucesso (RPC rate limiting pode estar bloqueando)
- **Ver deploy automático no Vercel**
