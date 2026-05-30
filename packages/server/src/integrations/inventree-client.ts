import { setTimeout as delay } from "node:timers/promises";
import {
  BusinessRuleError,
  InternalError,
  NotFoundError,
  ValidationFailedError,
} from "../errors.js";

const MAX_ATTEMPTS = 5;

export interface StockItem {
  pk: number;
  part: number;
  quantity: number;
  location: number | null;
  batch: string | null;
  serial: string | null;
  status: number;
  allocated: number;
  in_stock: boolean;
  supplier_part: number | null;
  expiry_date: string | null; // ISO date string or null
  updated: string; // ISO datetime string
}

export interface Part {
  pk: number;
  name: string;
  IPN: string | null;
  description: string | null;
  category: number | null;
  active: boolean;
  assembly: boolean;
  component: boolean;
  purchaseable: boolean;
  trackable: boolean;
  default_location: number | null;
  minimum_stock: number;
  in_stock: number;
  units: string | null;
}

export interface InvenTreeClientConfig {
  baseUrl?: string; // maps to INVENTREE_BASE_URL
  apiToken?: string; // maps to INVENTREE_API_TOKEN
  // When true, calls return stub data and never hit the network. Mirrors the
  // shopify-client testMode seam so unit tests can skip the fetch path entirely.
  testMode: boolean;
  // Override the global fetch — used by tests to assert request shape.
  fetchImpl?: typeof fetch;
  // Override the sleep used between retries; tests collapse it to 0.
  delayMs?: (ms: number) => Promise<void>;
}

const STUB_STOCK_ITEM: StockItem = {
  pk: 0,
  part: 0,
  quantity: 0,
  location: null,
  batch: null,
  serial: null,
  status: 10,
  allocated: 0,
  in_stock: true,
  supplier_part: null,
  expiry_date: null,
  updated: new Date(0).toISOString(),
};

const STUB_PART: Part = {
  pk: 0,
  name: "",
  IPN: null,
  description: null,
  category: null,
  active: true,
  assembly: false,
  component: true,
  purchaseable: true,
  trackable: false,
  default_location: null,
  minimum_stock: 0,
  in_stock: 0,
  units: null,
};

/**
 * Pull the most specific human-readable message out of an InvenTree error body.
 * Handles all three documented shapes: `{ detail }` (401/403/500),
 * `{ non_field_errors: [...] }` (400), and falls back to `HTTP <status>`.
 */
function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b["detail"] === "string") return b["detail"];
    const nonField = b["non_field_errors"];
    if (Array.isArray(nonField) && typeof nonField[0] === "string") return nonField[0];
  }
  return `HTTP ${status}`;
}

/**
 * Map a 4xx response to the correct DomainError subclass and throw it. 4xx are
 * client errors and are never retried — the caller's request will not succeed on
 * a repeat. Return type is `never` so TypeScript's control-flow analysis understands
 * that the 4xx branch always terminates, keeping the 5xx retry path correctly typed.
 */
function throwForStatus(status: number, body: unknown, context: string): never {
  const msg = extractErrorMessage(body, status);
  if (status === 400) throw new ValidationFailedError(`inventree ${context}: ${msg}`, body);
  if (status === 404) throw new NotFoundError("inventree_resource", context);
  if (status === 409) {
    throw new BusinessRuleError("inventree_conflict", `inventree ${context}: ${msg}`, body);
  }
  if (status === 401 || status === 403) {
    throw new InternalError(`inventree auth error on ${context}: ${msg}`, { status });
  }
  // any other 4xx
  throw new ValidationFailedError(`inventree ${context}: ${msg}`, { status, body });
}

/**
 * Shared retry skeleton. Network failures and 5xx responses are retried up to
 * MAX_ATTEMPTS with exponential backoff (1s, 2s, 4s, 8s); 4xx responses throw
 * immediately via {@link throwForStatus}. Returns the parsed JSON body on success.
 *
 * The fetch call lives inside the try/catch (so transport errors retry), while
 * status handling lives outside it — that keeps a thrown DomainError (4xx) from
 * being swallowed and treated as a retryable network error.
 */
