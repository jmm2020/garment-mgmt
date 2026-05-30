# ADR 0005: Production Tracking + Shopify as Finished-Goods Source of Truth

**Status**: Accepted (2026-05-25)
**Supersedes**: ADR-0001 (FG inventory portion only — the three-tier ownership table)

## Context

ADR-0001 placed finished-goods inventory in **Cin7 Core**. After the iteration-1 foundation landed, the operator (who runs both the cut floor and the Shopify storefront) clarified two requirements that don't fit that decision:

1. **FG inventory must surface on Shopify the moment a batch completes.** Selling out-of-stock or missing a re-list is worse than the operational pain of running a second inventory system. The storefront _is_ the source of truth in customer terms; making it secondary to Cin7 adds latency and reconciliation overhead.
2. **Completed batches are a permanent forensic record.** When a customer reports a quality issue on a finished garment six months later, we need to query: which fabric lot? Which dye lot? Who cut it? Who QC'd it? What batch? When? The data needs to live in our database, not a third-party SaaS we can't query freely.

The iteration-1 plan also carved out _"Sew / QC / finish / pack workflow"_ as iteration-2 scope. Pulling it forward needs a station-tracking model that:

- Assigns each batch a unique, human-readable identifier (printable on floor tags)
- Tracks status transitions from cut → pre-production → production → QC → completed
- Logs every transition with actor, timestamp, and quantity (immutable)
- Generates a structured FG SKU at completion that encodes line, model, color, size, gender, season, fabric type
- Pushes inventory to Shopify on completion

## Decision

### 1. Shopify is the finished-goods source of truth

The ownership boundary changes for FG inventory only:

| Layer                      | Responsibility                                                                             | Owner   |
| -------------------------- | ------------------------------------------------------------------------------------------ | ------- |
| **Shopify**                | Storefront, online sales, payments, **and FG inventory of record**                         | Shopify |
| Cin7 Core                  | _Role under review — see Open Questions_                                                   | Cin7    |
| Production Hub (this repo) | Apparel manufacturing data + **production batches + station tracking + FG SKU generation** | We own  |

On batch `completed`, the Production Hub calls Shopify Admin API `inventoryAdjustQuantities` to credit the configured `SHOPIFY_LOCATION_ID` with `qty_actual` units against the FG SKU. The SKU and qty are also recorded in `production_batches` so we retain a permanent record independent of Shopify.

### 2. New entities

**`production_batches`** — the unit of work flowing through the floor.

| Column               | Notes                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `id`                 | bigint PK                                                                                                 |
| `batch_no`           | `PB-YYYY-####` (sequential per year, scannable). Unique.                                                  |
| `cut_ticket_id`      | FK → `cut_tickets`. Multiple batches can derive from one cut ticket.                                      |
| `product_variant_id` | FK → `product_variants`. The variant being produced.                                                      |
| `status`             | enum: `received_from_cutter`, `staged_pre_prod`, `in_production`, `awaiting_qc`, `completed`, `cancelled` |
| `qty_planned`        | numeric(12,3) — what we expected from this slice                                                          |
| `qty_actual`         | numeric(12,3) — what came out the other side (set at QC pass)                                             |
| `cutter_user_id`     | FK → `users`. Who cut the fabric.                                                                         |
| `qc_user_id`         | FK → `users`. Who passed/failed QC. Null until QC.                                                        |
| `qc_verdict`         | enum: `pass`, `fail`, `pass_with_notes` · nullable until QC                                               |
| `received_at`        | timestamp · set on `received_from_cutter`                                                                 |
| `started_at`         | timestamp · set on `in_production`                                                                        |
| `completed_at`       | timestamp · set on `completed`                                                                            |
| `shopify_pushed_at`  | timestamp · set after successful Shopify push (idempotency marker)                                        |
| `notes`              | text · operator notes                                                                                     |

**`production_events`** — append-only station-transition log.

