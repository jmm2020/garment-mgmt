import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get } from "../api/client.js";
import type { PvtSummary, PvtStatus } from "../api/types.js";

const PVT_STATUS_OPTIONS: PvtStatus[] = [
  "cutting", "shipped", "inspecting", "validated", "rejected", "cancelled",
];

export function PvtPage() {
  const [statusFilter, setStatusFilter] = useState<PvtStatus | "">("");
  const [activeOnly, setActiveOnly] = useState(false);

  const params = new URLSearchParams();
  if (statusFilter) params.set("status", statusFilter);
  if (activeOnly) params.set("activeOnly", "true");
  const qs = params.toString();
  const url = qs ? `/api/pvt?${qs}` : "/api/pvt";

  const { data: runs, isLoading, isError } = useQuery({
    queryKey: ["pvt", statusFilter, activeOnly],
    queryFn: () => get<PvtSummary[]>(url),
  });

  return (
    <div>
      <h1>PVT Runs</h1>
      <div style={{ marginBottom: 12, display: "flex", gap: 12, alignItems: "center" }}>
        <label htmlFor="pvt-status">Status: </label>
        <select id="pvt-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PvtStatus | "")}>
          <option value="">All</option>
          {PVT_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label>
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          {" "}Active only
        </label>
      </div>

      {isLoading && <p>Loading…</p>}
      {isError && <p style={{ color: "#b00020" }}>Failed to load PVT runs.</p>}

      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            {["Run No", "Status", "Expires", "Validated At"].map((h) => (
              <th key={h} style={{ border: "1px solid #ccc", padding: "4px 12px", textAlign: "left" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(runs ?? []).map((r) => (
            <tr key={r.id}>
              <td style={{ border: "1px solid #ccc", padding: "4px 12px" }}>
                <Link to={`/pvt/${r.runNo}`}>{r.runNo}</Link>
              </td>
              <td style={{ border: "1px solid #ccc", padding: "4px 12px" }}>{r.status}</td>
              <td style={{ border: "1px solid #ccc", padding: "4px 12px" }}>
                {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "—"}
              </td>
              <td style={{ border: "1px solid #ccc", padding: "4px 12px" }}>
                {r.validatedAt ? new Date(r.validatedAt).toLocaleDateString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
