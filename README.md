# garment-mgmt — Production Hub

**Apparel-specific manufacturing data layer + services** for a boutique
outerwear maker. The custom-built half of a hybrid stack:

```
   ┌──────────┐   ┌────────────────────┐   ┌─────────────┐
   │ Shopify  │   │ Production Hub     │   │ Cin7 Core   │
   │ (store)  │   │ (this repo)        │   │ (FG / WMS)  │
   └──────────┘   └────────────────────┘   └─────────────┘
                       owns:
                       - vendors, materials, lots
                       - dye-lot integrity
                       - BOMs, cut tickets
                       - remnants, provenance
```

Iteration 1 ships a typed Fastify HTTP API + a Commander-based operator
CLI (`gm`) that walks the full demo flow end-to-end. No UI yet — that's
iteration 2.

See `docs/adr/` for architecture decisions.

## Requirements

- Node ≥ 20
- pnpm ≥ 9 (`npm install -g pnpm@9` if missing)
- Docker (for local Postgres)

## Quick start

```bash
pnpm install
cp .env.example .env

pnpm db:up        # bring up Postgres 16 in docker
pnpm migrate      # apply Drizzle migrations
pnpm seed         # populate demo data (admin, 3 vendors, 5 materials, 1 product, 1 PO, 2 lots)

pnpm dev          # start Fastify on http://localhost:3000
```

In a second shell:

```bash
# Run the e2e happy path
packages/server/test/e2e.sh

# Or use the CLI
pnpm cli login admin@example.com --password dev
pnpm cli vendors list
pnpm cli lot provenance 1
```

## Package layout

```
packages/db       — Drizzle schema, migrations, seed, singleton client
packages/server   — Fastify app, services (business rules), routes (HTTP)
packages/cli      — `gm` operator CLI (commander, calls the HTTP API)
```

## Scripts

| Command                       | What                                                        |
| ----------------------------- | ----------------------------------------------------------- |
| `pnpm typecheck`              | TypeScript noEmit across all packages                       |
| `pnpm lint`                   | ESLint across the repo                                      |
| `pnpm test`                   | Vitest suites                                               |
| `pnpm migrate`                | Apply pending Drizzle migrations                            |
| `pnpm seed`                   | Idempotent seed                                             |
| `pnpm generate`               | `drizzle-kit generate` (schema changes → new SQL migration) |
| `pnpm db:up` / `pnpm db:down` | Local Postgres docker                                       |
| `pnpm db:reset`               | Drop volume, recreate                                       |
| `pnpm dev`                    | Server in watch mode                                        |

## Architecture decisions

1. [Hybrid architecture (Shopify + Cin7 + Hub)](docs/adr/0001-hybrid-architecture.md)
2. [Drizzle over Prisma](docs/adr/0002-drizzle-over-prisma.md)
3. [Lot tracking + provenance ledger](docs/adr/0003-lot-and-provenance-model.md)
4. [BOM versioning + cut-ticket flow](docs/adr/0004-bom-versioning-cut-ticket-flow.md)

## Out of scope (iteration 1)

- React UI (iteration 2)
- Real-time push, Shopify/Cin7 sync (iteration 3+)
- Sew/QC/finish/pack workflow (iteration 2)
- Finished-goods stock (Cin7 owns this)
- SAM-based costing engine (schema field reserved)
- CSV export, multi-tenant, native mobile

See the PRD for full scope boundaries.
