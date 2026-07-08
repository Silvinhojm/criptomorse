# ArcFlow (CriptoMorse)

ArcFlow is not a trading bot.

It is an autonomous agent coordination framework built on Arc Testnet.

`PROJECT_VISION.md` is the canonical architecture source of truth.

## Canonical Lifecycle

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

## Architecture

The framework is centered around:

- Coordinator
- Knowledge Service
- Policy Engine
- Voting Engine
- Decision Reports
- Audit
- DecisionAnchor
- Adapters

Trading is only one Adapter.

The Coordinator is the only public entry point.

Pregão is internal TradingAdapter machinery.

DecisionAnchor anchors the Decision Report hash plus compact metadata. It does not store full reports on-chain.

## Rules

Before implementing any feature:

1. Read PROJECT_VISION.md
2. Read ROADMAP.md
3. Read ARCHITECTURE_PRINCIPLES.md
4. Never bypass the Coordinator.
5. Never bypass the Knowledge Service.
6. Never create shortcuts.
7. Every new domain should be implemented as an Adapter.
8. Preserve Decision Reports.
9. Preserve on-chain DecisionAnchor.
10. Prefer extending the framework over modifying Trading.
11. Maintain backward compatibility whenever possible.

## Goal

ArcFlow is evolving into an Agent Coordination Framework for the Arc ecosystem.

Trading is only the first Adapter.

Every implementation must strengthen the framework instead of increasing coupling.
