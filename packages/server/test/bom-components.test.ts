import { schema } from "@garment-mgmt/db";
import { describe, expect, it } from "vitest";
import { computeRequirementsFromComponents } from "../src/services/bom-service.js";

function component(over: Partial<schema.BomComponent>): schema.BomComponent {
  return {
    id: 1,
    bomId: 1,
    materialVariantId: 10,
    quantityPerUnit: "2.0000",
    unitOfMeasure: "yard",
    position: null,
    isVisiblePanel: false,
    sizeCurve: null,
    wasteFactorPct: "8.00",
    isOptional: false,
    notes: null,
    ...over,
  };
}

describe("computeRequirementsFromComponents", () => {
  it("applies default 8% waste factor and unit multipliers", () => {
    const components = [component({ id: 1, quantityPerUnit: "2.000", wasteFactorPct: "8.00" })];
    const result = computeRequirementsFromComponents(components, { M: 10, L: 5 });
    // base 2 yd/unit * 15 units * 1.08 waste = 32.4
    expect(result[0]?.totalQuantity).toBeCloseTo(32.4, 6);
  });

  it("respects zero waste factor", () => {
    const components = [component({ quantityPerUnit: "1.5000", wasteFactorPct: "0.00" })];
    const result = computeRequirementsFromComponents(components, { M: 4 });
    expect(result[0]?.totalQuantity).toBeCloseTo(6, 6);
  });

  it("scales by sizeCurve multiplier when key present", () => {
    const components = [
      component({
        quantityPerUnit: "1.0000",
        wasteFactorPct: "0.00",
        sizeCurve: { S: 0.8, M: 1.0, L: 1.2 },
      }),
    ];
    const result = computeRequirementsFromComponents(components, { S: 10, M: 10, L: 10 });
    // total units = 10*0.8 + 10*1.0 + 10*1.2 = 30
    expect(result[0]?.totalQuantity).toBeCloseTo(30, 6);
  });

  it("defaults missing size in curve to multiplier 1", () => {
    const components = [
      component({
        quantityPerUnit: "1.0000",
        wasteFactorPct: "0.00",
        sizeCurve: { M: 1.0 }, // L missing
      }),
    ];
    const result = computeRequirementsFromComponents(components, { M: 5, L: 5 });
    // L falls back to 1.0
    expect(result[0]?.totalQuantity).toBeCloseTo(10, 6);
  });

  it("returns 0 for empty sizeBreakdown", () => {
    const components = [component({ quantityPerUnit: "5.0000", wasteFactorPct: "10.00" })];
    const result = computeRequirementsFromComponents(components, {});
    expect(result[0]?.totalQuantity).toBe(0);
  });

  it("returns empty array when components is empty", () => {
    const result = computeRequirementsFromComponents([], { M: 5 });
    expect(result).toEqual([]);
  });

  it("computes each component independently", () => {
    const components = [
      component({
        id: 1,
        materialVariantId: 10,
        quantityPerUnit: "1.0000",
        wasteFactorPct: "0.00",
      }),
      component({
        id: 2,
        materialVariantId: 11,
        quantityPerUnit: "2.0000",
        wasteFactorPct: "0.00",
      }),
    ];
    const result = computeRequirementsFromComponents(components, { M: 3 });
    expect(result[0]?.totalQuantity).toBeCloseTo(3, 6);
    expect(result[1]?.totalQuantity).toBeCloseTo(6, 6);
    expect(result[0]?.materialVariantId).toBe(10);
    expect(result[1]?.materialVariantId).toBe(11);
  });

  it("preserves isVisiblePanel and bomComponentId for downstream allocator", () => {
    const components = [
      component({
        id: 42,
        isVisiblePanel: true,
        quantityPerUnit: "1.0000",
        wasteFactorPct: "0.00",
      }),
    ];
    const result = computeRequirementsFromComponents(components, { M: 1 });
    expect(result[0]?.bomComponentId).toBe(42);
    expect(result[0]?.isVisiblePanel).toBe(true);
  });

  it("treats sizeCurve as JSON-shaped (not array) — multiplier from JS Record lookup", () => {
    // Demonstrates the contract: sizeCurve is Record<string, number>
    const components = [
      component({
        quantityPerUnit: "2.0000",
        wasteFactorPct: "5.00",
        sizeCurve: { XS: 0.5 },
      }),
    ];
    const result = computeRequirementsFromComponents(components, { XS: 4 });
    // 2 * (4 * 0.5) * 1.05 = 4.2
    expect(result[0]?.totalQuantity).toBeCloseTo(4.2, 6);
  });
});