| Column          | Notes                                                          |
| --------------- | -------------------------------------------------------------- |
| `id`            | bigint PK                                                      |
| `batch_id`      | FK → `production_batches`                                      |
| `from_status`   | nullable (first event has none)                                |
| `to_status`     | the new status                                                 |
| `actor_user_id` | FK → `users`                                                   |
| `qty`           | numeric(12,3) · nullable · used on `awaiting_qc` → `completed` |
| `notes`         | text                                                           |
| `occurred_at`   | timestamp · default `now()` · indexed                          |

This table is **append-only**. Status changes go through named transition functions (`receiveFromCutter`, `stageForProduction`, `startProduction`, `submitForQc`, `completeBatch`, `cancelBatch`) which validate the current `production_batches.status`, update it, and insert a `production_events` row in the same transaction.

### 3. Structured FG SKU

`product_variants` gains dimension columns and a derived SKU:

| New column    | Type        | Notes                                        |
| ------------- | ----------- | -------------------------------------------- |
| `line`        | varchar(16) | e.g., `PERF`, `HERIT`                        |
| `model`       | varchar(16) | e.g., `HOOD`, `TEE`, `JACKET`                |
| `color`       | varchar(16) | e.g., `BLK`, `OLV`, `RUST`                   |
| `size`        | varchar(8)  | e.g., `S`, `M`, `L`, `XL`, `2XL`             |
| `gender`      | varchar(8)  | enum: `MENS`, `WOMENS`, `UNISEX`, `YOUTH`    |
| `season`      | varchar(8)  | e.g., `SS26`, `FW26`, `EVRG` (evergreen)     |
| `fabric_type` | varchar(16) | e.g., `12OZ-COTTON`, `RIPSTOP`, `MERINO-200` |

The `sku` column (already exists) becomes a generated column:

```sql
sku TEXT GENERATED ALWAYS AS (
  line || '-' || model || '-' || color || '-' || size || '-' || gender || '-' || season || '-' || fabric_type
) STORED
```

Example: `PERF-HOOD-BLK-M-MENS-SS26-12OZ-COTTON`.

**Why generated, not composed in code**: Postgres enforces uniqueness at the DB level (`UNIQUE` index on the generated column), and the SKU can never drift from its dimensions. Reads are zero-cost (stored, not virtual).

**Trade-off**: changing the SKU format means a migration on every variant row. We accept this — the format is meant to be stable for years.

### 4. The cutter goes on the batch, not the SKU

A common temptation is to encode the cutter into the SKU itself (so floor tags carry the cutter ID). We reject this:

- Two batches of the same Black Medium Men's Performance Hoodie cut by different cutters would have different SKUs.
- Shopify would treat them as different products; customers would see duplicate listings; FG inventory would fragment.

Instead: the **batch ID** (`PB-YYYY-####`) goes on the floor tag along with the SKU. Cutter identity is recorded on `production_batches.cutter_user_id` and is one query away from the SKU.

### 5. Shopify push is fire-and-forget with idempotency

`completeBatch(batchId, qcVerdict, qtyActual)` does, in one transaction:

1. Validate `status = 'awaiting_qc'`
2. Set `status = 'completed'`, `completed_at = now()`, `qty_actual`, `qc_verdict`, `qc_user_id`
3. Insert a `production_events` row
4. Audit
5. **Return.** Shopify push runs _after_ commit, in a background job.

Push job (idempotent):

1. Read batch with `shopify_pushed_at IS NULL`
2. Call Shopify Admin API `inventoryAdjustQuantities` with `delta = qty_actual` for the variant's SKU at `SHOPIFY_LOCATION_ID`
3. On success: set `shopify_pushed_at = now()`
4. On failure: log, retry with exponential backoff (max 5)

The batch is `completed` in our system whether or not Shopify is reachable. Reconciliation reads `WHERE status = 'completed' AND shopify_pushed_at IS NULL`.

