# PRD: Production Tracking

**Iteration**: 2
**Status**: Draft (2026-05-25)
**Owner**: jmm2020
**Companion ADR**: [`0005-production-tracking-and-shopify-fg.md`](../adr/0005-production-tracking-and-shopify-fg.md)

---

## TL;DR

Pull *"sew / QC / finish / pack workflow"* from iteration 3 forward into iteration 2. Add a **production batch** entity that flows through five floor stations (received → staged → producing → QC → completed), generate a **structured FG SKU** at variant creation, and **push completed batches to Shopify** as the new finished-goods source of truth.

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
- Per-garment tracking (one row per individual unit) — deferred; we track at the batch level. If a future warranty workflow needs unit-level granularity, a `production_units` table can be added then.

---

## User story

> *Maria runs the cut floor. She cuts 47 pieces of fabric for batch PB-2026-0042 (Performance Hoodie, Black, Medium, Mens, SS26, 12oz Cotton — from cut ticket CT-2026-0119). She tags the bundle with the batch number, hands it off to Devon in pre-production. Devon scans the tag and runs `gm batch receive PB-2026-0042` on the floor terminal. Tomorrow the bundle gets moved to the sewing area; Devon runs `gm batch start PB-2026-0042`. Two days later, all 47 are sewn; the lead runs `gm batch submit-qc PB-2026-0042 --qty 47`. QC inspects, rejects 2, passes 45. The QC lead runs `gm batch complete PB-2026-0042 --qty 45 --verdict pass_with_notes --note "2 rejects: bad topstitch on hood seam"`. Sixty seconds later, 45 units of SKU PERF-HOOD-BLK-M-MENS-SS26-12OZ-COTTON appear in Shopify.*
>
> *Three months later, a customer DMs Maria: "the hood seam on the one I bought is unraveling." She queries: `gm batch find --sku PERF-HOOD-BLK-M-MENS-SS26-12OZ-COTTON --since 2026-04-01`. PB-2026-0042 comes up. She sees the QC note from Devon's lead. She pulls up the fabric lot via `gm lot provenance` from the cut ticket. The mill cert chain is two clicks away.*

---

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
   - `gm batch show <batchNo>` (accepts `PB-YYYY-####` *or* numeric ID)
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
14. **Audit coverage**: every state transition writes a `recordAudit` row.

### Out of scope (this PR)

- Multi-cutter batches (one batch = one cutter for now)
- Splitting a batch mid-flow (one path, no fork/merge)
- Re-opening a `completed` batch (write a `cancelled` batch and a new one instead)
- Shopify metafield with batch ID on order lines (ADR-0005 open question #2)
- A `gm batch find --customer <order-id>` reverse-lookup (needs Shopify webhook integration; iter 3)
- Cin7 raw-material sync (ADR-0005 open question #1)

---

## Data model

See ADR-0005 §2 + §3 for the column-level spec. Key invariants:

| Invariant                                                        | Enforced by                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| `batch_no` is unique                                             | `UNIQUE` index on `production_batches.batch_no`                   |
| `production_events` are append-only                              | No `UPDATE` route; service layer never updates events             |
| `shopify_pushed_at` set ⇔ Shopify call succeeded                 | Set only by push job after `2xx` response                         |
| `qty_actual` ≤ `qty_planned` enforced by app, not DB             | Service layer; allows operator override with a `--force` flag     |
| SKU dimensions match allowlist                                   | Zod validators in product-service                                 |
| Status transitions follow the legal graph                        | Named transition functions reject illegal `from_status`           |
| Generated SKU is unique across variants                          | `UNIQUE` index on `product_variants.sku`                          |

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

| Dimension     | Allowlist (initial)                                                | Notes                                            |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| `line`        | `PERF`, `HERIT`, `BASIC`                                           | Add new lines via migration + allowlist update   |
| `model`       | `HOOD`, `TEE`, `JACKET`, `PANT`, `SHORT`                           | Same                                             |
| `color`       | `BLK`, `WHT`, `OLV`, `RUST`, `NAVY`, `CHAR`, `SAND`                | Same                                             |
| `size`        | `XS`, `S`, `M`, `L`, `XL`, `2XL`, `3XL`                            | Stable; size-curve constants live alongside      |
| `gender`      | `MENS`, `WOMENS`, `UNISEX`, `YOUTH`                                | Closed set                                       |
| `season`      | `SS<YY>`, `FW<YY>`, `EVRG`                                         | Regex-validated (`^(SS|FW)\d{2}$|^EVRG$`)        |
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

| Title                                                          | Priority |
| -------------------------------------------------------------- | -------- |
| ADR-0006: Cin7 role under hybrid architecture                  | P2       |
| Shopify metafield with batch ID on order lines                 | P3       |
| Customer order ↔ batch reverse lookup (Shopify webhook)        | P3       |
| Per-unit tracking under a batch (warranty workflow)            | P4       |
| Shopify token rotation runbook                                 | P3       |
| Sew-line capacity planning + machine assignment                | P3       |
