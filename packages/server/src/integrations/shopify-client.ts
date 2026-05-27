import { setTimeout as delay } from "node:timers/promises";

export interface ShopifyClientConfig {
  shopDomain?: string;
  adminToken?: string;
  locationId?: string;
  // When true, calls are logged and not sent. Set by NODE_ENV='test' so CI never
  // hits the network; the inventory push job still marks shopify_pushed_at so the
  // happy-path test can assert end-to-end progression.
  testMode: boolean;
  // Override the global fetch — used by tests to assert request shape.
  fetchImpl?: typeof fetch;
  // Override the sleep used between retries; tests collapse it to 0.
  delayMs?: (ms: number) => Promise<void>;
}

export interface InventoryAdjustResult {
  ok: boolean;
  attempts: number;
  testMode: boolean;
  delta: number;
  sku: string;
  response?: unknown;
  error?: string;
}

const MAX_ATTEMPTS = 5;

/**
 * Adjust Shopify inventory by `delta` for the given SKU at the given location.
 *
 * Uses the Admin GraphQL `inventoryAdjustQuantities` mutation. Retries with exponential
 * backoff (1s, 2s, 4s, 8s, 16s) up to 5 attempts. On final failure, returns ok=false
 * with the last error message — the caller records the failure on the production_event
 * log and the push job retries on the next tick (idempotent: shopify_pushed_at is set
 * only on success).
 */
