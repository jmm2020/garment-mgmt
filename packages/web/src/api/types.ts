/**
 * Shared API types for the web client.
 *
 * Mirrors the server error envelope emitted by setErrorHandler in
 * packages/server/src/app.ts: { error: { code, message, details } }.
 */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Thrown by the API client on any non-ok response. Extends Error so consumers
 * can branch with `if (err instanceof ApiError)` and read the server `code`.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thin response shapes — screens are added in later iterations. */
export interface BatchSummary {
  id: number;
  batchNo: string;
  status: string;
  /** Postgres numeric columns — parse with parseFloat() before display math. */
  qtyPlanned: string;
  qtyActual: string | null;
  /** FK to product_variants; the SKU string requires a JOIN not returned by listBatches. */
  productVariantId: number;
}

export interface PvtSummary {
  id: number;
  runNo: string;
  status: string;
  productVariantId: number;
}
