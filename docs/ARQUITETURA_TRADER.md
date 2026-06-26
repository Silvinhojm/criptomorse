# Arquitetura do CriptoMorse — Automated Trading System

## 1. Stack
- **Frontend**: Next.js (React) com TypeScript
- **Blockchain**: Polygon Mainnet (real) + Arc Testnet
- **Wallet**: Auto-sign via private key (sem MetaMask)
- **Preços**: SoSoValue API (`openapi.sosovalue.com`, 20 req/min free)
- **DEX**: QuickSwap (Polygon), Uniswap V2 (Ethereum), Aerodrome (Base), SushiSwap (Arbitrum)
- **LI.FI**: Rota alternativa quando DEX direto não tem liquidez
- **Batch**: Multicall3 (UltraFlash) para executar múltiplos swaps numa transação

## 2. Redes
| Rede | Status | Moeda | Gas | Trade mínimo |
|------|--------|-------|-----|-------------|
| Polygon Mainnet | Produção | POL | ~$0.004 | $6.50 |
| Arc Testnet | Teste | ARC (grátis) | ~$0.004 | $2.00 |
| Base | Futuro | ETH | — | $2.00 |
| Arbitrum | Futuro | ETH | — | $2.00 |
| Ethereum | Futuro | ETH | ~$1-5 | $50.00 |

## 3. Agentes (Robôs de Análise)
17 agentes ativos, cada um analisa pares e vota com confiança (0-100%):

**Análise Técnica**: Technical, TrendFollower, MeanReversion, MomentumTrader  
**Sentimento**: Sentimento, Volume, Tendência  
**Quantitativo**: Quantum, QuantumTrader, ArbitrageHunter  
**Especialistas**: BTCTrader, NVIDIAgent, Synthesis, MarketMaker, Liquidator  
**Pregueiros**: Tático, ArcBandit:1/2/3  
**Híbridos**: Morse

Cada agente tem:
- `score` (sistema Elo, pool 500pts)
- `winRate` (% acertos)
- `totalTrades`
- Pontuação por desempenho (ranking do Professor)

## 4. Ciclo de Trading (a cada 30s)

```
1. limparOrdensTravadas()    → limpa ordens presas >5s
2. executarCicloPregueiros() → pregueiros votam nos pares
3. executarCicloAgentes()    → agentes votam → consenso → cria ordens
4. professor.gerarPacotes()  → empacota ordens pendentes por rede
5. pregão.executarPacotes()  → UltraFlash batch (1 tx = N swaps)
```

## 5. Pipeline de Execução

### Entrada: Ordens do Pregão
Agentes votam → consenso mínimo (≥2 agentes ou 1 agente + 1 pregueiro) → `receberOK()` cria `OrdemExecucao`

### Processamento (mainnet — batch)
```
OrdemExecucao → Escriturário → "pronto" → Professor.gerarPacotes()
  ↓
Pacote { rede, trades: [{from, to, amount, ordemId}] }
  ↓
Pregão.executarPacotes()
  ↓
_quoteTrade() paralelo (DEX + LI.FI concorrentes, timeout 5s)
  ↓
batchApprove() + executeBatch() → Multicall3 → 1 transação
  ↓
Por swap no resultado:
  - Compra volátil → positionManager.openPosition()
  - Venda volátil → positionManager.closePosition() ← DELTA NEUTRO
```

### Processamento (testnet/Arc — direto)
```
OrdemExecucao → Escriturário → Corretor → Swap individual
```
Arc ignora thresholds de lucro/gas para gerar operações constantes.

## 6. Delta Neutro — O Coração do Sistema

### Conceito
Cada pacote agrupa **todas as ordens pendentes de uma rede**. Se houver compra E venda do mesmo token no mesmo ciclo, ambos vão no mesmo pacote executado atomicamente:

```
Pacote da Polygon:
  Trade 1: USDC → WMATIC  (compra, abre posição)
  Trade 2: WMATIC → USDC   (venda, fecha posição anterior)
```

### Fluxo temporal (exemplo com WMATIC)

**T+0min** — Pacote #1:
- Compra WMATIC por $7.80 → posição aberta a $0.0721

