import { schema } from "@garment-mgmt/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { BusinessRuleError, ValidationFailedError } from "../src/errors.js";
import {
  completeBatch,
  receiveFromCutter,
  stageForProduction,
  startProduction,
  submitForQc,
} from "../src/services/production-batch-service.js";
import { withTestDb } from "./helpers/test-db.js";
import { seedProductionFixture, seedValidatedPvt } from "./helpers/seed-production.js";

describe("production batch — state transition guards", () => {
  it("guard 1: stage rejects when not in received_from_cutter", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "5",
        cutterUserId: fx.userId,
      });
      await stageForProduction(db, batch.id, fx.userId);
      await expect(stageForProduction(db, batch.id, fx.userId)).rejects.toBeInstanceOf(
        BusinessRuleError,
      );
    });
  });

  it("guard 2: start rejects when not in staged_pre_prod", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "5",
        cutterUserId: fx.userId,
      });
      await expect(startProduction(db, batch.id, fx.userId)).rejects.toBeInstanceOf(
        BusinessRuleError,
      );
    });
  });

  it("guard 3: submitForQc rejects when not in in_production", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "5",
        cutterUserId: fx.userId,
      });
      await expect(
        submitForQc(db, { ref: batch.id, qty: "5", actorUserId: fx.userId }),
      ).rejects.toBeInstanceOf(BusinessRuleError);
    });
  });

  it("guard 4: completeBatch rejects when not in awaiting_qc", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "5",
        cutterUserId: fx.userId,
      });
      await expect(
        completeBatch(db, {
          ref: batch.id,
          qty: "5",
          verdict: "pass",
          actorUserId: fx.userId,
        }),
      ).rejects.toBeInstanceOf(BusinessRuleError);
    });
  });

  it("guard 5: receiveFromCutter refuses a pvt-kind cut ticket", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      await expect(
        receiveFromCutter(db, {
          cutTicketId: fx.pvtCutTicketId,
          productVariantId: fx.variantId,
          qtyPlanned: "5",
          cutterUserId: fx.userId,
        }),
      ).rejects.toMatchObject({ code: "rule.cut_ticket_not_production" });
    });
  });

  it("guard 6: submitForQc rejects qty greater than qtyPlanned", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "5",
        cutterUserId: fx.userId,
      });
      await stageForProduction(db, batch.id, fx.userId);
      await startProduction(db, batch.id, fx.userId);
      await expect(
        submitForQc(db, { ref: batch.id, qty: "999", actorUserId: fx.userId }),
      ).rejects.toMatchObject({ code: "rule.qty_exceeds_planned" });
    });
  });

  it("guard 7: completeBatch rejects an invalid qc verdict", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "5",
        cutterUserId: fx.userId,
      });
      await stageForProduction(db, batch.id, fx.userId);
      await startProduction(db, batch.id, fx.userId);
      await submitForQc(db, { ref: batch.id, qty: "5", actorUserId: fx.userId });
      await expect(
        completeBatch(db, {
          ref: batch.id,
          qty: "5",
          // @ts-expect-error: intentionally invalid verdict for runtime guard test
          verdict: "maybe",
          actorUserId: fx.userId,
        }),
      ).rejects.toBeInstanceOf(ValidationFailedError);
    });
  });

  it("guard 8: receiveFromCutter requires a marker on the cut ticket", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      await db
        .update(schema.cutTickets)
        .set({ markerId: null })
        .where(eq(schema.cutTickets.id, fx.productionCutTicketId));
      await expect(
        receiveFromCutter(db, {
          cutTicketId: fx.productionCutTicketId,
          productVariantId: fx.variantId,
          qtyPlanned: "5",
          cutterUserId: fx.userId,
        }),
      ).rejects.toMatchObject({ code: "rule.cut_ticket_missing_marker" });
    });
  });
});
