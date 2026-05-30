# garment-mgmt — Production Hub

**Apparel-specific manufacturing data layer + services** for a boutique outerwear maker. The custom-built half of a hybrid stack:

```
   ┌──────────┐   ┌────────────────────┐   ┌─────────────┐
   │ Shopify  │   │ Production Hub     │   │ InvenTree   │
   │ (store)  │   │ (this repo)        │   │ (raw mats)  │
   └──────────┘   └────────────────────┘   └─────────────┘
                       owns:
                       - vendors, materials, lots
                       - dye-lot integrity
                       - BOMs, cut tickets
                       - production batches (iter 2)
                       - remnants, provenance, audit
```

> **Note on FG inventory:** ADR-0001 originally placed finished-goods inventory in Cin7. Iteration 2 supersedes that — Shopify becomes the FG source of truth. See ADR-0005. Raw-material tracking moved from Cin7 Core to InvenTree (self-hosted, MIT-licensed) — see ADR-0006.

Iteration 1 ships a typed Fastify HTTP API + a Commander-based operator CLI (`gm`) that walks the full demo flow end-to-end. No UI yet.

## Requirements

- **Node** ≥ 20 (see `.nvmrc`)
- **pnpm** ≥ 9 — `npm install -g pnpm@9` (the workspace pins `pnpm@9.15.9` via `packageManager`)
- **PostgreSQL 16** — Docker provided via `docker-compose.yml`
- **Docker** — for local Postgres

## Quick start

```bash
pnpm install
cp .env.example .env

pnpm db:up        # Postgres 16 in docker on :5432
pnpm migrate      # apply Drizzle migrations (19 tables)
pnpm seed         # demo data: admin user, 3 vendors, 5 materials, 1 product, 1 PO, 2 lots

pnpm dev          # Fastify on http://localhost:3000
```

In a second shell:

```bash
# End-to-end happy-path walk through the demo data
packages/server/test/e2e.sh

# Or drive it via the CLI
pnpm cli login admin@example.com --password dev
pnpm cli vendors list
pnpm cli lot provenance 1
```

## Repository layout

```
packages/
  db/         Drizzle schema, migrations, seed, singleton client, DbExecutor type
  server/     Fastify app, services (business rules), routes (HTTP), test harness
  cli/        `gm` operator CLI (commander, hits the HTTP API)

docs/
  adr/        Architecture decisions (numbered, immutable)
  prd/        Product requirements (lands with iter 2)

scripts/      One-time setup (e.g., init-test-db.sql)
```

### Conventions

- **`DbExecutor = Database | DbTransaction`** — mutating helpers accept either, so they compose inside `db.transaction(async tx => ...)`. Pass `tx`, not `db`, inside a transaction.
- **`DomainError` hierarchy** — `NotFoundError`, `ValidationError`, `BusinessRuleError`, `AuthError`. Don't `throw new Error(...)` in services; pick the right subclass so the central error handler maps to the right HTTP status.
- **State transitions are named** — `sendPo`, `confirmPo`, `activateBom`, `closeCutTicket`. No generic `update` on lifecycle-bearing entities.
- **Audit every mutation** — call `recordAudit(tx, ...)` inside the same transaction.
- **Numerics are SQL-side** — quantities are `numeric(12,3)`, costs are `numeric(12,4)`. Don't round-trip through JS `number` for arithmetic; use `sql\`${col} - ${value.toFixed(3)}\``.
- **No soft delete on lifecycle records** — completed batches stay queryable forever as the forensic record.

## Scripts

| Command                       | What                                                            |
| ----------------------------- | --------------------------------------------------------------- |
| `pnpm typecheck`              | TypeScript `--noEmit` across all packages                       |
| `pnpm lint`                   | ESLint (flat config) across the repo                            |
| `pnpm format`                 | Prettier write                                                  |
| `pnpm test`                   | Vitest across all packages                                      |
| `pnpm build`                  | Per-package build (no emit — tsx at runtime)                    |
| `pnpm dev`                    | Server in watch mode                                            |
| `pnpm migrate`                | Apply pending Drizzle migrations to `DATABASE_URL`              |
| `pnpm seed`                   | Idempotent seed                                                 |
| `pnpm generate`               | `drizzle-kit generate` (schema change → new SQL migration file) |
| `pnpm db:up` / `pnpm db:down` | Local Postgres docker                                           |
| `pnpm db:reset`               | Drop volume, recreate                                           |
| `pnpm cli -- <args>`          | Run the `gm` CLI (e.g., `pnpm cli -- vendors list`)             |

