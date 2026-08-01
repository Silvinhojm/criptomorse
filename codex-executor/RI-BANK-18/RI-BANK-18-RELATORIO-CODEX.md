# RI-BANK-18 — Qual projeto Vercel é a produção real

**Data da investigação:** 2026-08-01  
**Escopo:** somente leitura; nenhuma configuração AWS/Vercel alterada; nenhum deploy, cron, signer, wallet ou trade executado.

## ALERTA EXECUTIVO — BLOQUEIO MANTIDO

**A investigação NÃO encontrou `criptomorse-arc` como um repositório ou branch separado. Os dois projetos Vercel recebem o mesmo repositório `Silvinhojm/criptomorse`, branch `versao-polygon`.**

O que existe são **dois aliases públicos servindo snapshots diferentes do mesmo codebase**:

| Domínio | Projeto Vercel | Deployment servido em 01/08/2026 | Estado |
|---|---|---|---|
| `https://criptomorse.vercel.app` | `arcflow` | `dpl_EKB64MCy1F1Gw8ZzFAu3suEqM1iZ`, criado em 28/07/2026 00:03 BRT | `Ready`, target `production` |
| `https://criptomorse-arc.vercel.app` | `criptomorse-arc` | `dpl_Fj1ny1h5USxKqzQF9bjjFhDhxqwX`, criado em 29/06/2026 19:20 BRT | `Ready`, target `production`, mas antigo |

**Nenhum dos dois deployments públicos contém o conjunto atual RI-BANK-12/13/14.** `lib/risk-boxes.ts` e `lib/trading-budget.ts` estão não rastreados no working tree; `lib/circuit-breaker.ts` e `lib/corretor.ts` têm alterações locais não commitadas. O commit remoto atual `5a8f6a3` contém apenas as versões anteriores de `circuit-breaker.ts` e `corretor.ts` e não contém `risk-boxes.ts` nem `trading-budget.ts`.

Portanto:

1. não é correto tratar a UI cliente de `criptomorse-arc.vercel.app` como prova de um codebase de produção diferente;
2. também não é correto concluir que o runtime financeiro RI-BANK-12/13/14 já está em produção em `arcflow`;
3. o escopo OIDC `project:arcflow` corresponde ao único projeto que recebeu um deploy de produção recente, mas a decisão humana sobre qual projeto será o endpoint financeiro canônico continua necessária antes de RI-BANK-16/17;
4. **RI-BANK-16/17 deve permanecer bloqueado.**

---

## 1. Qual projeto Vercel está conectado a qual repositório/branch Git?

### Resultado

Os dois projetos estão efetivamente conectados ao mesmo repositório e à mesma branch:

| Projeto Vercel | Project ID | Repositório observado nos eventos Vercel | Branch observada | Root |
|---|---|---|---|---|
| `arcflow` | `prj_ntogSlyjapx6GjpO44jNaT9Dv1YT` | `Silvinhojm/criptomorse` | `versao-polygon` | `.` |
| `criptomorse-arc` | `prj_89NIkKkLomsVdTTpC3Q71vy5mvmK` | `Silvinhojm/criptomorse` | `versao-polygon` | `.` |

Evidência autenticada da Vercel (`vercel activity`): em 28/07/2026 às 02:59:54 UTC, os dois projetos receberam o mesmo commit `5a8f6a3` de `Silvinhojm/criptomorse`, branch `versao-polygon`, no mesmo segundo:

- `arcflow`: “deployed arcflow from Silvinhojm/criptomorse (5a8f6a3 in versao-polygon)”;
- `criptomorse-arc`: “deployed criptomorse-arc from Silvinhojm/criptomorse (5a8f6a3 in versao-polygon)”.

O repositório local confirma:

```text
cwd: C:\Users\silvi\arcflow
branch: versao-polygon
HEAD: 5a8f6a38e605effe2f35d08b4d260d9b93928603
remote: https://github.com/Silvinhojm/criptomorse.git
origin/versao-polygon: 5a8f6a3
```

O link local `.vercel/project.json` aponta somente para `arcflow`:

```json
{"projectId":"prj_ntogSlyjapx6GjpO44jNaT9Dv1YT","orgId":"team_VI1EfN31hvY3GHCCLrL1RKjQ","projectName":"arcflow"}
```

### Limite da evidência

A tela visual Settings → Git não pôde ser lida: o controle do navegador instalado falhou ao carregar sua documentação e o fallback visual do Windows foi interrompido por não conseguir validar a URL ativa. Nenhuma ação de UI foi feita. Ainda assim, os eventos autenticados da Vercel são evidência direta da integração Git efetivamente usada por ambos os projetos.

