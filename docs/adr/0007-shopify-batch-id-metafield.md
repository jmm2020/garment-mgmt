# ADR 0007: Shopify batch_id metafield on product variants

**Status**: Accepted (2026-05-27)
**Addresses**: ADR-0005 open question #2 — whether each batch should publish a Shopify metafield with its batch ID

## Context

ADR-0005 placed finished-goods inventory in Shopify and pushed `qty_actual` units against the variant SKU on batch completion. It left one open question:

> Should each batch have a Shopify metafield with the batch ID? That would let customer service trace a Shopify order line back to a batch without leaving the Shopify admin.

Issue #7 (P3) reopened that question with a concrete user story: when Maria (floor operator / customer-service lead) handles a customer DM that references only a Shopify order number, she has no path from Shopify back to the batch + fabric lot. Today she must hand-search Production Hub by SKU and date range. Closing that gap makes the Shopify product page a forensic entry point.

Two designs were on the table:

| Option | Verdict | Reason |
| ------ | ------- | ------ |
| **Variant-level metafield** (`garment_mgmt/last_batch_no` on `ProductVariant`) | **Accepted** | Minimum viable; reuses the existing push job; no new webhook infrastructure |
| **Order-line-level metafield** (per-line metafield set via `orders/create` webhook) | Rejected | Requires Shopify webhook subscription, HMAC verification middleware, order-line FIFO assignment from inventory snapshots — order-of-magnitude more code for a P3 ask |

## Decision

### 1. Write `garment_mgmt/last_batch_no` on the variant on every push

The existing background job `pushPendingOnce` already finds every completed batch with `shopify_pushed_at IS NULL`, calls `inventoryAdjustQuantities` for the SKU, and stamps `shopify_pushed_at` on success. After that path succeeds (or is detected as already done in a previous tick), the job:

1. Looks up the Shopify variant GID for the SKU using Admin GraphQL `productVariants(first: 1, query: "sku:<sku>")`. Result is cached on `product_variants.shopify_variant_gid` so we only pay this call once per variant.
2. Calls `metafieldsSet` with `{ namespace: "garment_mgmt", key: "last_batch_no", value: batchNo, type: "single_line_text_field", ownerId: variantGid }`.
3. On success, sets `production_batches.shopify_batch_metafield_at = now()` and writes a `shopify_batch_metafield_set` event.
4. On failure, writes a `shopify_batch_metafield_failed` event but leaves `shopify_batch_metafield_at` NULL so the next tick retries.

### 2. Schema additions (two nullable columns, additive only)

| Column | Table | Purpose |
| ------ | ----- | ------- |
| `shopify_variant_gid` (text, nullable) | `product_variants` | Cached GID; populated on first successful lookup. Avoids a Shopify GraphQL call on every push tick for the same variant. |
| `shopify_batch_metafield_at` (timestamp with time zone, nullable) | `production_batches` | Idempotency marker. NULL until `metafieldsSet` succeeds. Separate from `shopify_pushed_at` so a partial failure (inventory ok, metafield failed) is retried on the next tick. |

### 3. Required Shopify scope

The custom-app `SHOPIFY_ADMIN_TOKEN` must be re-authorized with `write_metafields` in addition to the existing `write_inventory`, `read_inventory`, `read_products`, `read_locations`. Operator runbook step (deferred separately): "After deploying this change, open the Shopify custom-app settings → Admin API access scopes → enable `write_metafields` → save → reinstall the app to mint a new token → update `SHOPIFY_ADMIN_TOKEN` in production env."

### 4. Retry semantics

The push job's SELECT broadens from `WHERE status = 'completed' AND shopify_pushed_at IS NULL` to `WHERE status = 'completed' AND (shopify_pushed_at IS NULL OR shopify_batch_metafield_at IS NULL)`. A batch that succeeded inventory push but failed metafield write will be picked up again on the next tick; the inventory phase will detect `shopify_pushed_at` is non-null and skip directly to the metafield phase. The existing `pendingShopifyIdx` partial index still covers the common (both NULL) case; the retry path is rare.

### 5. Why not order-line-level

Order-line-level would answer the customer question more precisely ("this exact garment came from PB-2026-0042") but requires:

- Shopify webhook subscription (`orders/create` or `orders/paid`)
- New HTTP endpoint with HMAC signature verification middleware
- Either storing Shopify orders in our DB or querying Shopify order GIDs per line at write time
- FIFO assignment from an inventory snapshot taken at order time — correctness-sensitive and depends on multi-batch overlap

At P3 priority this is not justifiable. Variant-level answers "which batch was most recently produced for this variant?" which addresses 90% of the forensic question Maria asked. The richer order-line workflow is deferred to iteration 3+ where the UI exists to surface it.

## Consequences

**Positive**:

- Shopify variant admin page becomes a forensic entry point: one click from a customer DM to the batch number; one query from there to the full provenance chain.
- Implementation reuses the existing push job, retry loop, and idempotency pattern. No new infrastructure (no webhook endpoint, no HMAC middleware, no scheduler).
- Two new columns are additive and nullable; existing data and tests are unaffected.

**Negative**:

- The metafield is stale-by-design when a variant has multiple batches in flight — only the most recently pushed batch wins. The customer's specific garment may not be from the batch shown.
- Requires re-authorizing the custom app with `write_metafields`. Operator burden, but one-time.
- Adds 1–2 Shopify API calls per batch push (GID lookup once per variant, metafield set per batch). Well within Shopify's 2 req/sec limit at current batch volume (< 10/day).

**Mitigations**:

- The "most recently pushed wins" behavior is documented; the metafield value is `last_batch_no` (not `current_batch_no`) to make this explicit.
- GID caching means we pay the lookup cost once per variant lifetime, not once per batch.
- Failed metafield writes do not block batch completion or inventory push — the batch is `completed` in our system regardless; only the metafield is missing until the next tick succeeds.

## Open questions

1. **Backfill of `shopify_variant_gid` for historical variants?** Deferred. The next push for any variant fills in its own GID. Variants that never push again stay NULL — harmless.
2. **Backfill of `garment_mgmt/last_batch_no` for batches completed before this change?** Deferred. A separate one-shot job could read the most recent `completed` batch per variant and write its metafield, but it's not blocking the forensic workflow for new batches.
3. **Should `last_batch_no` link to a Production Hub URL?** Deferred to iteration 3 when the UI exists. A pure text metafield is sufficient for now.

## Related

- ADR-0005 (Production Tracking + Shopify FG) — open question #2 is closed by this ADR.
- ADR-0006 (InvenTree for Raw Materials) — pattern reference: small, additive, externally-facing column change paired with an ADR.
