import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface TransitionEvent {
  kind: "batch" | "pvt";
  id: number;
  ref: string;
  fromStatus: string | null;
  toStatus: string;
  at: string;
}

/**
 * Opens a single EventSource to /api/events/stream for the lifetime of the
 * component. On each `transition` event, invalidates the relevant TanStack
 * Query keys so views refetch authoritative data.
 * The stream is a SIGNAL — we never mutate local state from it.
 * Auto-reconnect is handled by the browser's native EventSource implementation.
 * Closed automatically when the calling component unmounts.
 */
export function useEventStream(): void {
  const qc = useQueryClient();

  useEffect(() => {
    const es = new EventSource("/api/events/stream", { withCredentials: true });

    es.addEventListener("transition", (e: MessageEvent) => {
      let event: TransitionEvent;
      try {
        event = JSON.parse(e.data) as TransitionEvent;
      } catch {
        return;
      }

      if (event.kind === "batch") {
        void qc.invalidateQueries({ queryKey: ["batches"] });
        void qc.invalidateQueries({ queryKey: ["batches", event.ref] });
      } else if (event.kind === "pvt") {
        void qc.invalidateQueries({ queryKey: ["pvt"] });
        void qc.invalidateQueries({ queryKey: ["pvt", event.ref] });
        // Also invalidate pvt-status for the related product variant (not always
        // available from the event; a full pvt list invalidation covers it).
        void qc.invalidateQueries({ queryKey: ["pvt", "active"] });
      }
    });

    es.onerror = (e) => console.error("[sse] stream error:", e);

    return () => es.close();
  }, [qc]);
}
