import { schema, type Database } from "@garment-mgmt/db";
import { describe, expect, it } from "vitest";
import { BusinessRuleError } from "../src/errors.js";
import { getBatch } from "../src/services/production-batch-queries.js";
import {
  cancelBatch,
  completeBatch,
  receiveFromCutter,
  stageForProduction,
  startProduction,
  submitForQc,
} from "../src/services/production-batch-service.js";
import { withTestDb } from "./helpers/test-db.js";
import {
  seedProductionFixture,
  seedValidatedPvt,
  type ProductionFixture,
} from "./helpers/seed-production.js";

type AdvanceFn = (db: Database, fx: ProductionFixture, batchId: number) => Promise<void>;

interface CancelSetup {
  name: string;
  advance: AdvanceFn;
  expectedFrom: schema.ProductionBatchStatus;
}

const setups: CancelSetup[] = [
  {
    name: "received_from_cutter",
    advance: async () => {},
    expectedFrom: "received_from_cutter",
  },
  {
    name: "staged_pre_prod",
    advance: async (db, fx, id) => {
      await stageForProduction(db, id, fx.userId);
    },
    expectedFrom: "staged_pre_prod",
  },
  {
    name: "in_production",
    advance: async (db, fx, id) => {
      await stageForProduction(db, id, fx.userId);
      await startProduction(db, id, fx.userId);
    },
    expectedFrom: "in_production",
  },
  {
    name: "awaiting_qc",
    advance: async (db, fx, id) => {
      await stageForProduction(db, id, fx.userId);
      await startProduction(db, id, fx.userId);
      await submitForQc(db, { ref: id, qty: "5", actorUserId: fx.userId });
    },
    expectedFrom: "awaiting_qc",
  },
];

describe("production batch — cancel from each non-terminal", () => {
  for (const setup of setups) {
    it(`cancels from ${setup.name}`, async () => {
      await withTestDb(async (db) => {
        const fx = await seedProductionFixture(db);
        await seedValidatedPvt(db, fx);
        const batch = await receiveFromCutter(db, {
          cutTicketId: fx.productionCutTicketId,
          productVariantId: fx.variantId,
          qtyPlanned: "5",
          cutterUserId: fx.userId,
        });
        await setup.advance(db, fx, batch.id);
        const cancelled = await cancelBatch(db, {
          ref: batch.id,
          reason: `test cancel from ${setup.name}`,
          actorUserId: fx.userId,
        });
        expect(cancelled.status).toBe("cancelled");
        expect(cancelled.cancelledAt).not.toBeNull();

        const detail = await getBatch(db, batch.id);
        const cancelEvent = detail.events.find((e) => e.toStatus === "cancelled");
        expect(cancelEvent).toBeDefined();
        expect(cancelEvent?.fromStatus).toBe(setup.expectedFrom);
      });
    });
  }

  it("refuses to cancel a batch already in completed", async () => {
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
      await completeBatch(db, {
        ref: batch.id,
        qty: "5",
        verdict: "pass",
        actorUserId: fx.userId,
      });
      await expect(
        cancelBatch(db, {
          ref: batch.id,
          reason: "too late",
          actorUserId: fx.userId,
        }),
      ).rejects.toBeInstanceOf(BusinessRuleError);
    });
  });
});