## CLI reference (`gm`)

Session is persisted to `~/.garment-mgmt/session` after login.

| Command                                               | Notes                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `gm login <email> --password <pw>`                    | Authenticate; writes session token                                  |
| `gm logout`                                           | Drop session                                                        |
| `gm vendors list`                                     | List vendors                                                        |
| `gm materials list`                                   | List materials                                                      |
| `gm po list`                                          | List purchase orders                                                |
| `gm po show <id>`                                     | PO with lines                                                       |
| `gm po receive <lineId>`                              | Receive lots — stdin: `{"lots":[...]}`                              |
| `gm bom show <id>`                                    | BOM with components                                                 |
| `gm ct list`                                          | List cut tickets                                                    |
| `gm ct create`                                        | Create cut ticket — stdin: JSON body                                |
| `gm ct show <id>`                                     | Cut ticket with allocations                                         |
| `gm ct close <id>`                                    | Close ticket — stdin: `{"actuals":[...]}`                           |
| `gm lot provenance <id>`                              | Walk lot → PO line → PO → vendor + movements                        |
| `gm batch list [--status <s>]`                        | List batches, optionally filtered by status                         |
| `gm batch show <batchNoOrId>`                         | Show batch with events                                              |
| `gm batch stage <batchNo>`                            | Advance to `staged_pre_prod`                                        |
| `gm batch start <batchNo>`                            | Advance to `in_production`                                          |
| `gm batch submit-qc <batchNo> --qty <n>`              | Submit for QC                                                       |
| `gm batch complete <batchNo> --qty <n> --verdict <v>` | Complete batch; triggers Shopify inventory push                     |
| `gm batch cancel <batchNo> --reason <r>`              | Cancel batch                                                        |
| `gm batch find <batchNo>`                             | Forensic lookup by `PB-YYYY-####`                                   |
| `gm batch find --order <shopifyOrderId>`              | Reverse lookup: Shopify order → batches + cut tickets + fabric lots |
| `gm batch assign <batchNo> --line <id>`               | Assign a production batch to a sew line                             |
| `gm batch release <batchNo>`                          | Release a production batch from its sew line                        |
| `gm line list`                                        | List all sew lines with machine counts                              |
| `gm line show <id>`                                   | Show sew line detail including machines                             |
| `gm line load <id> --date YYYY-MM-DD`                 | Show planned load for a line on a given date                        |
| **`gm pvt`**                                          | **Production Validation Testing commands**                          |
| `gm pvt create --variant <id> --marker <id> --cutter <userId> --cut-ticket <id> [--notes <n>]` | Create a new PVT run (cut ticket must have `kind='pvt'`) |
| `gm pvt list [--status <s>] [--variant <id>] [--active-only]` | List PVT runs; `--active-only` filters to authorized/in-progress    |
| `gm pvt show <ref>`                                   | Show a PVT run by id or `PVT-YYYY-####`                             |
| `gm pvt ship <ref>`                                   | Advance: `cutting → shipped`                                        |
| `gm pvt receive <ref>`                                | Advance: `shipped → inspecting`                                     |
| `gm pvt validate <ref> [--notes <n>]`                 | Advance: `inspecting → validated` (opens the production gate)       |
| `gm pvt reject <ref> --reason <r>`                    | Advance: `inspecting → rejected` (must cut a new PVT)               |
| `gm pvt cancel <ref> --reason <r>`                    | Cancel a non-terminal PVT run                                       |
| `gm pvt status <variantId> --marker <id>`             | Check (variant, marker) authorization for production                |
| **`gm unit`**                                         | **Production unit commands**                                        |
| `gm unit show <serial>`                               | Show unit provenance by serial number                               |
| `gm unit list <batchId> [--verdict <v>]`              | List units for a batch; `--verdict` filters by `pass\|fail\|pass_with_notes` |
| `gm unit qc <batchId> <serial> --verdict <v> [--reason <r>]` | Record per-unit QC verdict                                   |

