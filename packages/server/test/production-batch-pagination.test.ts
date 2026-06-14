import { afterAll, describe, expect, it } from "vitest";
import { closeTestDb, withTestDb } from "./helpers/test-db.js";
import {
  seedProductionFixture,
  seedValidatedPvt,
  type ProductionFixture,
} from "./helpers/seed-production.js";
import { listBatches } from "../src/services/production-batch-queries.js";
import { ValidationFailedError } from "../src/errors.js";
import { receiveFromCutter } from "../src/services/production-batch-service.js";

afterAll(async () => {
  await closeTestDb();
});

async function seedBatches(
  db: Parameters<typeof receiveFromCutter>[0],
  fx: ProductionFixture,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await receiveFromCutter(db, {
      cutTicketId: fx.productionCutTicketId,
      productVariantId: fx.variantId,
      qtyPlanned: "5",
      cutterUserId: fx.userId,
      actorUserId: fx.userId,
    });
  }
}

describe("listBatches — pagination", () => {
  it("applies the default limit of 50 and offset 0", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      await seedBatches(db, fx, 3);

      const page = await listBatches(db, {});
      expect(page.total).toBe(3);
      expect(page.limit).toBe(50);
      expect(page.offset).toBe(0);
      expect(page.items.length).toBe(3);
    });
  });

  it("clamps an over-large limit to 200 at the service level", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      await seedBatches(db, fx, 1);

      const page = await listBatches(db, { limit: 500 });
      expect(page.limit).toBe(200);
      expect(page.total).toBe(1);
    });
  });

  it("pages through results with limit and offset", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      await seedBatches(db, fx, 5);

      const firstPage = await listBatches(db, { limit: 2, offset: 2 });
      expect(firstPage.items.length).toBe(2);
      expect(firstPage.total).toBe(5);
      expect(firstPage.offset).toBe(2);

      const lastPage = await listBatches(db, { limit: 2, offset: 4 });
      expect(lastPage.items.length).toBe(1);
      expect(lastPage.total).toBe(5);
      expect(lastPage.offset).toBe(4);
    });
  });

  it("reports total that reflects the active filter, not the whole table", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      await seedBatches(db, fx, 3);

      const page = await listBatches(db, { status: "completed" });
      expect(page.total).toBe(0);
      expect(page.items).toEqual([]);
    });
  });

  it("throws ValidationFailedError for a non-ISO since value", async () => {
    await withTestDb(async (db) => {
      await expect(listBatches(db, { since: "not-a-date" })).rejects.toBeInstanceOf(
        ValidationFailedError,
      );
    });
  });

  it("since filter returns no results for a far-future date", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      await seedBatches(db, fx, 2);

      const page = await listBatches(db, { since: "2099-01-01T00:00:00Z" });
      expect(page.total).toBe(0);
      expect(page.items).toEqual([]);
    });
  });
});
