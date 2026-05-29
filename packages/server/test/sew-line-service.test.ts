import { afterAll, describe, expect, it } from "vitest";
import { BusinessRuleError, NotFoundError } from "../src/errors.js";
import {
  cancelBatch,
  completeBatch,
  receiveFromCutter,
  stageForProduction,
  startProduction,
  submitForQc,
} from "../src/services/production-batch-service.js";
import {
  addMachine,
  assignBatchToLine,
  createSewLine,
  getLineLoad,
  getSewLine,
  listSewLines,
  releaseBatchFromLine,
  updateMachineStatus,
} from "../src/services/sew-line-service.js";
import { seedProductionFixture, seedValidatedPvt } from "./helpers/seed-production.js";
import { closeTestDb, withTestDb } from "./helpers/test-db.js";

afterAll(async () => {
  await closeTestDb();
});

describe("createSewLine", () => {
  it("creates a sew line and returns it", async () => {
    await withTestDb(async (db) => {
      const line = await createSewLine(db, {
        code: "SL-A",
        name: "Line Alpha",
        capacityUnitsPerDay: 120,
      });
      expect(line.code).toBe("SL-A");
      expect(line.active).toBe(true);
    });
  });
});

describe("addMachine", () => {
  it("adds a machine to an existing line", async () => {
    await withTestDb(async (db) => {
      const line = await createSewLine(db, {
        code: "SL-B",
        name: "Line Beta",
        capacityUnitsPerDay: 80,
      });
      const machine = await addMachine(db, {
        sewLineId: line.id,
        code: "MC-001",
        type: "flatlock",
      });
      expect(machine.sewLineId).toBe(line.id);
      expect(machine.status).toBe("available");
    });
  });

  it("throws NotFoundError for non-existent sew line", async () => {
    await withTestDb(async (db) => {
      await expect(
        addMachine(db, { sewLineId: 999999, code: "MC-002", type: "overlock" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});

describe("updateMachineStatus", () => {
  it("transitions machine status", async () => {
    await withTestDb(async (db) => {
      const line = await createSewLine(db, {
        code: "SL-C",
        name: "Line C",
        capacityUnitsPerDay: 60,
      });
      const machine = await addMachine(db, {
        sewLineId: line.id,
        code: "MC-003",
        type: "single_needle",
      });
      const updated = await updateMachineStatus(db, machine.id, "maintenance");
      expect(updated.status).toBe("maintenance");
    });
  });

  it("throws NotFoundError for a non-existent machine", async () => {
    await withTestDb(async (db) => {
      await expect(updateMachineStatus(db, 999999, "in_use")).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});

describe("assignBatchToLine", () => {
  it("assigns an in_production batch to a line", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "20",
        cutterUserId: fx.userId,
      });
      await stageForProduction(db, batch.id, fx.userId);
      await startProduction(db, batch.id, fx.userId);

      const line = await createSewLine(db, {
        code: "SL-D",
        name: "Line D",
        capacityUnitsPerDay: 100,
      });
      const assigned = await assignBatchToLine(db, {
        ref: batch.id,
        sewLineId: line.id,
        actorUserId: fx.userId,
      });
      expect(assigned.sewLineId).toBe(line.id);
      expect(assigned.assignedAt).not.toBeNull();
    });
  });

  it("throws BusinessRuleError when assigning a completed (terminal) batch", async () => {
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
      await completeBatch(db, { ref: batch.id, qty: "5", verdict: "pass", actorUserId: fx.userId });

      const line = await createSewLine(db, {
        code: "SL-E",
        name: "Line E",
        capacityUnitsPerDay: 50,
      });
      await expect(
        assignBatchToLine(db, { ref: batch.id, sewLineId: line.id }),
      ).rejects.toBeInstanceOf(BusinessRuleError);
    });
  });

  it("throws NotFoundError for a non-existent sew line", async () => {
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
        assignBatchToLine(db, { ref: batch.id, sewLineId: 999999 }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});

describe("releaseBatchFromLine", () => {
  it("clears sewLineId and assignedAt on release", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "10",
        cutterUserId: fx.userId,
      });
      await stageForProduction(db, batch.id, fx.userId);
      await startProduction(db, batch.id, fx.userId);
      const line = await createSewLine(db, {
        code: "SL-F",
        name: "Line F",
        capacityUnitsPerDay: 80,
      });
      await assignBatchToLine(db, { ref: batch.id, sewLineId: line.id });
      const released = await releaseBatchFromLine(db, batch.id);
      expect(released.sewLineId).toBeNull();
      expect(released.assignedAt).toBeNull();
    });
  });

  it("throws BusinessRuleError when releasing from a completed (terminal) batch", async () => {
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
      await completeBatch(db, { ref: batch.id, qty: "5", verdict: "pass", actorUserId: fx.userId });
      await expect(releaseBatchFromLine(db, batch.id)).rejects.toBeInstanceOf(BusinessRuleError);
    });
  });

  it("throws BusinessRuleError when releasing from a cancelled (terminal) batch", async () => {
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
      await cancelBatch(db, { ref: batch.id, reason: "test cancel", actorUserId: fx.userId });
      await expect(releaseBatchFromLine(db, batch.id)).rejects.toBeInstanceOf(BusinessRuleError);
    });
  });

  it("throws BusinessRuleError when releasing a batch not assigned to any line", async () => {
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
      await expect(releaseBatchFromLine(db, batch.id)).rejects.toBeInstanceOf(BusinessRuleError);
    });
  });
});