## HTTP API

Mounted under `/` from `packages/server/src/routes/`. All mutating endpoints require an active session cookie / bearer (set by `POST /auth/login`).

| Resource      | Routes                                                                                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`        | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`                                                                                                                                                         |
| `vendors`     | `GET/POST /vendors`, `GET /vendors/:id`                                                                                                                                                                         |
| `materials`   | `GET/POST /materials`, `GET /materials/:id`, `POST /materials/:id/variants`                                                                                                                                     |
| `products`    | `GET/POST /products`, `GET /products/:id`, `POST /products/:id/variants`                                                                                                                                        |
| `pos` (POs)   | `GET/POST /pos`, `GET /pos/:id`, `POST /pos/:id/send`, `POST /pos/:id/confirm`                                                                                                                                  |
| `lots`        | `GET /lots/:id`, `GET /lots/:id/provenance`, `POST /pos/:lineId/receive`                                                                                                                                        |
| `boms`        | `GET/POST /boms`, `POST /boms/:id/approve`, `POST /boms/:id/activate`                                                                                                                                           |
| `cut-tickets` | `GET/POST /cut-tickets`, `POST /cut-tickets/:id/mark-cutting`, `…/close`, `…/cancel`                                                                                                                            |
| `batches`     | `GET/POST /api/batches`, `GET /api/batches/by-order?order=<id>`, `GET /api/batches/:ref`, `POST /api/batches/:ref/stage`, `…/start`, `…/submit-qc`, `…/complete`, `…/cancel`, `…/assign-line`, `…/release-line` |
| `sew-lines`   | `GET /api/sew-lines`, `GET /api/sew-lines/:id`, `GET /api/sew-lines/:id/load?date=YYYY-MM-DD`, `POST /api/sew-lines`, `POST /api/sew-lines/:id/machines`, `PATCH /api/sew-lines/:id/machines/:machineId`        |
| `pvt`         | `GET/POST /api/pvt`, `GET /api/pvt/:ref`, `POST /api/pvt/:ref/ship`, `POST /api/pvt/:ref/receive`, `POST /api/pvt/:ref/validate`, `POST /api/pvt/:ref/reject`, `POST /api/pvt/:ref/cancel`, `GET /api/products/:variantId/pvt-status?markerId=<id>` |
| `units`       | `GET /api/units/:serial`, `GET /api/batches/:batchId/units`, `POST /api/batches/:batchId/units/:serial/qc`                                                                                                      |
| `webhooks`    | `POST /webhooks/orders` (Shopify `orders/create` — HMAC-verified when `SHOPIFY_WEBHOOK_SECRET` is set; no session auth required)                                                                                |

Errors are emitted by the central handler with stable shape:

```json
{ "error": { "code": "lot_quantity_insufficient", "message": "…", "details": { … } } }
```

`code` is the `DomainError.code` — stable contract. Use it for branch logic in clients.

## Environment variables

`.env.example` is the source of truth. Required:

| Variable              | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `DATABASE_URL`        | Postgres connection string                                |
| `TEST_DATABASE_URL`   | Separate DB for the test harness (`withTestDb`)           |
| `PORT`                | Server bind port (default `3000`)                         |
| `SESSION_SECRET`      | HMAC secret for session tokens — **rotate to ≥ 32 chars** |
| `NODE_ENV`            | `development` / `test` / `production`                     |
| `SEED_ADMIN_EMAIL`    | Email used by `pnpm seed`                                 |
| `SEED_ADMIN_PASSWORD` | Password used by `pnpm seed`                              |

**Iteration 2 — Shopify outbound push** (required when pushing FG inventory to Shopify):

