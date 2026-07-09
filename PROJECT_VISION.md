# Project Vision - ArcFlow (CriptoMorse)

> Canonical source of truth for ArcFlow architecture. When another document conflicts with this file, this file wins and the other document should be treated as historical or stale until updated.

ArcFlow is an autonomous agent coordination framework for Arc Testnet.

ArcFlow is not a trading bot. Trading is the first Adapter and the first proof domain, because trading gives the framework a measurable feedback loop: profit, loss, gas, execution quality, reputation, and auditability. The framework itself must remain domain-neutral.

## Mission

Build reusable open-source infrastructure for autonomous agents in the Arc ecosystem. ArcFlow coordinates agents through shared knowledge, policy, voting, execution adapters, audit trails, decision reports, and on-chain proofs.

## ArcFlow as Structural Discipline for Economic Agents

A common failure mode in financial and agentic systems is not only bad execution, but overreaction to incomplete or isolated signals.

In trading and autonomous finance, a single strong signal can create premature execution. A local result can be mistaken for verified profit. A confirmed transaction can be confused with reconciled economic outcome.

ArcFlow is designed to introduce structural discipline into the decision chain of autonomous economic agents.

Rather than allowing one signal to trigger immediate execution, every economic proposal must pass through a verifiable path:

```text
Knowledge -> Policy -> Voting -> Execution -> Settlement -> DecisionReport
```

This creates intentional friction between signal and action.

ArcFlow does not prevent action.
ArcFlow prevents unverified action from being treated as truth.

The system separates:

- signal from intent;
- intent from approval;
- approval from execution;
- execution from settlement;
- settlement from reconciliation;
- reconciliation from verified profit.

This discipline protects the operator and the system from common automation failures, such as overreacting to one strong signal, bypassing risk limits, duplicating orders, or treating provisional results as verified outcomes.

ArcFlow does not promise profit.
ArcFlow does not eliminate losses.
ArcFlow does not replace human judgment.

ArcFlow provides a verifiable process so that economic actions can be limited, reviewed, executed, settled, and audited with clear status boundaries.

Core principle:

```text
ArcFlow does not celebrate execution.
ArcFlow only trusts verified settlement.
```

## Canonical Lifecycle

All current and future documentation must use this lifecycle:

```text
Identity
  -> Knowledge Service
  -> Intent
  -> Coordinator
  -> Policy Engine
  -> Voting Engine
  -> Adapter
  -> Execution
  -> Audit
  -> Decision Report
  -> DecisionAnchor
```

Inline form:

`Identity → Knowledge Service → Intent → Coordinator → Policy Engine → Voting Engine → Adapter → Execution → Audit → Decision Report → DecisionAnchor`

The Coordinator is the only public entry point. Agents, UI, SDKs, and external callers submit intents or proposals to the Coordinator. They do not call domain internals directly.

The Knowledge Service is the only official source of context. Agents do not call external market APIs, chain data providers, DEX routers, or other knowledge sources directly. The Knowledge Service consolidates liquidity, routes, gas, market state, history, and reputation into a KnowledgeReport.

The Policy Engine owns global rules. Gas limits, congestion handling, operating windows, liquidity minimums, economic mode, learning mode, and other system-wide constraints belong in Policy Engine, not in agents or adapters.

Voting resolves agent input using confidence, reputation, and Knowledge-derived modifiers. Voting should degrade weak proposals naturally instead of creating hidden shortcuts.

Adapters encapsulate domains. TradingAdapter is the first Adapter. Future domains such as lending, governance, monitoring, job marketplaces, research, and automation must be implemented as Adapters rather than added to framework core.

Audit, Decision Reports, and DecisionAnchor make decisions explainable and verifiable. Every coordinated execution must leave a complete off-chain report and an on-chain proof.

## Trading Adapter Boundary

Pregão is internal TradingAdapter machinery. It may remain as an internal order book, consensus helper, or trading engine implementation detail, but it is not the public architectural center of ArcFlow.

Correct direction:

```text
Agent or UI
  -> Coordinator
  -> Knowledge Service
  -> Policy Engine
  -> Voting Engine
  -> TradingAdapter
  -> internal Pregão machinery
  -> Execution
  -> Audit / Decision Report
  -> DecisionAnchor
```

Incorrect direction:

```text
Agent or UI
  -> Pregão directly
```

## Runtime Architecture State After Phase 2c

Phase 1 is accepted for entry-point alignment:

