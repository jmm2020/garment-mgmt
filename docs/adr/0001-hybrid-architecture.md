# ADR 0001: Hybrid Architecture — Shopify + Cin7 Core + Production Hub

**Status**: Accepted (2026-05-25)

## Context

We are a $2.5M boutique outerwear maker operating a brick-and-mortar
storefront, a Shopify e-commerce site, and a small in-house cut/sew operation.
Off-the-shelf manufacturing ERPs (Katana, Fishbowl, Cin7 Core) handle
commodity inventory and order management but do **not** model the
apparel-specific primitives we need:

- Dye-lot integrity across visible garment panels
- Cut-ticket lot allocation with FIFO + dye-lot constraints
- Marker efficiency / fabric-required-per-unit math
- Remnant return with parent-lot provenance
- SAM-based labor costing
- Cradle-to-grave provenance (mill → vendor cert → roll → dye lot → cut → finished garment)

Building a single, monolithic ERP that covers storefront + warehouse +
manufacturing would take 12+ months and re-implement well-solved problems
(shopping cart, warehouse picking, sales reporting). Buying a single ERP
that does manufacturing well enough costs more than the value of the
operation and still doesn't model dye-lot integrity.

## Decision

We adopt a **three-tier hybrid stack** with clear ownership boundaries:

| Layer                      | Responsibility                                                                                                               | Owner   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------- |
| Shopify                    | Storefront, online sales, payments                                                                                           | Shopify |
| ~~Cin7 Core~~              | ~~FG warehouse stock, sales orders, shipping~~ — _superseded: FG → Shopify (ADR-0005); raw materials → InvenTree (ADR-0006)_ | —       |
| Production Hub (this repo) | Apparel manufacturing data: vendors, materials, PO/receiving, lots, BOMs, cut tickets, remnants, provenance                  | We own  |

The Production Hub is the system of record for everything Shopify and
Cin7 _(superseded — see ADR-0006)_ cannot model. Finished-good SKUs
(`product_variants.fg_sku`) are the integration seam — they become the
join key for future Shopify and InvenTree sync.

## Consequences

**Positive**:

- We only build what is uniquely ours (the apparel data model).
- Shopify and Cin7 _(superseded)_ keep handling storefront/warehouse — no NIH risk.
- Integration is deferred to iteration 3+, after the model is validated
  by the operator via CLI.

**Negative**:

- We carry the integration burden eventually (two sync pipelines).
- Data lives in three places; reconciliation logic is required.
- The FG-SKU seam must stay stable; renaming it later costs migrations
  on the Cin7 _(superseded)_ / Shopify sides.

**Mitigations**:

- `product_variants.fg_sku` is reserved early so the seam is concrete
  from day one.
- Provenance ledger (`audit_log` + `lot_movements`) is append-only —
  the Hub remains the truth source even if a sync goes wrong.

## Note (2026-05-27)

The Cin7 row in the table above has been superseded in two steps:

- **FG inventory** moved to Shopify as source of truth — see ADR-0005.
- **Raw-material tracking** moved to InvenTree (open-source, self-hosted) — see ADR-0006.

The three-tier shape of the stack is preserved; only the occupant of the middle layer changed.
