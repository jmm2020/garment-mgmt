import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get } from "../api/client.js";
import type { BatchListPage, BatchStatus } from "../api/types.js";

const STATUS_OPTIONS: BatchStatus[] = [
  "received_from_cutter",
  "staged_pre_prod",
  "in_production",
  "awaiting_qc",
  "completed",
  "cancelled",
];

export function BatchesPage() {
  const [statusFilter, setStatusFilter] = useState<BatchStatus | "">("");
  const [skuFilter, setSkuFilter] = useState("");
  const [sinceFilter, setSinceFilter] = useState("");
  const [cutterFilter, setCutterFilter] = useState("");

  const params = new URLSearchParams();
  if (statusFilter) params.set("status", statusFilter);
  if (skuFilter.trim()) params.set("sku", skuFilter.trim());
  if (sinceFilter) params.set("since", sinceFilter);
  if (cutterFilter) params.set("cutterUserId", cutterFilter);
  const search = params.toString();
  const url = search ? `/api/batches?${search}` : "/api/batches";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["batches", statusFilter, skuFilter, sinceFilter, cutterFilter],
    queryFn: () => get<BatchListPage>(url),
  });

  return (
    <div>
      <h1>Batches</h1>
      <div style={{ marginBottom: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <label htmlFor="status-filter">
          Filter by status:{" "}
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as BatchStatus | "")}
          >
            <option value="">All</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
        <label htmlFor="sku-filter">
          SKU:{" "}
          <input
            id="sku-filter"
            value={skuFilter}
            onChange={(e) => setSkuFilter(e.target.value)}
            placeholder="e.g. SKU-001"
            style={{ width: 120 }}
          />
        </label>
        <label htmlFor="since-filter">
          Since:{" "}
          <input
            id="since-filter"
            type="date"
            value={sinceFilter}
            onChange={(e) => setSinceFilter(e.target.value)}
            style={{ width: 140 }}
          />
        </label>
        <label htmlFor="cutter-filter">
          Cutter ID:{" "}
          <input
            id="cutter-filter"
            value={cutterFilter}
            onChange={(e) => setCutterFilter(e.target.value)}
            placeholder="user ID"
            style={{ width: 80 }}
          />
        </label>
      </div>

      {isLoading && <p>Loading…</p>}
      {isError && <p style={{ color: "#b00020" }}>Failed to load batches.</p>}
      {data && (
        <p style={{ marginBottom: 8 }}>
          Showing {data.items.length} of {data.total}
        </p>
      )}

      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            {["Batch No", "Status", "Qty Planned", "Qty Actual", "Received"].map((h) => (
              <th key={h} style={{ border: "1px solid #ccc", padding: "4px 12px", textAlign: "left" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(data?.items ?? []).map((b) => (
            <tr key={b.id}>
              <td style={{ border: "1px solid #ccc", padding: "4px 12px" }}>
                <Link to={`/batches/${b.batchNo}`}>{b.batchNo}</Link>
              </td>
              <td style={{ border: "1px solid #ccc", padding: "4px 12px" }}>{b.status}</td>
              <td style={{ border: "1px solid #ccc", padding: "4px 12px" }}>{b.qtyPlanned}</td>
              <td style={{ border: "1px solid #ccc", padding: "4px 12px" }}>{b.qtyActual ?? "—"}</td>
              <td style={{ border: "1px solid #ccc", padding: "4px 12px" }}>{new Date(b.receivedAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
