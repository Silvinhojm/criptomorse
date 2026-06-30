# ArcFlow — Sistema Multi-Agente de Trading Autônomo

> Plataforma de trading algorítmico multi-chain com 13 agentes de IA operando em consenso, executando swaps reais em Polygon, Arc, Base e Ethereum. Também conhecido como **CriptoMorse**.

![Next.js](https://img.shields.io/badge/Next.js-15.5-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript)
![ethers.js](https://img.shields.io/badge/ethers.js-v6-purple)
![Arc Testnet](https://img.shields.io/badge/Arc-Testnet-green)
![Polygon](https://img.shields.io/badge/Polygon-Mainnet-8247e5)

---

## O que é

ArcFlow é uma plataforma de trading automatizado onde múltiplos agentes de IA votam em oportunidades de mercado, formam consenso, e executam swaps reais na blockchain — tudo de forma autônoma, sem intervenção humana.

O sistema opera como um **pregão de bolsa digital**: cada agente analisa o mercado com sua própria estratégia, emite votos com grau de confiança, e o Pregão central consolida o consenso antes de autorizar qualquer execução. Um módulo **Professor** avalia cada decisão após o fato, ajustando os parâmetros de cada agente individualmente com base no histórico de acertos.

---

## Arquitetura

```
Agentes (13) → Pregão → Escriturário → Capital Controller → Corretor → Blockchain
     ↑                                                                    ↓
  Professor ←←←←←←← Accountant + Position Manager ←←←←←←←←←←←←←←←←←←←
     ↓
  Escola de Robôs (ranking + promoção + turnos de 10min)
```

### Módulos Principais

| Módulo | Descrição |
|--------|-----------|
| **Pregão** | Livro de ordens central, matching de OKs, formação de consenso |
| **Escriturário** | Valida saldo, dimensiona valor, previne concorrência de par |
| **Corretor** | Executa swaps via DEX direto (SushiSwap/Uniswap) + LI.FI aggregator |
| **Professor** | Avalia acertos/erros, ajusta parâmetros por agente, cache em localStorage |
| **Escola de Robôs** | Ranking, turnos de 10min, promoção de agentes com base em performance |
| **Capital Controller** | Gate central FIFO: 1 trade por vez, fila ordenada por score |
| **StableMR** | Mean-reversion em pares EURC/USDC com PiFilter Gaussiano |
| **Modo Grão** | Scalping de stablecoins com batching de sinais MR+MM |
| **Oscillation Hunter** | Micro-scalping em pools Uniswap V3 profundas (USDC/USDT 0.01%) |
| **Grid Trading** | Grid adaptativo com 15 níveis, deriva de preço e Red Line |
| **PiFilter** | Filtro Gaussiano com warmup de 18 amostras para detecção de sinal em ruído DEX |
| **Arc Training** | Treinamento autônomo dos agentes na Arc Testnet com snapshots |
| **Circuit Breaker** | Proteção contra perdas consecutivas (3 strikes) |
| **Gas Price Oracle** | Custo de gas em USD com fallback multi-RPC |
| **Pair Price Feed** | Preços em tempo real via SoSoValue + Stork Oracle on-chain |

### Agentes de Trading

`Quantum` · `Technical` · `TrendFollower` · `MeanReversion` · `QuantumTrader` · `ArbitrageHunter` · `MarketMaker` · `BTCTrader` · `Liquidator` · `MomentumTrader` · `NVIDIAgent` · `Synthesis` · `ArcBandit (×3)`

Cada agente tem parâmetros individuais (confiança mínima, threshold de entrada, viés de direção) ajustados automaticamente pelo Professor. Os 3 melhores em cada ciclo de 10 minutos têm suas decisões aceitas sem exigir consenso dos demais.

---

## Contratos Deployados

### Arc Testnet

| Contrato | Endereço | Explorer |
|----------|----------|----------|
| AgentIdentity (ERC-8004) | `0xd2a801e60a0ab36da3fb17d4a7654b494ba8326b` | [ArcScan](https://testnet.arcscan.app/address/0xd2a801e60a0ab36da3fb17d4a7654b494ba8326b) |
| AgenticCommerce (ERC-8183) v1 | `0x319227cf1de5c61d11313af8226a8f5309fa70d9` | [ArcScan](https://testnet.arcscan.app/address/0x319227cf1de5c61d11313af8226a8f5309fa70d9) |
| AgenticCommerce (ERC-8183) v2 | `0x0747EEf0706327138c69792bF28Cd525089e4583` | [ArcScan](https://testnet.arcscan.app/address/0x0747EEf0706327138c69792bF28Cd525089e4583) |
| AMM USDC/EURC (GenericAMMPair) | `0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb` | [ArcScan](https://testnet.arcscan.app/address/0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb) |

### Base Mainnet

| Contrato | Endereço | Explorer |
|----------|----------|----------|
| AgentIdentity (ERC-8004) | `0xaeb95e2532a73a097e03584cb244eeca9b5609a5` | [BaseScan](https://basescan.org/address/0xaeb95e2532a73a097e03584cb244eeca9b5609a5) |
| AgenticCommerce (ERC-8183) | `0x0747EEf0706327138c69792bF28Cd525089e4583` | [BaseScan](https://basescan.org/address/0x0747EEf0706327138c69792bF28Cd525089e4583) |

### Polygon Mainnet

| Contrato | Endereço | Explorer |
|----------|----------|----------|
| AgenticCommerce (ERC-8183) | `0x0747EEf0706327138c69792bF28Cd525089e4583` | [PolygonScan](https://polygonscan.com/address/0x0747EEf0706327138c69792bF28Cd525089e4583) |

### Ethereum Mainnet

| Contrato | Endereço | Explorer |
|----------|----------|----------|
| AgenticCommerce (ERC-8183) | `0x0747EEf0706327138c69792bF28Cd525089e4583` | [Etherscan](https://etherscan.io/address/0x0747EEf0706327138c69792bF28Cd525089e4583) |

### Wallet de operação

`0x77f5C3A1079B86ef8490E7c5Ec1F9bcfbaAE5894` — ativa na Arc desde outubro de 2025

> JobProof não tem endereço fixo — é deployado dinamicamente pelo JobRobot a cada ciclo de stress na Arc.
> MicroPool.sol é conceitual (MVP), não deployado.

---

## Padrões Implementados

| Padrão | Descrição | Status |
|--------|-----------|--------|
| **ERC-8004** | Identidade on-chain de agentes autônomos | ✅ Deployado (Arc + Base) |
| **ERC-8183** | Escrow de jobs para economia agentic | ✅ Deployado (Arc, Base, Polygon, Ethereum) |
| **EIP-7702 / ERC-4337** | Account abstraction nativa da Arc (gasless) | Suportado pela rede |
| **CCTP v2** | Bridge USDC entre chains via Circle | ✅ Integrado |
| **Stork Oracle** | Preços on-chain via pull oracle | ✅ Integrado (Arc) |
| **x402** | Protocolo de micropagamentos para agentes | 🔄 Planejado |

---

## Estratégias de Trading

### StableMR (Mean Reversion)
Mean-reversion em pares EURC/USDC com SMA rolante de 12 amostras. Threshold de 0.10% (2σ do spread típico DEX). DEX fee de 0.3% aceita como custo de entrada — o lucro vem da reversão. Amount dinâmico: `max($12, |dev| × 5000)`. Fallback automático V2 quando V3 sem pools.

### Modo Grão (Batch Trading)
Batching de sinais MeanReversion + MarketMaker em stablecoins. Acumula 3–5 sinais antes de executar um swap único maior, amortizando o custo de gas. Usa PiFilter Gaussiano (motor estocástico com warmup de 18 amostras, σ threshold ±1.5, noiseProbability bilateral) para filtrar ruído de mercado.

### Oscillation Hunter
Micro-scalping em pools Uniswap V3 de alta liquidez (USDC/USDT 0.01% fee, $2M+ TVL). Detecta desvios >0.20% da SMA com confirmação de reversão. Take-profit 0.15%, stop-loss −0.10%, timeout 5 minutos.

### Grid Adaptativo
Grid com 15 níveis e espaçamento dinâmico baseado na volatilidade do token com EMA. Drift suave quando preço deriva; Red Line quando preço escapa 2.2× o nível externo. Auto-rebalance: nível executado cria complemento no lado oposto. 1 nível por direção por ciclo.

### Multi-armed Bandit (Arc)
Seleção de pares na Arc Testnet via ArcBandit com algoritmo bandit de múltiplos braços. Pesos atualizados a cada 10 trades baseado em lucro acumulado por par.

---

## Sistema de Aprendizado

```
Voto do agente com preço atual
    ↓
Pregão registra palpite (par, direção, preço, confiança)
    ↓
5 minutos depois → Professor consulta preço atual
    ↓
Acertou direção?  → +pontos, parâmetros afrouxados (↓conf.min, ↑entrada)
Errou direção?    → −pontos, parâmetros endurecidos (↑conf.min, ↓entrada)
    ↓
Escola de Robôs atualiza ranking → streak acumula → promoção
```

**Critérios de promoção**: 50+ avaliações · 60%+ acerto · 500+ pontos.
Agentes promovidos têm suas ordens aceitas diretamente pelo Pregão sem exigir segundo voto concordando.

O Professor tem trava de segurança: streak por par (não contamina outros pares), cap de 10 ajustes consecutivos por par, e early exit ao atingir o teto (conf.min 55%, entrada 1.50%).

---

## Resultados (Polygon Mainnet)

| Métrica | Valor |
|---------|-------|
| Trades on-chain executados | 6+ |
| Win rate | 100% |
| Lucro acumulado | ~$18.77 |
| Capital operado | ~$50–65 USDC |
| Retorno sobre capital | ~28.9% |
| Ativo desde | Outubro 2025 |

---

## Redes Suportadas

| Rede | Tipo | Porta | Status |
|------|------|-------|--------|
| Arc Testnet | 🧪 testnet | 3001 | ✅ Ativo — campo de treinamento principal |
| Polygon Mainnet | 💰 mainnet | 3000 | ✅ Ativo — trading real |
| Base Mainnet | 💰 mainnet | 3002 | ✅ Configurado |
| Ethereum Mainnet | 💰 mainnet | — | ✅ Configurado |
| Ethereum Sepolia | 🧪 testnet | 3003 | ✅ Configurado |

---

## Stack Técnica

| Categoria | Tecnologias |
|-----------|-------------|
| Framework | Next.js 15.5 + React 19.2 |
| Linguagem | TypeScript (strict mode) |
| Blockchain | ethers.js v6 + viem + wagmi |
| Swaps | LI.FI REST API + DEX direto (SushiSwap V2, Uniswap V3) |
| Preços | SoSoValue API + Stork Oracle on-chain |
| Bridge | Circle CCTP v2 (5 chains) |
| Identidade | ERC-8004 AgentIdentity (próprio) + IdentityRegistry oficial da Arc |
| Jobs | ERC-8183 Job Marketplace (próprio) + AgenticCommerce oficial da Arc |
| Estilo | Tailwind CSS 4.3, lucide-react |
| Gráficos | recharts 3.x |
| Contratos | Solidity + OpenZeppelin v5 |
| Deploy | Vercel |

---

## Como Rodar

```bash
# Instalar dependências
npm install

# Copiar variáveis de ambiente
cp .env.example .env.local
# Preencher: PRIVATE_KEY, SOSO_API_KEY, KIT_KEY

# Arc Testnet (recomendado para começar)
npm run dev:testnet   # porta 3001

# Polygon Mainnet
npm run dev           # porta 3000

# Base Mainnet
npm run dev:base      # porta 3002

# Ethereum Sepolia (testnet)
npm run dev:sepolia   # porta 3003

# Verificar TypeScript
npx tsc --noEmit
```

### Variáveis de Ambiente

```env
PRIVATE_KEY=           # Chave privada da wallet de operação
SOSO_API_KEY=          # SoSoValue API (gratuita: 20 req/min)
KIT_KEY=               # Circle App Kit (opcional — necessário para JobRobot)
LIFI_API_KEY=          # LI.FI (opcional — usa endpoint público se ausente)
NEXT_PUBLIC_DEFAULT_NETWORK=arc
```

---

## Estrutura do Repositório

```
arcflow/
├── app/
│   ├── api/              # 17 rotas de API (price, rpc-proxy, relayer, jobs, etc.)
│   ├── components/       # 22 componentes React (dashboard, agentes, posições)
│   └── page.tsx          # SPA principal
├── lib/                  # 72+ módulos TypeScript (núcleo do sistema)
│   ├── pregão.ts         # Orquestrador central
│   ├── stable-mr.ts      # Mean reversion para stablecoins
│   ├── modo-grão.ts      # Batch trading com PiFilter
│   ├── oscillation-hunter.ts
│   ├── grid-trading.ts   # Grid adaptativo
│   ├── capital-controller.ts
│   ├── contract-registry.ts  # Registro central de contratos
│   └── ...
├── contracts/            # Contratos Solidity (AgentIdentity, ERC8183, AMM)
├── scripts/              # Deploy e utilitários
│   ├── deployAMMArc.js
│   └── addLiquidityAMM.js
├── ARCFLOW.md            # Documentação técnica completa para IAs
└── AGENTS.md             # Histórico de sessões e regras para contribuidores
```

---

## Roadmap

- [x] Sistema multi-agente com consenso e aprendizado
- [x] ERC-8004 AgentIdentity deployado (Arc + Base)
- [x] ERC-8183 Job Marketplace deployado (Arc, Base, Polygon, Ethereum)
- [x] AMM próprio USDC/EURC na Arc Testnet
- [x] PiFilter Gaussiano para scalping de stablecoins
- [x] Sistema de treinamento autônomo (ArcTraining)
- [x] Contract Registry com dashboard on-chain
- [ ] Migração para Arc Mainnet (aguardando lançamento — verão 2026)
- [ ] Integração x402 para micropagamentos entre agentes
- [ ] Arc Privacy Sector para estratégias confidenciais
- [ ] Agente FX Arbitrage: spread StableFX vs AMM público
- [ ] Unified Balance (Circle API plano pago)

---

## Documentação

- [`ARCFLOW.md`](ARCFLOW.md) — Mapa completo do sistema, parâmetros, arquitetura, fórmulas matemáticas, bugs conhecidos
- [`AGENTS.md`](AGENTS.md) — Histórico de sessões e regras para IAs contribuidoras

---

## Autor

**Silvio** · [@Silvinhojm](https://github.com/Silvinhojm)

Construído sobre o ecossistema Arc/Circle como participante ativo desde o lançamento do testnet em outubro de 2025. O projeto explora a interseção entre sistemas multi-agente autônomos, infraestrutura de stablecoin, e os padrões emergentes da economia agentic (ERC-8004, ERC-8183, x402).

---

> **ArcFlow não é um serviço financeiro. Trading envolve risco de perda de capital. Use por sua conta e risco.**

---

## Repositório

Desenvolvido em `versao-polygon` — deploys automáticos via Vercel.

```
https://arcflow-steel.vercel.app
```