**T+5min** — WMATIC não moveu (break-even):
- Pacote #2 contém:
  - VENDE 48.5 WMATIC (fecha posição #1 a $0.0721) → $0.00 lucro
  - COMPRA WMATIC por $7.80 (abre posição #2 a $0.0721)
- Efeito: posição renovada, timer resetado

**T+10min** — WMATIC subiu 0.5%:
- Pacote #3 contém:
  - VENDE 48.5 WMATIC (fecha posição #2 a $0.0725) → +$0.02 lucro
  - NÃO compra (aguarda queda pra recomprar)
- Lucro realizado: $0.02 (gas ~$0.01, líquido $0.01)

**T+15min** — WMATIC caiu 0.3%:
- Pacote #4:
  - COMPRA WMATIC por $7.80 (abre posição #3 a $0.0718)
- Novo ciclo recomeça

### Resultado esperado
- Em mercado lateral: pequenos ganhos no spread (0.1-0.5% por ciclo)
- Em tendência: um lado sempre lucra, o outro espera reversão
- Perda máxima por posição: 15% (stop loss) ou ~$0.10 se fechar em 5min
- Posições NUNCA ficam presas mais que 5min (stale force close)

## 7. Gerenciamento de Capital

### Mainnet
- Saldo atual: ~$10 USDC na Polygon
- Trade size: `min(saldo * 0.25, $7.80)` — cerca de $7.80
- Max posições simultâneas: 2 (calculado de `floor(saldo * 0.9 / $6.50)`)
- Stale close: 5min incondicional
- Stop loss: -15%

### Testnet
- Saldo atual: ~$1,100 USDC + €300 EURC na Arc
- Trade size: $4.50 (fixo por ser testnet)
- Thresholds: ignorados (sempre executa)
- Stale close: 1min

## 8. Staircase (Escada de Lucro)

Quando uma posição está com lucro:
- Threshold mínimo: lucro líquido ≥ $0.01 (cobre gas + spread)
- Se lucro > 0, verifica se está acima do custo de venda (gas + 0.5% spread)
- Fecha automaticamente quando lucro líquido positivo
- Staircase NÃO segura posição sem lucro por mais de 5min

## 9. Circuit Breaker
- Ativa após 5 perdas consecutivas
- Ativa após 10% de drawdown do pico
- Bloqueia TODOS os trades até reset manual
- Reset automático no F5 (testnet) / manual (mainnet)

## 10. Questões em Aberto para Outras IAs

### Q1 — Concentração de Capital
Com $10 de saldo, só cabe 1-2 posições. Se o mercado lateralizar, o lucro por pacote (~$0.01) mal cobre gas (~$0.004). **Vale a pena operar com capital tão baixo?**
- Sugestão: depósito mínimo de $50-100 para gas ser irrelevante?
- Ou micro-trades em testnet até estratégia provar lucro consistente?

### Q2 — Delta Neutro vs Direcional
O delta neutro funciona bem em mercado lateral (compra na baixa, venda na alta). Mas em tendência forte, você sempre fecha a posição contrária no prejuízo.
- **Dúvida**: deveria haver um detector de tendência que PAUSA um dos lados? Ex: se WMATIC subiu 3% em 1h, só comprar (não vender)?
- Ou o delta neutro deve ser mantido 100% do tempo como hedge?

### Q3 — Arc Testnet: Operações Constantes
Arc ignora thresholds e executa tudo. Mas USDC→EURC perde ~$0.01 por swap (spread). Com $1.100 isso é $0,09% — aceitável para testar infraestrutura.
- **Dúvida**: devemos usar LI.FI ou DEX direto na Arc? LI.FI cobra taxa, DEX direto precisa de liquidez no pool. Qual dá menos slippage?

### Q4 — Multicall3 vs Execução Sequencial
UltraFlash executa N swaps numa transação. Economiza gas mas o batch falha INTEIRO se UM swap reverter.
- **Dúvida**: devemos agrupar swaps relacionados (ex: compra+venda do mesmo token) em batches separados? Para falha de um não matar o outro?
- Ou manter tudo no mesmo batch (atomicidade é desejável)?

### Q5 — Prioridade: Polygon vs Arc
Arc testnet não dá lucro real. Polygon mainnet tem $10 só.
- **Dúvida**: onde focar o desenvolvimento agora?
  - A) Depositar $50-100 na Polygon e operar a sério
  - B) Continuar testando na Arc até estratégia estar madura
  - C) Adicionar mais redes (Base, Arbitrum) para diversificar

### Q6 — Os Agentes Estão Aprendendo?
Agentes têm winRate 0% e scores negativos porque NUNCA fecharam um trade lucrativo. O Professor ajusta parâmetros mas sem trades reais não há aprendizado.
- **Dúvida**: com capital tão baixo, os agentes conseguem acumular histórico relevante? Ou precisamos de capital maior para gerar dados de treinamento?

## 11. Arquivos Relevantes

```
lib/agentes-do-pregão.ts   → Ciclo principal, votos, consenso, thresholds
lib/pregão.ts              → OrdemExecucao, receberOK(), executarPacotes()
lib/escriturario.ts        → Prepara ordens, roteia mainnet/testnet
lib/corretor.ts            → Execução individual de swaps
lib/professor.ts           → gerarPacotes(), avaliação de agentes
lib/setor-pacotes.ts       → TradeIntent, Pacote, fila por rede
lib/position-manager.ts    → Posições abertas, Staircase, stale close
lib/real-swap-executor.ts  → executeSwap(), NETWORKS, TRADING_PAIRS
lib/ultraflash.ts          → Multicall3: batchApprove() + executeBatch()
lib/direct-dex.ts          → DEX routers (QuickSwap, Uniswap, etc)
lib/lifi-executor.ts       → LI.FI quote + swap
lib/circuit-breaker.ts     → Controle de pânico
lib/sosovalue-price-agent.ts → Preços via SoSoValue API
```
