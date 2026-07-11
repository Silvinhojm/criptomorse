# DESIGN-2e2j — Persistence Design (Versioned, Pre-Implementation)

| Status | Date | Commit | Tag |
|--------|------|--------|-----|
| Design | 2026-07-11 | TBD | `phase-2e2j-persistence-design` |

## 1. Purpose

This document defines the concrete persistence model for ArcFlow's settlement state. It does **not** authorize implementation. It establishes the design, acceptance criteria, and gating conditions so that when an operational trigger fires, `phase-2e2k` can begin with a complete, audited blueprint.

**Scope**: settlement replay queue, SettlementRegistry, DecisionReport, IntentRecord, Audit entries.

**Non-scope**: agent parameters, volatility data, price feeds, configuration, user preferences, blockchain raw state. Those have separate persistence needs and are not governed by this document.

---

## 2. What Needs to Survive Restart

The following in-memory structures are the sources of truth today. After restart, they are lost and must be rebuilt or recovered.

### 2.1 SettlementRegistry (`frameworkSettlementRegistry`)

| Field | Cardinality | Recoverable from on-chain? |
|-------|-------------|---------------------------|
| `SettlementRecord` (22 fields) | 1 per settlement event | TX hash can be re-queried; `balanceDeltas`, `gasUsed`, and `canonicalSettlement` are computed off-chain and NOT recoverable purely from RPC |
| Internal indices (`byCorrelationId`, `byTxHash`, `byOrdemId`) | 1 per key | Rebuildable from stored records |

**Risk without persistence**: The system loses knowledge of which settlements were `confirmed canonical`, which `balanceDeltas` were applied, and which `gasUsed` values were recorded. The blockchain holds the raw transaction but not the coordinator's interpretation of it.

### 2.2 DecisionReport (on `IntentRecord` in `frameworkIntents`)

| Field | Recoverable from? |
|-------|-------------------|
| `settlementStatus` | Partially from RPC (confirmed/failed) |
| `canonicalSettlement` | **No** — this is a coordinator-level decision |
| `txHash`, `blockNumber`, `gasUsed` | Yes, from RPC |
| `balanceDeltas` | **No** — computed off-chain |
| `synthetic` flag | **No** — internal diagnostic |
| `knowledgeReport`, `knowledgeModifier` | **No** — pure computation |
| `onChainHash`, `onChainTx`, `onChainStatus` | Yes, from ArcScan |

**Risk without persistence**: Coordinator loses the mapping from intent → decision → settlement. The `canonicalSettlement` flag and `balanceDeltas` cannot be recovered from on-chain data alone.

### 2.3 Pending Settlement Replay Queue (`_pendingSettlementReplays`)

| Field | Recoverable from? |
|-------|-------------------|
| `PendingSettlementReplayEntry` (record + retry metadata) | **No** — this queue is ephemeral by design. It exists precisely because a `registerPending` call arrived before the DecisionReport was saved. After restart, SettlementRegistry and IntentRecord would need re-synchronization |

**Risk without persistence**: Entries queued because the DecisionReport wasn't yet saved will be permanently lost. The SettlementRegistry will have records without matching DecisionReports. These become "orphan settlements" that never sync to the intent system.

### 2.4 Audit (`frameworkAudit`)

| Field | Recoverable from? |
|-------|-------------------|
| `AuditEntry` (trace of every decision) | **No** — pure off-chain record |

**Risk without persistence**: Loss of audit trail. This is acceptable during demonstration but unacceptable for regulated operation or external audit.

### 2.5 Non-Persisted (by Design)

These structures are intentionally ephemeral and should NOT be persisted:

- Agent reputation scores (recalculated on restart from stored Audit)
- KnowledgeService cache (rebuilt from live queries)
- Volatility data, price feeds, market data (lives in its own cache layer)
- PolicyEngine runtime state
- PiEngine warmup state, Arqueiro ATR baselines

---

## 3. Source of Truth During Transition

The transition from memory-only to durable storage follows a **shadow-first** model with explicit phases. At every phase, it is unambiguous which representation is authoritative.

### 3.1 Authoritative Representations by Phase