describe("listSewLines", () => {
  it("returns empty array when no lines exist", async () => {
    await withTestDb(async (db) => {
      expect(await listSewLines(db)).toHaveLength(0);
    });
  });

  it("returns lines ordered by code with machines grouped per line", async () => {
    await withTestDb(async (db) => {
      const lineB = await createSewLine(db, {
        code: "LSL-B",
        name: "Line B",
        capacityUnitsPerDay: 50,
      });
      const lineA = await createSewLine(db, {
        code: "LSL-A",
        name: "Line A",
        capacityUnitsPerDay: 100,
      });
      await addMachine(db, { sewLineId: lineA.id, code: "LSL-M1", type: "flatlock" });
      await addMachine(db, { sewLineId: lineA.id, code: "LSL-M2", type: "overlock" });

      const lines = await listSewLines(db);
      const a = lines.find((l) => l.id === lineA.id);
      const b = lines.find((l) => l.id === lineB.id);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(a!.machines).toHaveLength(2);
      expect(b!.machines).toHaveLength(0);
      // ordered by code — LSL-A comes before LSL-B
      const aIdx = lines.findIndex((l) => l.id === lineA.id);
      const bIdx = lines.findIndex((l) => l.id === lineB.id);
      expect(aIdx).toBeLessThan(bIdx);
    });
  });
});

describe("getLineLoad", () => {
  it("returns 0 load for a line with no in_production batches on a date", async () => {
    await withTestDb(async (db) => {
      const line = await createSewLine(db, {
        code: "SL-G",
        name: "Line G",
        capacityUnitsPerDay: 100,
      });
      const load = await getLineLoad(db, line.id, "2026-01-01");
      expect(load.totalQtyPlanned).toBe("0");
      expect(load.batchCount).toBe(0);
    });
  });

  it("sums qty_planned of in_production batches for the given date", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const line = await createSewLine(db, {
        code: "SL-H",
        name: "Line H",
        capacityUnitsPerDay: 200,
      });

      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "25",
        cutterUserId: fx.userId,
      });
      await stageForProduction(db, batch.id, fx.userId);
      await startProduction(db, batch.id, fx.userId);
      await assignBatchToLine(db, { ref: batch.id, sewLineId: line.id });

      const today = new Date().toISOString().slice(0, 10);
      const load = await getLineLoad(db, line.id, today);
      expect(Number(load.totalQtyPlanned)).toBe(25);
      expect(load.batchCount).toBe(1);
    });
  });

  it("excludes batches that are not in_production status from load", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const line = await createSewLine(db, {
        code: "SL-J",
        name: "Line J",
        capacityUnitsPerDay: 100,
      });

      // batch assigned to line but not yet in in_production (staged_pre_prod)
      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "15",
        cutterUserId: fx.userId,
      });
      await stageForProduction(db, batch.id, fx.userId);
      await assignBatchToLine(db, { ref: batch.id, sewLineId: line.id });

      const today = new Date().toISOString().slice(0, 10);
      const load = await getLineLoad(db, line.id, today);
      expect(load.totalQtyPlanned).toBe("0");
      expect(load.batchCount).toBe(0);
    });
  });

  it("throws NotFoundError for a non-existent line", async () => {
    await withTestDb(async (db) => {
      await expect(getLineLoad(db, 999999, "2026-01-01")).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});

describe("getSewLine", () => {
  it("includes machines in the response", async () => {
    await withTestDb(async (db) => {
      const line = await createSewLine(db, {
        code: "SL-I",
        name: "Line I",
        capacityUnitsPerDay: 90,
      });
      await addMachine(db, { sewLineId: line.id, code: "MC-010", type: "bartack" });
      const detail = await getSewLine(db, line.id);
      expect(detail.machines).toHaveLength(1);
      expect(detail.machines[0]?.type).toBe("bartack");
    });
  });
});
