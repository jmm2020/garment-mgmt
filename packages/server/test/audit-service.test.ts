import { describe, expect, it } from "vitest";
import { recordAudit } from "../src/services/audit-service.js";

function makeFakeDb() {
  const calls: unknown[] = [];
  const fake = {
    insert: () => ({
      values: (v: unknown) => {
        calls.push(v);
        return Promise.resolve();
      },
    }),
  };
  return { db: fake as never, calls };
}

describe("recordAudit", () => {
  it("scrubs passwordHash and session_token from before/after", async () => {
    const { db, calls } = makeFakeDb();
    await recordAudit({
      db,
      entityType: "user",
      entityId: 1,
      action: "update",
      before: { id: 1, email: "a@b.c", passwordHash: "secret", role: "viewer" },
      after: { id: 1, email: "a@b.c", passwordHash: "rotated", role: "admin", sessionToken: "tok" },
    });
    const inserted = calls[0] as {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };
    expect(inserted.before).not.toHaveProperty("passwordHash");
    expect(inserted.after).not.toHaveProperty("passwordHash");
    expect(inserted.after).not.toHaveProperty("sessionToken");
    expect(inserted.before.email).toBe("a@b.c");
  });

  it("handles primitive and nested values", async () => {
    const { db, calls } = makeFakeDb();
    await recordAudit({
      db,
      entityType: "lot",
      entityId: 9,
      action: "create",
      after: { id: 9, certData: { bluesign: true }, list: [1, 2, { passwordHash: "x", ok: true }] },
    });
    const inserted = calls[0] as { after: { list: Array<Record<string, unknown>> } };
    const nested = inserted.after.list[2]!;
    expect(nested).not.toHaveProperty("passwordHash");
    expect(nested.ok).toBe(true);
  });
});
