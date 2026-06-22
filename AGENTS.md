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

## Session Summary (22/06/2026)

### What's Changed
1. **Profit streak não destruído por compras** — `lib/corretor.ts`: `isBuyOpening` skipa `accountant.addReport()` + `processarRecompensa()` + `circuitBreaker.recordTrade()` quando é compra (stable→volátil)
2. **minViableTrade dinâmico** — `lib/agentes-do-pregão.ts:1098`: `getMinTradeSize(pairNet)` retorna $2 (não-ETH) em vez de hardcoded $5
3. **Wallet balance priority** — `lib/agentes-do-pregão.ts:328`: `Math.max(walletBalance, unifiedBalance)` quando wallet real > Circle Kit balance
4. **RPC Proxy** — `app/api/rpc-proxy/route.ts` + `_createProxyProvider()`: todas RPCs via proxy Next.js (CORS)
5. **LI.FI Quote Proxy** — `app/api/lifi/quote/route.ts`: proxy GET para `li.quest/v1/quote` (CORS)
6. **refreshAllBalances** — provider fresco + cascata RPC fallback (llamarpc, polygon-rpc, maticvigil, MetaMask)
7. **CCTP bridge** — usa `caixa.getSaldo()` (cache 10s) em vez de `unifiedBalance` direto
8. **jumper-learn** — `/api/narrator/learn` proxy (CORS)
9. **PregãoDashboard** — inline `PREGUEIROS_DISPLAY` (HMR fix)
10. **caixa.ts** — cache 10s `getSaldo()`
11. **escriturario** — `switchNetwork()` + unified balance fallback em mainnet
12. **pregão** — `okAgentes` sorted by confidence >= 30%
13. **entryPrice corrompido corrigido** — `agentes-do-pregão.ts:1236`: quando `profitPercent > 100%`, recalcula `entryPrice = amountPaid / amountBought` (swap real), salva posição corrigida via `positionManager.savePositions()`

### Current State
- **Polygon Mainnet**: wallet $23.30 USDC, $2.085 POL. Bot rodando com LI.FI proxy (CORS resolvido). 25 trades executados, $116.95 bruto / ~$18.77 líquido. entryPrice corrigido automaticamente.
- **Arc Testnet**: rodando mas perdendo $0.015/trade em USDC→EURC (spread come lucro).
- **CCTP Bridge**: ainda não testado com sucesso
- **LI.FI**: `Failed to fetch` resolvido com proxy `/api/lifi/quote`
- **Ver deploy automático no Vercel****
