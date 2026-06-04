// env() runs inside buildApp before envOverrides is applied, so DATABASE_URL
// and SESSION_SECRET must be set at module level (before imports).
process.env.DATABASE_URL ??=
  process.env.TEST_DATABASE_URL ?? "postgres://dev:dev@localhost:5432/garment_mgmt_test";
process.env.SESSION_SECRET ??= "test-secret-with-enough-length-1234567";
process.env.NODE_ENV ??= "test";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bus, emitTransition, type TransitionEvent } from "../src/events/bus.js";
import { buildApp } from "../src/app.js";

describe("emitTransition", () => {
  beforeEach(() => bus.removeAllListeners());

  it("emits a transition event on the bus with correct shape", () => {
    const received: TransitionEvent[] = [];
    bus.on("transition", (e: TransitionEvent) => received.push(e));

    emitTransition({
      kind: "batch",
      id: 1,
      ref: "PB-2026-0001",
      fromStatus: "received_from_cutter",
      toStatus: "staged_pre_prod",
      at: "2026-01-01T00:00:00.000Z",
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      kind: "batch",
      id: 1,
      ref: "PB-2026-0001",
      fromStatus: "received_from_cutter",
      toStatus: "staged_pre_prod",
    });
  });

  it("does not throw when a listener throws", () => {
    bus.on("transition", () => {
      throw new Error("listener error");
    });

    expect(() =>
      emitTransition({
        kind: "pvt",
        id: 2,
        ref: "PVT-2026-0001",
        fromStatus: "cutting",
        toStatus: "shipped",
        at: "2026-01-01T00:00:00.000Z",
      }),
    ).not.toThrow();
  });
});

describe("GET /api/events/stream — auth guard", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ envOverrides: { NODE_ENV: "test" } });
  });

  afterAll(() => app.close());

  it("returns 401 without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/events/stream" });
    expect(res.statusCode).toBe(401);
  });
});
