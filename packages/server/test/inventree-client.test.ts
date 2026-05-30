import { describe, expect, it, vi } from "vitest";
import {
  consumeStock,
  findOrCreatePart,
  listStock,
  receiveStock,
  type Part,
  type StockItem,
} from "../src/integrations/inventree-client.js";
import { InternalError, NotFoundError, ValidationFailedError } from "../src/errors.js";

const baseCfg = {
  testMode: false as const,
  baseUrl: "http://inventree.test",
  apiToken: "test-token",
  delayMs: async () => {}, // collapse retry delays to zero
};

const STOCK_ITEM: StockItem = {
  pk: 5,
  part: 1,
  quantity: 50,
  location: 2,
  batch: "LOT-001",
  serial: null,
  status: 10,
  allocated: 0,
  in_stock: true,
  supplier_part: null,
  expiry_date: null,
  updated: "2024-01-15T10:00:00Z",
};

const PART: Part = {
  pk: 99,
  name: "Cotton Twill 100g/m2",
  IPN: "MAT-CTN-001",
  description: "Cotton Twill 100g/m2",
  category: null,
  active: true,
  assembly: false,
  component: true,
  purchaseable: true,
  trackable: false,
  default_location: null,
  minimum_stock: 0,
  in_stock: 0,
  units: "",
};

function okJson(status: number, payload: unknown) {
  return { ok: true, status, json: async () => payload } as unknown as Response;
}

function errJson(status: number, payload: unknown) {
  return { ok: false, status, json: async () => payload } as unknown as Response;
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as RequestInit).body as string);
}

function headersOf(call: unknown[]): Record<string, string> {
  return (call[1] as RequestInit).headers as Record<string, string>;
}

describe("listStock", () => {
  it("returns results array on 200 with correct URL and auth header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson(200, { count: 1, results: [STOCK_ITEM] }));

    const result = await listStock({ ...baseCfg, fetchImpl });

    expect(result).toHaveLength(1);
    expect(result[0]!.pk).toBe(5);
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain("/api/stock/");
    expect(headersOf(fetchImpl.mock.calls[0]!)["Authorization"]).toBe("Token test-token");
  });

  it("appends part query param when partId provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson(200, { count: 0, results: [] }));

    await listStock({ ...baseCfg, fetchImpl }, { partId: 42 });

    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain("part=42");
  });

  it("throws InternalError after 5 failed 500 responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(errJson(500, { error: "srv" }));

    await expect(listStock({ ...baseCfg, fetchImpl })).rejects.toBeInstanceOf(InternalError);
    expect(fetchImpl.mock.calls.length).toBe(5);
  });

  it("throws ValidationFailedError immediately on 400 (no retry)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(errJson(400, { non_field_errors: ["bad"] }));

    await expect(listStock({ ...baseCfg, fetchImpl })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    expect(fetchImpl.mock.calls.length).toBe(1);
  });

  it("throws NotFoundError immediately on 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(errJson(404, { detail: "Not found." }));

    await expect(listStock({ ...baseCfg, fetchImpl })).rejects.toBeInstanceOf(NotFoundError);
    expect(fetchImpl.mock.calls.length).toBe(1);
  });

  it("returns stub array in testMode without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await listStock({ ...baseCfg, testMode: true, fetchImpl });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws InternalError when baseUrl not set", async () => {
    const fetchImpl = vi.fn();

    await expect(listStock({ ...baseCfg, baseUrl: undefined, fetchImpl })).rejects.toBeInstanceOf(
      InternalError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("receiveStock", () => {
  const input = { partId: 1, quantity: 100, locationId: 2 };

  it("POSTs to /api/stock/ and returns StockItem on 201", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson(201, STOCK_ITEM));

    const result = await receiveStock({ ...baseCfg, fetchImpl }, input);

    expect(typeof result.pk).toBe("number");
    const call = fetchImpl.mock.calls[0]!;
    expect(call[0] as string).toContain("/api/stock/");
    expect((call[1] as RequestInit).method).toBe("POST");
    const body = bodyOf(call);
    expect(body["part"]).toBe(1);
    expect(body["quantity"]).toBe(100);
    expect(body["location"]).toBe(2);
  });

  it("includes batch and supplier_part in body when provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson(201, STOCK_ITEM));

    await receiveStock(
      { ...baseCfg, fetchImpl },
      { partId: 1, quantity: 10, locationId: 2, batch: "B1", supplierLotId: 7 },
    );

    const body = bodyOf(fetchImpl.mock.calls[0]!);
    expect(body["batch"]).toBe("B1");
    expect(body["supplier_part"]).toBe(7);
  });

  it("omits batch from body when not provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson(201, STOCK_ITEM));

    await receiveStock({ ...baseCfg, fetchImpl }, input);

    const body = bodyOf(fetchImpl.mock.calls[0]!);
    expect(Object.prototype.hasOwnProperty.call(body, "batch")).toBe(false);
  });

  it("throws ValidationFailedError on 400 without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(errJson(400, { non_field_errors: ["bad"] }));

    await expect(receiveStock({ ...baseCfg, fetchImpl }, input)).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    expect(fetchImpl.mock.calls.length).toBe(1);
  });
});