- Legacy Pregao entry paths for autonomous economic signals now route through the Coordinator.
- `pregao.receberOK()` is a backward-compatible wrapper, not the final public economic authority.
- `pregao.injetarSinal()` is the TradingAdapter-internal hook used after Coordinator approval.
- TradingAdapter calls `pregao.injetarSinal()`, not `pregao.receberOK()`, avoiding a `receberOK -> Coordinator -> TradingAdapter -> receberOK` loop.

Phase 1b is accepted for remaining autonomous trading surfaces:

- `RealAutomatedTrader` autonomous decisions submit through the Coordinator.
- `TradingNanopayments` autonomous decisions submit through the Coordinator.
- Manual, test, admin, and demo paths are classified and may remain outside the autonomous lifecycle for now.

Phase 2a is accepted for Knowledge and Policy enforcement:

- Knowledge Service is enforced inside the Coordinator.
- `knowledgeStatus` and `knowledgeError` are persisted when available.
- `KnowledgeReport.canTrade = false` blocks execution.
- Policy Engine is enforced before voting and before execution.
- Policy rejection blocks execution and is persisted in DecisionReport and Audit where applicable.

Phase 2b is accepted for Voting Engine canonicalization:

- `Voting.resolve()` is the canonical consensus authority.
- `Coordinator.resolveConsensus()` has been removed.
- `submitProposal()` and `runCycle()` use `Voting.resolve()`.
- Zero voting agents reject instead of executing.
- `ConsensusResult.action` maps from `proposal.action`, not from hardcoded buy/sell/hold assumptions.

Phase 2c is accepted for Coordinator result hardening and Arqueiro startup safety:

- Rejection paths preserve the canonical `SubmissionResult` shape: `{ consensus: ... }`.
- Adapter execution remains blocked after every rejection path.
- Arqueiro startup is browser/runtime guarded.
- Arqueiro remains shadow/inert and non-executing.
- ScoutSignal runtime has not been implemented.

Current valid autonomous trading flow:

```text
Autonomous decision
  -> Coordinator.submitProposal()
  -> TradingAdapter
  -> pregao.injetarSinal()
  -> Pregao / Corretor machinery
```

Knowledge, Policy, and Voting are now real runtime gates. They are not documentation-only concepts and must not be bypassed by agents, adapters, dashboards, or compatibility wrappers.

## Settlement Truth Principle

ArcFlow não comemora execução. ArcFlow só confia em liquidação verificada.

Meaning:

- A transaction being dispatched is not proof of profit.
- A transaction hash alone is not final economic truth.
- Dashboard profit is provisional until settlement is verified.
- DecisionAnchor proves what was anchored, not full lifecycle correctness unless the canonical DecisionReport hash is complete.
- Net profit must eventually account for gas, fees, slippage, failed attempts, time, and risk.

Known limitations after Phase 2c:

- Pending proposal settlement is not reconciled back into all dashboards or accounting surfaces yet.
- Coordinator and TradingAdapter currently treat dispatch to Pregao as execution success, not final on-chain settlement.
- `job-robot` and `contratante` are demo/stress/testnet utilities for now and need a future Job/Testnet Adapter if promoted to canonical runtime behavior.
- Manual/admin swap routes remain callable low-level utilities and need stronger access boundaries later.
- DecisionReport is not fully canonical yet.
- DecisionAnchor exists and works as a contract, but canonical hash correctness over complete finalized DecisionReports remains future work.
- Dashboard profit must be treated as provisional until settlement reconciliation is implemented.

Next architecture work should focus on TradingAdapter settlement correctness, DecisionReport runtime correctness, and DecisionAnchor canonical hash correctness.

Infrastructure facts to preserve before Phase 2:

- Arc cirBTC source of truth must use current on-chain verification unless contradicted by primary Arc/Circle documentation. As of the 07/07/2026 audit, `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` has bytecode and reports `name = Circle Wrapped Bitcoin`, `symbol = cirBTC`, `decimals = 8`; `0x171A4217b86A807A64eB94757Db6849fb4bDbAA0` has no bytecode on the tested Arc Testnet RPCs.
- Pool A (`0x8cdc84f93F6a5413667354F8fB516959D682423c`) was recovered by `0xfa033D062d6ab8d49D611F5644d46f5380737dDA` via `removeLiquidity(123501)` after read-only `eth_call` verification. Recovery tx `0xe7efabca39944399179263711e38ab6f385dcea087baedac122c7db86300acfd` confirmed in block `50639197`, recovering `65.03 USDC` and `0.00117965 cirBTC`; final LP balance, totalLiquidity, and reserves are `0`.
- Pool ownership is split: active USDC/EURC pool `0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb` is owned by the main wallet `0x77f5C3A1079B86ef8490E7c5Ec1F9bcfbaAE5894`; secondary/demo pools are owned by `0xfa033D...`.
- DecisionAnchor at `0x7813e04338dc9d6b7676843a52152c57438cc7b2` has bytecode and `totalReports() = 65`, proving the contract works and has been called; canonical runtime anchoring of finalized DecisionReports is still incomplete.

