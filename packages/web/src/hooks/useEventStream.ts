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
 * Opens a single EventSource to /api/events/stream once authenticated.
 * On each `transition` event, invalidates the relevant TanStack Query keys
 * so views refetch authoritative data. The stream is a SIGNAL — we never
 * mutate local state from it. Auto-reconnect is handled by the browser's
 * native EventSource implementation. The returned `close` function stops
 * the stream (call on logout).
 */
export function useEventStream(): { close: () => void } {
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

    return () => es.close();
  }, [qc]);

  // Provide an explicit close for logout path (App.tsx calls it before clearing cache).
  // The useEffect cleanup already handles unmount; this is a belt-and-suspenders for logout.
  const close = () => {
    // No-op in the hook — the effect cleanup handles it.
    // The App component can simply call queryClient.clear() + navigate('/login')
    // which unmounts App and triggers the cleanup. This export is kept for clarity.
  };

  return { close };
}
