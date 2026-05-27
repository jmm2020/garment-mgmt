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
pnpm migrate      # apply Drizzle migrations (17 tables)
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

| Command                              | Notes                                          |
| ------------------------------------ | ---------------------------------------------- |
| `gm login <email> --password <pw>`   | Authenticate; writes session token             |
| `gm logout`                          | Drop session                                   |
| `gm vendors list`                    | List vendors                                   |
| `gm materials list`                  | List materials                                 |
| `gm po list`                         | List purchase orders                           |
| `gm po show <id>`                    | PO with lines                                  |
| `gm po receive <lineId>`             | Receive lots — stdin: `{"lots":[...]}`         |
| `gm bom show <id>`                   | BOM with components                            |
| `gm ct list`                         | List cut tickets                               |
| `gm ct create`                       | Create cut ticket — stdin: JSON body           |
| `gm ct show <id>`                    | Cut ticket with allocations                    |
| `gm ct close <id>`                   | Close ticket — stdin: `{"actuals":[...]}`      |
| `gm lot provenance <id>`             | Walk lot → PO line → PO → vendor + movements   |

## HTTP API

Mounted under `/` from `packages/server/src/routes/`. All mutating endpoints require an active session cookie / bearer (set by `POST /auth/login`).

| Resource         | Routes                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------- |
| `auth`           | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`                                |
| `vendors`        | `GET/POST /vendors`, `GET /vendors/:id`                                                |
| `materials`      | `GET/POST /materials`, `GET /materials/:id`, `POST /materials/:id/variants`            |
| `products`       | `GET/POST /products`, `GET /products/:id`, `POST /products/:id/variants`               |
| `pos` (POs)      | `GET/POST /pos`, `GET /pos/:id`, `POST /pos/:id/send`, `POST /pos/:id/confirm`         |
| `lots`           | `GET /lots/:id`, `GET /lots/:id/provenance`, `POST /pos/:lineId/receive`               |
| `boms`           | `GET/POST /boms`, `POST /boms/:id/approve`, `POST /boms/:id/activate`                  |
| `cut-tickets`    | `GET/POST /cut-tickets`, `POST /cut-tickets/:id/mark-cutting`, `…/close`, `…/cancel`   |

Errors are emitted by the central handler with stable shape:

```json
{ "error": { "code": "lot_quantity_insufficient", "message": "…", "details": { … } } }
```

`code` is the `DomainError.code` — stable contract. Use it for branch logic in clients.

## Environment variables

`.env.example` is the source of truth. Required:

| Variable                | Purpose                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`          | Postgres connection string                                    |
| `TEST_DATABASE_URL`     | Separate DB for the test harness (`withTestDb`)               |
| `PORT`                  | Server bind port (default `3000`)                             |
| `SESSION_SECRET`        | HMAC secret for session tokens — **rotate to ≥ 32 chars**     |
| `NODE_ENV`              | `development` / `test` / `production`                         |
| `SEED_ADMIN_EMAIL`      | Email used by `pnpm seed`                                     |
| `SEED_ADMIN_PASSWORD`   | Password used by `pnpm seed`                                  |

**Iteration 2 adds** (will land with ADR-0005):

| Variable                | Purpose                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `SHOPIFY_SHOP_DOMAIN`   | `your-shop.myshopify.com`                                     |
| `SHOPIFY_ADMIN_TOKEN`   | Custom-app Admin API access token                             |
| `SHOPIFY_LOCATION_ID`   | Shopify location to adjust inventory against                  |

## Testing

```bash
# Local test DB is created by docker init script (scripts/init-test-db.sql).
# After `pnpm db:up`, both `garment_mgmt` and `garment_mgmt_test` exist.

pnpm test               # all packages
pnpm --filter @garment-mgmt/server test
```

The `withTestDb(cb)` helper (`packages/server/test/helpers/test-db.ts`) wraps each test in a Drizzle transaction and rolls back, so suites can run in parallel without bleed.

## Architecture decisions

1. [Hybrid architecture (Shopify + Cin7 + Hub)](docs/adr/0001-hybrid-architecture.md) — *Cin7 row superseded by ADR-0006; FG portion superseded by ADR-0005*
2. [Drizzle over Prisma](docs/adr/0002-drizzle-over-prisma.md)
3. [Lot tracking + provenance ledger](docs/adr/0003-lot-and-provenance-model.md)
4. [BOM versioning + cut-ticket flow](docs/adr/0004-bom-versioning-cut-ticket-flow.md)
5. [Production tracking + Shopify FG inventory](docs/adr/0005-production-tracking-and-shopify-fg.md) — *coming with iter 2*
6. [InvenTree for raw-material tracking (replaces Cin7)](docs/adr/0006-inventree-for-raw-materials.md)

## Roadmap

| Iteration | Scope                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------- |
| **1**     | Data layer, services, REST API, CLI, lot provenance, cut-ticket flow (cut-only)                 |
| **2**     | Production batches (PB-YYYY-####), station tracking, structured SKUs, Shopify inventory push    |
| **3**     | React UI, real-time push (WS/SSE), sew/QC/finish/pack workflow                                  |
| **4+**    | CSV export, multi-facility, native mobile, SAM-based costing                                    |

## Out of scope (iteration 1)

- React UI · sew/QC/finish/pack · real-time push · finished-goods inventory · Shopify integration code · SAM costing engine · CSV export · multi-tenant · native mobile

Schema reserves the seams (`base_sam_minutes`, `fg_sku`, `file_ref`, `reorder_point`, `target_stock`) — implementations land in iterations 2-3+.

## Working with Claude

Project-specific guidance for AI coding agents lives in [`CLAUDE.md`](CLAUDE.md). Read it before suggesting changes.
