import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { PvtPage } from "../src/pages/PvtPage.js";
import { PvtDetailPage } from "../src/pages/PvtDetailPage.js";
import * as client from "../src/api/client.js";
import type { PvtSummary, PvtDetail } from "../src/api/types.js";

function renderPvt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><PvtPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const mockPvt: PvtSummary[] = [
  { id: 1, runNo: "PVT-2026-0001", status: "inspecting", productVariantId: 1, markerId: 1, expiresAt: null, validatedAt: null, rejectedAt: null },
  { id: 2, runNo: "PVT-2026-0002", status: "validated", productVariantId: 2, markerId: 1, expiresAt: "2026-12-01T00:00:00Z", validatedAt: "2026-06-01T00:00:00Z", rejectedAt: null },
];

describe("PvtPage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders PVT list with runNo and status", async () => {
    vi.spyOn(client, "get").mockResolvedValue(mockPvt);
    renderPvt();
    await screen.findByText("PVT-2026-0001");
    // Status text appears in both the filter <option> and the table cell — match any.
    expect(screen.getAllByText("inspecting").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("validated").length).toBeGreaterThanOrEqual(1);
  });

  it("each row links to PVT detail", async () => {
    vi.spyOn(client, "get").mockResolvedValue(mockPvt);
    renderPvt();
    const link = await screen.findByRole("link", { name: /PVT-2026-0001/i });
    expect(link.getAttribute("href")).toBe("/pvt/PVT-2026-0001");
  });
});

function renderPvtDetail(run: PvtDetail) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/pvt/${run.runNo}`]}>
        <Routes>
          <Route path="/pvt/:runNo" element={<PvtDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const baseRun: PvtDetail = {
  id: 1, runNo: "PVT-2026-0001", status: "inspecting", productVariantId: 1, markerId: 1,
  expiresAt: null, validatedAt: null, rejectedAt: null,
  notes: null, shippedAt: null, receivedAt: null, cancelledAt: null, cancelReason: null, events: [],
};

describe("PvtDetailPage action gating", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows validate + reject + cancel buttons when status=inspecting", async () => {
    vi.spyOn(client, "get").mockResolvedValue(baseRun);
    renderPvtDetail(baseRun);

    await screen.findByRole("button", { name: /validate/i });
    expect(screen.getByRole("button", { name: /reject/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /ship/i })).toBeNull();
  });

  it("reject button is disabled when reason is empty", async () => {
    vi.spyOn(client, "get").mockResolvedValue(baseRun);
    renderPvtDetail(baseRun);

    const rejectBtn = await screen.findByRole("button", { name: /reject/i });
    expect(rejectBtn.hasAttribute("disabled")).toBe(true);
  });

  it("shows no action buttons when status=validated", async () => {
    const validated = { ...baseRun, status: "validated" as const, validatedAt: new Date().toISOString() };
    vi.spyOn(client, "get").mockResolvedValue(validated);
    renderPvtDetail(validated);

    await screen.findByText("PVT-2026-0001");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
