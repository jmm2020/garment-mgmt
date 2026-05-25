# ADR 0004: BOM Versioning and Cut-Ticket Flow

**Status**: Accepted (2026-05-25)

## Context

Bills of Material change. A new colorway becomes available; a vendor
switches a zipper size; a panel gets reinforced. We need to support
both:

- **Forward changes**: today's cut tickets use today's active BOM.
- **Historical accuracy**: a cut ticket closed three months ago must
  be reproducible exactly — including which BOM version (and which
  components) were in effect at the time it was cut.

## Decision

### BOMs are versioned and (mostly) immutable

- Every BOM has `(product_id, version)` with unique constraint.
- Status lifecycle: `draft → approved → active → superseded`.
- Components are editable **only** while `status = 'draft'`.
- `approveBom(bomId, userId)` snapshots `approved_by_user_id` and
  `approved_at`, then locks components.
- `activateBom(bomId)` performs in a single transaction:
  1. Find any current `status='active'` BOM for the same product.
  2. Transition it to `status='superseded'`.
  3. Set this BOM to `active`.

A partial unique index `UNIQUE (product_id) WHERE status = 'active'`
guarantees at most one active BOM per product at the DB level.

### Cut tickets snapshot their BOM by ID

A cut ticket stores `bom_id` directly. Even if the BOM is later
superseded, the cut ticket references its historical BOM. Closed cut
tickets are reproducible: re-running `componentsForCutTicket(bom_id,
plannedQuantityBySize)` yields the same component requirements
forever.

### State transitions are explicit functions

No generic `update()` on cut tickets. Each transition is a named
service function:

- `createCutTicket(...)` — `draft → allocated` (allocates lots in
  same txn).
- `markInCutting(id, userId)` — `allocated → in_cutting`, stamps
  `started_at`.
- `closeCutTicket({ ticketId, actuals })` — any → `closed`, writes
  actuals + remnants in one txn.
- `cancelCutTicket(id, reason)` — only from `draft` or `allocated`.

Each function:

- Enforces its precondition (current status, BOM activeness).
- Writes the audit row with `action='state_transition:from->to'`.
- Returns the after-state.

This is verbose vs. a generic update, but it makes the state machine
visible at the type level and at the call site.

## Consequences

**Positive**:

- A closed cut ticket from Q1 2027 can be reopened, inspected, and
  reproduced; the BOM it points at never changes.
- Active-BOM uniqueness is enforced at the DB layer, not just service
  code — defense in depth.
- State transitions surface as named functions, which makes new
  developers immediately see the lifecycle without grepping for
  `status = …` strings.

**Negative**:

- Versioning means we never _fix_ an approved BOM — we publish a new
  version. This is correct but feels heavy for typos. We accept this
  tradeoff because the operator-visible cost is "approve again."
- Each state transition is a new function; the service file gets long.
  We accept this in exchange for grep-ability.

**Dye-lot integrity at allocation** (relevant to BOM flow):

`bom_components.is_visible_panel = true` drives the allocator:

- If true, **all panels of that component within this cut ticket must
  come from a single `dye_lot`**.
- Allocator picks the smallest dye_lot group that satisfies the need
  to leave larger groups for future tickets.
- If no single dye_lot can fulfill, raise `BusinessRuleError
('dye_lot_integrity_violation', …)`.
- Operator override: `createCutTicket({ ..., allowDyeLotSplit: true })`
  bypasses the constraint when reality demands it.

The override is documented in the API/CLI so the operator can choose
to ship a split-lot garment after acknowledging the colorway risk.
