import { render, screen } from "@testing-library/react";
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