| Phase | Registry | DecisionReport | Queue | Behavior |
|-------|----------|---------------|-------|----------|
| 1 — Today | Memory | Memory | Memory | Coordinator reads/writes memory directly |
| 2 — Shadow Write | **Memory** | **Memory** | **Memory** | Persistence layer receives writes; zero read path |
| 3 — Comparison | **Memory** | **Memory** | **Memory** | Background comparator detects divergences, logs them |
| 4 — Recovery Test | Memory | Memory | Memory | Manual restart exercises recovery path; comparison validates results |
| 5 — Flag-Controlled Read | **Memory** | **Memory** | **Memory** | `PERSISTENCE_RECOVERY_ENABLED=true` allows reading from persistence on restart only |
| 6 — Authority | **Persistence** | **Persistence** | **Memory** | After audit confirmation, persistence becomes authority |

**Key rule**: At no point does the system consult BOTH sources and pick the "better" one. There is always a single, explicit, configured authority.

### 3.2 Dual-Write Model (Phase 2)

```
Coordinator
     │
     ├─► Memory (authority, unchanged)
     │
     └─► Persistence.write(shadow copy, fire-and-forget)
          │
          └─► on error: log warning, DO NOT affect memory path
```

The persistence write in Phase 2:
- Is fire-and-forget (not awaited in the hot path)
- Never influences the return value or control flow of the Coordinator
- Errors are logged at `warn` level, never `error`
- Has a dedicated `PERSISTENCE_WRITE_ENABLED` flag independent of recovery

### 3.3 Hard Cutover vs. Gradual

**Decision**: Gradual shadow transition. Hard cutover is rejected.

Rationale:
- A hard cutover introduces a binary risk point: "it worked in memory, does it work in persistence?"
- Shadow writes provide days or weeks of comparison data before the switch
- If persistence has bugs, they are visible in logs before they become operational
- Rollback from Phase 2-4 is a single flag flip (`PERSISTENCE_WRITE_ENABLED=false`)
- Rollback from Phase 6 requires migration, but by then confidence is established

---

## 4. Kill Switch Architecture

Two independent flags. Both default to `false`. Both are runtime-configurable without restart.

### 4.1 `PERSISTENCE_WRITE_ENABLED`

When `false`:
- No writes to persistence occur
- Shadow writes stop immediately
- Existing persisted data is NOT deleted, NOT reinterpreted
- The runtime continues with memory-only operation

When `true`:
- Shadow writes fire on every state mutation
- Writes are best-effort (failures logged, not thrown)

### 4.2 `PERSISTENCE_RECOVERY_ENABLED`

When `false`:
- On restart, the system starts with empty state (current behavior)
- Existing persisted data is ignored entirely
- No attempt to read, hydrate, or validate persisted records

When `true`:
- On restart, the system reads from persistence
- Hydration follows the validation pipeline (Section 7)
- Recovery failures leave the system in empty state (not partially-hydrated)

### 4.3 Flag Independence

These flags are independent to support asymmetric scenarios:

| WRITE | RECOVERY | Use Case |
|-------|----------|----------|
| false | false | Current behavior (baseline) |
| true  | false | Shadow writes active, no recovery — write-only accumulation for later comparison |
| true  | true  | Full durability — writes and recovery active (Phase 5-6) |
| false | true  | **Invalid state** — guarded by startup assertion |

The `false | true` quadrant is explicitly rejected because it would mean recovering from data that no process is currently writing, leading to stale reads.

### 4.4 Emergency Rollback

If persistence introduces a bug in Phase 6 (authority mode):

1. Set `PERSISTENCE_RECOVERY_ENABLED=false`
2. Restart the process
3. The system starts empty (memory-only, current behavior)
4. The persisted data remains on disk (not deleted, not migrated)
5. Investigation proceeds against the persisted copy without affecting runtime

There is no "revert migration" because there is no migration. The flags disable the persistence path without mutating the stored data.

---

## 5. Persistence Format and Versioning

### 5.1 Storage Format

```
arcflow_persistence_v1
├── version:              1
├── created_at:           ISO 8601 timestamp
├── last_write_at:        ISO 8601 timestamp
├── checksum:             SHA-256 of serialized payload (hex)
├── settlement_registry:
│   └── records[]:        Array<SettlementRecord>   (ordered by timestamp)
├── decision_reports:
│   └── reports[]:        Array<{intentId, DecisionReport}>
├── pending_replay_queue:
│   └── entries[]:        Array<PendingSettlementReplayEntry>
└── audit:
    └── entries[]:        Array<AuditEntry>
```

### 5.2 Serialization

