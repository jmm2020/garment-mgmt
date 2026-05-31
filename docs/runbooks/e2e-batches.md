# Runbook: Running e2e-batches.sh Locally

**Status**: Active
**Owner**: Engineering
**Cadence**: On-demand — run after changes to PVT, production-batch, or sew-line flows

> **TL;DR**
> Start the server and a seeded Postgres, export four env vars, then run the script.
> The script is self-cleaning and exits non-zero on any assertion failure.

`packages/server/test/e2e-batches.sh` drives the full PVT + production-batch flow
through the `gm` CLI against a live server. It covers PRD acceptance criteria #6
(PR #2): pvt create → ship → receive → validate → batch receive → stage → start →
submit-qc → complete → Shopify push.

---

## Prerequisites

- Node ≥ 20, pnpm 9.x, `tsx` (installed via `pnpm install`)
- `curl` and `jq` on the host
- PostgreSQL 16 running and accessible
- The production-hub server running (`pnpm --filter @garment-mgmt/server start`)
- A seeded admin user (the seed helper creates one automatically during step 1)

---

## Environment Variables

| Variable | Default | Notes |
|----------|---------|-------|
| `DATABASE_URL` | `postgres://dev:dev@localhost:5432/garment_mgmt` | Must point to a **writable** dev database; the seed helper inserts data |
| `HOST` | `http://localhost:3000` | Base URL of the running server |
| `SEED_ADMIN_EMAIL` | `admin@example.com` | Email the seed helper creates |
| `SEED_ADMIN_PASSWORD` | `dev` | Password for the seeded admin |

> The script also reads `SHOPIFY_ADMIN_TOKEN` via the server process — set it to any
> non-empty string in `.env` to enable the Shopify push loop (step 8/8). If unset,
> the loop runs in test mode and `shopifyPushedAt` is still populated.

---

## Steps

### 1. Start dependencies

```bash
# Terminal 1 — Postgres (if not already running)
docker compose up -d db

# Terminal 2 — server
DATABASE_URL=postgres://dev:dev@localhost:5432/garment_mgmt \
  pnpm --filter @garment-mgmt/server start
```

### 2. Export env vars (if not using defaults)

```bash
export DATABASE_URL=postgres://dev:dev@localhost:5432/garment_mgmt
export HOST=http://localhost:3000
export SEED_ADMIN_EMAIL=admin@example.com
export SEED_ADMIN_PASSWORD=dev
```

### 3. Run the script

```bash
# From repo root
bash packages/server/test/e2e-batches.sh
```

Expected output ending with:

```
[e2e-batches] SUCCESS
```

---

## What the Script Does

| Step | Action |
|------|--------|
| 1/8 | Seed fixtures (variant, marker, cut tickets, admin user) |
| 2/8 | Login via CLI + HTTP; assert `/auth/me` returns admin email |
| 3/8 | `gm pvt create` — creates a PVT run |
| 4/8 | `gm pvt ship/receive/validate` — walks PVT to `validated` |
| 5/8 | `gm batch receive` — starts a production batch |
| 6/8 | `gm batch stage/start/submit-qc/complete` — walks batch to `completed` |
| 7/8 | Assert `batch.status == completed` |
| 8/8 | Poll up to 60 s for `shopifyPushedAt` to be set |

---

## Troubleshooting

**Step 1 fails with a database connection error**
→ Confirm `DATABASE_URL` is correct and `pg_isready` returns OK.

**Step 2 fails with `gm: command not found`**
→ Run `pnpm install` from the repo root to ensure `tsx` is available.

**Step 8 times out (shopify_pushed_at not set within 60 s)**
→ Check the server logs for Shopify push errors. If `SHOPIFY_ADMIN_TOKEN` is unset,
the server runs in test mode — this is expected to still pass. A timeout here usually
means the server process exited or the push loop was never started.

---

## Related

- `packages/server/test/e2e.sh` — the original e2e script covering iter 1 flows
- `packages/server/test/helpers/seed-e2e-batches.ts` — fixture seed helper
- [ADR-0005](../adr/0005-shopify-owns-storefront.md) — Shopify inventory ownership
