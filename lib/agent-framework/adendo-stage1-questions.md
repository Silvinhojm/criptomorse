# Adendo ao Estágio 1 — Resposta às duas perguntas de Silvio

**Investigador:** DeepSeek (read-only)
**Data:** 29/07/2026
**Contexto:** Perguntas de Silvio sobre o design da guarda de idempotência
  do `anchorDecision`, levantadas após a entrega do Estágio 1.

---

## Pergunta 1 — Quando o anchor falha e é reprocessado, o `onChainStatus` é atualizado?

**Resposta curta: NÃO.** Há um bug no `retryPendingProofs`.

### O que a retentativa faz (vs. o que deveria fazer)

O fluxo de sucesso (em `coordinator.ts:812-825`, `submitProposal`):

```
anchorDecision retorna { txHash, blockNumber, hash }
  → dp.onChainHash = result.hash
  → dp.onChainTx = result.txHash
  → dp.onChainStatus = "confirmed"
  → audit_.updateEntry(auditId, { onChainHash, onChainTx, onChainStatus: "confirmed" })
  → _saveDecisionReport(intentId, dp)
  → log de sucesso
```

O fluxo de retentativa (em `onchain-intent-publisher.ts:58-73`, `retryPendingProofs`):

```
anchorDecision retorna { txHash, blockNumber, hash }  ← na segunda tentativa
  → pendingProofs.delete(id)                            ← remove da fila
  → resolved++                                          ← incrementa contador
  → (NÃO faz mais nada)
```

**O `onChainStatus` nunca é atualizado para "confirmed" no retry path.**

O `DecisionReport` permanece com `onChainStatus: "pending"` para sempre,
mesmo depois de a transação on-chain ter sido minerada com sucesso na
retentativa. O relatório de auditoria mente para o futuro: mostra
"pendente" enquanto a prova existe.

### Localização exata

- **Arquivo:** `lib/agent-framework/onchain-intent-publisher.ts`
- **Função:** `retryPendingProofs()` (linhas 58-73)
- **Callback de sucesso** (linhas 62-63):
  ```typescript
  const result = await this.anchorDecision(id, entry.report)
  if (result) {
    this.pendingProofs.delete(id)   // ← só remove da fila
    resolved++                      // ← só incrementa contador
  }
  ```
- **O que falta:** Chamada a `this.publisher.setDecisionReport(id, updatedReport)` com
  `onChainStatus: "confirmed"`, `onChainHash`, `onChainTx` — análogo ao que
  `coordinator.ts:814-822` faz no path de sucesso inicial.

### Observações adicionais sobre o design

1. **`retryPendingProofs` não tem acesso ao Audit.** Ela recebeu `entry.report`
   (uma snapshot do `DecisionReport` no momento do agendamento), mas não tem
   referência ao `Audit` para chamar `updateEntry()`. Isso significa que mesmo
   que corrigíssemos o `setDecisionReport`, o audit entry continuaria com
   `onChainStatus: "pending"`.

2. **O report da pendingProofs é uma snapshot.** Em `anchorDecision` linha 206:
   ```typescript
   this.pendingProofs.set(id, { report, retries: ... })
   ```
   O `report` é o objeto original (não uma deep copy). O Coordinator, após
   chamar `anchorDecision` (linha 813), continua sua execução — se ele alterar
   o `report` depois (ex.: atualizar `onChainStatus`), a snapshot na
   `pendingProofs` NÃO reflete a alteração (referência para o mesmo objeto,
   então na verdade SIM reflete — mas isso é um detalhe frágil, não um design
   intencional). O ponto é: mesmo que corrigíssemos o retry path para fazer
   `setDecisionReport`, ele precisaria construir um objeto `DecisionReport`
   atualizado, não reusar o `entry.report` cego.

---

## Pergunta 2 — O mecanismo de retry depende da aba do navegador aberta?

**Resposta curta: PIOR que isso — o mecanismo de retry é código morto em produção.**

### A cadeia de chamadas

```
retryPendingProofs()  →  chamado de
  Coordinator.runCycle()  →  NUNCA chamado em produção
                             (só em scripts de teste: k-2c3, k-2c4, k-2c5, ri-l1-p3)
```

Verificação independente:

`lib/` e `app/` não contêm nenhuma chamada a `frameworkCoordinator.runCycle()`,
`coordinator.runCycle()`, ou qualquer variação. O `runCycle` do
`PregãoDashboard.tsx:344` é uma **função completamente diferente** que chama
`executarCicloAgentes()`, `executarCicloPregueiros()`, e
`pregão.executarPacotes()` — NUNCA `frameworkCoordinator.runCycle()`.

### Consequência

Se o `anchorDecision` inicial falhar (e ele é fire-and-forget com
`.catch(() => {})`), o registro cai em `pendingProofs` e **lá fica para
sempre**. Não há caminho de recuperação executável em produção:

1. `submitProposal()` (coordinator.ts:812) → `anchorDecision()` fire-and-forget
   → falha → `pendingProofs.set()` ✓
2. `retryPendingProofs()` — **nunca chamado** ← AQUI ESTÁ O GAP
3. `pendingProofs` acumula entradas permanentemente

### E o caminho browser?

O `anchorDecision` do `OnChainIntentPublisher` (linhas 166-209) tem dois
caminhos:

- **Server-side** (linhas 180-188): usa `ethers.Wallet` com chave privada.
  Funciona independente de navegador, desde que o processo Node esteja vivo.
  Mas `submitProposal()` só é chamado a partir do ciclo do PregãoDashboard
  (browser). Se o navegador fechar, o ciclo para de rodar, e `submitProposal()`
  nunca mais é chamado — logo, nenhum anchor novo é disparado. Os que estão
  em `pendingProofs` ficam lá.

- **Browser** (linhas 191-203): `fetch("/api/anchor-decision")`. Se o
  navegador fechar antes do fetch completar, a chamada é abortada. O `.catch`
  silencioso (coordinator.ts:824) engole o erro e coloca em `pendingProofs`
  — que nunca será retentado.

### Resumo da dependência de navegador

| Caminho | Disparo inicial | Retry |
|---------|----------------|-------|
| `submitProposal()` (via `PregãoDashboard.tsx` ciclo) | ✅ Browser-dependent (ciclo de polling) | ❌ `runCycle()` nunca chamado |
| `runCycle()` → `retryPendingProofs()` | ❌ Nunca chamado em produção | ❌ Nunca chamado em produção |

O disparo inicial do anchor não depende de navegador para EXECUTAR (a promise
roda no event loop do Node), mas depende do navegador para SER DISPARADO
(o ciclo do PregãoDashboard que chama `submitProposal()` é um setInterval
client-side). A retentativa, por sua vez, não existe em produção — é código
morto.

---

## Impacto no Veredito do Estágio 1

As duas perguntas revelam que o design da guarda de idempotência não é
**completo** — ele cobre o caso feliz (primeira tentativa), mas deixa dois
gaps no caso de falha:

1. **Gap de atualização**: retry bem-sucedido não propaga o resultado de
   volta ao DecisionReport nem ao Audit. `onChainStatus` fica "pending"
   para sempre.

2. **Gap de orquestração**: o mecanismo de retry (`retryPendingProofs`) é
   código morto — só executável em testes. Não há caminho de produção que
   o chame.

Nenhum dos gaps invalida o design da guarda de idempotência em si (a guarda
está correta). Eles são problemas no DESIGN DE RECUPERAÇÃO que circunda a
guarda — ou seja, a guarda faz o que promete (impede chamadas duplicadas
concorrentes), mas o sistema ao redor não garante que uma chamada perdida
será retomada.
