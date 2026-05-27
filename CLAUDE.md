# CLAUDE.md — garment-mgmt

Guidance for AI coding agents (Claude Code, Cursor, Codex, etc.) working in this repo.

> If you only read one section, read **Hard rules** (below). Everything else is context.

---

## Identity

`garment-mgmt` is the **Production Hub** — the custom-built half of a hybrid apparel-manufacturing stack. Shopify owns storefront + finished-goods inventory (per ADR-0005). Cin7 Core may hold raw materials (TBD in iter 2). This repo owns:

- vendors, materials, material lots, dye-lot integrity
- purchase orders + receipts + lot movements ledger
- BOMs (versioned, one active per product) + cut tickets
- **iter 2:** production batches, station tracking, structured FG SKUs, Shopify inventory push
- audit log (recursive secret scrubbing)

The codebase is **iteration 1** of a 4-iteration plan. Schema reserves seams (`base_sam_minutes`, `fg_sku`, `reorder_point`) for later iterations — leave them in place.

---

## Stack

| Layer    | Choice                                                                  |
| -------- | ----------------------------------------------------------------------- |
| Runtime  | Node ≥ 20 · pnpm 9.15.9 · TypeScript 5.6 · ESM                          |
| Database | PostgreSQL 16 · Drizzle ORM 0.36 · drizzle-kit 0.28 · `postgres` driver |
| HTTP     | Fastify 5 · Zod 3.23 for validation                                     |
| Auth     | Bcryptjs session tokens, cookie-based                                   |
| CLI      | Commander 12 (`gm` entry, session at `~/.garment-mgmt/session`)         |
| Tests    | Vitest 2 · `withTestDb()` rollback harness · per-service unit tests     |
| CI       | GitHub Actions · Postgres-as-a-service · matrix Node 20                 |

Three workspaces: `packages/db`, `packages/server`, `packages/cli`.

---

## Hard rules

### 1. Memory of "done": **tests must pass before you say done.**

Before you claim a task is complete:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

If any of these fail, you are **not** done. Fix or report — do not claim success.

### 2. Don't `throw new Error(...)` from service code.

Use the `DomainError` hierarchy in `packages/server/src/errors.ts`:

| Subclass            | Use when                                        | HTTP    |
| ------------------- | ----------------------------------------------- | ------- |
| `NotFoundError`     | Entity by id doesn't exist                      | 404     |
| `ValidationError`   | Zod parse fail, missing required field          | 400     |
| `BusinessRuleError` | Domain invariant violated (e.g., dye-lot split) | 409     |
| `AuthError`         | No session / wrong role                         | 401/403 |

The central `setErrorHandler` in `app.ts` maps these. If you `throw new Error(...)`, it becomes a generic 500 with no `code` field, and clients can't branch on it.

### 3. Mutating helpers take `DbExecutor`, not `Database`.

```typescript
// ✅ Correct
async function recordAudit(tx: DbExecutor, …) { … }

// ❌ Wrong — breaks inside transactions
async function recordAudit(db: Database, …) { … }
```

`DbExecutor = Database | DbTransaction`. Inside `db.transaction(async tx => …)`, pass `tx`. `PgTransaction` does not have `.$client`, so `tx as Database` won't typecheck.

### 4. SQL-side arithmetic for `numeric` columns.

Don't round-trip quantities through JS `number`:

```typescript
// ✅ Correct — stays in pg numeric
.set({
  quantityRemaining: sql`${schema.materialLots.quantityRemaining} - ${pick.quantity.toFixed(3)}`,
  updatedAt: new Date(),
})

// ❌ Wrong — float drift on the third decimal
.set({
  quantityRemaining: lot.quantityRemaining - pick.quantity,
})
```

### 5. Use `inArray()`, not `sql\`IN ${array}\``.

```typescript
import { inArray } from "drizzle-orm";
.where(inArray(schema.materialLots.poLineId, lines.map(l => l.id)))
```

Drizzle binds JS arrays as a single Postgres array literal — `IN` doesn't accept that. This was bug HIGH-3 in the PR-1 review.

### 6. Audit every mutation in the same transaction.

```typescript
await db.transaction(async tx => {
  const created = await tx.insert(...).returning();
  await recordAudit(tx, { userId, action: "vendor.create", entity: ..., before: null, after: created });
  return created;
});
```

Audit rows are scrubbed (`passwordHash`, `session_token`, etc.) recursively before insert. Don't bypass `recordAudit` — write to the table directly only inside that helper.

### 7. State transitions are named functions.

