# Criptomorse / ArcFlow

Carteira de stablecoin na **Arc Testnet** com swap/bridge via LI.FI, trading multi-agente e jobs ERC-8183.

- **Stack:** Next.js 15 + React + TypeScript + ethers + LI.FI
- **Rede padrão:** Arc Testnet (chainId `5042002`)
- **Explorer:** [testnet.arcscan.app](https://testnet.arcscan.app)

## Pré-requisitos

- Node.js 20+
- [MetaMask](https://metamask.io/) (Chrome/Edge) — para enviar/receber USDC na UI
- USDC de teste na Arc Testnet via [faucet Circle](https://faucet.circle.com/)

## Instalação

```bash
git clone https://github.com/Silvinhojm/criptomorse-arc.git
cd criptomorse-arc
npm install
cp .env.example .env.local
```

Edite `.env.local` e adicione sua private key (sem o prefixo `0x` ou com — ethers aceita ambos):

```env
NEXT_PUBLIC_PRIVATE_KEY=sua_chave_privada_aqui
```

> **Segurança:** `.env.local` está no `.gitignore`. Nunca commite chaves privadas. Em produção, prefira backend com wallet server-side.

## Rodar localmente

```bash
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

## Configurar MetaMask — Arc Testnet

| Campo | Valor |
|-------|-------|
| Nome da rede | Arc Testnet |
| RPC URL | `https://rpc.testnet.arc.network` |
| Chain ID | `5042002` |
| Símbolo | USDC |
| Explorer | `https://testnet.arcscan.app` |

No app, use o seletor de rede no topo (🔵 Arc) ou conecte via MetaMask — a rede é adicionada automaticamente se não existir.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `NEXT_PUBLIC_PRIVATE_KEY` | Para trading real | Private key da carteira que executa swaps LI.FI on-chain |

## Duas formas de usar a carteira

| Modo | Como funciona |
|------|----------------|
| **UI (MetaMask)** | Botão "Conectar" — envia USDC, recebe, jobs, bridge |
| **Trading real automático** | Usa `NEXT_PUBLIC_PRIVATE_KEY` — swaps USDC↔EURC via LI.FI sem MetaMask |

O endereço derivado da private key aparece no console como:

```text
✅ RealSwapExecutor: Arc Testnet | 0x...
```

## Features

| Feature | Descrição | On-chain? |
|---------|-----------|-----------|
| Enviar USDC | Transferência ERC-20 via MetaMask | ✅ |
| Receber | Mostra endereço conectado | — |
| Bridge / Swap | Redireciona para Jumper (LI.FI) | ✅ (via LI.FI) |
| Jobs ERC-8183 | Comércio agentivo via contrato Arc | ✅ Arc Testnet |
| Multi-Agent Auto-Trade | Agentes simulados (quantum, news, etc.) | ❌ Simulação |
| Real Automated Trader | Swaps USDC↔EURC reais a cada N segundos | ✅ LI.FI |
| Nanopayments | Pagamentos entre agentes internos | ❌ Simulação |
| Bitcoin Treasure Hunter | Mini-game | ❌ Simulação |

## Contratos Arc Testnet

| Token / Contrato | Endereço |
|------------------|----------|
| USDC | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| ERC-8183 (Agentic Commerce) | `0x0747EEf0706327138c69792bF28Cd525089e4583` |

## Jobs ERC-8183 (on-chain)

Na **Arc Testnet**, aba **Jobs** com MetaMask conectado:

1. **Criar Job** — `createJob` → `setBudget` → `approve USDC` → `fund`
2. Jobs listados via eventos `JobCreated` + leitura `getJob`
3. Evaluator padrão: sua própria carteira (client)

Contrato: `0x0747EEf0706327138c69792bF28Cd525089e4583`

Tutorial oficial: [Arc Docs — ERC-8183](https://docs.arc.network/arc/tutorials/create-your-first-erc-8183-job)

## Trading real — comportamento esperado

- **BUY** (USDC → EURC): slippage 0.5% → 3%
- **SELL** (EURC → USDC): slippage 5% → 15% (Arc Testnet tem pools ilíquidos)
- **Fila de transações:** uma TX por vez (evita erro `nonce too low`)
- **Cooldown SELL:** após 2 falhas LI.FI, pausa SELL por 5 minutos
- **Limite EURC:** para de comprar EURC após acumular 3× o valor do trade

Se SELL falhar com `price impact > 10%`, use **Bridge/Swap → Jumper** manualmente com valor menor.

## Build e deploy

```bash
npm run build
npm start
```

Deploy na [Vercel](https://vercel.com) — configure `NEXT_PUBLIC_PRIVATE_KEY` nas Environment Variables do projeto.

## Estrutura do projeto

```
app/
  page.tsx              # Página principal (wallet UI)
  components/           # NetworkSwitcher, JobsPanel, SwapBridgeModal, etc.
lib/
  wallet-config.ts      # Redes e constantes compartilhadas
  real-automated-trader.ts
  real-swap-executor.ts
  lifi-executor.ts
contracts/              # Solidity (AgentIdentity, etc.)
arc-wallet-subgraph/    # Subgraph ERC-8183
```

## Troubleshooting

| Erro | Causa | Solução |
|------|-------|---------|
| `MetaMask extension not found` | Navegador sem extensão | Use Chrome/Edge com MetaMask, ou ignore se só usa trading real |
| `nonce too low` | TXs paralelas | Corrigido — aguarde ciclo anterior terminar |
| LI.FI 404 / price impact | Pool ilíquido na testnet | Reduza valor, use Jumper manual, ou aguarde cooldown |
| Saldo USDC zero | Sem faucet | [faucet.circle.com](https://faucet.circle.com/) |

## Licença

Projeto privado — Silvinhojm / Criptomorse.