- Format: JSON (line-delimited for append-friendly writes, or single blob for atomic write)
- Encoding: UTF-8 without BOM
- All `bigint` fields stored as strings with `n` suffix (e.g., `"21000n"`)
- All `number` fields stored as JSON numbers
- All `undefined` fields omitted entirely (not stored as `null`)
- Timestamps stored as `number` (epoch ms), not ISO strings, to match in-memory representation
- `Record<string, string>` fields (e.g., `balanceDeltas`) stored as JSON objects

### 5.3 Versioning

The format version (`version: 1`) is a monotonically increasing integer stored as the first field in the payload.

**Backward compatibility rules**:
- A reader MUST reject any version it does not recognize (no silent degradation)
- A writer MUST only write the version it supports
- Version bumps occur when the schema changes in a way that would break a reader
- Version bumps are documented in this file's revision history
- The version number maps to a specific commit range via git tag

**Version 1 fields are frozen**. Adding optional fields (backward-compatible) does not require a version bump. Removing or renaming fields does.

### 5.4 What Is NOT Versioned

- The file format (JSON) — assumed stable
- The storage backend (localStorage, file system, IndexedDB) — abstracted behind `IPersistenceBackend`
- The checksum algorithm (SHA-256) — documented, not versioned
- The quarantine format (same as main format, Section 6)

---

## 6. Checksum and Quarantine

### 6.1 Checksum Computation

```
payload = JSON.stringify(root_object_without_checksum_field)
checksum = SHA256(payload)
```

The checksum is computed over the entire serialized payload **excluding** the `checksum` field itself. The checksum is stored at the top level as a hex string.

### 6.2 Write-Time Integrity

On every write:
1. Serialize the current state snapshot
2. Compute SHA-256 checksum
3. Embed checksum in the payload
4. Write the complete payload to the backend

The backend write is atomic (either fully written or not written at all). For backends that don't support atomic writes natively (e.g., `localStorage`), use a staging approach:
1. Write to `arcflow_persistence_v1.tmp`
2. Compute checksum of the temp file
3. Rename `arcflow_persistence_v1.tmp` → `arcflow_persistence_v1` (atomic on most filesystems)

### 6.3 Read-Time Integrity

On every read:
1. Read the complete payload
2. Extract the stored checksum
3. Recompute checksum over the payload minus the checksum field
4. If checksums match → payload is intact
5. If checksums mismatch → **quarantine**

### 6.4 Quarantine Behavior

When checksum validation fails:
1. The entire payload is moved to `arcflow_persistence_v1.quarantine.<ISO timestamp>`
2. A structured warning is emitted with: file path, expected checksum, actual checksum, timestamp
3. The runtime continues with **empty state** (no partial hydration)
4. The system does NOT attempt to salvage individual records from the corrupted payload
5. The quarantine file is retained for forensic analysis

**Rationale for no partial salvage**: The records within a corrupted payload may appear valid individually but could have been truncated mid-write. Partial records (e.g., a SettlementRecord missing its `canonicalSettlement` field) would produce inconsistent state. The invariant from Phase 2e.2h (monotonicity) and Phase 2e.2i (exception safety) cannot be guaranteed for partial data.

---

## 7. Atomicity of Writes

### 7.1 Scope of Atomicity

A single persistence write operation encompasses the **complete state snapshot** of all four persisted domains:

- SettlementRegistry records
- DecisionReports
- Pending replay queue
- Audit entries

These are written as a single blob because they reference each other:
- A `DecisionReport.execution.txHash` must match the corresponding `SettlementRecord.txHash`
- A `PendingSettlementReplayEntry` references a `SettlementRecord` by `settlementId` and `correlationId`
- An `AuditEntry` references an `IntentRecord` by `intentId`

Writing them independently would allow states where a SettlementRecord exists on disk but its DecisionReport doesn't, or vice versa.

### 7.2 Backend Abstraction

```
interface IPersistenceBackend {
  write(key: string, data: Uint8Array): Promise<void>  // atomic
  read(key: string): Promise<Uint8Array | null>          // null = not found
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}
```

Backend implementations (not part of this design phase):
- `LocalStorageBackend` — `localStorage.setItem(key, base64)` (single-key atomic)
- `FileSystemBackend` — `fs.writeFile(tmp) + fs.rename(tmp, target)` (POSIX atomic rename)
- `IndexedDBBackend` — `transaction.put(store, value)` (transactional)

### 7.3 Write Cadence

Writes are **NOT** triggered on every mutation. They follow a batching strategy:

