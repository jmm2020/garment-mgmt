import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { BatchesPage } from "../src/pages/BatchesPage.js";
import { BatchDetailPage } from "../src/pages/BatchDetailPage.js";
import * as client from "../src/api/client.js";
import type { BatchSummary, BatchDetail } from "../src/api/types.js";

function renderBatches() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BatchesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const mockBatches: BatchSummary[] = [
  { id: 1, batchNo: "PB-2026-0001", status: "in_production", qtyPlanned: "100.000", qtyActual: null, productVariantId: 1, cutterUserId: 1, receivedAt: "2026-06-01T00:00:00Z", completedAt: null, cancelledAt: null },
  { id: 2, batchNo: "PB-2026-0002", status: "awaiting_qc", qtyPlanned: "50.000", qtyActual: "49.000", productVariantId: 2, cutterUserId: 1, receivedAt: "2026-06-02T00:00:00Z", completedAt: null, cancelledAt: null },
];

describe("BatchesPage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders batch list with batchNo and status", async () => {
    vi.spyOn(client, "get").mockResolvedValue(mockBatches);
    renderBatches();

    await screen.findByText("PB-2026-0001");
    expect(screen.getByText("PB-2026-0002")).toBeTruthy();
    expect(screen.getByText("in_production")).toBeTruthy();
    expect(screen.getByText("awaiting_qc")).toBeTruthy();
  });

  it("each row links to batch detail", async () => {
    vi.spyOn(client, "get").mockResolvedValue(mockBatches);
    renderBatches();

    const link = await screen.findByRole("link", { name: /PB-2026-0001/i });
    expect(link.getAttribute("href")).toBe("/batches/PB-2026-0001");
  });
});

function renderDetail(batch: BatchDetail) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/batches/${batch.batchNo}`]}>
        <Routes>
          <Route path="/batches/:ref" element={<BatchDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const batchIn: BatchDetail = {
  id: 1, batchNo: "PB-2026-0001", status: "in_production",
  qtyPlanned: "100.000", qtyActual: null, productVariantId: 1, cutterUserId: 1,
  receivedAt: "2026-06-01T00:00:00Z", completedAt: null, cancelledAt: null,
  notes: null, stagedAt: null, startedAt: "2026-06-02T00:00:00Z",
  submittedQcAt: null, qcVerdict: null, cancelReason: null, events: [],
};

describe("BatchDetailPage action gating", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows submit-qc button (and NOT stage/start) when status=in_production", async () => {
    vi.spyOn(client, "get").mockResolvedValue(batchIn);
    renderDetail(batchIn);

    await screen.findByRole("button", { name: /submit.*qc/i });
    expect(screen.queryByRole("button", { name: /^stage/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^start/i })).toBeNull();
  });

  it("shows no action buttons when status=completed", async () => {
    const completed = { ...batchIn, status: "completed" as const, completedAt: new Date().toISOString(), qtyActual: "99.000", qcVerdict: "pass" as const };
    vi.spyOn(client, "get").mockResolvedValue(completed);
    renderDetail(completed);

    await screen.findByText("PB-2026-0001");
    expect(screen.queryByRole("button", { name: /stage|start|submit|complete|cancel/i })).toBeNull();
  });
});

describe("BatchDetailPage mutation paths", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("clicking Stage calls POST to correct endpoint", async () => {
    const receivedBatch: BatchDetail = { ...batchIn, status: "received_from_cutter", startedAt: null };
    vi.spyOn(client, "get").mockResolvedValue(receivedBatch);
    const postSpy = vi.spyOn(client, "post").mockResolvedValue(undefined);
    renderDetail(receivedBatch);

    await userEvent.click(await screen.findByRole("button", { name: /^stage/i }));

    expect(postSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/batches/PB-2026-0001/stage"),
    );
  });

  it("clicking Submit QC calls POST to correct endpoint", async () => {
    vi.spyOn(client, "get").mockResolvedValue(batchIn);
    const postSpy = vi.spyOn(client, "post").mockResolvedValue(undefined);
    renderDetail(batchIn);

    // Wait for detail to load, then find the Qty input by its label text
    await screen.findByText("PB-2026-0001");
    const qtyInput = screen.getAllByRole("textbox")[0]!;
    await userEvent.type(qtyInput, "99");
    await userEvent.click(screen.getByRole("button", { name: /submit.*qc/i }));

    expect(postSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/batches/PB-2026-0001/submit-qc"),
      expect.anything(),
    );
  });
});

describe("BatchDetailPage action gating — all statuses", () => {
  beforeEach(() => vi.restoreAllMocks());

  const STATUS_CASES: Array<[BatchDetail["status"], RegExp | null]> = [
    ["received_from_cutter", /^stage/i],
    ["staged_pre_prod", /^start/i],
    ["in_production", /submit.*qc/i],
    ["awaiting_qc", /^complete/i],
    ["completed", null],
    ["cancelled", null],
  ];

  it.each(STATUS_CASES)("status=%s shows correct primary action", async (status, btnPattern) => {
    const batch: BatchDetail = { ...batchIn, status, startedAt: status !== "received_from_cutter" && status !== "staged_pre_prod" ? "2026-06-02T00:00:00Z" : null };
    vi.spyOn(client, "get").mockResolvedValue(batch);
    renderDetail(batch);

    await screen.findByText("PB-2026-0001");
    if (btnPattern) {
      expect(screen.getByRole("button", { name: btnPattern })).toBeTruthy();
    } else {
      expect(screen.queryByRole("button", { name: /stage|start|submit|complete|cancel/i })).toBeNull();
    }
  });
});