describe("consumeStock", () => {
  const input = { stockItemId: 5, quantity: 20 };

  it("POSTs to /api/stock/remove/ then GETs /api/stock/{pk}/ and returns item", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okJson(200, {}))
      .mockResolvedValueOnce(okJson(200, STOCK_ITEM));

    const result = await consumeStock({ ...baseCfg, fetchImpl }, input);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]![0] as string).toMatch(/\/api\/stock\/remove\/$/);
    expect(fetchImpl.mock.calls[1]![0] as string).toMatch(/\/api\/stock\/5\/$/);
    expect(result.pk).toBe(5);
  });

  it("sends items array with pk and quantity", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okJson(200, {}))
      .mockResolvedValueOnce(okJson(200, STOCK_ITEM));

    await consumeStock({ ...baseCfg, fetchImpl }, input);

    const body = bodyOf(fetchImpl.mock.calls[0]!);
    const items = body["items"] as { pk: number; quantity: number }[];
    expect(items[0]!.pk).toBe(5);
    expect(items[0]!.quantity).toBe(20);
  });

  it("includes notes in body when provided", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okJson(200, {}))
      .mockResolvedValueOnce(okJson(200, STOCK_ITEM));

    await consumeStock({ ...baseCfg, fetchImpl }, { ...input, notes: "test note" });

    const body = bodyOf(fetchImpl.mock.calls[0]!);
    expect(body["notes"]).toBe("test note");
  });

  it("throws InternalError if follow-up GET fails after successful remove", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okJson(200, {}))
      .mockResolvedValueOnce(errJson(500, { error: "srv" }));

    await expect(consumeStock({ ...baseCfg, fetchImpl }, input)).rejects.toBeInstanceOf(
      InternalError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws InternalError after 5 failed remove attempts (no follow-up GET)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(errJson(500, { error: "srv" }));

    await expect(consumeStock({ ...baseCfg, fetchImpl }, input)).rejects.toBeInstanceOf(
      InternalError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});

describe("findOrCreatePart", () => {
  const input = { name: "Cotton Twill 100g/m2", sku: "MAT-CTN-001" };

  it("returns existing part when IPN search finds a match", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson(200, { count: 1, results: [PART] }));

    const result = await findOrCreatePart({ ...baseCfg, fetchImpl }, input);

    expect(result.pk).toBe(99);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("creates part when IPN search returns count 0", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okJson(200, { count: 0, results: [] }))
      .mockResolvedValueOnce(okJson(201, PART));

    const result = await findOrCreatePart({ ...baseCfg, fetchImpl }, input);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[1]![1] as RequestInit).method).toBe("POST");
    const body = bodyOf(fetchImpl.mock.calls[1]!);
    expect(body["name"]).toBe(input.name);
    expect(body["IPN"]).toBe(input.sku);
    expect(body["description"]).toBe(input.name);
    expect(body["purchaseable"]).toBe(true);
    expect(body["component"]).toBe(true);
    expect(result.pk).toBe(99);
  });

  it("includes default_supplier in POST body when supplierId provided", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okJson(200, { count: 0, results: [] }))
      .mockResolvedValueOnce(okJson(201, PART));

    await findOrCreatePart({ ...baseCfg, fetchImpl }, { ...input, supplierId: 7 });

    const body = bodyOf(fetchImpl.mock.calls[1]!);
    expect(body["default_supplier"]).toBe(7);
  });

  it("does NOT include default_supplier when supplierId not provided", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okJson(200, { count: 0, results: [] }))
      .mockResolvedValueOnce(okJson(201, PART));

    await findOrCreatePart({ ...baseCfg, fetchImpl }, input);

    const body = bodyOf(fetchImpl.mock.calls[1]!);
    expect(Object.prototype.hasOwnProperty.call(body, "default_supplier")).toBe(false);
  });

  it("uses name as description in POST body", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okJson(200, { count: 0, results: [] }))
      .mockResolvedValueOnce(okJson(201, PART));

    await findOrCreatePart({ ...baseCfg, fetchImpl }, input);

    const body = bodyOf(fetchImpl.mock.calls[1]!);
    expect(body["description"]).toBe(input.name);
  });

  it("returns testMode stub with correct name and IPN", async () => {
    const fetchImpl = vi.fn();

    const result = await findOrCreatePart(
      { ...baseCfg, testMode: true, fetchImpl },
      { name: "Foo", sku: "SKU-1" },
    );

    expect(result.name).toBe("Foo");
    expect(result.IPN).toBe("SKU-1");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