| Variable                    | Purpose                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `SHOPIFY_SHOP_DOMAIN`       | `your-shop.myshopify.com`                                                                                                                      |
| `SHOPIFY_ADMIN_TOKEN`       | Custom-app Admin API access token. Required scopes: `write_inventory`, `read_inventory`, `read_products`, `read_locations`, `write_metafields` |
| `SHOPIFY_LOCATION_ID`       | Shopify location to adjust inventory against                                                                                                   |
| `SHOPIFY_PUSH_INTERVAL_MS`  | Polling interval for the Shopify inventory push job (default `30000` ms). Set lower in staging; `NODE_ENV=test` bypasses network regardless.   |

**Iteration 2 — Shopify inbound webhook** (required for order → batch reverse lookup):

| Variable                 | Purpose                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `SHOPIFY_WEBHOOK_SECRET` | HMAC secret matching the Shopify app webhook config. Absent → verification skipped (CI/dev only). **Must be set in production.** |

**Iteration 2 — PVT validity** (optional; controls how long a validated PVT authorizes production):

| Variable                      | Purpose                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `PVT_DEFAULT_VALIDITY_MONTHS` | How many months a validated PVT authorizes production (default `6`). Per-product override via `products.pvt_validity_months`. |

## Operational Runbooks

| Runbook                                                           | When to use                          |
| ----------------------------------------------------------------- | ------------------------------------ |
| [Shopify token rotation](docs/runbooks/shopify-token-rotation.md) | Annual `SHOPIFY_ADMIN_TOKEN` renewal |
| [InvenTree self-host setup](docs/runbooks/inventree-self-host.md) | Stand up InvenTree Docker instance before wiring the InvenTree client |

## Testing

```bash
# Local test DB is created by docker init script (scripts/init-test-db.sql).
# After `pnpm db:up`, both `garment_mgmt` and `garment_mgmt_test` exist.

pnpm test               # all packages
pnpm --filter @garment-mgmt/server test
```

The `withTestDb(cb)` helper (`packages/server/test/helpers/test-db.ts`) wraps each test in a Drizzle transaction and rolls back, so suites can run in parallel without bleed.

## Architecture decisions

1. [Hybrid architecture (Shopify + Cin7 + Hub)](docs/adr/0001-hybrid-architecture.md) — _Cin7 row superseded by ADR-0006; FG portion superseded by ADR-0005_
2. [Drizzle over Prisma](docs/adr/0002-drizzle-over-prisma.md)
3. [Lot tracking + provenance ledger](docs/adr/0003-lot-and-provenance-model.md)
4. [BOM versioning + cut-ticket flow](docs/adr/0004-bom-versioning-cut-ticket-flow.md)
5. [Production tracking + Shopify FG inventory](docs/adr/0005-production-tracking-and-shopify-fg.md)
6. [InvenTree for raw-material tracking (replaces Cin7)](docs/adr/0006-inventree-for-raw-materials.md)
7. [Shopify batch_id variant metafield](docs/adr/0007-shopify-batch-id-metafield.md)
8. [Sew-line capacity model + machine assignment](docs/adr/0008-sew-line-capacity-model.md)

## Roadmap

| Iteration | Scope                                                                                                                                          | Status                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **1**     | Data layer, services, REST API, CLI, lot provenance, cut-ticket flow (cut-only)                                                                | shipped — PR #1 (foundation)                |
| **2**     | Production batches (PB-YYYY-####), per-unit tracking, PVT, structured SKUs, Shopify inventory push, sew-line capacity + machine assignment     | shipped — PR #2 (production tracking + PVT) |
| **3**     | React UI, real-time push (WS/SSE), sew/QC/finish/pack workflow                                                                                 | future                                      |
| **4+**    | CSV export, multi-facility, native mobile, SAM-based costing                                                                                   | future                                      |

## Out of scope (iterations 3+)

- **Iteration 3+**: React UI · real-time push (WS/SSE) · sew/QC/finish/pack workflow screens
- **Iteration 4+**: CSV export · multi-facility · native mobile · SAM costing engine

Schema reserves the seams (`base_sam_minutes`, `fg_sku`, `file_ref`, `reorder_point`, `target_stock`) — implementations land in iterations 3+.

## Working with Claude

Project-specific guidance for AI coding agents lives in [`CLAUDE.md`](CLAUDE.md). Read it before suggesting changes.