async function requestWithRetry(
  cfg: InvenTreeClientConfig,
  method: string,
  path: string,
  context: string,
  opts?: { query?: Record<string, string | number>; body?: unknown },
): Promise<unknown> {
  const baseUrl = cfg.baseUrl;
  const apiToken = cfg.apiToken;
  if (!baseUrl || !apiToken) {
    throw new InternalError(
      "inventree env not configured (INVENTREE_BASE_URL, INVENTREE_API_TOKEN)",
    );
  }

  const fetchFn = cfg.fetchImpl ?? fetch;
  const sleep = cfg.delayMs ?? ((ms) => delay(ms));

  // new URL(path, base) handles a base with or without a trailing slash correctly,
  // unlike string concatenation which can produce a double slash.
  const url = new URL(path, baseUrl);
  if (opts?.query) {
    for (const [key, value] of Object.entries(opts.query)) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = { Authorization: `Token ${apiToken}` };
  if (opts?.body !== undefined) headers["content-type"] = "application/json";
  const init: RequestInit = { method, headers };
  if (opts?.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }

  let lastError = "unknown";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetchFn(url.toString(), init);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) await sleep(2 ** (attempt - 1) * 1000);
      continue;
    }

    const body = (await res.json().catch(() => null)) as unknown;
    if (res.ok) return body;

    if (res.status >= 400 && res.status < 500) {
      throwForStatus(res.status, body, context); // never returns
    }

    // 5xx (or any other non-ok status) — retry
    lastError = extractErrorMessage(body, res.status);
    if (attempt < MAX_ATTEMPTS) await sleep(2 ** (attempt - 1) * 1000);
  }

  throw new InternalError(`inventree ${context} failed after ${MAX_ATTEMPTS} attempts`, {
    lastError,
  });
}

/**
 * List stock items, optionally filtered by part and/or location.
 * `GET /api/stock/[?part=&location=]`.
 *
 * Callers should pass `{ baseUrl: env.INVENTREE_BASE_URL, apiToken:
 * env.INVENTREE_API_TOKEN, testMode: env.NODE_ENV === "test" }`. Do not call
 * `env()` inside this module — config is injected.
 */
export async function listStock(
  cfg: InvenTreeClientConfig,
  opts?: { partId?: number; locationId?: number; limit?: number },
): Promise<StockItem[]> {
  if (cfg.testMode) return [STUB_STOCK_ITEM];

  const query: Record<string, number> = {};
  if (opts?.partId !== undefined) query["part"] = opts.partId;
  if (opts?.locationId !== undefined) query["location"] = opts.locationId;
  // InvenTree paginates (default ~100 results). Callers must pass a limit large enough
  // to cover the expected result set; cursor-based pagination is deferred to wiring phase.
  if (opts?.limit !== undefined) query["limit"] = opts.limit;

  const body = await requestWithRetry(cfg, "GET", "/api/stock/", "listStock", { query });
  return (body as { results?: StockItem[] }).results ?? [];
}

/**
 * Create a new stock item (receive stock). `POST /api/stock/` returns 201.
 * `supplierLotId` maps to InvenTree's `supplier_part`; `batch` is optional.
 */
export async function receiveStock(
  cfg: InvenTreeClientConfig,
  input: {
    partId: number;
    quantity: number;
    locationId: number;
    batch?: string;
    supplierLotId?: number;
  },
): Promise<StockItem> {
  if (cfg.testMode) return STUB_STOCK_ITEM;

  const payload: Record<string, unknown> = {
    part: input.partId,
    quantity: input.quantity,
    location: input.locationId,
  };
  if (input.batch !== undefined) payload["batch"] = input.batch;
  if (input.supplierLotId !== undefined) payload["supplier_part"] = input.supplierLotId;

  const body = await requestWithRetry(cfg, "POST", "/api/stock/", "receiveStock", {
    body: payload,
  });
  return body as StockItem;
}

