// Regression for #21: empty-body POST with content-type application/json
// raised FST_ERR_CTP_EMPTY_JSON_BODY but the error handler leaked it as 500.
//
// env() runs inside buildApp before envOverrides is applied, so DATABASE_URL
// and SESSION_SECRET must be set at module level (before imports).
process.env.DATABASE_URL ??=
  process.env.TEST_DATABASE_URL ?? "postgres://dev:dev@localhost:5432/garment_mgmt_test";
process.env.SESSION_SECRET ??= "test-secret-with-enough-length-1234567";
process.env.NODE_ENV ??= "test";

import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { closeTestDb, withTestDb } from "./helpers/test-db.js";

afterAll(() => closeTestDb());

describe("setErrorHandler — Fastify framework errors", () => {
  it("returns 400 (not 500) when content-type is application/json with empty body", async () => {
    await withTestDb(async (db) => {
      const app = await buildApp({ db });
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: { "content-type": "application/json" },
        payload: "",
      });
      await app.close();
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: { code: string; message: string } }>();
      expect(body.error.code).toBe("FST_ERR_CTP_EMPTY_JSON_BODY");
      expect(body.error.message).toMatch(/empty/i);
    });
  });

  it("returns a structured error envelope for FST_ERR_CTP_EMPTY_JSON_BODY", async () => {
    await withTestDb(async (db) => {
      const app = await buildApp({ db });
      const res = await app.inject({
        method: "POST",
        url: "/api/vendors",
        headers: { "content-type": "application/json" },
        payload: "",
      });
      await app.close();
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: { code: string } }>();
      expect(body).toHaveProperty("error.code");
    });
  });
});
