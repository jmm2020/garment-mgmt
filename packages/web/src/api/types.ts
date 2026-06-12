export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Thrown on any non-ok response; carries the server `code` for branching. */
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

export type BatchStatus =
  | "received_from_cutter"
  | "staged_pre_prod"
  | "in_production"
  | "awaiting_qc"
  | "completed"
  | "cancelled";

export type PvtStatus =
  | "cutting"
  | "shipped"
  | "inspecting"
  | "validated"
  | "rejected"
  | "cancelled";

export interface BatchSummary {
  id: number;
  batchNo: string;
  status: BatchStatus;
  qtyPlanned: string; // numeric string — use parseFloat() for display math
  qtyActual: string | null;
  productVariantId: number;
  cutterUserId: number;
  receivedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface BatchListPage {
  items: BatchSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProductionEvent {
  id: number;
  batchId: number;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorUserId: number | null;
  payload: unknown;
  createdAt: string;
}

export interface BatchDetail extends BatchSummary {
  notes: string | null;
  stagedAt: string | null;
  startedAt: string | null;
  submittedQcAt: string | null;
  qcVerdict: "pass" | "fail" | "pass_with_notes" | null;
  cancelReason: string | null;
  events: ProductionEvent[];
}

export interface PvtSummary {
  id: number;
  runNo: string;
  status: PvtStatus;
  productVariantId: number;
  markerId: number;
  expiresAt: string | null;
  validatedAt: string | null;
  rejectedAt: string | null;
}

export interface PvtEvent {
  id: number;
  runId: number;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorUserId: number | null;
  payload: unknown;
  createdAt: string;
}

export interface PvtDetail extends PvtSummary {
  notes: string | null;
  shippedAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  events: PvtEvent[];
}