Os eventos mostram `versao-polygon` gerando deployments `Preview` nos dois projetos. Em `arcflow`, a produção de 28/07 foi criada separadamente “via Vercel CLI”, solicitada por `claude-code_2-1-219_agent`; portanto, não há evidência de que `versao-polygon` esteja configurada como Production Branch automática. Não foi possível ler com segurança o valor nominal do campo “Production Branch” na UI e ele não deve ser presumido.

---

## 2. Onde vive o código testado durante a semana?

### Resultado

O código RI-BANK-11 a RI-BANK-14 vive hoje no working tree local de `C:\Users\silvi\arcflow`, mas **não está integralmente no Git e não está em nenhum deployment Vercel identificado**.

Estado Git observado:

```text
 M lib/circuit-breaker.ts
 M lib/corretor.ts
?? lib/risk-boxes.ts
?? lib/trading-budget.ts
```

Comparação com o commit implantado mais recente via Git (`5a8f6a3`):

| Arquivo | Working tree atual | Commit `5a8f6a3` | Deployments públicos |
|---|---|---|---|
| `lib/circuit-breaker.ts` | existe com 199 linhas de diff (164 adições/35 remoções) | existe, versão anterior | versão anterior ao RI-BANK atual |
| `lib/corretor.ts` | existe com 58 linhas de diff (52 adições/6 remoções) | existe, versão anterior | versão anterior ao RI-BANK atual |
| `lib/risk-boxes.ts` | existe, não rastreado | ausente | ausente |
| `lib/trading-budget.ts` | existe, não rastreado | ausente | ausente |

Consequências por projeto:

- **`arcflow` produção:** build de 28/07/2026, anterior às alterações RI-BANK-12/13/14 registradas em 31/07; não contém o conjunto atual.
- **`criptomorse-arc` produção:** build de 29/06/2026; é ainda mais antigo e também não contém o conjunto atual.
- **previews recentes de ambos:** receberam o commit `5a8f6a3`, que não contém `risk-boxes.ts` nem `trading-budget.ts` e contém versões anteriores dos outros dois arquivos.

Assim, a resposta não é “os controles estão em um dos dois projetos”: **eles ainda não estão integralmente em nenhum deployment Vercel**.

---

## 3. Por que `arcflow` mostrou “No Production Deployment” enquanto o domínio carregava?

### Causa verificável no estado atual

Em 01/08/2026, a premissa do painel não corresponde ao estado retornado pela Vercel:

```text
https://criptomorse.vercel.app
  -> deployment dpl_EKB64MCy1F1Gw8ZzFAu3suEqM1iZ
  -> project arcflow
  -> target production
  -> status Ready
  -> created 2026-07-28 00:03:13 BRT
```

O alias não aponta para Preview, nem para outro projeto, nem para uma branch diferente. Ele aponta para um deployment explicitamente marcado `production`.

O histórico explica a contradição temporal mais provável e verificável:

1. às 23:59 de 27/07, o push do commit `5a8f6a3` gerou Preview nos dois projetos;
2. às 00:03 de 28/07, `arcflow` recebeu um deploy separado de produção via Vercel CLI;
3. esse deployment recebeu quatro aliases, incluindo `criptomorse.vercel.app`.

Logo, uma tela vista antes desse deploy, uma tela não atualizada ou uma visualização com filtro diferente poderia mostrar “No Production Deployment”. **Não há evidência de alias de produção apontando para Preview no estado atual.** Sem a captura/timestamp exatos da tela original, não é possível distinguir cache visual de observação anterior a 28/07; afirmar uma dessas duas causas seria especulação.

---

## 4. O que é `criptomorse-arc` de fato?

### Resultado

`criptomorse-arc` é um segundo projeto Vercel para o **mesmo codebase**, não um repositório separado.

A diferença visual decorre dos deployments que os aliases públicos servem:

- `criptomorse-arc.vercel.app` permanece no snapshot de produção de 29/06, com 59 artefatos de build e a UI antiga voltada ao usuário (“Bot Bank”, “Sala de Aula”, “Bridge” etc.);
- `criptomorse.vercel.app` serve o snapshot de produção de 28/07, com 67 artefatos e a navegação técnica atual definida em `app/components/DashboardShell.tsx`: `Overview`, `Decisions`, `Proofs`, `Agents`, `Architecture`, `Operator`, `Ledger`, `Debug`.