export async function inventoryAdjustQuantities(
  cfg: ShopifyClientConfig,
  sku: string,
  delta: number,
): Promise<InventoryAdjustResult> {
  if (cfg.testMode) {
    return { ok: true, attempts: 0, testMode: true, delta, sku, response: { mode: "test" } };
  }

  if (!cfg.shopDomain || !cfg.adminToken || !cfg.locationId) {
    return {
      ok: false,
      attempts: 0,
      testMode: false,
      delta,
      sku,
      error:
        "shopify env not configured (SHOPIFY_SHOP_DOMAIN, SHOPIFY_ADMIN_TOKEN, SHOPIFY_LOCATION_ID)",
    };
  }

  const url = `https://${cfg.shopDomain}/admin/api/2024-10/graphql.json`;
  const query = `
    mutation inventoryAdjust($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        inventoryAdjustmentGroup { createdAt reason }
        userErrors { field message }
      }
    }
  `.trim();
  const variables = {
    input: {
      reason: "correction",
      name: "available",
      referenceDocumentUri: `gid://garment-mgmt/production-batch/${sku}`,
      changes: [
        {
          delta,
          inventoryItemId: sku,
          locationId: cfg.locationId,
        },
      ],
    },
  };

  const fetchFn = cfg.fetchImpl ?? fetch;
  const sleep = cfg.delayMs ?? ((ms) => delay(ms));

  let lastError = "unknown";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Shopify-Access-Token": cfg.adminToken,
        },
        body: JSON.stringify({ query, variables }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: unknown;
        errors?: { message: string }[];
      };
      if (res.ok && (!body.errors || body.errors.length === 0)) {
        return { ok: true, attempts: attempt, testMode: false, delta, sku, response: body };
      }
      lastError = body.errors?.[0]?.message ?? `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleep(2 ** (attempt - 1) * 1000);
    }
  }
  return { ok: false, attempts: MAX_ATTEMPTS, testMode: false, delta, sku, error: lastError };
}

export interface LookupVariantGidResult {
  ok: boolean;
  attempts: number;
  testMode: boolean;
  sku: string;
  gid?: string;
  error?: string;
}

/**
 * Look up a Shopify product variant GID by SKU. Uses Admin GraphQL
 * `productVariants(first: 1, query: "sku:<sku>")`. Returns the GID string or
 * ok=false on failure / not-found. Same retry / testMode semantics as
 * inventoryAdjustQuantities. The GID is cached on product_variants by the
 * push job so this call runs at most once per variant lifetime.
 */
export async function lookupShopifyVariantGid(
  cfg: ShopifyClientConfig,
  sku: string,
): Promise<LookupVariantGidResult> {
  if (cfg.testMode) {
    return {
      ok: true,
      attempts: 0,
      testMode: true,
      sku,
      gid: `gid://shopify/ProductVariant/0`,
    };
  }

  if (!cfg.shopDomain || !cfg.adminToken) {
    return {
      ok: false,
      attempts: 0,
      testMode: false,
      sku,
      error: "shopify env not configured (SHOPIFY_SHOP_DOMAIN, SHOPIFY_ADMIN_TOKEN)",
    };
  }

  const url = `https://${cfg.shopDomain}/admin/api/2024-10/graphql.json`;
  const query = `
    query lookupVariantBySku($sku: String!) {
      productVariants(first: 1, query: $sku) {
        nodes { id }
      }
    }
  `.trim();
  const variables = { sku: `sku:${sku}` };

  const fetchFn = cfg.fetchImpl ?? fetch;
  const sleep = cfg.delayMs ?? ((ms) => delay(ms));

  let lastError = "unknown";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Shopify-Access-Token": cfg.adminToken,
        },
        body: JSON.stringify({ query, variables }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { productVariants?: { nodes?: { id?: string }[] } };
        errors?: { message: string }[];
      };
      if (res.ok && (!body.errors || body.errors.length === 0)) {
        const gid = body.data?.productVariants?.nodes?.[0]?.id;
        if (!gid) {
          return {
            ok: false,
            attempts: attempt,
            testMode: false,
            sku,
            error: "variant not found in Shopify",
          };
        }
        return { ok: true, attempts: attempt, testMode: false, sku, gid };
      }
      lastError = body.errors?.[0]?.message ?? `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleep(2 ** (attempt - 1) * 1000);
    }
  }
  return { ok: false, attempts: MAX_ATTEMPTS, testMode: false, sku, error: lastError };
}

export interface SetVariantMetafieldResult {
  ok: boolean;
  attempts: number;
  testMode: boolean;
  variantGid: string;
  batchNo: string;
  error?: string;
}

/**
 * Write garment_mgmt/last_batch_no metafield on a Shopify product variant.
 * Uses Admin GraphQL `metafieldsSet` mutation. Required Shopify scope:
 * `write_metafields`. Both top-level GraphQL `errors` and the mutation's
 * `userErrors` are treated as failures (the GraphQL endpoint returns HTTP 200
 * for logical-validation failures).
 */
export async function setVariantMetafield(
  cfg: ShopifyClientConfig,
  variantGid: string,
  batchNo: string,
): Promise<SetVariantMetafieldResult> {
  if (cfg.testMode) {
    return { ok: true, attempts: 0, testMode: true, variantGid, batchNo };
  }

  if (!cfg.shopDomain || !cfg.adminToken) {
    return {
      ok: false,
      attempts: 0,
      testMode: false,
      variantGid,
      batchNo,
      error: "shopify env not configured (SHOPIFY_SHOP_DOMAIN, SHOPIFY_ADMIN_TOKEN)",
    };
  }

  const url = `https://${cfg.shopDomain}/admin/api/2024-10/graphql.json`;
  const query = `
    mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message code }
      }
    }
  `.trim();
  const variables = {
    metafields: [
      {
        namespace: "garment_mgmt",
        key: "last_batch_no",
        value: batchNo,
        type: "single_line_text_field",
        ownerId: variantGid,
      },
    ],
  };

  const fetchFn = cfg.fetchImpl ?? fetch;
  const sleep = cfg.delayMs ?? ((ms) => delay(ms));

  let lastError = "unknown";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Shopify-Access-Token": cfg.adminToken,
        },
        body: JSON.stringify({ query, variables }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: {
          metafieldsSet?: {
            metafields?: { id?: string }[];
            userErrors?: { field?: string[]; message?: string; code?: string }[];
          };
        };
        errors?: { message: string }[];
      };
      if (res.ok && (!body.errors || body.errors.length === 0)) {
        const userErrors = body.data?.metafieldsSet?.userErrors ?? [];
        if (userErrors.length === 0) {
          return { ok: true, attempts: attempt, testMode: false, variantGid, batchNo };
        }
        lastError = userErrors[0]?.message ?? "metafieldsSet userError";
      } else {
        lastError = body.errors?.[0]?.message ?? `HTTP ${res.status}`;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleep(2 ** (attempt - 1) * 1000);
    }
  }
  return {
    ok: false,
    attempts: MAX_ATTEMPTS,
    testMode: false,
    variantGid,
    batchNo,
    error: lastError,
  };
}
