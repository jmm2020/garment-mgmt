import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get } from "../api/client.js";
import type { BatchSummary, BatchStatus } from "../api/types.js";

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

  const url = statusFilter ? `/api/batches?status=${statusFilter}` : "/api/batches";

  const { data: batches, isLoading, isError } = useQuery({
    queryKey: ["batches", statusFilter],
    queryFn: () => get<BatchSummary[]>(url),
  });

  return (
    <div>
      <h1>Batches</h1>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="status-filter">Filter by status: </label>
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
      </div>

      {isLoading && <p>Loading…</p>}
      {isError && <p style={{ color: "#b00020" }}>Failed to load batches.</p>}

      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            {["Batch No", "Status", "Qty Planned", "Qty Actual", "Received"].map((h) => (
              <th key={h} style={{ border: "1px solid #ccc", padding: "4px 12px", textAlign: "left" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(batches ?? []).map((b) => (
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
