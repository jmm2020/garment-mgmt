# ADR 0007: Per-Unit Production Tracking for Warranty Provenance

**Status**: Accepted (2026-05-27)
**Addresses**: Issue #9 — Warranty traceability gap at batch level

## Context

The Production Hub today tracks production at the **batch** level (`production_batches`). When a customer returns a defective unit, the forensic chain ends there: we know the batch that produced the garment, but not which individual unit failed QC, which operator handled it, or whether that specific unit had a per-unit verdict recorded.

The original PRD (`docs/prd/production-tracking.md`) listed per-unit identity as a non-goal for iter-2, on the theory that batch-level QC (`qcVerdict`, `qtyActual`) was sufficient for the initial roll-out. In practice, warranty claims have surfaced a real gap: a `pass_with_notes` batch with "2 rejects: bad topstitch" tells us 48 of 50 units shipped, but a returning customer holding unit #37 has no way to confirm whether their unit was one of the two flagged ones or one of the 48 passes.

We need to close this gap before iter-3 ships a customer-facing warranty workflow.

Options evaluated:

| Option                                           | Verdict      | Reason                                                                                               |
| ------------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------- |
| **Status quo (batch-level only)**                | Rejected     | Leaves the warranty trail dead-ended; no path forward for iter-3                                     |
| **External serialization in Shopify metafields** | Rejected     | Cross-system source-of-truth split; can't be queried alongside the lot/cut-ticket chain              |
| **Per-unit rows in `production_batches`**        | Rejected     | Conflates batch (workflow state) with unit (physical object); inflates state-machine transitions     |
| **New `production_units` table**                 | **Accepted** | Additive; batch-level QC untouched; one row per physical garment; serial-indexed for warranty lookup |

## Decision

### 1. Schema: `production_units` table

A new table mints one row per physical garment. Each row carries:

- A globally-unique serial `U-{YYYY}-{NNNNNN}` (6-digit zero-padded, year-scoped)
- An FK to `production_batches.id`
- A per-unit `status` enum: `created | qc_passed | qc_rejected | shipped`
- A per-unit `qc_verdict` (reuses the existing `qc_verdict` enum — `pass | fail | pass_with_notes`)
- A per-unit `qc_actor_user_id`, `qc_at`, and `qc_rejected_reason`
- Standard `created_at` / `updated_at` timestamps

The `qc_verdict` column reuses the existing enum (declared once on `production_batches`) — units do not get their own verdict type.

### 2. Mint trigger: `startProduction`

Units are minted **at `startProduction`** (the `staged_pre_prod → in_production` transition), inside the same transaction. Quantity equals `qty_planned`.

Alternatives considered:

| Trigger             | Verdict      | Reason                                                                                                                            |
| ------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `receiveFromCutter` | Rejected     | Too early — at receive, the bundles are still a planning artefact; no physical units exist                                        |
| `completeBatch`     | Rejected     | Too late — units physically exist the moment sewing begins; minting at completion blocks any iter-3 in-progress per-unit tracking |
| `startProduction`   | **Accepted** | Aligns with the moment units physically come into being on the floor                                                              |

### 3. Serial scheme

`U-{YYYY}-{NNNNNN}`, sequential per UTC year, 6-digit zero-padded. The next serial is computed by `SELECT MAX(unit_serial) WHERE unit_serial LIKE 'U-{YYYY}-%'` inside the minting transaction — identical pattern to `nextBatchNo` for `PB-{YYYY}-{NNNN}` batch numbers.

6 digits accommodates up to 999,999 units per year; current scale runs ~50,000 units annually with 10x headroom for growth. Year rollover resets the counter.

### 4. Per-unit QC is additive, not a replacement

- Batch-level `qcVerdict` and `qtyActual` on `production_batches` are **untouched** by this change.
- `completeBatch` still records a batch-wide verdict for floor-supervisor decision-making.
- Per-unit QC (`recordUnitQcVerdict`) is a separate path used by QC inspectors flagging individual units.
- Operators can run one or both flows independently.

### 5. What is deferred (NOT building in this issue)

- **`shipped` status transition** — the enum value exists; no `shipUnit` service function or route until iter-4+ customer-facing warranty UI.
- **Per-unit sew-operator tracking** — units mint at `startProduction` with no per-unit actor; granular operator-per-unit tracking is iter-3+ when a sew-station UI ships.
- **Historical batch backfill** — already-completed batches do not retroactively get unit rows; documented as a follow-up issue.
- **Customer-facing warranty registration UI** — iter-4+.

## Consequences

**Positive**:

- Warranty claims gain a unit-level forensic chain: serial → unit → batch → cut ticket → lots → operator.
- Batch-level workflow is untouched; no regression risk for existing `production_batches` flows.
- Per-unit verdicts unblock iter-3's station-level UI without requiring further schema migrations.
- Serial format mirrors batch number format, so operator mental model stays consistent.

**Negative**:

- Database row count increases by ~`qty_planned` per batch. Typical batch is 20–200 units; at ~50k units/year this adds ~50k rows annually. Negligible at current scale.
- `startProduction` now performs an additional N-row insert inside its transaction. For a 200-unit batch this is one `INSERT … VALUES (…)` with 200 rows — well within Postgres performance budget.
- Concurrent `startProduction` calls could race on `MAX(unit_serial)`. Same single-row-per-batch lock pattern as `nextBatchNo`; acceptable at single-server scale.

**Mitigations**:

- The mint runs in the same transaction as the state transition: if the unit insert fails, the batch never transitions to `in_production`. No partial state.
- `nextUnitSerial` reads `MAX` inside the transaction; under the default `READ COMMITTED` isolation this is sufficient for the current single-writer pattern. If contention becomes a problem, a dedicated sequence is the next step.

## Related

- ADR-0005 (Production Tracking + Shopify FG) — establishes the `production_batches` table that units now extend.
- Issue #9 — defines the warranty-traceability acceptance criteria implemented here.
- `docs/prd/production-tracking.md` — removes "per-unit identity" from the non-goals list.