- **Debounce**: 2-second window after the last mutation
- **Maximum staleness**: 10 seconds (forced write even if mutations continue)
- **On shutdown**: best-effort `write()` call in `beforeunload` / `SIGTERM` handler

This reduces write pressure for high-frequency mutations (e.g., rapid settlement confirmations) while bounding potential data loss to at most 10 seconds.

### 7.4 Write Failure

If a write fails (backend error, quota exceeded, disk full):
- The in-memory state is NOT affected (authority remains memory)
- A warning is logged with the backend error
- The next write attempt proceeds normally (no backoff)
- No queue of failed writes is maintained (next snapshot supersedes)

---

## 8. Hydration and Validation

### 8.1 Hydration Pipeline (on Restart)

```
1. Read payload from backend
   │
   ├─ null / not found → start with empty state (normal for first run)
   │
   └─ payload found
        │
       2. Validate version (reject unknown versions)
        │
       3. Validate checksum (quarantine on mismatch, start empty)
        │
       4. Deserialize JSON (quarantine on parse error, start empty)
        │
       5. Validate structural invariants (Section 8.2)
        │
       6. Rebuild internal indices
        │
       7. Hydrate singletons (Section 8.3)
        │
       8. Reconcile queue with DecisionReports (Section 8.4)
```

### 8.2 Structural Invariants

Before hydration, every record is validated against the invariants established by prior phases:

| Invariant | Source | Check |
|-----------|--------|-------|
| No `settled` status in Registry | 2e.2h | `record.status !== "settled"` |
| Monotonic status flow | 2e.2h | If multiple records for same `correlationId`, status never regresses |
| Single `canonicalSettlement: true` per `correlationId` | 2e.2h | Count ≤ 1 |
| `retryCount ≤ MAX_SETTLEMENT_REPLAY_ATTEMPTS` | 2e.2i | Any entry with `retryCount > 5` is discarded |
| `pendingSettlementReplays.length ≤ MAX_PENDING_SETTLEMENT_REPLAYS` | 2e.2i | Truncate to 500 |
| `DecisionReport.execution` references valid `correlationId` in Registry | Consistency | If a report exists, its `correlationId` must exist in the registry (or be queued) |
| `balanceDeltas` keys are valid token symbols | Schema | Recognized token symbols only |

Any record that fails these invariants is:
1. Removed from the hydrated dataset
2. Logged with a structured warning (`action=hydration_invariant_failed`)
3. Counted in a recovery report (`recovery.skippedRecords`)

The system hydrates only valid records. It does not attempt to fix them.

### 8.3 Singleton Hydration Order

```
1. SettlementRegistry — hydrate first (other structures reference it)
2. IntentPublisher (DecisionReports) — hydrate second (references Registry)
3. PendingSettlementReplayQueue — hydrate third (references both above)
4. Audit — hydrate last (independent, references Intents)
5. Rebuild internal indices (byCorrelationId, byTxHash, byOrdemId)
```

### 8.4 Queue-Report Reconciliation

After hydration, entries in `pendingSettlementReplays` may reference SettlementRecords whose DecisionReport now exists (because both were persisted together). These entries represent settlements that were queued before the report was saved, but the report was saved before the persistence snapshot.

Reconciliation process:
1. For each queue entry, check if a DecisionReport exists for its `correlationId`
2. If yes → replay the settlement immediately (projection succeeds, entry removed)
3. If no → the entry remains in the queue (was genuinely pending at snapshot time)
4. Log the count of reconciled vs. retained entries

This prevents "zombie queue entries" that survived a restart despite their reports being available.

---

## 9. Rollback

### 9.1 Rollback Definition

Rollback means: **the system returns to operating as if persistence was never enabled.**

This is achieved by setting both flags to `false` and restarting. The persisted data remains on disk but is ignored.

### 9.2 What Rollback Does NOT Do

- Does NOT delete persisted data
- Does NOT attempt to "merge" persisted state into memory
- Does NOT interpret or validate the persisted payload
- Does NOT require a code deploy or configuration change beyond flag values

### 9.3 When Rollback Is Triggered

- Operator sets `PERSISTENCE_RECOVERY_ENABLED=false` (any phase)
- Operator sets `PERSISTENCE_WRITE_ENABLED=false` (stops writes, affects future restarts)
- Recovery validation fails (automatic rollback — system starts empty)
- Checksum mismatch (automatic rollback via quarantine)

