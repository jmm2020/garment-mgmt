import { schema } from "@garment-mgmt/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { NotFoundError } from "../src/errors.js";
import {
  receiveFromCutter,
  stageForProduction,
  startProduction,
} from "../src/services/production-batch-service.js";
import {
  getUnit,
  listBatchUnits,
  recordUnitQcVerdict,
} from "../src/services/production-unit-service.js";
import { closeTestDb, withTestDb } from "./helpers/test-db.js";
import { seedProductionFixture, seedValidatedPvt } from "./helpers/seed-production.js";

afterAll(async () => {
  await closeTestDb();
});

describe("production units — minting", () => {
  it("mints qty_planned units when batch enters in_production", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "10",
        cutterUserId: fx.userId,
        actorUserId: fx.userId,
      });
      await stageForProduction(db, batch.id, fx.userId);
      await startProduction(db, batch.id, fx.userId);

      const units = await listBatchUnits(db, batch.id);
      expect(units).toHaveLength(10);
      expect(units[0]?.unitSerial).toMatch(/^U-\d{4}-\d{6}$/);
      expect(units.every((u) => u.status === "created")).toBe(true);
      expect(units.every((u) => u.qcVerdict === null)).toBe(true);
    });
  });

  it("emits a units_minted production_event when units are minted", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "5",
        cutterUserId: fx.userId,
        actorUserId: fx.userId,
      });
      await stageForProduction(db, batch.id, fx.userId);
      await startProduction(db, batch.id, fx.userId);

      const events = await db
        .select()
        .from(schema.productionEvents)
        .where(eq(schema.productionEvents.batchId, batch.id));
      const minted = events.filter((e) => e.eventType === "units_minted");
      expect(minted).toHaveLength(1);
      expect((minted[0]?.payload as { count: number } | null)?.count).toBe(5);
    });
  });
});

describe("production units — QC verdicts", () => {
  it("10-unit batch: 8 pass / 2 fail produces correct statuses (acceptance test from issue #9)", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "10",
        cutterUserId: fx.userId,
        actorUserId: fx.userId,
      });
      await stageForProduction(db, batch.id, fx.userId);
      await startProduction(db, batch.id, fx.userId);
      const units = await listBatchUnits(db, batch.id);
      expect(units).toHaveLength(10);

      for (const unit of units.slice(0, 8)) {
        await recordUnitQcVerdict(db, {
          unitSerial: unit.unitSerial,
          verdict: "pass",
          actorUserId: fx.userId,
        });
      }
      for (const unit of units.slice(8)) {
        await recordUnitQcVerdict(db, {
          unitSerial: unit.unitSerial,
          verdict: "fail",
          reason: "seam failure",
          actorUserId: fx.userId,
        });
      }

      const all = await listBatchUnits(db, batch.id);
      expect(all).toHaveLength(10);
      const passed = await listBatchUnits(db, batch.id, { verdict: "pass" });
      const failed = await listBatchUnits(db, batch.id, { verdict: "fail" });
      expect(passed).toHaveLength(8);
      expect(failed).toHaveLength(2);
      expect(passed.every((u) => u.status === "qc_passed")).toBe(true);
      expect(failed.every((u) => u.status === "qc_rejected")).toBe(true);
      expect(failed[0]?.qcRejectedReason).toBe("seam failure");
    });
  });

  it("rejects duplicate verdict on same unit", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "1",
        cutterUserId: fx.userId,
        actorUserId: fx.userId,
      });
      await stageForProduction(db, batch.id, fx.userId);
      await startProduction(db, batch.id, fx.userId);
      const [unit] = await listBatchUnits(db, batch.id);
      if (!unit) throw new Error("expected one minted unit");

      await recordUnitQcVerdict(db, {
        unitSerial: unit.unitSerial,
        verdict: "pass",
        actorUserId: fx.userId,
      });
      await expect(
        recordUnitQcVerdict(db, {
          unitSerial: unit.unitSerial,
          verdict: "fail",
          actorUserId: fx.userId,
        }),
      ).rejects.toMatchObject({ code: "rule.unit_verdict_already_set" });
    });
  });

  it("raises NotFoundError for unknown unit serial", async () => {
    await withTestDb(async (db) => {
      await expect(
        recordUnitQcVerdict(db, {
          unitSerial: "U-9999-999999",
          verdict: "pass",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it("batch-level QC verdict and qty_actual are unaffected by per-unit QC", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "3",
        cutterUserId: fx.userId,
        actorUserId: fx.userId,
      });
      await stageForProduction(db, batch.id, fx.userId);
      await startProduction(db, batch.id, fx.userId);
      const units = await listBatchUnits(db, batch.id);
      for (const unit of units) {
        await recordUnitQcVerdict(db, {
          unitSerial: unit.unitSerial,
          verdict: "pass",
          actorUserId: fx.userId,
        });
      }

      const [reloaded] = await db
        .select()
        .from(schema.productionBatches)
        .where(eq(schema.productionBatches.id, batch.id));
      expect(reloaded?.qcVerdict).toBeNull();
      expect(reloaded?.qtyActual).toBeNull();
      expect(reloaded?.status).toBe("in_production");
    });
  });
});

describe("production units — provenance lookup", () => {
  it("getUnit returns unit + batch + cut ticket chain", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "2",
        cutterUserId: fx.userId,
        actorUserId: fx.userId,
      });
      await stageForProduction(db, batch.id, fx.userId);
      await startProduction(db, batch.id, fx.userId);
      const [unit] = await listBatchUnits(db, batch.id);
      if (!unit) throw new Error("expected at least one minted unit");

      const result = await getUnit(db, unit.unitSerial);
      expect(result.unit.unitSerial).toBe(unit.unitSerial);
      expect(result.batch.id).toBe(batch.id);
      expect(result.batch.batchNo).toBe(batch.batchNo);
      expect(result.cutTicket.id).toBe(fx.productionCutTicketId);
    });
  });

  it("getUnit raises NotFoundError for unknown serial", async () => {
    await withTestDb(async (db) => {
      await expect(getUnit(db, "U-9999-999999")).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
