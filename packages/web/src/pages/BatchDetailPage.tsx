import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../api/client.js";
import type { BatchDetail, BatchStatus } from "../api/types.js";

/** Actions enabled per status. */
const LEGAL_ACTIONS: Record<BatchStatus, string[]> = {
  received_from_cutter: ["stage", "cancel"],
  staged_pre_prod: ["start", "cancel"],
  in_production: ["submit-qc", "cancel"],
  awaiting_qc: ["complete", "cancel"],
  completed: [],
  cancelled: [],
};

export function BatchDetailPage() {
  const { ref } = useParams<{ ref: string }>();
  const qc = useQueryClient();
  const [qtyInput, setQtyInput] = useState("");
  const [verdict, setVerdict] = useState<"pass" | "fail" | "pass_with_notes">("pass");
  const [cancelReason, setCancelReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: batch, isLoading, isError } = useQuery({
    queryKey: ["batches", ref],
    queryFn: () => get<BatchDetail>(`/api/batches/${ref}`),
    enabled: !!ref,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["batches"] });
  };

  const action = useMutation({
    mutationFn: async ({ type }: { type: string }) => {
      setActionError(null);
      if (type === "stage") return post(`/api/batches/${ref}/stage`);
      if (type === "start") return post(`/api/batches/${ref}/start`);
      if (type === "submit-qc") return post(`/api/batches/${ref}/submit-qc`, { qty: qtyInput });
      if (type === "complete") return post(`/api/batches/${ref}/complete`, { qty: qtyInput, verdict });
      if (type === "cancel") return post(`/api/batches/${ref}/cancel`, { reason: cancelReason });
    },
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setActionError(err instanceof Error ? err.message : "Action failed");
    },
  });

  if (isLoading) return <p>Loading…</p>;
  if (isError || !batch) return <p style={{ color: "#b00020" }}>Batch not found.</p>;

  const legal = LEGAL_ACTIONS[batch.status] ?? [];

  return (
    <div>
      <h1>Batch <span>{batch.batchNo}</span></h1>
      <p>Status: <strong>{batch.status}</strong></p>
      <p>Planned: {batch.qtyPlanned} · Actual: {batch.qtyActual ?? "—"}</p>
      {batch.qcVerdict && <p>QC Verdict: {batch.qcVerdict}</p>}
      {batch.cancelReason && <p>Cancel reason: {batch.cancelReason}</p>}

      {legal.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h2>Actions</h2>
          {actionError && <p style={{ color: "#b00020" }}>{actionError}</p>}
          {(legal.includes("submit-qc") || legal.includes("complete")) && (
            <label style={{ display: "block", marginBottom: 8 }}>
              Qty: <input value={qtyInput} onChange={(e) => setQtyInput(e.target.value)} style={{ width: 80 }} />
            </label>
          )}
          {legal.includes("complete") && (
            <label style={{ display: "block", marginBottom: 8 }}>
              Verdict:{" "}
              <select value={verdict} onChange={(e) => setVerdict(e.target.value as typeof verdict)}>
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
                <option value="pass_with_notes">Pass with notes</option>
              </select>
            </label>
          )}
          {legal.includes("cancel") && (
            <label style={{ display: "block", marginBottom: 8 }}>
              Cancel reason: <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} style={{ width: 200 }} />
            </label>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {legal.includes("stage") && <button type="button" onClick={() => action.mutate({ type: "stage" })} disabled={action.isPending}>Stage</button>}
            {legal.includes("start") && <button type="button" onClick={() => action.mutate({ type: "start" })} disabled={action.isPending}>Start production</button>}
            {legal.includes("submit-qc") && <button type="button" onClick={() => action.mutate({ type: "submit-qc" })} disabled={action.isPending || !qtyInput}>Submit QC</button>}
            {legal.includes("complete") && <button type="button" onClick={() => action.mutate({ type: "complete" })} disabled={action.isPending || !qtyInput}>Complete</button>}
            {legal.includes("cancel") && <button type="button" onClick={() => action.mutate({ type: "cancel" })} disabled={action.isPending || !cancelReason} style={{ background: "#fff0f0" }}>Cancel</button>}
          </div>
        </div>
      )}

      <h2 style={{ marginTop: 24 }}>Event Timeline</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {batch.events.map((ev) => (
          <li key={ev.id} style={{ borderBottom: "1px solid #eee", padding: "4px 0" }}>
            <span style={{ color: "#666", marginRight: 8 }}>{new Date(ev.createdAt).toLocaleString()}</span>
            <strong>{ev.eventType}</strong>
            {ev.fromStatus && ev.toStatus && ` · ${ev.fromStatus} → ${ev.toStatus}`}
          </li>
        ))}
        {batch.events.length === 0 && <li style={{ color: "#666" }}>No events yet.</li>}
      </ul>
    </div>
  );
}