### 9.4 Post-Rollback State

After rollback:
- Memory is empty (fresh start)
- SettlementRegistry is empty
- DecisionReports are empty
- Queue is empty
- Audit is empty
- The Coordinator must re-discover state from on-chain data (RPC queries)
- This is identical to the current behavior after a browser refresh or server restart

---

## 10. Behavior Under Corruption

### 10.1 Corruption Scenarios

| Scenario | Detection | Response | Recovery |
|----------|-----------|----------|----------|
| Checksum mismatch | SHA-256 validation on read | Quarantine file, start empty | Manual investigation of quarantine file |
| JSON parse error | `JSON.parse` throws | Quarantine file, start empty | Manual inspection of raw bytes |
| Unknown version | Version field check | Start empty, log warning | Deploy compatible reader |
| Truncated write (incomplete JSON) | JSON parse error | Quarantine file, start empty | Use staging write to prevent |
| Partial write (some records missing) | Structural invariant check | Reject invalid records, hydrate valid ones | Section 8.2 |
| Record count > expected (injection) | Cap enforcement | Truncate to cap | Audit log for anomaly |
| Timestamp in future | `timestamp > Date.now() + 1h` | Accept record, log warning | Clock sync investigation |

### 10.2 Corruption Logging

All corruption events log with this structure:

```
[PERSISTENCE] action=<action> checksum_expected=<hex> checksum_actual=<hex> file=<path> version=<n>
```

Where `<action>` is one of: `quarantined_checksum_mismatch`, `quarantined_parse_error`, `hydration_invariant_failed`, `version_rejected`, `record_capped`.

### 10.3 No Auto-Repair

The persistence layer makes no attempt to auto-repair corrupted data. Rationale:
- Auto-repair would need to guess which version of conflicting data is correct
- The invariants from 2e.2h and 2e.2i are the only source of truth for correctness
- Without human judgment (or external on-chain verification), auto-repair risks cementing incorrect state
- The quarantine file preserves evidence for manual investigation

---

## 11. Retry Handling After Restart

### 11.1 Queue Retry State

The `retryCount` and `lastAttemptAt` fields on `PendingSettlementReplayEntry` are persisted as part of the queue snapshot. On restart:

1. **`retryCount < MAX_SETTLEMENT_REPLAY_ATTEMPTS`**: The entry is re-enqueued with its existing retryCount. The next `flushPendingSettlementReplays()` call will attempt it again. The `retryCount` does NOT reset to 0 on restart — the existing count is preserved.

2. **`retryCount >= MAX_SETTLEMENT_REPLAY_ATTEMPTS`**: The entry is dropped on hydration (same behavior as the in-memory drop after 5 failures). A warning is logged with `action=dropped_after_retry_limit` and the original correlationId/settlementId.

### 11.2 LastError Preservation

The `lastError` field persists across restarts. This enables post-mortem analysis: an operator can inspect the quarantine or log to determine what caused repeated failures.

### 11.3 FirstQueuedAt Timestamp

`firstQueuedAt` is an absolute epoch timestamp. It survives restarts. This enables:
- Age-based eviction (entries older than 1 hour are suspicious)
- Logging: "Entry for corrId X has been queued since timestamp Y"
- Monitoring: alert if any entry's age exceeds a threshold

### 11.4 Replay After Restart

On restart, the Coordinator's `runCycle()` calls `retryPendingProofs()` (for on-chain proofs) and can also call `flushPendingSettlementReplays()` (for settlement queue). This means:

