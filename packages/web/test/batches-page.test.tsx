import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { BatchesPage } from "../src/pages/BatchesPage.js";
import { BatchDetailPage } from "../src/pages/BatchDetailPage.js";
import * as client from "../src/api/client.js";
import type { BatchSummary, BatchListPage, BatchDetail } from "../src/api/types.js";

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

const mockPage: BatchListPage = { items: mockBatches, total: mockBatches.length, limit: 50, offset: 0 };
const emptyPage: BatchListPage = { items: [], total: 0, limit: 50, offset: 0 };

describe("BatchesPage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders batch list with batchNo and status", async () => {
    vi.spyOn(client, "get").mockResolvedValue(mockPage);
    renderBatches();

    await screen.findByText("PB-2026-0001");
    expect(screen.getByText("PB-2026-0002")).toBeTruthy();
    expect(screen.getByText("in_production")).toBeTruthy();
    expect(screen.getByText("awaiting_qc")).toBeTruthy();
  });

  it("each row links to batch detail", async () => {
    vi.spyOn(client, "get").mockResolvedValue(mockPage);
    renderBatches();

    const link = await screen.findByRole("link", { name: /PB-2026-0001/i });
    expect(link.getAttribute("href")).toBe("/batches/PB-2026-0001");
  });

  it("selecting a status filter calls get with status query param", async () => {
    const getSpy = vi.spyOn(client, "get").mockResolvedValue(emptyPage);
    renderBatches();

    await screen.findByRole("table");
    const select = screen.getByRole("combobox", { name: /filter by status/i });
    await userEvent.selectOptions(select, "in_production");

    expect(getSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/batches?status=in_production"),
    );
  });

  it('renders "Showing X of Y" using total from server, not items.length', async () => {
    const truncatedPage: BatchListPage = { items: mockBatches, total: 100, limit: 50, offset: 0 };
    vi.spyOn(client, "get").mockResolvedValue(truncatedPage);
    renderBatches();

    await screen.findByText(/Showing 2 of 100/);
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

describe("BatchDetailPage — button disabled state", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("Submit QC button is disabled until qty is entered", async () => {
    vi.spyOn(client, "get").mockResolvedValue(batchIn);
    renderDetail(batchIn);

    const btn = await screen.findByRole("button", { name: /submit.*qc/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);

    const qtyInput = screen.getAllByRole("textbox")[0]!;
    await userEvent.type(qtyInput, "99");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("Complete button is disabled until qty is entered", async () => {
    const awaitingQc: BatchDetail = { ...batchIn, status: "awaiting_qc" };
    vi.spyOn(client, "get").mockResolvedValue(awaitingQc);
    renderDetail(awaitingQc);

    const btn = await screen.findByRole("button", { name: /^complete/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);

    const qtyInput = screen.getAllByRole("textbox")[0]!;
    await userEvent.type(qtyInput, "50");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("BatchDetailPage — cancel action", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("Cancel button is disabled until a reason is entered", async () => {
    const receivedBatch: BatchDetail = { ...batchIn, status: "received_from_cutter", startedAt: null };
    vi.spyOn(client, "get").mockResolvedValue(receivedBatch);
    renderDetail(receivedBatch);

    const cancelBtn = await screen.findByRole("button", { name: /^cancel/i });
    expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);

    const reasonInput = screen.getByRole("textbox", { name: /cancel reason/i });
    await userEvent.type(reasonInput, "Wrong cut");
    expect((cancelBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("clicking Cancel POSTs to the correct endpoint with reason", async () => {
    const receivedBatch: BatchDetail = { ...batchIn, status: "received_from_cutter", startedAt: null };
    vi.spyOn(client, "get").mockResolvedValue(receivedBatch);
    const postSpy = vi.spyOn(client, "post").mockResolvedValue(undefined);
    renderDetail(receivedBatch);

    const reasonInput = await screen.findByRole("textbox", { name: /cancel reason/i });
    await userEvent.type(reasonInput, "Wrong cut");
    await userEvent.click(screen.getByRole("button", { name: /^cancel/i }));

    expect(postSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/batches/PB-2026-0001/cancel"),
      expect.objectContaining({ reason: "Wrong cut" }),
    );
  });
});

describe("BatchDetailPage — complete mutation", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("clicking Complete POSTs qty and verdict to correct endpoint", async () => {
    const awaitingQc: BatchDetail = { ...batchIn, status: "awaiting_qc" };
    vi.spyOn(client, "get").mockResolvedValue(awaitingQc);
    const postSpy = vi.spyOn(client, "post").mockResolvedValue(undefined);
    renderDetail(awaitingQc);

    await screen.findByText("PB-2026-0001");
    const qtyInput = screen.getAllByRole("textbox")[0]!;
    await userEvent.type(qtyInput, "95");
    await userEvent.click(screen.getByRole("button", { name: /^complete/i }));

    expect(postSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/batches/PB-2026-0001/complete"),
      expect.objectContaining({ qty: "95", verdict: "pass" }),
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
