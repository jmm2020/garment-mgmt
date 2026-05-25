import { describe, expect, it } from "vitest";
import {
  AuthError,
  BusinessRuleError,
  DomainError,
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
});
