import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useEventStream } from "../src/hooks/useEventStream.js";

class MockEventSource {
  static listeners: Record<string, EventListenerOrEventListenerObject[]> = {};
  static lastInstance: MockEventSource | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor() {
    MockEventSource.lastInstance = this;
  }
  addEventListener(type: string, fn: EventListenerOrEventListenerObject) {
    (MockEventSource.listeners[type] ??= []).push(fn);
  }
  close() {
    MockEventSource.listeners = {};
  }
  static fire(type: string, data: unknown) {
    const evt = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const fn of MockEventSource.listeners[type] ?? []) (fn as EventListener)(evt);
  }
  static reset() {
    MockEventSource.listeners = {};
    MockEventSource.lastInstance = null;
  }
}

describe("useEventStream", () => {
  let qc: QueryClient;

  beforeEach(() => {
    MockEventSource.reset();
    vi.stubGlobal("EventSource", MockEventSource);
    qc = new QueryClient();
    vi.spyOn(qc, "invalidateQueries");
  });

  function wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }

  it("invalidates batch query keys on a batch transition event", () => {
    renderHook(() => useEventStream(), { wrapper });

    act(() => {
      MockEventSource.fire("transition", {
        kind: "batch",
        id: 1,
        ref: "PB-2026-0001",
        fromStatus: "staged_pre_prod",
        toStatus: "in_production",
        at: "2026-06-01T00:00:00Z",
      });
    });

    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["batches"] });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["batches", "PB-2026-0001"] });
  });

  it("invalidates pvt query keys on a pvt transition event", () => {
    renderHook(() => useEventStream(), { wrapper });

    act(() => {
      MockEventSource.fire("transition", {
        kind: "pvt",
        id: 2,
        ref: "PVT-2026-0001",
        fromStatus: "cutting",
        toStatus: "shipped",
        at: "2026-06-01T00:00:00Z",
      });
    });

    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["pvt"] });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["pvt", "PVT-2026-0001"] });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["pvt", "active"] });
  });

  it("ignores malformed JSON without throwing", () => {
    renderHook(() => useEventStream(), { wrapper });

    const badEvt = new MessageEvent("transition", { data: "not-json{{{" });
    expect(() =>
      act(() => {
        for (const fn of MockEventSource.listeners["transition"] ?? [])
          (fn as EventListener)(badEvt);
      }),
    ).not.toThrow();
    expect(qc.invalidateQueries).not.toHaveBeenCalled();
  });

  it("returns isDisconnected=false initially and true after onerror fires", () => {
    const { result } = renderHook(() => useEventStream(), { wrapper });

    expect(result.current.isDisconnected).toBe(false);

    act(() => {
      MockEventSource.lastInstance?.onerror?.(new Event("error"));
    });

    expect(result.current.isDisconnected).toBe(true);
  });

  it("resets isDisconnected to false when a transition event arrives after an error", () => {
    const { result } = renderHook(() => useEventStream(), { wrapper });

    act(() => {
      MockEventSource.lastInstance?.onerror?.(new Event("error"));
    });
    expect(result.current.isDisconnected).toBe(true);

    act(() => {
      MockEventSource.fire("transition", {
        kind: "batch",
        id: 1,
        ref: "PB-2026-0001",
        fromStatus: "staged_pre_prod",
        toStatus: "in_production",
        at: "2026-06-01T00:00:00Z",
      });
    });

    expect(result.current.isDisconnected).toBe(false);
  });
});
