# ADR 0008: Sew-Line Capacity Model + Machine Assignment

**Status**: Accepted (2026-05-29)

## Context

Iteration 2 (ADR-0005) gives a production batch a flat `in_production` state. The
`production_batches` table records *what* is being produced and *who* cut it, but nothing about
*where* on the floor it runs. There is no model for:

- which physical sew line a batch is running on,
- what sew lines exist and how many units each can carry per day,
- what machines sit on each line and whether they are available.

Without this, a floor lead has no system view of line utilisation, any future scheduling or
throughput automation has nowhere to store assignments, and per-line efficiency reporting is
impossible.

The concrete gap is testable: a batch in `in_production` cannot produce a `sew_line_id`, and a
query like `SELECT SUM(qty_planned) FROM production_batches WHERE sew_line_id = ?` cannot be
written because the column does not exist.

This ADR deliberately stops short of auto-scheduling. It lays the data model, an assignment
service, and the CLI/API surface. Load-balancing / auto-scheduling (Phase D) and per-machine
human staffing are deferred to separate issues.

## Decision

### 1. Two new tables: `sew_lines` and `machines`

**`sew_lines`** — a physical production line on the floor.

| Column                   | Notes                                                        |
| ------------------------ | ----------------------------------------------------------- |
| `id`                     | bigint PK                                                   |
| `code`                   | unique, human-readable (e.g., `SL-A`). Printed on floor.    |
| `name`                   | display name                                               |
| `capacity_units_per_day` | integer — informational ceiling used by future scheduling   |
| `active`                 | boolean · default true                                     |
| `created_at`/`updated_at`| timestamps                                                 |

**`machines`** — a machine that lives on exactly one sew line.

| Column         | Notes                                                            |
| -------------- | --------------------------------------------------------------- |
| `id`           | bigint PK                                                       |
| `code`         | unique (e.g., `MC-001`)                                         |
| `type`         | enum: `flatlock`, `coverstitch`, `single_needle`, `overlock`, `bartack`, `other` |
| `sew_line_id`  | FK → `sew_lines` · `ON DELETE restrict`                         |
| `status`       | enum: `available`, `in_use`, `maintenance` · default `available`|
| `created_at`/`updated_at` | timestamps                                          |

`machines.sew_line_id` uses `ON DELETE restrict`: a line cannot be deleted while machines still
reference it. Machines must be removed (or re-homed) first. This keeps the floor topology
consistent and surfaces accidental deletes as an error rather than a silent cascade.

### 2. Line assignment is metadata on the batch, not a status change

`production_batches` gains two nullable columns:

| Column        | Notes                                                                |
| ------------- | ------------------------------------------------------------------- |
| `sew_line_id` | FK → `sew_lines` · `ON DELETE set null` · nullable                  |
| `assigned_at` | timestamp · nullable · set when a line is assigned, cleared on release |

Assigning a batch to a line does **not** change `status`. A batch stays `in_production` (or
whatever non-terminal state it is in); the line is recorded as metadata. This matches the
issue's requirement to model line assignment as a metadata field, and keeps the existing status
graph (ADR-0005) untouched.

`sew_line_id` uses `ON DELETE set null`, not cascade: deleting a line must never cascade-delete a
completed production record. Per CLAUDE.md rule 8 (no soft delete on lifecycle records, and its
corollary — don't cascade-delete them either), the forensic record is preserved and only the
non-critical line reference is nulled.

### 3. Assignment service with named transitions

`sew-line-service.ts` exposes named functions consistent with the rest of the codebase:

- `createSewLine`, `addMachine`, `updateMachineStatus` — CRUD with audit rows.
- `assignBatchToLine` / `releaseBatchFromLine` — set/clear `sew_line_id` + `assigned_at`,
  write a `production_event` (`eventType: "line_assignment"` / `"line_release"`), and an
  `audit_log` row, all in one transaction. Both guard against terminal batches
  (`completed`, `cancelled`) with a `BusinessRuleError`.
- `getLineLoad(sewLineId, date)` — returns the summed `qty_planned` and batch count of
  `in_production` batches on a line for a given day.

`getLineLoad` sums in PostgreSQL (`COALESCE(SUM(qty_planned), '0')`), never by round-tripping
numerics through JS (CLAUDE.md rule 4). Load is keyed off `received_at::date`; the `date`
argument is interpreted in the server's local timezone.

## Consequences

**Positive**:

- A floor lead can assign batches to lines and read per-line, per-day load.
- Future scheduling/throughput automation has a stable place to read `sew_line_id` and
  `capacity_units_per_day`.
- Line/machine topology is queryable and auditable.

**Negative**:

- `ON DELETE restrict` on `machines.sew_line_id` means a line with machines cannot be deleted
  until its machines are removed. This is intentional but is a surprise an admin must be told
  about (the route returns the FK error as a domain error).
- `getLineLoad` ties load to `received_at::date`, a simplification. A batch that spans multiple
  days counts only on its receive date. A richer time model is deferred with Phase D.

## NOT in scope (deferred)

- Auto-scheduling / load balancing across lines (Phase D — separate issue).
- Per-machine human/operator staffing.
- Assigning batches to individual machines (batches assign to lines; machines only track status).
- Any UI (iteration 3+) and real-time load updates.
- Historical load analytics beyond the single-day `getLineLoad`.

## Related

- ADR-0005 (Production Tracking + Shopify FG) — defines `production_batches` and the status graph
  this ADR extends with line metadata.
- ADR-0007 (Per-unit tracking) — the other iteration-2 extension on production batches.
- CLAUDE.md — Hard rules 2 (DomainError), 3 (DbExecutor), 4 (SQL-side numeric arithmetic),
  6 (audit every mutation), 7 (named state-transition functions), 8 (no soft delete / no cascade).
