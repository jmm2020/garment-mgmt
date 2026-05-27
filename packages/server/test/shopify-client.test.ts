import { describe, expect, it, vi } from "vitest";
import {
  lookupShopifyVariantGid,
  setVariantMetafield,
} from "../src/integrations/shopify-client.js";

const baseCfg = {
  testMode: false as const,
  shopDomain: "test.myshopify.com",
  adminToken: "tok",
  delayMs: async () => {},
};

describe("lookupShopifyVariantGid", () => {
  it("returns gid on success and sends sku: prefix in query", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: { productVariants: { nodes: [{ id: "gid://shopify/ProductVariant/123" }] } },
      }),
    } as unknown as Response);

    const result = await lookupShopifyVariantGid({ ...baseCfg, fetchImpl }, "PERF-HOOD-BLK-M");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("narrowing");
    expect(result.gid).toBe("gid://shopify/ProductVariant/123");
    expect(result.attempts).toBe(1);

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.variables.sku).toBe("sku:PERF-HOOD-BLK-M");
  });

  it("returns ok=false with 'variant not found' when nodes is empty", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { productVariants: { nodes: [] } } }),
    } as unknown as Response);

    const result = await lookupShopifyVariantGid({ ...baseCfg, fetchImpl }, "MISSING-SKU");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it("returns ok=false when top-level errors present", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: "Unauthorized" }] }),
    } as unknown as Response);

    const result = await lookupShopifyVariantGid({ ...baseCfg, fetchImpl }, "ANY-SKU");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Unauthorized");
  });

  it("returns ok=false with non-JSON error message (not 'variant not found') on parse failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Response);

    const result = await lookupShopifyVariantGid({ ...baseCfg, fetchImpl }, "ANY-SKU");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/non-JSON response/);
    expect(result.error).not.toMatch(/not found/);
  });

  it("returns ok=false with attempts=0 when env not configured", async () => {
    const result = await lookupShopifyVariantGid({ testMode: false }, "ANY-SKU");
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(0);
  });
});

describe("setVariantMetafield", () => {
  it("returns ok=true on success and sends correct metafield shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: { metafieldsSet: { metafields: [{ id: "123" }], userErrors: [] } },
      }),
    } as unknown as Response);

    const result = await setVariantMetafield(
      { ...baseCfg, fetchImpl },
      "gid://shopify/ProductVariant/42",
      "PB-2026-0001",
    );
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    const mf = body.variables.metafields[0];
    expect(mf.namespace).toBe("garment_mgmt");
    expect(mf.key).toBe("last_batch_no");
    expect(mf.type).toBe("single_line_text_field");
    expect(mf.ownerId).toBe("gid://shopify/ProductVariant/42");
    expect(mf.value).toBe("PB-2026-0001");
  });

  it("returns ok=false immediately (no retry) when userErrors returned", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          metafieldsSet: {
            metafields: [],
            userErrors: [{ message: "Invalid type: bogus_type", code: "INVALID" }],
          },
        },
      }),
    } as unknown as Response);

    const result = await setVariantMetafield(
      { ...baseCfg, fetchImpl },
      "gid://shopify/ProductVariant/42",
      "PB-2026-0001",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid type/);
    expect(result.attempts).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns ok=false (not ok=true) when response is non-JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Response);

    const result = await setVariantMetafield(
      { ...baseCfg, fetchImpl },
      "gid://shopify/ProductVariant/42",
      "PB-2026-0001",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/non-JSON response/);
  });
});
