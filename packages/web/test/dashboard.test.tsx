import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { DashboardPage } from "../src/pages/DashboardPage.js";
import * as client from "../src/api/client.js";
import type { BatchSummary, PvtSummary } from "../src/api/types.js";

function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const mockBatches: BatchSummary[] = [
  { id: 1, batchNo: "PB-2026-0001", status: "in_production", qtyPlanned: "100.000", qtyActual: null, productVariantId: 1, cutterUserId: 1, receivedAt: "2026-06-01T00:00:00Z", completedAt: null, cancelledAt: null },
  { id: 2, batchNo: "PB-2026-0002", status: "awaiting_qc", qtyPlanned: "50.000", qtyActual: "49.000", productVariantId: 2, cutterUserId: 1, receivedAt: "2026-06-02T00:00:00Z", completedAt: null, cancelledAt: null },
  { id: 3, batchNo: "PB-2026-0003", status: "completed", qtyPlanned: "80.000", qtyActual: "78.000", productVariantId: 1, cutterUserId: 2, receivedAt: "2026-06-03T00:00:00Z", completedAt: new Date().toISOString(), cancelledAt: null },
];

const mockPvt: PvtSummary[] = [
  { id: 1, runNo: "PVT-2026-0001", status: "inspecting", productVariantId: 1, markerId: 1, expiresAt: new Date(Date.now() - 1000).toISOString(), validatedAt: null, rejectedAt: null },
];

// Mock by URL so query resolution order doesn't matter (the two queries fire concurrently).
function mockGet(batches: BatchSummary[], pvt: PvtSummary[]) {
  vi.spyOn(client, "get").mockImplementation((path: string) => {
    if (path.startsWith("/api/pvt")) return Promise.resolve(pvt as never);
    return Promise.resolve(batches as never);
  });
}

describe("DashboardPage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows batch status counts", async () => {
    mockGet(mockBatches, mockPvt);
    renderDashboard();

    await screen.findByText("in_production");
    // Wait for the batches query to resolve and counts to render.
    // in_production count = 1 (and awaiting_qc count = 1) — at least one "1" cell present.
    const ones = await screen.findAllByText("1");
    expect(ones.length).toBeGreaterThanOrEqual(1);
  });

  it("shows expired PVT alert banner", async () => {
    mockGet(mockBatches, mockPvt);
    renderDashboard();

    await screen.findByText(/expired/i);
  });

  it("shows today's completed throughput", async () => {
    mockGet(mockBatches, []);
    renderDashboard();

    // batch 3 completed today, qtyActual=78
    await screen.findByText(/78/);
  });
});
