import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../api/client.js";
import type { PvtDetail, PvtStatus } from "../api/types.js";

const LEGAL_PVT_ACTIONS: Record<PvtStatus, string[]> = {
  cutting: ["ship", "cancel"],
  shipped: ["receive", "cancel"],
  inspecting: ["validate", "reject", "cancel"],
  validated: [],
  rejected: [],
  cancelled: [],
};

export function PvtDetailPage() {
  const { runNo } = useParams<{ runNo: string }>();
  const qc = useQueryClient();
  const [validateNote, setValidateNote] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: run, isLoading, isError } = useQuery({
    queryKey: ["pvt", runNo],
    queryFn: () => get<PvtDetail>(`/api/pvt/${runNo}`),
    enabled: !!runNo,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["pvt"] });
  };

  const action = useMutation({
    mutationFn: async ({ type }: { type: string }) => {
      setActionError(null);
      if (type === "ship") return post(`/api/pvt/${runNo}/ship`);
      if (type === "receive") return post(`/api/pvt/${runNo}/receive`);
      if (type === "validate") return post(`/api/pvt/${runNo}/validate`, { notes: validateNote || null });
      if (type === "reject") return post(`/api/pvt/${runNo}/reject`, { reason: rejectReason });
      if (type === "cancel") return post(`/api/pvt/${runNo}/cancel`, { reason: cancelReason });
    },
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setActionError(err instanceof Error ? err.message : "Action failed");
    },
  });

  if (isLoading) return <p>Loading…</p>;
  if (isError || !run) return <p style={{ color: "#b00020" }}>PVT run not found.</p>;

  const legal = LEGAL_PVT_ACTIONS[run.status] ?? [];

  return (
    <div>
      <h1>PVT Run <span>{run.runNo}</span></h1>
      <p>Status: <strong>{run.status}</strong></p>
      {run.expiresAt && <p>Expires: {new Date(run.expiresAt).toLocaleDateString()}</p>}
      {run.validatedAt && <p>Validated: {new Date(run.validatedAt).toLocaleString()}</p>}
      {run.rejectedAt && <p>Rejected: {new Date(run.rejectedAt).toLocaleString()}</p>}
      {run.cancelReason && <p>Cancel reason: {run.cancelReason}</p>}

      {legal.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h2>Inspector Actions</h2>
          {actionError && <p style={{ color: "#b00020" }}>{actionError}</p>}
          {legal.includes("validate") && (
            <label style={{ display: "block", marginBottom: 8 }}>
              Validate note (optional):{" "}
              <input value={validateNote} onChange={(e) => setValidateNote(e.target.value)} style={{ width: 240 }} />
            </label>
          )}
          {legal.includes("reject") && (
            <label style={{ display: "block", marginBottom: 8 }}>
              Reject reason (required):{" "}
              <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} style={{ width: 240 }} />
            </label>
          )}
          {legal.includes("cancel") && (
            <label style={{ display: "block", marginBottom: 8 }}>
              Cancel reason:{" "}
              <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} style={{ width: 240 }} />
            </label>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            {legal.includes("ship") && <button type="button" onClick={() => action.mutate({ type: "ship" })} disabled={action.isPending}>Ship</button>}
            {legal.includes("receive") && <button type="button" onClick={() => action.mutate({ type: "receive" })} disabled={action.isPending}>Receive</button>}
            {legal.includes("validate") && <button type="button" onClick={() => action.mutate({ type: "validate" })} disabled={action.isPending}>Validate</button>}
            {legal.includes("reject") && <button type="button" onClick={() => action.mutate({ type: "reject" })} disabled={action.isPending || !rejectReason}>Reject</button>}
            {legal.includes("cancel") && <button type="button" onClick={() => action.mutate({ type: "cancel" })} disabled={action.isPending || !cancelReason}>Cancel</button>}
          </div>
        </div>
      )}

      <h2 style={{ marginTop: 24 }}>Event Timeline</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {run.events.map((ev) => (
          <li key={ev.id} style={{ borderBottom: "1px solid #eee", padding: "4px 0" }}>
            <span style={{ color: "#666", marginRight: 8 }}>{new Date(ev.createdAt).toLocaleString()}</span>
            <strong>{ev.eventType}</strong>
            {ev.fromStatus && ev.toStatus && ` · ${ev.fromStatus} → ${ev.toStatus}`}
          </li>
        ))}
        {run.events.length === 0 && <li style={{ color: "#666" }}>No events yet.</li>}
      </ul>
    </div>
  );
}