O repositório atual ainda contém simultaneamente componentes das duas camadas, por exemplo `BotBank.tsx`, `SalaDeAula.tsx`, `BridgeWidget.tsx` e `DashboardShell.tsx`. Portanto, a presença dessas telas não prova bifurcação de repositório; prova apenas que aliases diferentes ficaram presos em versões diferentes do mesmo histórico.

Também há previews recentes de `criptomorse-arc` até 28/07, inclusive no commit `5a8f6a3`, mas o alias estável `criptomorse-arc.vercel.app` não foi promovido e continua apontando para a produção de 29/06.

---

## 5. Qual domínio está referenciado no ERC-8004 e no LI.FI?

### ERC-8004 — confirmação on-chain

O domínio gravado nas quatro identidades do contrato AgentIdentity da Arc Testnet (`0xd2a801e60a0ab36da3fb17d4a7654b494ba8326b`) é **`criptomorse-arc.vercel.app`**.

Consulta read-only ao RPC em 01/08/2026:

```text
totalAgents=4
1=https://criptomorse-arc.vercel.app/api/agent-card/0x77f5C3A1079B86ef8490E7c5Ec1F9bcfbaAE5894
2=https://criptomorse-arc.vercel.app/api/agent-card/0x77f5C3A1079B86ef8490E7c5Ec1F9bcfbaAE5894
3=https://criptomorse-arc.vercel.app/api/agent-card/0x77f5C3A1079B86ef8490E7c5Ec1F9bcfbaAE5894
4=https://criptomorse-arc.vercel.app/api/agent-card/0x77f5C3A1079B86ef8490E7c5Ec1F9bcfbaAE5894
```

O código que criou esses registros confirma a mesma URI em `scripts/createArcActivity.js` e `scripts/deployAgentIdentityArc.js`. A rota do agent card também publica todos os serviços (`web`, `agent_card`, `agent_info`, `market_data`, `price_feed`) sob `https://criptomorse-arc.vercel.app`.

### LI.FI

O `INTEGRATOR_ID` não é um domínio URL. Nos dois clientes LI.FI ele é:

```text
CriptoMorse-ARC---Main
```

Arquivos:

- `lib/lifi-executor.ts`;
- `lib/lifi-agent.ts`.

Portanto, o LI.FI preserva a identidade textual “CriptoMorse-ARC”, mas **não permite concluir sozinho qual dos dois domínios Vercel é o endpoint canônico**. A evidência externa forte e explícita de domínio vem do ERC-8004, e ela aponta para `criptomorse-arc.vercel.app`.

### Divergência documental encontrada

Ao contrário do enunciado do mandato, a versão atual não rastreada de `docs/BRAND_AND_ARC_ALIGNMENT.md` não registra os domínios ERC-8004 nem o `INTEGRATOR_ID`; ela trata apenas governança de marca. As referências foram confirmadas diretamente no runtime on-chain, nos scripts e nos arquivos LI.FI. Essa discrepância deve ser tratada como fato documental, sem correção neste mandato.

---

## Decisão operacional que os fatos permitem — sem escolher produto

1. **OIDC atual:** está corretamente preso ao projeto que hoje recebeu o deploy de produção mais recente (`arcflow`), mas não ao domínio gravado no ERC-8004 (`criptomorse-arc.vercel.app`).
2. **Produção cliente histórica:** `criptomorse-arc.vercel.app` é o endpoint on-chain/externo legado, porém serve um snapshot de 29/06 e não o código bancário atual.
3. **Produção técnica recente:** `criptomorse.vercel.app` é um deployment real de produção do projeto `arcflow`, mas também não contém RI-BANK-12/13/14.
4. **Não há base factual para avançar signer/cron em qualquer um dos dois sem uma decisão humana explícita de endpoint canônico e um plano separado de promoção/migração.**

## Evidências e comandos read-only usados

- `vercel project inspect arcflow`
- `vercel project inspect criptomorse-arc`
- `vercel ls arcflow`
- `vercel ls criptomorse-arc`
- `vercel inspect https://criptomorse.vercel.app`
- `vercel inspect https://criptomorse-arc.vercel.app`
- `vercel activity --project arcflow`
- `vercel activity --project criptomorse-arc`
- `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git remote -v`
- `git ls-tree` e `git diff --stat/--numstat` para os quatro arquivos RI-BANK
- consulta `eth_call` read-only via ethers ao AgentIdentity na Arc Testnet

Nenhuma configuração ou deployment foi alterado durante a investigação.
