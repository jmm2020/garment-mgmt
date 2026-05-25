# ADR 0002: Drizzle ORM over Prisma

**Status**: Accepted (2026-05-25)

## Context

The Production Hub schema is unusual for a TypeScript project: many
Postgres-specific features are load-bearing.

- 6+ `pgEnum` types (vendor_type, material_type, po_status, …) that
  must be `ALTER TYPE … ADD VALUE` extendable in production.
- Partial indexes (`material_lots.dye_lot WHERE dye_lot IS NOT NULL`,
  `remnants.status WHERE status = 'available'`) for performance.
- `jsonb` columns for certifications, size curves, addresses.
- `GENERATED ALWAYS AS IDENTITY` primary keys.
- Check constraints (e.g., `quantity_remaining >= 0`).
- Append-only ledger queries (`lot_movements`) that benefit from
  composite indexes.

Two TypeScript ORMs are viable: Prisma (codegen) and Drizzle (no codegen).

## Decision

We use **Drizzle ORM 0.36** with the `postgres` 3.4 driver and
`drizzle-kit` 0.28 for migration generation.

## Consequences

**Positive**:

- **Type inference is direct.** Drizzle's `$inferSelect` / `$inferInsert`
  reflect the schema with no codegen step or shadow DB. The schema file
  is the truth source.
- **First-class Postgres features.** Partial indexes, identity PKs,
  check constraints, and enums map cleanly to Drizzle's API. No
  fighting an abstraction layer.
- **Cheap escape hatch.** `tx.execute(sql\`SELECT ... FOR UPDATE\`)`is one line. We need`FOR UPDATE`for the lot allocation race in`cut-ticket-service`.
- **Smaller dependency footprint.** No Prisma engine binary.

**Negative**:

- Smaller ecosystem than Prisma; fewer Stack Overflow hits.
- Generated migrations need human review (Drizzle is honest about
  this — it does not invent destructive rewrites).
- Relational queries (joins) are less ergonomic than Prisma's
  `include`. We mitigate by composing in service code, which keeps
  business rules visible.

**Enum migration pattern (for future schema changes)**:

```sql
ALTER TYPE vendor_type ADD VALUE 'embroidery_house';
```

This is non-blocking in PG ≥ 12; document each enum addition as a
hand-edited migration alongside the Drizzle-generated diff.