`activateBom`, `sendPo`, `confirmPo`, `markInCutting`, `closeCutTicket`, `cancelCutTicket`. **Don't add a generic `updateCutTicket`.** If you need a new transition (e.g., iter 2's `receiveFromCutter`), add a named function that:

1. Validates current state
2. Updates the status (and any other fields)
3. Inserts an audit row
4. Emits a `production_event` row (iter 2)

### 8. No soft delete on lifecycle records.

Completed batches, closed cut tickets, finalized POs — they stay in the database forever as the forensic record. Use `status` enums (`completed`, `cancelled`, `closed`) for terminal states. Never add a `deleted_at` column to these.

### 9. Generate migrations, don't hand-write them.

```bash
# After editing packages/db/src/schema/*.ts
pnpm generate
```

`drizzle-kit` produces `0000_initial.sql`-style files. Review the diff, commit alongside the schema change. **Never edit a committed migration** — generate a new one.

### 10. Schema imports drop `.js` extension.

Only inside `packages/db/src/schema/*.ts`. Everywhere else, preserve ESM `.js` extensions on relative imports. `drizzle-kit generate` loads schema via CJS require and can't resolve `.js → .ts`; this is Deviation 2 from the original plan.

---

## Conventions

### File organization

```
packages/server/src/
  errors.ts                ← DomainError hierarchy (single file, ~70 lines)
  auth/
    session.ts             ← authenticate(), createSession(), bcrypt guard
    middleware.ts          ← requireAuth, requireRole
  services/
    audit-service.ts       ← recordAudit + scrub
    vendor-service.ts
    material-service.ts
    po-service.ts          ← + recalculatePoStatus
    lot-service.ts         ← receivePoLine
    bom-service.ts         ← + activateBom + computeRequirementsFromComponents
    cut-ticket-service.ts  ← + pickFifo + pickSingleDyeLot (exported pure fns)
    product-service.ts
  routes/                  ← One file per resource. Routes are Zod-validated thin wrappers.
  app.ts                   ← buildApp(): env parse → drizzle → routes → setErrorHandler
```

### Naming

- **Tables**: snake_case (`material_lots`, `cut_ticket_lots`)
- **Drizzle column refs**: camelCase (`schema.materialLots.quantityRemaining`)
- **Status enums**: snake_case string literals (`'in_cutting'`, `'awaiting_qc'`)
- **State-transition fns**: verb + entity (`closeCutTicket`, `activateBom`)
- **Pure helpers**: noun-first (`pickFifo`, `computeRequirementsFromComponents`)

### Testing

- **Pure functions**: trivial unit tests (Vitest). See `packages/server/test/cut-ticket-allocator.test.ts`.
- **DB-touching code**: use `withTestDb(async tx => { … })`. Each test gets a tx that rolls back. Suites can run in parallel.
- **Integration tests** (iter 2): `app.inject({ method, url, payload })` against a real Fastify app + `withTestDb`.
- **No mocking of Drizzle.** If you find yourself reaching for `vi.mock("drizzle-orm")`, use `withTestDb` instead.

### Migrations

- One migration per schema change.
- Migration files are immutable once merged to main.
- Drop columns in two steps (deploy code that doesn't read them → next release drops them).
- Always review the generated SQL before committing — drizzle-kit occasionally emits surprising things on enum reorderings.

---

## When you're stuck

1. **Look for prior art first.** Most patterns already exist somewhere — grep before inventing.
2. **Run the e2e walk** to understand what success looks like: `packages/server/test/e2e.sh`.
3. **Read the ADRs** (`docs/adr/`) before changing architecture. They encode decisions, not just history.
4. **Read the PRD** (`docs/prd/`, iter 2+) for scope boundaries.
5. **Ask, don't guess.** Ambiguity in the data model is worth a clarifying question — Drizzle migrations are forever.

---

## Things this repo deliberately doesn't do

- ORM-managed identity (no `findOrCreate`, no implicit upserts). All inserts are explicit.
- Per-route try/catch. Throw `DomainError`; the central handler maps it.
- Generic `update` methods on lifecycle entities. Use named transitions.
- Soft delete on transactional records.
- Floats for money or quantity. Use `numeric(12,4)` and SQL arithmetic.
- Mocking the database in service tests.

---

## Iteration roadmap

| Iter | Theme                                            | Status       |
| ---- | ------------------------------------------------ | ------------ |
| 1    | Data layer, REST API, CLI, lot/cut foundation    | PR #1 (this) |
| 2    | Production batches, station tracking, Shopify FG | PR #2 (next) |
| 3    | React UI, real-time, sew/QC/finish/pack          | future       |
| 4+   | CSV export, multi-facility, mobile, SAM costing  | future       |
