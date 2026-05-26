import { afterAll, describe, expect, it } from "vitest";
import { NotFoundError } from "../src/errors.js";
import { pushPendingOnce } from "../src/jobs/shopify-inventory-push.js";
import {
  getBatch,
  loadBatch,
  markShopifyPushed,
} from "../src/services/production-batch-queries.js";
import {
  completeBatch,
  receiveFromCutter,
  stageForProduction,
  startProduction,
  submitForQc,
} from "../src/services/production-batch-service.js";
import { closeTestDb, withTestDb } from "./helpers/test-db.js";
import { seedProductionFixture, seedValidatedPvt } from "./helpers/seed-production.js";

afterAll(async () => {
  await closeTestDb();
});

describe("production batch — happy path", () => {
  it("walks receive → stage → start → submit-qc → complete and marks shopify_pushed_at", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);

      const received = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "10",
        cutterUserId: fx.userId,
        actorUserId: fx.userId,
      });
      expect(received.status).toBe("received_from_cutter");
      expect(received.batchNo).toMatch(/^PB-\d{4}-\d{4}$/);

      const staged = await stageForProduction(db, received.id, fx.userId);
      expect(staged.status).toBe("staged_pre_prod");
      expect(staged.stagedAt).not.toBeNull();

      const started = await startProduction(db, staged.id, fx.userId);
      expect(started.status).toBe("in_production");
      expect(started.startedAt).not.toBeNull();

      const submitted = await submitForQc(db, {
        ref: started.id,
        qty: "10",
        actorUserId: fx.userId,
      });
      expect(submitted.status).toBe("awaiting_qc");
      expect(submitted.qtyActual).toBe("10.000");

      const completed = await completeBatch(db, {
        ref: submitted.id,
        qty: "10",
        verdict: "pass",
        actorUserId: fx.userId,
      });
      expect(completed.status).toBe("completed");
      expect(completed.qcVerdict).toBe("pass");
      expect(completed.completedAt).not.toBeNull();
      expect(completed.shopifyPushedAt).toBeNull();

      const result = await pushPendingOnce(db, { testMode: true });
      expect(result.scanned).toBe(1);
      expect(result.pushed).toBe(1);
      expect(result.failed).toBe(0);

      const afterPush = await loadBatch(db, completed.id);
      expect(afterPush.shopifyPushedAt).not.toBeNull();
    });
  });

  it("records every state transition as a production_event for forensic replay", async () => {
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

      const detail = await getBatch(db, batch.id);
      const transitions = detail.events
        .filter((e) => e.eventType === "state_transition" || e.eventType === "qc_decision")
        .map((e) => `${e.fromStatus ?? "null"}->${e.toStatus ?? "null"}`);
      expect(transitions).toEqual([
        "null->received_from_cutter",
        "received_from_cutter->staged_pre_prod",
        "staged_pre_prod->in_production",
        "in_production->awaiting_qc",
        "awaiting_qc->completed",
      ]);
    });
  });
});

describe("production batch — forensic lookup", () => {
  it("loadBatch resolves both numeric id and PB-YYYY-#### identifier", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "5",
        cutterUserId: fx.userId,
      });
      const byId = await loadBatch(db, batch.id);
      const byBatchNo = await loadBatch(db, batch.batchNo);
      expect(byId.id).toBe(batch.id);
      expect(byBatchNo.id).toBe(batch.id);
      expect(byBatchNo.batchNo).toBe(batch.batchNo);
    });
  });

  it("loadBatch raises NotFoundError for an unknown identifier", async () => {
    await withTestDb(async (db) => {
      await expect(loadBatch(db, "PB-2199-9999")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it("markShopifyPushed sets timestamp and appends a shopify_push_succeeded event", async () => {
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

      const ts = new Date();
      await markShopifyPushed(db, batch.id, ts, { sku: fx.variantSku, delta: 5 });
      const detail = await getBatch(db, batch.id);
      expect(detail.shopifyPushedAt?.getTime()).toBe(ts.getTime());
      expect(detail.events.some((e) => e.eventType === "shopify_push_succeeded")).toBe(true);
    });
  });
});
