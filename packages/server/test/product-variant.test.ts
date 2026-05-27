import { afterAll, describe, expect, it } from "vitest";
import { BusinessRuleError, NotFoundError } from "../src/errors.js";
import { addProductVariant, updateProductVariant } from "../src/services/product-service.js";
import { seedProductionFixture } from "./helpers/seed-production.js";
import { closeTestDb, withTestDb } from "./helpers/test-db.js";

afterAll(async () => {
  await closeTestDb();
});

describe("addProductVariant — dimension validation", () => {
  it("inserts variant and computes canonical sku from dimensions", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      const variant = await addProductVariant(db, {
        productId: fx.productId,
        line: "PERF",
        model: "TEE",
        color: "WHT",
        sizeDim: "S",
        gender: "WOMENS",
        seasonDim: "SS26",
        fabricType: "14OZ-COTTON",
        size: "S",
        colorway: "White",
        fgSku: `FG-WHT-${Date.now().toString(36)}`,
      });
      expect(variant.sku).toBe("PERF-TEE-WHT-S-WOMENS-SS26-14OZ-COTTON");
      expect(variant.line).toBe("PERF");
      expect(variant.color).toBe("WHT");
    });
  });

  it("throws BusinessRuleError 409 on duplicate canonical sku", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      const tag = Date.now().toString(36);
      const dims = {
        productId: fx.productId,
        line: "BASIC" as const,
        model: "PANT" as const,
        color: "NAVY" as const,
        sizeDim: "L" as const,
        gender: "UNISEX" as const,
        seasonDim: "EVRG",
        fabricType: "RIPSTOP" as const,
        size: "L",
        colorway: "Navy",
        fgSku: `FG-NAVY-${tag}-1`,
      };
      await addProductVariant(db, dims);
      // Different size/colorway ensures only product_variants_sku_idx can fire
      // (the composite productId+size+colorway index won't conflict)
      await expect(
        addProductVariant(db, {
          ...dims,
          size: "Large",
          colorway: "Navy Blue",
          fgSku: `FG-NAVY-${tag}-2`,
        }),
      ).rejects.toThrow(BusinessRuleError);
    });
  });
});

describe("updateProductVariant", () => {
  it("updates dimensions and recomputes canonical sku", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      const tag = Date.now().toString(36);
      const created = await addProductVariant(db, {
        productId: fx.productId,
        line: "BASIC",
        model: "TEE",
        color: "BLK",
        sizeDim: "S",
        gender: "WOMENS",
        seasonDim: "FW26",
        fabricType: "12OZ-COTTON",
        size: "S",
        colorway: `Navy-${tag}`,
        fgSku: `FG-BLK-${tag}`,
      });
      const updated = await updateProductVariant(db, {
        productId: fx.productId,
        variantId: created.id,
        line: "PERF",
        model: "TEE",
        color: "BLK",
        sizeDim: "S",
        gender: "WOMENS",
        seasonDim: "FW26",
        fabricType: "12OZ-COTTON",
        size: "S",
        colorway: `Navy-${tag}`,
        fgSku: created.fgSku,
      });
      expect(updated.sku).toBe("PERF-TEE-BLK-S-WOMENS-FW26-12OZ-COTTON");
      expect(updated.line).toBe("PERF");
    });
  });

  it("throws NotFoundError for unknown variantId", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await expect(
        updateProductVariant(db, {
          productId: fx.productId,
          variantId: 999999,
          line: "BASIC",
          model: "TEE",
          color: "BLK",
          sizeDim: "M",
          gender: "MENS",
          seasonDim: "FW26",
          fabricType: "12OZ-COTTON",
          size: "M",
          colorway: "Black",
          fgSku: "FG-GHOST",
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
