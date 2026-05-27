# ADR 0006: InvenTree for Raw-Material Tracking (replaces Cin7 Core)

**Status**: Accepted (2026-05-27)
**Addresses**: ADR-0005 open question #1 — Cin7's residual role in the stack

## Context

ADR-0001 placed raw-material stock management in **Cin7 Core**. ADR-0005 later noted "Cin7's role is under review" (open question #1) after FG inventory moved to Shopify.

On 2026-05-27 the operator resolved the question: **Cin7 Core is too expensive at current scale.** The annual subscription cost exceeds the value of the raw-material tracking it provides for a single-location, ~$2.5M boutique operation.

Options evaluated:

| Option | Verdict | Reason |
| ------ | ------- | ------ |
| **Cin7 Core** (status quo) | Rejected | Cost-prohibitive at current scale; monthly seat cost is not justified |
| **ERPNext** | Rejected | Heavier than needed; significant setup/maintenance overhead for one facility |
| **Absorb into Production Hub** | Rejected | Contradicts ADR-0001's "only build what is uniquely ours" principle; re-implements a solved problem (warehouse stock) |
| **InvenTree** | **Accepted** | MIT-licensed, self-hostable via Docker, active development, scope matches exactly: suppliers, stock locations, batch/lot, BOMs, REST API |

InvenTree (https://inventree.org/) handles the commodity warehouse layer that was previously expected of Cin7. It provides supplier management, stock locations, batch/lot tracking, and a REST API — all the primitives the raw-material layer needs, without apparel-specific features that would remain unused.

## Decision

### 1. InvenTree replaces Cin7 Core as the raw-material warehouse layer

The three-tier ownership table from ADR-0001 updates to:

| Layer                      | Responsibility                                                                                              | Owner      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------- |
| **Shopify**                | Storefront, online sales, payments, FG inventory of record (per ADR-0005)                                   | Shopify    |
| **InvenTree**              | Raw-material stock-on-hand, supplier records, stock locations, receiving from POs                            | InvenTree  |
| **Production Hub (this repo)** | Apparel manufacturing data: vendors, materials, POs, material lots, dye-lot integrity, BOMs, cut tickets, production batches | We own |

### 2. Ownership boundaries

**InvenTree owns:**
- Stock-on-hand quantity per raw material per location
- Supplier records (counterpart to our `vendors` table — InvenTree is the warehouse view; Hub is the apparel master)
- Stock locations (warehouse bin / shelf assignments)
- Receiving confirmations from purchase orders (stock-in events)

**Production Hub owns — unchanged:**
- `vendors` — master vendor data (name, address, certifications, audit trail)
- `materials` — material catalog (fiber content, width, weight, dye-lot behavior)
- `material_lots` — cut-floor traceability: lot number, provenance, dye lot, quantity remaining
- `purchase_orders` + `po_lines` — purchasing workflow and receiving transactions
- `boms`, `cut_tickets` — allocation and apparel-specific BOM logic
- `production_batches` — station tracking, FG SKU generation, Shopify push
- All `audit_log` entries for the above

The Production Hub is the **source of truth for the apparel-specific schema**. InvenTree is the **warehouse layer** that tracks physical stock movements.

### 3. Sync direction: Hub → InvenTree (one-way, iter-2)

Two events in the Production Hub trigger a push to InvenTree:

| Hub event | InvenTree action |
| --------- | ---------------- |
| Material lot received (`receivePoLine`) | `POST /api/stock/` — incoming stock entry |
| Material consumed on cut (`closeCutTicket` lot pick) | `PATCH /api/stock/{id}/` — stock-out adjustment |

Direction is **one-way Hub → InvenTree** for iteration 2. The Hub initiates all pushes; InvenTree is never the source of mutations that the Hub must react to.

### 4. What is deferred

- **Multi-location lot sync inside InvenTree** — lot integrity is maintained in the Hub (`material_lots`); InvenTree tracks aggregate stock per location. Per-lot traceability inside InvenTree is iter-3+ scope.
- **Real-time vs nightly cadence** — iteration 2 starts with nightly batch sync. Sub-minute latency is not required until a live warehouse picking workflow exists.
- **InvenTree client and docker-compose service** — building the HTTP client and the self-hosted InvenTree instance is a separate issue, filed once this ADR lands.
- **Reconciliation** — if Hub and InvenTree stock quantities diverge, reconciliation logic is deferred. The Hub's `material_lots.quantity_remaining` is the authoritative source; InvenTree is kept as a mirror.

## Consequences

**Positive**:

- Cost saved: InvenTree is MIT-licensed and self-hostable — only hosting cost (fits on existing Docker infra).
- Scope match: InvenTree covers suppliers, stock locations, batch/lot, BOMs, REST API — exactly what was expected of Cin7, nothing more.
- Integration is clean: one-way push from Hub events is simpler than bidirectional sync; Hub remains single source of truth.
- No apparel-specific debt: Hub does not absorb a generic warehouse layer, honoring ADR-0001's "only build what is uniquely ours."

**Negative**:

- We now operate two databases for raw-material state (Hub `material_lots` + InvenTree stock). Drift is possible if the push fails.
- InvenTree is a dependency we must operate (Docker, upgrades, backups). Cin7 SaaS had no ops burden.
- The InvenTree REST API must be wrapped; a thin client library lands as a separate task in iter-2.

**Mitigations**:

- Hub `material_lots.quantity_remaining` is authoritative; if InvenTree is unreachable, Hub operations are unaffected (push is fire-and-forget with retry, same pattern as the Shopify push job in ADR-0005).
- Reconciliation script (`gm inventree reconcile --dry-run`) deferred to iter-3 but designed to be straightforward given Hub is the single source of mutations.
- InvenTree Docker image runs alongside existing Postgres container — no new infrastructure class.

## Iter-3 Consequences

The following integration work is unblocked once this ADR is accepted:

1. **InvenTree client** (`packages/server/src/integrations/inventree-client.ts`) — thin wrapper around InvenTree REST API (`POST /api/stock/`, `PATCH /api/stock/{id}/`), with exponential backoff and test-mode stub (same pattern as `shopify-client.ts`).
2. **Push hooks in `lot-service.ts`** — `receivePoLine` calls `inventreeClient.stockIn(materialId, qty, locationId)` after the Hub transaction commits; `closeCutTicket` calls `inventreeClient.stockOut(materialId, qty)` for each lot pick.
3. **Docker Compose update** — add `inventree` service to `docker-compose.yml`; document initial setup in `docs/runbooks/inventree-setup.md`.

## Related

- ADR-0001 (Hybrid Architecture) — superseded for the Cin7 column; the three-tier shape stands with InvenTree replacing Cin7.
- ADR-0005 (Production Tracking + Shopify FG) — open question #1 is now closed by this ADR.
- ADR-0003 (Lot and Provenance Model) — `material_lots` remain in the Hub; InvenTree mirrors aggregate stock only.
