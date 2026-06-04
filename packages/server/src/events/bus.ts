import { EventEmitter } from "node:events";

export interface TransitionEvent {
  kind: "batch" | "pvt";
  id: number;
  ref: string; // batchNo for batches, runNo for PVT
  fromStatus: string | null;
  toStatus: string;
  at: string; // ISO 8601 datetime
}

class EventBus extends EventEmitter {}
export const bus = new EventBus();

/** Fire-and-forget emit. Never throws into the caller's transaction path. */
export function emitTransition(event: TransitionEvent): void {
  try {
    bus.emit("transition", event);
  } catch {
    // Listener errors must not crash state transitions.
  }
}
