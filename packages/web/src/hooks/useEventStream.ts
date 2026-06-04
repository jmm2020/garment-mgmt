import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface TransitionEvent {
  kind: "batch" | "pvt";
  id: number;
  ref: string;
  fromStatus: string | null;
  toStatus: string;
  at: string;
}

// Stream is a SIGNAL — never mutate local state from it; invalidate queries instead.
export function useEventStream(): { isDisconnected: boolean } {
  const qc = useQueryClient();
  const [isDisconnected, setIsDisconnected] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/events/stream", { withCredentials: true });

    es.addEventListener("transition", (e: MessageEvent) => {
      setIsDisconnected(false);
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
        // Also invalidate ["pvt", "active"] — the Dashboard active-PVT list. The event
        // doesn't carry a productVariantId, so we can't narrow to a per-variant key;
        // a full active-list invalidation is the safe cover.
        void qc.invalidateQueries({ queryKey: ["pvt", "active"] });
      }
    });

    es.onerror = (e) => {
      console.error("[sse] stream error:", e);
      setIsDisconnected(true);
    };

    return () => es.close();
  }, [qc]);

  return { isDisconnected };
}
