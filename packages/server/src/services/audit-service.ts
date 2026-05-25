import { schema, type DbExecutor } from "@garment-mgmt/db";

const SENSITIVE_KEYS = new Set(["passwordHash", "password_hash", "sessionToken", "session_token"]);

export interface RecordAuditInput {
  db: DbExecutor;
  entityType: string;
  entityId: number;
  action: string;
  actorUserId?: number;
  before?: unknown;
  after?: unknown;
}

export async function recordAudit(input: RecordAuditInput): Promise<void> {
  await input.db.insert(schema.auditLog).values({
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actorUserId: input.actorUserId,
    before: scrub(input.before),
    after: scrub(input.after),
  });
}

function scrub(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k)) continue;
    out[k] = scrub(v);
  }
  return out;
}