> **Updated (ADR-0007, 2026-05-27)**: The push job was extended to a two-phase sweep. Phase 1 is the inventory adjust described above. Phase 2 writes `garment_mgmt/last_batch_no` on the Shopify product variant. The SELECT broadens to `shopify_pushed_at IS NULL OR shopify_batch_metafield_at IS NULL`. See ADR-0007 for the full retry semantics and new schema columns.

### 6. Required env vars

**Outbound (inventory push)**

| Variable              | Purpose                                         |
| --------------------- | ----------------------------------------------- |
| `SHOPIFY_SHOP_DOMAIN` | `your-shop.myshopify.com`                       |
| `SHOPIFY_ADMIN_TOKEN` | Custom-app Admin API access token               |
| `SHOPIFY_LOCATION_ID` | Shopify location ID to adjust inventory against |

**Inbound (webhook)**

| Variable                 | Purpose                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `SHOPIFY_WEBHOOK_SECRET` | HMAC-SHA256 secret for `orders/create` webhook. Absent → verification skipped (dev/CI). Must be set in production. |

Required Shopify app scopes: `write_inventory`, `read_inventory`, `read_products`, `read_locations`.

## Consequences

**Positive**:

- FG inventory updates the storefront immediately — no Cin7 → Shopify sync latency.
- The forensic record lives in our database, queryable forever via the `production_batches` + `production_events` + `audit_log` + `lot_movements` chain.
- Structured SKUs are self-documenting; cutter/lot/date are one join away but don't fragment the SKU namespace.
- Shopify push is decoupled from the operator workflow — they can ship batches even if Shopify is briefly unreachable.

**Negative**:

- We carry the Shopify integration code (HTTP client, retry, idempotency, scope rotation).
- Shopify rate limits are a real concern at scale (Admin API: 2 calls/sec on standard, 4 on Plus). Mitigation: the background push job already serializes by design; if we ever batch-push hundreds, we'll need explicit rate-limit handling.
- The `sku` generated column can't be edited without a migration. Operator typos in `line`/`model`/`color` propagate to Shopify and customers see them. Mitigation: strict server-side validation against an allowlist for each dimension (next iteration), and `gm variant rename` doesn't exist on purpose.

**Mitigations**:

- The `production_batches.shopify_pushed_at` marker makes the push idempotent and re-runnable.
- Dimensions are validated by Zod against allowlists in `packages/server/src/services/product-service.ts`.
- A backfill plan exists for any variants created pre-ADR (`pnpm --filter @garment-mgmt/db backfill-sku`).

## Open questions

1. ~~**What does Cin7 own now?**~~ **Resolved (2026-05-27):** Cin7 is dropped entirely. Raw-material tracking moves to **InvenTree** (MIT-licensed, self-hosted). See ADR-0006 for the full decision, ownership boundaries, and iter-3 integration plan.
2. ~~**Should each batch have a Shopify metafield with the batch ID?**~~ **Resolved (2026-05-27):** Yes — variant-level `garment_mgmt/last_batch_no` written by the push job after each successful inventory adjust. See ADR-0007 for the full decision, rejected order-line-level alternative, retry semantics, and required Shopify scope (`write_metafields`).
3. ~~**How do we recover which batches fulfilled a given Shopify order?**~~ **Resolved (PR #25, 2026-05-27):** Inbound `orders/create` webhook. Shopify posts to `POST /webhooks/orders`; the service allocates FIFO batches and inserts `shopify_order_line_batches` rows. The operator queries from our side via `gm batch find --order <shopifyOrderId>` or `GET /api/batches/by-order`. This keeps an order→batch forensic record in our DB, complementing the outbound variant-level metafield from ADR-0007, consistent with the goals in §2 of this ADR.

## Related

- ADR-0001 (Hybrid Architecture) — superseded for FG inventory only; the broader three-tier shape stands.
- ADR-0003 (Lot and Provenance Model) — `production_batches.cut_ticket_id` extends the same provenance chain forward of the cut.
- ADR-0004 (BOM Versioning + Cut-Ticket Flow) — batches inherit their BOM via `cut_ticket → bom`.
- PRD: `docs/prd/production-tracking.md`.
