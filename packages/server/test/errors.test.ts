import { describe, expect, it } from "vitest";
import {
  AuthError,
  BusinessRuleError,
  DomainError,
  InternalError,
  NotFoundError,
  ValidationFailedError,
  isDomainError,
} from "../src/errors.js";

describe("DomainError hierarchy", () => {
  it("NotFoundError carries 404 + code", () => {
    const err = new NotFoundError("vendor", 42);
    expect(err.status).toBe(404);
    expect(err.code).toBe("not_found");
    expect(err.message).toContain("vendor");
    expect(err.message).toContain("42");
    expect(isDomainError(err)).toBe(true);
  });

  it("BusinessRuleError tags rule namespace", () => {
    const err = new BusinessRuleError("dye_lot_integrity_violation", "no single dye lot");
    expect(err.code).toBe("rule.dye_lot_integrity_violation");
    expect(err.status).toBe(409);
  });

  it("ValidationFailedError is 400", () => {
    const err = new ValidationFailedError("bad");
    expect(err.status).toBe(400);
    expect(err.code).toBe("validation_failed");
  });

  it("AuthError chooses status from reason", () => {
    expect(new AuthError("unauthorized", "x").status).toBe(401);
    expect(new AuthError("invalid_credentials", "x").status).toBe(401);
    expect(new AuthError("forbidden", "x").status).toBe(403);
  });

  it("isDomainError rejects plain Error", () => {
    expect(isDomainError(new Error("plain"))).toBe(false);
    expect(isDomainError(new DomainError("x", "y"))).toBe(true);
  });

  it("InternalError is 500 with internal_error code", () => {
    const err = new InternalError("vendor insert returned no row");
    expect(err.status).toBe(500);
    expect(err.code).toBe("internal_error");
    expect(isDomainError(err)).toBe(true);
  });

  it("BusinessRuleError insert_returned_no_row slug has correct code", () => {
    const err = new BusinessRuleError("insert_returned_no_row", "foo insert returned no row");
    expect(err.code).toBe("rule.insert_returned_no_row");
    expect(err.status).toBe(409);
  });

  it("BusinessRuleError update_returned_no_row slug has correct code", () => {
    const err = new BusinessRuleError("update_returned_no_row", "foo update returned no row");
    expect(err.code).toBe("rule.update_returned_no_row");
    expect(err.status).toBe(409);
  });
});