- Queue entries that survived the restart will be retried on the next cycle
- The retry mechanism from Phase 2e.2i operates identically after restart
- The `MAX_SETTLEMENT_REPLAY_ATTEMPTS` limit is global across restarts (entries don't get infinite retries just because the process restarted)

---

## 12. Relationship Between Registry, Queue, and DecisionReport

### 12.1 Current Data Flow (Memory)

```
registerPending(record)
    │
    ├─► SettlementRegistry.save(record)     [always synchronous]
    │
    └─► listener(record)                     [updateDecisionReportFromSettlement]
         │
         ├─ DecisionReport exists?
         │   ├─ YES → update report, projection succeeds
         │   └─ NO  → enqueue in _pendingSettlementReplays
         │
         └─ Queue entry created with { record, retryCount: 0, firstQueuedAt: now }

setDecisionReport(intentId, report)
    │
    └─► flushSettlementsForIntent(intentId)
         │
         └─► replaySettlementForCorrelationId(intentId)
              │
              └─► For each queued entry with matching correlationId:
                   try projection → success (remove) or failure (retain, increment retryCount)
```

### 12.2 Persistence Implications

All three structures (Registry, Queue, DecisionReport) must be persisted as a single snapshot (Section 7.1) because:

1. A Registry record without its DecisionReport is an orphan
2. A Queue entry without its Registry record is dangling
3. A DecisionReport without its Registry record is unverifiable

The persistence write is triggered after any of these mutations complete, via the debounced write cadence (Section 7.3).

### 12.3 Reconciliation on Hydration

```
On restart:
  Registry ← persisted
  Reports  ← persisted
  Queue    ← persisted

  For each Queue entry:
    If Report exists for entry.correlationId → replay now, remove from queue
    If not → keep in queue

  For each Registry record:
    If no Report exists AND not in Queue → log "orphan registry record"
```

Orphan registry records (Section 2.3 risk) are logged and kept. They represent settlements that were registered but never had a DecisionReport created — this is a legitimate state (the report may be created by a future cycle).

---

## 13. Non-Goals (Explicit)

### 13.1 Multi-Instance Support

This design assumes a **single process**. It does not address:
- Shared state across multiple Node.js instances
- Distributed locks or leader election
- Cross-process SettlementRegistry synchronization
- Concurrent writes from different coordinator instances

These are deferred to a future design phase triggered by operational need for horizontal scaling.

### 13.2 Serverless / Ephemeral Compute

This design assumes a **long-running process** with a local or network-accessible persistence backend. It does not address:
- Lambda-style ephemeral execution
- Cold start with persistence fetch from remote
- Stateless function architecture
- Session affinity or sticky routing

Serverless is explicitly out of scope for Phase 2e.2j. If the deployment model changes to serverless, a new design phase is required.

### 13.3 Relational Database

This design uses a **blob/key-value** persistence model. It does not address:
- SQL schema design
- Normalization across tables
- Transactional updates to individual records
- Query capabilities (the blob is loaded in full)

If relational storage becomes necessary, the `IPersistenceBackend` abstraction allows swapping the backend without changing the serialization format.

### 13.4 Incremental Writes

This design uses **full snapshot** writes. It does not address:
- Append-only journals
- Write-ahead logs (WAL)
- Differential/delta updates
- Point-in-time recovery across multiple snapshots

Full snapshots are sufficient for the current data volume (hundreds of records, not millions). Incremental writes add complexity that is not justified before operational triggers fire.

### 13.5 Cross-Session IntentRecord

`IntentRecord` objects (in `frameworkIntents`) carry transient fields (`votes`, `status`, `timestamp`) that are not currently persisted. This design persists only the `DecisionReport` attached to an IntentRecord, not the full IntentRecord. Full intent lifecycle persistence is a separate concern.

---

## 14. Objective Criteria for Authorizing Phase 2e.2k

Phase 2e.2k (Persistence Implementation) is authorized when **at least one** of the following conditions is true:

### 14.1 Operational Triggers

| # | Trigger | Rationale |
|---|---------|-----------|
| T1 | System must operate continuously for >24h without manual restart | Memory state loss becomes unacceptable |
| T2 | Capital at risk (real trading, not testnet) | Financial accountability requires durability |
| T3 | Recovery after restart without manual intervention is required | Operational independence |
| T4 | Multiple instances need to share state | Memory isolation prevents consistency |
| T5 | External auditor requires proof of durability | Compliance requirement |
| T6 | Loss of in-memory state has compromised reconciliation | Demonstrated failure |
| T7 | Project moves from controlled demonstration to permanent operation | Production readiness |

### 14.2 Preconditions (must ALL be satisfied)

Even if a trigger fires, these preconditions must be met:

| # | Precondition | Status |
|---|-------------|--------|
| P1 | Deployment environment is defined (single-process vs. multi-instance) | **Unknown** — depends on Vercel/Arc deployment decision |
| P2 | Storage backend is chosen and available (`localStorage` for browser, filesystem for Node, or shared KV) | **Unknown** — depends on deployment model |
| P3 | `IPersistenceBackend` interface is implemented for the target backend | **Not started** |
| P4 | Phase 2e.2j design is reviewed, committed, and tagged | **This document** |
| P5 | Test suite covers persistence round-trip (write → restart → read → validate) | **Not started** |
| P6 | Shadow-write comparison has run for ≥7 days without divergence | **Not started** |
| P7 | Kill switch flags are wired and tested | **Not started** |

### 14.3 Blocking Conditions

Phase 2e.2k MUST NOT start if:

- The deployment model is undecided (serverless vs. long-running)
- The storage backend is not selected
- Any Phase 2e.2h (monotonicity) or Phase 2e.2i (exception safety) invariant has an open bug
- The test suite does not pass 100% (371/371 as of 2e.2i)

---

## 15. Implementation Phases After Authorization

These are NOT part of this design phase. They are included here to show the complete plan and to prevent scope creep during 2e.2j.

### Phase 2e.2k — Persistence Backend Implementation

- Implement `IPersistenceBackend` for the chosen storage
- Implement write path (serialize → checksum → store)
- Implement read path (load → checksum → deserialize → hydrate)
- Implement quarantine mechanism
- Wire kill switch flags
- Zero changes to Coordinator control flow (still reads from memory)

### Phase 2e.2l — Shadow Write + Comparator

- Deploy shadow writes in testnet with `PERSISTENCE_WRITE_ENABLED=true`, `PERSISTENCE_RECOVERY_ENABLED=false`
- Run comparator: after each write, compare in-memory snapshot with persisted snapshot
- Log and fix any divergences
- Run for ≥7 days without divergence

### Phase 2e.2m — Recovery Verification

- Implement recovery test harness (simulated restart)
- Test hydration pipeline (load → validate → hydrate → reconcile)
- Classify records as: recoverable, conflicting, corrupted
- Generate audit report of recovery attempt
- Verify that invariants from 2e.2h and 2e.2i hold on hydrated state
- Do NOT create a second state machine or "guess" which state wins

### Phase 2e.2n — Authority Transition

- Enable `PERSISTENCE_RECOVERY_ENABLED=true` after audit confirmation
- Persistence becomes authority on restart
- Memory remains authority during runtime
- Monitor for ≥14 days before declaring Phase 2e complete

---

## 16. Design Decisions Summary

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Full snapshot writes, not incremental | Data volume is small (hundreds of records); simplicity > efficiency |
| D2 | Single blob, not separate files per domain | Cross-domain consistency (Registry ↔ Queue ↔ Report) |
| D3 | SHA-256 checksum, not CRC/MD5 | Collision resistance for forensic evidence |
| D4 | Quarantine on corruption, not auto-repair | Human judgment required for conflicting data |
| D5 | Debounced writes (2s/10s), not per-mutation | Reduces I/O for rapid settlement bursts |
| D6 | Two independent kill switches, not one | Allows asymmetric write-only/recovery-only modes |
| D7 | Gradual shadow transition, not hard cutover | Days of comparison data before trust is established |
| D8 | Memory is authority during transition, not persistence | Preserves existing behavior; persistence is observer until proven |
| D9 | Structural invariant validation on hydration | Prevents corrupted/regressed data from entering runtime |
| D10 | No partial salvage from corrupted payloads | Invariants from 2e.2h/2e.2i cannot be guaranteed on partial data |
| D11 | Queue retryCount preserved across restarts | Prevents infinite retries across process boundaries |
| D12 | Backend-agnostic via IPersistenceBackend interface | Deployment model is undecided; abstraction allows later binding |

---

## 17. Relationship to Architecture Principles

| Principle | How This Design Respects It |
|-----------|---------------------------|
| P1 — Coordinator is single entry point | Persistence reads/writes happen inside the Coordinator, not as a separate entry point |
| P4 — No shortcut flags | Kill switch flags are explicit, documented, and gated — they don't bypass Coordinator logic |
| P6 — Every domain is an Adapter | Persistence is an Adapter around the existing memory domains, not a replacement |
| P7 — Every decision generates Audit | Persistence writes are auditable events logged through the Audit system |
| P8 — No direct external access | Persistence backend is accessed only through `IPersistenceBackend`, never directly |
| P9 — Framework independent of domain | Persistence layer is in `lib/agent-framework/`, not in any domain module |
| P12 — Global rules belong to Policy Engine | Kill switch flags are managed by Policy Engine configuration |

---

## 18. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1 | 2026-07-11 | ArcFlow Design | Initial versioned design |

---

*This document defines the persistence strategy. It does not authorize implementation. Phase 2e.2k begins only when an operational trigger fires AND all preconditions are satisfied.*
