# CriptoMorse — Multi-Chain Autonomous Micro-Trading System

Sistema de trading autônomo multi-rede que opera como uma mesa de pregão digital. Uma **inteligência coletiva** de agentes analisa mercados, vota oportunidades e executa swaps on-chain em Polygon, Arc Testnet, Base e Ethereum.

O nome vem do **agente Morse**, que lê padrões de candle como código Morse — traduzindo sinais de mercado em decisões de compra e venda.

---

## Arquitetura

```
Agent Swarm (13 agentes)
    ↓ votam (OKs com confiança)
Pregão (livro de ordens central)
    ↓ seleciona melhor oportunidade
Capital Controller (gate de 1 trade por vez)
    ↓ autoriza
Broker (corretor.ts) → DEX Direct / LI.FI
    ↓ executa
Position Manager + Accountant (aprendizado)
```

### Módulos Principais

| Módulo | Descrição |
|--------|-----------|
| **Agentes** | 13 agentes de trading com confiança dinâmica e votação |
| **Pregão** | Livro de ordens central, matching e OKs |
| **Capital Controller** | Gate FIFO: 1 trade por vez, prioridade por score |
| **StableMR** | Mean reversion para pares stablecoin (EURC/USDC) |
| **Modo Grão** | Batch trading com PiFilter Gaussian signal detection |
| **Oscillation Hunter** | Micro-scalping em pools Uniswap V3 profundas |
| **Grid Trading** | Grid adaptativo com 15 níveis e deriva de preço |
| **Professor** | Avaliador de palpites com ajuste fino de parâmetros |
| **Escola de Robôs** | Sistema de educação e promoção de agentes |
| **Arc Training** | Treinamento autônomo na Arc testnet com snapshots |
| **PiFilter** | Filtro Gaussiano para detecção de sinal em ruído DEX |
| **Circuit Breaker** | Proteção contra perdas consecutivas |

---

## Features

- **Multi-chain**: Polygon (mainnet), Arc Testnet, Base, Ethereum, Sepolia
- **Swaps reais**: DEX direct (SushiSwap V2, Uniswap V3) + LI.FI aggregator
- **Staircase**: Fechamento automático de posições com garantia de lucro
- **Stable pairs**: EURC/USDC mean reversion com fallback V2
- **Agentes clássicos**: 13 estratégias (Volume, Notícias, RSI, MACD, Oscar, etc.)
- **Dashboard**: Posições abertas, trades recentes, telemetria PiEngine
- **AMM próprio**: GenericAMMPair USDC→EURC deployado na Arc testnet
- **On-chain registry**: ERC-8004 AgentIdentity + ERC-8183 Job Marketplace

---

## Stack

| Categoria | Tecnologias |
|-----------|-------------|
| Framework | Next.js 15.5 (Turbopack) + React 19.2 + TypeScript 5 (strict) |
| Blockchain | ethers v6, viem 2.x, wagmi 3.x |
| Swaps | LI.FI SDK v4, Uniswap V3 SDK, SushiSwap |
| Wallet | Circle app-kit (user-controlled-wallets) |
| Estilo | Tailwind CSS 4.3, lucide-react |
| Gráficos | recharts 3.x |
| Contratos | Solidity + OpenZeppelin v5 |

---

## Scripts

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Dev server (porta 3000) |
| `npm run dev:polygon` | Polygon mainnet (porta 3000) |
| `npm run dev:testnet` | Arc testnet (porta 3001) |
| `npm run dev:sepolia` | Sepolia testnet (porta 3003) |
| `npm run build` | Produção |
| `npm run lint` | ESLint |

---

## Documentação

- [`ARCFLOW.md`](ARCFLOW.md) — Mapa completo do sistema, parâmetros, arquitetura, auditoria matemática
- [`AGENTS.md`](AGENTS.md) — Histórico de sessões e regras para IAs contribuidoras

---

## Repositório

Desenvolvido em `versao-polygon` — deploys automáticos via Vercel.

```
https://arcflow-steel.vercel.app
```
