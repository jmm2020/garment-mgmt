// Regression tests for the central setErrorHandler in app.ts.
//
// Issue #21: an empty-body POST that carried `content-type: application/json`
// made Fastify's body parser raise FST_ERR_CTP_EMPTY_JSON_BODY (statusCode 400),
// but the old error handler had no branch for framework errors and leaked it as a
// generic 500. The CLI side was fixed in PR #23 (request.ts no longer sets the
// content-type header for body-less requests) and the server side in PR #33
// (app.ts preserves Fastify 4xx statusCode). Neither fix had test coverage — this
// is the first test in the repo to exercise the HTTP layer end-to-end via
// buildApp + app.inject().
//
// env() runs inside buildApp before envOverrides is applied and requires
// DATABASE_URL + SESSION_SECRET, so we set hermetic fallbacks here (CI already
// provides real values; ??= leaves those untouched).
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
