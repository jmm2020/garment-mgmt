# PRD: Production Tracking

**Iteration**: 2
**Status**: Draft (2026-05-25)
**Owner**: jmm2020
**Companion ADR**: [`0005-production-tracking-and-shopify-fg.md`](../adr/0005-production-tracking-and-shopify-fg.md)

---

## TL;DR

Pull _"sew / QC / finish / pack workflow"_ from iteration 3 forward into iteration 2. Add a **production batch** entity that flows through five floor stations (received → staged → producing → QC → completed), generate a **structured FG SKU** at variant creation, and **push completed batches to Shopify** as the new finished-goods source of truth. Gate production behind a **Production Validation Testing (PVT)** step that the company runs on a small pre-production cut before authorizing the full run.

This iteration **does not** ship a UI. The CLI + REST API drive the floor workflow; UI lands in iteration 3.

---

## Problem

After iteration 1, the operator can:

- Receive raw material from a vendor → create lots
- Allocate fabric from lots into a cut ticket (with dye-lot integrity + FIFO)
- Close a cut ticket and create remnants

What's missing: **what happens between the cut floor and Shopify.**

The current cut ticket goes `draft → allocated → in_cutting → cut → closed`. That `closed` state is a dead end. There is no record of who sewed it, who QC'd it, when it left the floor as finished inventory, or how to push it to the storefront. When a customer reports a defect six months later, the operator has no path from the Shopify line item back to the fabric lot.

This PRD fills that gap.

---

## Goals

1. **Every garment leaving the floor is traceable.** Given a Shopify SKU + batch number, the operator can pull up: cut ticket, fabric lots consumed, who cut, who sewed (recorded by the in-production transition actor), who QC'd, dates of each transition, qty in / qty out, remnants generated.
2. **The storefront reflects production within minutes.** Marking a batch `completed` triggers a Shopify inventory adjust within the next background poll (≤ 60s).
3. **The operator types as little as possible.** Each station transition is one CLI call or one HTTP POST. The system computes the FG SKU; the operator never types it.
4. **Completed batches are permanent.** No soft delete, no edit-after-complete. If a batch was wrong, file a new `cancelled` batch with a reason.

## Non-goals

