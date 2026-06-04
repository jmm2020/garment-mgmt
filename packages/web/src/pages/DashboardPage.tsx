import { useQuery } from "@tanstack/react-query";
import { get } from "../api/client.js";
import type { BatchSummary, BatchStatus, PvtSummary } from "../api/types.js";

const ACTIVE_STATUSES: BatchStatus[] = [
  "received_from_cutter",
  "staged_pre_prod",
  "in_production",
  "awaiting_qc",
];

export function DashboardPage() {
  const batchesQ = useQuery({
    queryKey: ["batches"],
    queryFn: () => get<BatchSummary[]>("/api/batches"),
  });

  const pvtQ = useQuery({
    queryKey: ["pvt", "active"],
    queryFn: () => get<PvtSummary[]>("/api/pvt?activeOnly=true"),
  });

  const batches = batchesQ.data ?? [];
  const pvtRuns = pvtQ.data ?? [];

  const counts: Partial<Record<BatchStatus, number>> = {};
  for (const b of batches) {
    if (ACTIVE_STATUSES.includes(b.status as BatchStatus)) {
      counts[b.status] = (counts[b.status] ?? 0) + 1;
    }
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayThroughput = batches
    .filter((b) => b.status === "completed" && b.completedAt && new Date(b.completedAt) >= todayStart)
    .reduce((sum, b) => sum + parseFloat(b.qtyActual ?? "0"), 0);

  const alertPvt = pvtRuns.filter((r) => {
    if (!r.expiresAt) return false;
    const exp = new Date(r.expiresAt);
    const inSevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return exp <= inSevenDays;
  });

  return (
    <div>
      <h1>Dashboard</h1>

      {alertPvt.length > 0 && (
        <div style={{ background: "#fff3cd", border: "1px solid #ffc107", padding: "8px 16px", marginBottom: 16, borderRadius: 4 }}>
          <strong>PVT Alert:</strong> {alertPvt.length} run(s) expired or expiring within 7 days.
          {alertPvt.map((r) => (
            <span key={r.id} style={{ marginLeft: 8 }}>
              {r.runNo} (expires {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "—"})
            </span>
          ))}
        </div>
      )}

      <h2>Active Batches</h2>
      {batchesQ.isLoading && <p>Loading…</p>}
      {batchesQ.isError && <p style={{ color: "#b00020" }}>Failed to load batches.</p>}
      {pvtQ.isLoading && <p>Loading PVT data…</p>}
      {pvtQ.isError && <p style={{ color: "#b00020" }}>Failed to load PVT data.</p>}
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            {ACTIVE_STATUSES.map((s) => (
              <th key={s} style={{ border: "1px solid #ccc", padding: "4px 12px" }}>
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {ACTIVE_STATUSES.map((s) => (
              <td key={s} style={{ border: "1px solid #ccc", padding: "4px 12px", textAlign: "center" }}>
                {counts[s] ?? 0}
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      <h2 style={{ marginTop: 24 }}>Today&apos;s Throughput</h2>
      <p>Completed units today: <strong>{Math.round(todayThroughput)}</strong></p>
    </div>
  );
}
