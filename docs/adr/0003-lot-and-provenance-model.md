# ADR 0003: Lot Tracking and Provenance Model

**Status**: Accepted (2026-05-25)

## Context

The core differentiator of the Production Hub is **per-roll, per-dye-lot
traceability** from vendor PO through cut output to remnant. Adventure-
outerwear customers increasingly demand certifiable claims:

- "This jacket is PFAS-free." → traceable to mill cert via lot.
- "This colorway is consistent." → all visible panels must share a
  single dye lot.
- "Where was this fabric made?" → `material_lots.country_of_origin`
  joined back through PO line → PO → vendor.
- "Why does this defect cluster appear in 8 garments?" → cluster by
  `cut_ticket_lot.material_lot_id → dye_lot`.

We need three coordinated tables:

- `material_lots` — physical instance of a roll/batch.
- `lot_movements` — append-only ledger of every quantity change.
- `remnants` — what's left after a cut, with `parent_lot_id` linkage.

## Decision

**Three rules govern the lot/provenance model:**

### 1. Parent lots are decremented to physical truth

When a cut consumes 25 yards from `lot.id=42`, we write:

- `material_lots.quantity_remaining -= 25` (lot now shows truth of what's
  left on the roll).
- `lot_movements (movement_type='consumption', quantity=-25)` ledger row.

This is the **only** authoritative source. Anyone querying "how much
of lot 42 is left on the roll?" reads `quantity_remaining`. Anyone
auditing "what happened to lot 42 over time?" reads `lot_movements`.

### 2. Remnants are first-class, with explicit parent linkage

A 0.5-yard scrap returned at cut close is **not** added back to the
parent lot. It becomes a **new `remnants` row** with
`parent_lot_id = 42`. The remnant has its own dimensions, location bin,
and status (`available`, `reissued`, `scrap`).

This separates two different inventory truths:

- "Roll 42 has 0 yards left" (parent lot).
- "We have a 36in × 58in piece in bin B-3 that originated from roll 42"
  (remnant).

Reissuing a remnant later creates a new `lot_movements` row referencing
the remnant, not the parent.

### 3. `lot_movements` is an append-only polymorphic ledger

```
lot_movements
  movement_type ∈ {receipt, consumption, adjustment, transfer, scrap, remnant_return}
  quantity      signed (positive = into stock, negative = out)
  reference_type text — 'cut_ticket', 'po_line', 'remnant', 'manual'
  reference_id   bigint — points into the referenced table
```

Polymorphism is intentional: a lot's history references multiple
unrelated tables. A discriminated-union join table would explode
the schema without buying us anything.

## Consequences

**Positive**:

- Invariant: `sum(lot_movements.quantity WHERE lot_id = X) ==
material_lots.quantity_remaining(X)` — exposed in unit tests.
- Provenance query is a clean chain: `lot → po_line → po → vendor →
certifications`, all via FKs.
- Remnant reissuance preserves the chain: query a finished
  garment's panels, follow `cut_ticket_lots.material_lot_id` (which
  may be a remnant), then `remnants.parent_lot_id` back to the original
  roll.

**Negative**:

- Polymorphic FK is not DB-enforced; integrity relies on service code.
- Append-only ledger grows unbounded; partitioning by quarter
  becomes necessary at 10M+ rows.

**Concurrency rule**:
Allocation uses `SELECT … FOR UPDATE` on candidate lot rows inside
the cut-ticket-service transaction to prevent two cut tickets racing
to consume the same lot.
