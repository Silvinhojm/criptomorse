# Registro de Incidentes Técnicos — CriptoMorse

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