## Canonical Phase Status

This table is the single phase-status reference. `PROJECT_VISION.md` remains the canonical architecture source; this table only tracks implementation maturity.

| Phase | Status | Meaning |
|-------|--------|---------|
| Phase 1 - Coordinator core | Implemented / hardening | Coordinator is the public entry point; direct domain entry points are deprecated or internal. |
| Phase 2 - Knowledge First + Policy gates | Accepted / hardening | Knowledge Service and Policy Engine are runtime gates inside Coordinator. |
| Phase 3 - Voting Intelligence | Accepted / hardening | `Voting.resolve()` is the canonical consensus authority. |
| Phase 4 - Audit + Decision Reports | In progress | Every coordinated execution must produce an auditable Decision Report. |
| Phase 5 - DecisionAnchor | Implemented / hardening | DecisionAnchor anchors the Decision Report hash plus compact metadata. |
| Phase 6 - Policy Engine | Accepted / hardening | Policy blocks before voting and before execution; scattered rules should continue migrating there. |
| Phase 7 - SDK | Planned | Public developer API after architecture stabilizes. |
| Phase 8 - Adapters | In progress | TradingAdapter is first; new domains must be Adapters. |
| Phase 9-12 - UX, live view, memory, platform | Planned | Product and platform expansion after the framework boundary is stable. |

## Decision Report + DecisionAnchor Lifecycle

Every decision that passes through the Coordinator must produce a Decision Report before or during execution finalization. The report is the complete off-chain explanation of the decision.

Canonical DecisionAnchor payload:

- `decisionHash`: canonical hash of the finalized Decision Report.
- `metadata`: compact metadata only, such as `decisionId`, `network`, `domain`, `adapterId`, `timestamp`, and `knowledgeReportHash`.

DecisionAnchor must not store the full Decision Report or full KnowledgeReport on-chain. The on-chain proof is the Decision Report hash plus compact metadata.

Required Decision Report fields:

- `decisionId`: stable unique identifier for the decision.
- `timestamp`: decision creation/finalization time.
- `network`: target network, such as Arc Testnet.
- `domain`: adapter domain, such as `trading`.
- `adapterId`: adapter that executed or attempted execution.
- `actorIdentity`: submitting agent, user, or module identity.
- `intent`: original intent/proposal payload.
- `knowledgeReport`: Knowledge Service output used for the decision.
- `knowledgeReportHash`: canonical hash of the KnowledgeReport.
- `confidenceModifier`: modifier supplied by Knowledge.
- `policyChecks`: Policy Engine rules evaluated and their pass/fail results.
- `votes`: participating agents, confidence, reputation, weight, and vote result.
- `consensusResult`: accepted, rejected, deferred, or failed, with reason.
- `executionPlan`: selected adapter action before execution.
- `executionResult`: transaction, simulation, skipped, failed, or other outcome.
- `gas`: estimated and actual gas when available.
- `economicResult`: profit, loss, cost, or non-financial result depending on adapter.
- `auditTrail`: relevant events emitted during the decision lifecycle.
- `decisionHash`: canonical hash of the finalized Decision Report.
- `anchorMetadata`: compact metadata submitted with the anchor.
- `anchorTxHash`: DecisionAnchor transaction hash when anchored.
- `anchorStatus`: pending, anchored, failed, or not_required.

Lifecycle:

1. Agent, UI, or SDK submits an intent to the Coordinator.
2. Coordinator obtains context from the Knowledge Service.
3. Policy Engine evaluates global constraints.
4. Voting Engine resolves agent input when applicable.
5. Coordinator chooses the Adapter and records the execution plan.
6. Adapter executes through domain-specific internals.
7. Audit records the outcome and final metadata.
8. Decision Report is finalized with all required fields.
9. DecisionAnchor anchors `decisionHash` plus compact metadata on-chain.
10. The anchored transaction hash is attached back to the Decision Report.

## Non-Negotiable Principles

- Preserve Coordinator as the public entry point.
- Preserve Knowledge Service as the source of context.
- Preserve Policy Engine ownership of global rules.
- Preserve Voting as the consensus layer.
- Preserve Adapter boundaries for every domain.
- Preserve Audit and Decision Reports for explainability.
- Preserve DecisionAnchor for on-chain proof.
- Preserve historical implementation notes, but do not treat them as current architecture when they conflict with this document.
