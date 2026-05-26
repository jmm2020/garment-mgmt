import { describe, expect, it } from "vitest";
import { BusinessRuleError, ValidationFailedError } from "../src/errors.js";
import { getPvtAuthorization, loadRun } from "../src/services/pvt-queries.js";
import {
  cancelPvtRun,
  createPvtRun,
  markPvtReceived,
  markPvtShipped,
  rejectPvt,
  validatePvt,
} from "../src/services/pvt-service.js";
import { withTestDb } from "./helpers/test-db.js";
import { seedProductionFixture } from "./helpers/seed-production.js";

describe("PVT flow — happy path", () => {
  it("walks cutting → shipped → inspecting → validated and sets expires_at", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db, { pvtValidityMonths: 6 });

      const run = await createPvtRun(db, {
        productVariantId: fx.variantId,
        markerId: fx.markerId,
        cutterUserId: fx.userId,
        cutTicketId: fx.pvtCutTicketId,
      });
      expect(run.status).toBe("cutting");
      expect(run.runNo).toMatch(/^PVT-\d{4}-\d{4}$/);

      const shipped = await markPvtShipped(db, run.id, fx.userId);
      expect(shipped.status).toBe("shipped");
      expect(shipped.shippedAt).not.toBeNull();

      const received = await markPvtReceived(db, run.id, fx.userId);
      expect(received.status).toBe("inspecting");

      const validated = await validatePvt(db, {
        ref: run.id,
        validatorUserId: fx.userId,
      });
      expect(validated.status).toBe("validated");
      expect(validated.validityMonths).toBe(6);
      expect(validated.expiresAt).not.toBeNull();
      expect(validated.validatedAt).not.toBeNull();

      const auth = await getPvtAuthorization(db, fx.variantId, fx.markerId);
      expect(auth.authorized).toBe(true);
    });
  });

  it("createPvtRun refuses a production-kind cut ticket", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await expect(
        createPvtRun(db, {
          productVariantId: fx.variantId,
          markerId: fx.markerId,
          cutterUserId: fx.userId,
          cutTicketId: fx.productionCutTicketId,
        }),
      ).rejects.toMatchObject({ code: "rule.cut_ticket_not_pvt" });
    });
  });
});

describe("PVT flow — reject path", () => {
  it("rejected run closes authorization with reason='rejected'", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      const run = await createPvtRun(db, {
        productVariantId: fx.variantId,
        markerId: fx.markerId,
        cutterUserId: fx.userId,
        cutTicketId: fx.pvtCutTicketId,
      });
      await markPvtShipped(db, run.id, fx.userId);
      await markPvtReceived(db, run.id, fx.userId);
      const rejected = await rejectPvt(db, {
        ref: run.id,
        validatorUserId: fx.userId,
        reason: "stitching defects on shoulder seam",
      });
      expect(rejected.status).toBe("rejected");
      expect(rejected.rejectedReason).toBe("stitching defects on shoulder seam");

      const auth = await getPvtAuthorization(db, fx.variantId, fx.markerId);
      expect(auth.authorized).toBe(false);
      expect(auth.reason).toBe("rejected");
    });
  });

  it("rejectPvt requires a reason", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      const run = await createPvtRun(db, {
        productVariantId: fx.variantId,
        markerId: fx.markerId,
        cutterUserId: fx.userId,
        cutTicketId: fx.pvtCutTicketId,
      });
      await markPvtShipped(db, run.id, fx.userId);
      await markPvtReceived(db, run.id, fx.userId);
      await expect(
        rejectPvt(db, {
          ref: run.id,
          validatorUserId: fx.userId,
          reason: "",
        }),
      ).rejects.toBeInstanceOf(ValidationFailedError);
    });
  });
});

describe("PVT flow — cancel from non-terminal", () => {
  it("cancels from cutting and refuses from validated", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      const a = await createPvtRun(db, {
        productVariantId: fx.variantId,
        markerId: fx.markerId,
        cutterUserId: fx.userId,
        cutTicketId: fx.pvtCutTicketId,
      });
      const cancelled = await cancelPvtRun(db, {
        ref: a.id,
        actorUserId: fx.userId,
        reason: "wrong fabric",
      });
      expect(cancelled.status).toBe("cancelled");

      // Walk a second PVT through to validated, then attempt cancel — should fail.
      const fx2 = await seedProductionFixture(db);
      const b = await createPvtRun(db, {
        productVariantId: fx2.variantId,
        markerId: fx2.markerId,
        cutterUserId: fx2.userId,
        cutTicketId: fx2.pvtCutTicketId,
      });
      await markPvtShipped(db, b.id, fx2.userId);
      await markPvtReceived(db, b.id, fx2.userId);
      await validatePvt(db, { ref: b.id, validatorUserId: fx2.userId });
      await expect(
        cancelPvtRun(db, {
          ref: b.id,
          actorUserId: fx2.userId,
          reason: "changed mind",
        }),
      ).rejects.toBeInstanceOf(BusinessRuleError);
    });
  });
});

describe("PVT — forensic lookup", () => {
  it("loadRun resolves both numeric id and PVT-YYYY-#### identifier", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      const run = await createPvtRun(db, {
        productVariantId: fx.variantId,
        markerId: fx.markerId,
        cutterUserId: fx.userId,
        cutTicketId: fx.pvtCutTicketId,
      });
      const byId = await loadRun(db, run.id);
      const byRunNo = await loadRun(db, run.runNo);
      expect(byId.id).toBe(run.id);
      expect(byRunNo.id).toBe(run.id);
      expect(byRunNo.runNo).toBe(run.runNo);
    });
  });
});
