import { describe, expect, it } from "vitest";
import {
  pickFifo,
  pickSingleDyeLot,
  type Candidate,
} from "../src/services/cut-ticket-service.js";
import { BusinessRuleError } from "../src/errors.js";

function candidate(over: Partial<Candidate> & Pick<Candidate, "id" | "remaining">): Candidate {
  return {
    id: over.id,
    dyeLot: over.dyeLot ?? null,
    remaining: over.remaining,
    receivedAt: over.receivedAt ?? new Date(2026, 0, 1),
  };
}

describe("pickFifo", () => {
  it("picks lots in receivedAt order, taking only what is needed", () => {
    const candidates = [
      candidate({ id: 1, remaining: 50, receivedAt: new Date(2026, 0, 1) }),
      candidate({ id: 2, remaining: 50, receivedAt: new Date(2026, 0, 2) }),
    ];
    const picks = pickFifo(candidates, 60, 99);
    expect(picks).toEqual([
      { lotId: 1, quantity: 50 },
      { lotId: 2, quantity: 10 },
    ]);
  });

  it("stops as soon as need is satisfied (does not visit later lots)", () => {
    const candidates = [
      candidate({ id: 1, remaining: 100 }),
      candidate({ id: 2, remaining: 100 }),
    ];
    const picks = pickFifo(candidates, 30, 99);
    expect(picks).toEqual([{ lotId: 1, quantity: 30 }]);
  });

  it("throws BusinessRuleError(insufficient_stock) when total is short", () => {
    const candidates = [candidate({ id: 1, remaining: 10 })];
    expect(() => pickFifo(candidates, 25, 99)).toThrowError(BusinessRuleError);
    try {
      pickFifo(candidates, 25, 99);
    } catch (err) {
      expect((err as BusinessRuleError).code).toBe("rule.insufficient_stock");
    }
  });

  it("does not error on tiny float remainder under epsilon", () => {
    const candidates = [candidate({ id: 1, remaining: 10.0000001 })];
    // need is just under remaining; remainder should be inside 1e-6 tolerance
    expect(() => pickFifo(candidates, 10, 99)).not.toThrow();
  });
});

describe("pickSingleDyeLot", () => {
  it("picks smallest sufficient dye-lot group (best fit)", () => {
    const candidates = [
      candidate({ id: 1, remaining: 200, dyeLot: "A", receivedAt: new Date(2026, 0, 1) }),
      candidate({ id: 2, remaining: 50, dyeLot: "B", receivedAt: new Date(2026, 0, 2) }),
      candidate({ id: 3, remaining: 50, dyeLot: "B", receivedAt: new Date(2026, 0, 3) }),
    ];
    const picks = pickSingleDyeLot(candidates, 80, 99);
    expect(picks.map((p) => p.lotId).sort()).toEqual([2, 3]);
    expect(picks.reduce((s, p) => s + p.quantity, 0)).toBe(80);
  });

  it("falls back to larger group when smaller cannot cover need", () => {
    const candidates = [
      candidate({ id: 1, remaining: 200, dyeLot: "A" }),
      candidate({ id: 2, remaining: 50, dyeLot: "B" }),
    ];
    const picks = pickSingleDyeLot(candidates, 100, 99);
    expect(picks).toEqual([{ lotId: 1, quantity: 100 }]);
  });

  it("throws dye_lot_integrity_violation when no single group covers need", () => {
    const candidates = [
      candidate({ id: 1, remaining: 30, dyeLot: "A" }),
      candidate({ id: 2, remaining: 30, dyeLot: "B" }),
    ];
    expect(() => pickSingleDyeLot(candidates, 50, 99)).toThrowError(BusinessRuleError);
    try {
      pickSingleDyeLot(candidates, 50, 99);
    } catch (err) {
      expect((err as BusinessRuleError).code).toBe("rule.dye_lot_integrity_violation");
    }
  });

  it("skips candidates with null dye_lot", () => {
    const candidates = [
      candidate({ id: 1, remaining: 100, dyeLot: null }),
      candidate({ id: 2, remaining: 100, dyeLot: "A" }),
    ];
    const picks = pickSingleDyeLot(candidates, 50, 99);
    expect(picks).toEqual([{ lotId: 2, quantity: 50 }]);
  });

  it("throws when all candidates have null dye_lot", () => {
    const candidates = [
      candidate({ id: 1, remaining: 100, dyeLot: null }),
      candidate({ id: 2, remaining: 100, dyeLot: null }),
    ];
    expect(() => pickSingleDyeLot(candidates, 50, 99)).toThrowError(BusinessRuleError);
  });

  it("orders picks within chosen group by receivedAt (FIFO inside the group)", () => {
    const candidates = [
      candidate({ id: 1, remaining: 30, dyeLot: "A", receivedAt: new Date(2026, 0, 5) }),
      candidate({ id: 2, remaining: 30, dyeLot: "A", receivedAt: new Date(2026, 0, 1) }),
      candidate({ id: 3, remaining: 30, dyeLot: "A", receivedAt: new Date(2026, 0, 3) }),
    ];
    const picks = pickSingleDyeLot(candidates, 50, 99);
    expect(picks[0]?.lotId).toBe(2); // oldest first
    expect(picks[1]?.lotId).toBe(3);
  });
});