/**
 * Remove (consume) quantity from a stock item via `POST /api/stock/remove/`.
 * That endpoint returns 200 with no meaningful body, so a follow-up
 * `GET /api/stock/{pk}/` retrieves the updated item to fulfil the return
 * contract. The follow-up is a single call (not retried): the stock has already
 * been consumed, so a read failure is reported as an InternalError rather than
 * re-attempting the mutation.
 */
export async function consumeStock(
  cfg: InvenTreeClientConfig,
  input: {
    stockItemId: number;
    quantity: number;
    notes?: string;
  },
): Promise<StockItem> {
  if (cfg.testMode) return STUB_STOCK_ITEM;

  const payload: Record<string, unknown> = {
    items: [{ pk: input.stockItemId, quantity: input.quantity }],
  };
  if (input.notes !== undefined) payload["notes"] = input.notes;

  await requestWithRetry(cfg, "POST", "/api/stock/remove/", "consumeStock", { body: payload });

  // Follow-up read — single call, no retry (see doc comment above).
  // baseUrl/apiToken guaranteed non-null: requestWithRetry above would have thrown if absent.
  const fetchFn = cfg.fetchImpl ?? fetch;
  const followUrl = new URL(`/api/stock/${input.stockItemId}/`, cfg.baseUrl!);
  let res: Response;
  try {
    res = await fetchFn(followUrl.toString(), {
      headers: { Authorization: `Token ${cfg.apiToken!}` },
    });
  } catch (err) {
    throw new InternalError("inventree consumeStock follow-up GET failed", {
      stockItemId: input.stockItemId,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  const item = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    throw new InternalError("inventree consumeStock follow-up GET failed", {
      stockItemId: input.stockItemId,
      status: res.status,
    });
  }
  return item as StockItem;
}

/**
 * Find a Part by its IPN (`GET /api/part/?IPN=<sku>&limit=1`), creating it
 * (`POST /api/part/`) only when the search returns no match. `supplierId` maps
 * to `default_supplier`; `description` is required by InvenTree and defaults to
 * the part name. Search and create each get their own retry budget.
 */
export async function findOrCreatePart(
  cfg: InvenTreeClientConfig,
  input: {
    name: string;
    sku: string;
    supplierId?: number;
  },
): Promise<Part> {
  if (cfg.testMode) return { ...STUB_PART, name: input.name, IPN: input.sku };

  // Search phase.
  const searchBody = await requestWithRetry(cfg, "GET", "/api/part/", "findOrCreatePart search", {
    query: { IPN: input.sku, limit: 1 },
  });
  const found = searchBody as { count?: number; results?: Part[] };
  if ((found.count ?? 0) > 0 && found.results && found.results[0]) {
    return found.results[0];
  }

  // Create phase.
  const createPayload: Record<string, unknown> = {
    name: input.name,
    description: input.name, // description is required by InvenTree
    IPN: input.sku,
    purchaseable: true,
    component: true,
  };
  if (input.supplierId !== undefined) createPayload["default_supplier"] = input.supplierId;

  let created: unknown;
  try {
    created = await requestWithRetry(cfg, "POST", "/api/part/", "findOrCreatePart create", {
      body: createPayload,
    });
  } catch (err) {
    if (err instanceof BusinessRuleError) {
      // Concurrent create — re-search to return the winning record
      const retry = await requestWithRetry(cfg, "GET", "/api/part/", "findOrCreatePart retry", {
        query: { IPN: input.sku, limit: 1 },
      });
      const found2 = retry as { results?: Part[] };
      if (found2.results?.[0]) return found2.results[0];
    }
    throw err;
  }
  return created as Part;
}