- Real-time push (WebSocket/SSE) — iteration 3
- React UI — iteration 3
- Multi-facility — iteration 4+
- Native mobile — iteration 4+
- Replacing the Shopify storefront — out of scope forever
- Sew-line capacity planning, machine assignment, scheduling — iteration 3+
- Per-garment tracking (one row per individual unit) — ✅ shipped (PR #9, ADR-0007). Units are minted at `startProduction`; `production_units` table carries serial, status, and per-unit QC verdict.

---

## User story

> _Maria runs the cut floor. She cuts 47 pieces of fabric for batch PB-2026-0042 (Performance Hoodie, Black, Medium, Mens, SS26, 12oz Cotton — from cut ticket CT-2026-0119). She tags the bundle with the batch number, hands it off to Devon in pre-production. Devon scans the tag and runs `gm batch receive PB-2026-0042` on the floor terminal. Tomorrow the bundle gets moved to the sewing area; Devon runs `gm batch start PB-2026-0042`. Two days later, all 47 are sewn; the lead runs `gm batch submit-qc PB-2026-0042 --qty 47`. QC inspects, rejects 2, passes 45. The QC lead runs `gm batch complete PB-2026-0042 --qty 45 --verdict pass_with_notes --note "2 rejects: bad topstitch on hood seam"`. Sixty seconds later, 45 units of SKU PERF-HOOD-BLK-M-MENS-SS26-12OZ-COTTON appear in Shopify._
>
> _Three months later, a customer DMs Maria: "the hood seam on the one I bought is unraveling." She queries: `gm batch find --sku PERF-HOOD-BLK-M-MENS-SS26-12OZ-COTTON --since 2026-04-01`. PB-2026-0042 comes up. She sees the QC note from Devon's lead. She pulls up the fabric lot via `gm lot provenance` from the cut ticket. The mill cert chain is two clicks away._

---

## Production Validation Testing (PVT)

Before any full production run, the company validates the pattern + fabric combination on a small pre-production sample. This protects against:

- **New garments** — a pattern that has never been cut at production scale. First cut surfaces fit issues, marker yield problems, sew-time surprises.
- **Stale garments** — a pattern that has not been cut for an extended period (default: **6 months**, configurable per product). Patterns drift (fabric supplier swaps, pattern recuts, machine recalibration); a PVT confirms the current setup still produces.

### How it works

1. **Trigger.** When the operator attempts `gm batch receive` for a `(product_variant_id, pattern/marker)` pair that has no `validated` PVT _or_ whose most recent validated PVT is older than `pvt_validity_months`, the system rejects with `pvt_required` and tells them which PVT to run.
2. **Cutter cuts a small run** using the production pattern (the same `marker_id` the real batch will use). This produces a small lot — recorded as a normal `cut_ticket` with a `kind='pvt'` discriminator (see §3 below) so it's distinguishable from production cuts.
3. **Cut sample is shipped to the company** for inspection. The operator runs `gm pvt mark-shipped <run-no>` when it leaves the floor.
4. **Company inspects** — a validator on staff at the company reviews the sample. They run `gm pvt validate <run-no>` (pass) or `gm pvt reject <run-no> --reason "..."` (fail). Both record the validator's user ID and timestamp.
5. **On validate** — the PVT row sets `status='validated'`, `validated_at=now()`, `validator_user_id`. The `expires_at` is computed as `validated_at + interval pvt_validity_months`. Production batches against this variant + pattern are now authorized until `expires_at`.
6. **On reject** — the PVT row sets `status='rejected'` with `rejected_reason`. Production stays blocked. The operator must cut another PVT.

### Status flow (PVT)

```
            ┌────────────┐
            │   cutting  │  (cut_ticket exists, sample being made)
            └──────┬─────┘
                   ▼
            ┌────────────┐
            │  shipped   │  (cut leaving the floor, en route to company)
            └──────┬─────┘
                   ▼
            ┌────────────┐
            │ inspecting │  (company received, under review)
            └──────┬─────┘
                   ├──────────► rejected   (terminal — must cut a new PVT)
                   ▼
            ┌────────────┐
            │ validated  │  (terminal — production authorized until expires_at)
            └────────────┘
```

### What we track per PVT run

| Field                | Notes                                                                             |
| -------------------- | --------------------------------------------------------------------------------- | ---------- |
| `run_no`             | `PVT-YYYY-####` — operator-facing, scannable, printed on the sample tag           |
| `product_variant_id` | What's being validated                                                            |
| `marker_id`          | Which pattern/marker — pattern changes invalidate prior PVTs for the same variant |
| `cut_ticket_id`      | The small cut ticket created for the sample (kind='pvt')                          |
| `status`             | `cutting` → `shipped` → `inspecting` → `validated`                                | `rejected` |
| `cutter_user_id`     | Who cut the sample                                                                |
| `validator_user_id`  | Who at the company inspected/validated (null until inspection)                    |
| `cut_at`             | timestamp · when the sample was cut                                               |
| `shipped_at`         | timestamp · when it left the floor                                                |
| `received_at`        | timestamp · when the company logged it as received for inspection                 |
| `validated_at`       | timestamp · set on `validated`                                                    |
| `rejected_at`        | timestamp · set on `rejected`                                                     |
| `rejected_reason`    | text · required on `rejected`                                                     |
| `expires_at`         | timestamp · computed from `validated_at + pvt_validity_months`                    |
| `notes`              | text · validator notes (sew-time surprises, marker yield, fit feedback)           |

A passed PVT is the **permanent forensic record** of the pre-production check that authorized every production batch downstream. Like completed batches, PVTs are append-only after a terminal state.

### Validity window

- Default `pvt_validity_months = 6`, configurable via `products.pvt_validity_months` (nullable; falls back to env `PVT_DEFAULT_VALIDITY_MONTHS=6`).
- Some product lines (e.g., evergreens cut every few weeks) might warrant a 12-month window; volatile lines (technical performance with frequent fabric swaps) might warrant 3 months. The per-product override exists for that.
- The "stale" check is `now() > most_recent_validated_pvt.expires_at`. No grace window — once expired, the next batch attempt is blocked until a new PVT validates.

### What PVT does NOT block

- Cancelling an already-validated production batch (no re-validation required)
- Closing/reopening cut tickets unrelated to production batches
- Cancelling an in-flight PVT (`pvt cancel`)

## Scope

### In scope

1. **`production_batches` entity** with the schema in ADR-0005 §2.
2. **`production_events` log** (immutable append-only).
3. **Six named state-transition functions**:
   - `receiveFromCutter` — from `null` (creation) to `received_from_cutter`. Creates the batch.
   - `stageForProduction` — `received_from_cutter` → `staged_pre_prod`
   - `startProduction` — `staged_pre_prod` → `in_production`
   - `submitForQc` — `in_production` → `awaiting_qc`
   - `completeBatch` — `awaiting_qc` → `completed`. Triggers Shopify push.
   - `cancelBatch` — any non-terminal → `cancelled`
4. **Structured FG SKU** on `product_variants` (generated column per ADR-0005 §3).
5. **REST routes** at `/batches`:
   - `POST /batches` — create (`receiveFromCutter`)
   - `GET /batches` — list with filters (`?status=`, `?sku=`, `?since=`, `?cutter=`)
   - `GET /batches/:id` — single batch with events
   - `POST /batches/:id/stage` — `stageForProduction`
   - `POST /batches/:id/start` — `startProduction`
   - `POST /batches/:id/submit-qc` — `submitForQc` (body: `{ qty }`)
   - `POST /batches/:id/complete` — `completeBatch` (body: `{ qty, verdict, note? }`)
   - `POST /batches/:id/cancel` — `cancelBatch` (body: `{ reason }`)
6. **CLI extensions** at `gm batch …`:
   - `gm batch receive` — stdin: `{ cutTicketId, productVariantId, qtyPlanned, cutterUserId, notes? }`
   - `gm batch list [--status …] [--sku …] [--since YYYY-MM-DD]`
   - `gm batch show <batchNo>` (accepts `PB-YYYY-####` _or_ numeric ID)
   - `gm batch stage <batchNo>`
   - `gm batch start <batchNo>`
   - `gm batch submit-qc <batchNo> --qty <n>`
   - `gm batch complete <batchNo> --qty <n> --verdict <v> [--note …]`
   - `gm batch cancel <batchNo> --reason <r>`
   - `gm batch find --sku <sku> [--since YYYY-MM-DD]`
7. **Shopify Admin API client** at `packages/server/src/integrations/shopify-client.ts`:
   - `inventoryAdjustQuantities(sku, delta, locationId)` (GraphQL)
   - Exponential backoff (1s, 2s, 4s, 8s, 16s — max 5 attempts)
   - Configured via `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_LOCATION_ID`
   - Test mode (`NODE_ENV=test`) logs instead of calling — no network in CI
8. **Background push job** at `packages/server/src/jobs/shopify-inventory-push.ts`:
   - Polls every 30s for `completed` batches with `shopify_pushed_at IS NULL`
   - Runs as part of `pnpm dev` and a separate `pnpm push-job` entry for prod
   - Idempotent: sets `shopify_pushed_at` on success
9. **`product_variants` dimension columns**: `line`, `model`, `color`, `size`, `gender`, `season`, `fabric_type` (per ADR-0005 §3)
10. **SKU validation**: Zod schemas reject unknown values per dimension. Allowlists live in `packages/db/src/schema/product-variant-dimensions.ts` (e.g., `GENDER = ['MENS', 'WOMENS', 'UNISEX', 'YOUTH']`).
11. **Backfill migration** for any existing variants — populates dimension columns from a manual mapping or fails fast if data can't be reconstructed (one variant exists in seed; trivial).
12. **Integration tests** using `withTestDb` + `app.inject`:
    - Full happy-path: receive → stage → start → submit-qc → complete (and assert Shopify push job picks it up in test mode)
    - State-transition guards (can't `complete` from `staged_pre_prod`, etc.)
    - SKU uniqueness collision on duplicate variant
    - Cancel from each non-terminal state
    - Forensic query: `find --sku --since` returns expected batches
13. **README updates**: add `gm batch` reference, env vars table, iteration-2 status to roadmap.
14. **Audit coverage**: every state transition writes a `recordAudit` row (batch _and_ PVT transitions).
15. **`production_validation_runs` entity** — full PVT model per §"Production Validation Testing" above. Includes `run_no` generator (PVT-YYYY-####), status enum, per-stage timestamps, validator + cutter user FKs, expiry.
16. **PVT named transitions**:
    - `createPvtRun(variantId, markerId, cutterUserId, cutTicketId)` — `null` → `cutting`
    - `markPvtShipped(runId, actorUserId)` — `cutting` → `shipped`
    - `markPvtReceived(runId, actorUserId)` — `shipped` → `inspecting`
    - `validatePvt(runId, validatorUserId, notes?)` — `inspecting` → `validated`; computes `expires_at`
    - `rejectPvt(runId, validatorUserId, reason)` — `inspecting` → `rejected`
    - `cancelPvtRun(runId, actorUserId, reason)` — any non-terminal → `cancelled`
17. **PVT gate on batch creation**: `receiveFromCutter` calls `assertPvtCurrent(variantId, markerId)` first; on failure throws `BusinessRuleError("pvt_required", { mostRecentRunNo, expiresAt })`. Bypass via `--force` flag emits an audit row but does not satisfy the gate (forces operator to consciously override).
18. **PVT routes** at `/pvt`:
    - `POST /pvt` — create (body: `{ productVariantId, markerId, cutterUserId, cutTicketId }`)
    - `GET /pvt` — list with filters (`?status=`, `?variantId=`, `?activeOnly=true`)
    - `GET /pvt/:runNo` — single PVT with events
    - `POST /pvt/:runNo/ship`
    - `POST /pvt/:runNo/receive`
    - `POST /pvt/:runNo/validate` (body: `{ notes? }`)
    - `POST /pvt/:runNo/reject` (body: `{ reason }`)
    - `POST /pvt/:runNo/cancel` (body: `{ reason }`)
    - `GET /products/:id/pvt-status` — convenience: is this product authorized for production right now? Returns `{ authorized: bool, mostRecentRun, expiresAt, reason? }`.
19. **PVT CLI** at `gm pvt …`:
    - `gm pvt create` — stdin: `{ productVariantId, markerId, cutterUserId, cutTicketId }`
    - `gm pvt list [--status …] [--variant …] [--active-only]`
    - `gm pvt show <runNo>`
    - `gm pvt ship <runNo>`
    - `gm pvt receive <runNo>`
    - `gm pvt validate <runNo> [--note …]`
    - `gm pvt reject <runNo> --reason <r>`
    - `gm pvt cancel <runNo> --reason <r>`
    - `gm pvt status --product <id>` — surfaces the gate status before the operator tries to start a batch
20. **`products.pvt_validity_months` column** (nullable, falls back to env default `PVT_DEFAULT_VALIDITY_MONTHS=6`).
21. **`cut_tickets.kind` column** (`'production' | 'pvt'`, default `'production'`) so PVT cuts are distinguishable in cut-ticket listings.

### Out of scope (this PR)

- Multi-cutter batches (one batch = one cutter for now)
- Splitting a batch mid-flow (one path, no fork/merge)
- Re-opening a `completed` batch (write a `cancelled` batch and a new one instead)
- Order-line-level Shopify metafield with batch ID (requires Shopify webhook subscription, HMAC middleware, per-line FIFO assignment; deferred to iter 3+). Variant-level `garment_mgmt/last_batch_no` is resolved — see ADR-0007.
- A `gm batch find --customer <order-id>` reverse-lookup (needs Shopify webhook integration; iter 3)
- InvenTree raw-material sync (ADR-0006; Hub → InvenTree push lands in a follow-up issue)

---

## Data model

See ADR-0005 §2 + §3 for the column-level spec. Key invariants:

| Invariant                                            | Enforced by                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `batch_no` is unique                                 | `UNIQUE` index on `production_batches.batch_no`               |
| `production_events` are append-only                  | No `UPDATE` route; service layer never updates events         |
| `shopify_pushed_at` set ⇔ Shopify call succeeded     | Set only by push job after `2xx` response                     |
| `qty_actual` ≤ `qty_planned` enforced by app, not DB | Service layer; allows operator override with a `--force` flag |
| SKU dimensions match allowlist                       | Zod validators in product-service                             |
| Status transitions follow the legal graph            | Named transition functions reject illegal `from_status`       |
| Generated SKU is unique across variants              | `UNIQUE` index on `product_variants.sku`                      |

Legal status graph:

```
                  ┌──────────────────────┐
                  │ received_from_cutter │ ──┐
                  └──────────┬───────────┘   │
                             ▼               │
                  ┌──────────────────────┐   │
                  │   staged_pre_prod    │ ──┤
                  └──────────┬───────────┘   │
                             ▼               │
                  ┌──────────────────────┐   │ cancelBatch
                  │    in_production     │ ──┼──────────────► cancelled
                  └──────────┬───────────┘   │
                             ▼               │
                  ┌──────────────────────┐   │
                  │     awaiting_qc      │ ──┘
                  └──────────┬───────────┘
                             ▼
                  ┌──────────────────────┐
                  │      completed       │  (terminal — triggers Shopify push)
                  └──────────────────────┘
```

`cancelled` is also terminal. `completed` → no exit. `cancelled` → no exit.

---

## SKU schema (concrete)

| Dimension     | Allowlist (initial)                                                 | Notes                                            |
| ------------- | ------------------------------------------------------------------- | ------------------------------------------------ | --------- | -------- |
| `line`        | `PERF`, `HERIT`, `BASIC`                                            | Add new lines via migration + allowlist update   |
| `model`       | `HOOD`, `TEE`, `JACKET`, `PANT`, `SHORT`                            | Same                                             |
| `color`       | `BLK`, `WHT`, `OLV`, `RUST`, `NAVY`, `CHAR`, `SAND`                 | Same                                             |
| `size`        | `XS`, `S`, `M`, `L`, `XL`, `2XL`, `3XL`                             | Stable; size-curve constants live alongside      |
| `gender`      | `MENS`, `WOMENS`, `UNISEX`, `YOUTH`                                 | Closed set                                       |
| `season`      | `SS<YY>`, `FW<YY>`, `EVRG`                                          | Regex-validated (`^(SS                           | FW)\d{2}$ | ^EVRG$`) |
| `fabric_type` | `12OZ-COTTON`, `14OZ-COTTON`, `RIPSTOP`, `MERINO-200`, `MERINO-260` | Add new fabrics via migration + allowlist update |

**Sample SKUs**:

- `PERF-HOOD-BLK-M-MENS-SS26-12OZ-COTTON`
- `HERIT-JACKET-OLV-L-MENS-FW26-RIPSTOP`
- `BASIC-TEE-WHT-S-UNISEX-EVRG-12OZ-COTTON`

---

## Acceptance criteria

The PR is mergeable when:

1. `pnpm typecheck && pnpm lint && pnpm test` exit 0 in CI.
2. The happy-path integration test (receive → … → complete) passes against `withTestDb` and asserts that the test-mode Shopify push job marks `shopify_pushed_at` non-null.
3. All eight state-transition guards have negative tests (reject illegal `from_status`).
4. The SKU column is generated, unique, and matches every variant in seed.
5. Audit rows exist for every state transition (one negative test confirms `recordAudit` was called).
6. `gm batch` CLI commands all work end-to-end against a local server (`packages/server/test/e2e-batches.sh`).
7. README documents the `gm batch` namespace and Shopify env vars.
8. ADR-0005 is committed in the same PR.

## Operational considerations

- **Shopify rate limit**: 2 req/sec standard, 4 req/sec Plus. The push job is serial; we'll hit the limit only on backfills. Add explicit `429` retry-after handling if/when we backfill > 100 batches.
- **Token rotation**: `SHOPIFY_ADMIN_TOKEN` is a long-lived custom-app token. Rotate annually. Document the rotation procedure in `docs/runbooks/shopify-token-rotation.md` (deferred — not blocking the PR).
- **Backfill**: existing variants from iter 1 seed will have their dimensions backfilled in the migration. Inspection: `pnpm --filter @garment-mgmt/db backfill-sku --dry-run` outputs the proposed mappings before apply.
- **Test isolation**: Shopify client checks `NODE_ENV === 'test'` and logs instead of calling. CI never hits the network.

## Follow-ups (filed as issues after merge)

| Title                                                                 | Priority |
| --------------------------------------------------------------------- | -------- |
| ADR-0006: InvenTree for raw-material tracking — Accepted (2026-05-27) | ✅ Done  |
| Shopify metafield with batch ID on order lines                        | P3       |
| Customer order ↔ batch reverse lookup (Shopify webhook)               | P3       |
| Per-unit tracking under a batch (warranty workflow)                   | ✅ Done  |
| Shopify token rotation runbook                                        | P3       |
| Sew-line capacity planning + machine assignment                       | P3       |
