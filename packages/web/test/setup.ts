// Stub EventSource for jsdom (not needed at runtime — browsers have native EventSource).
if (typeof EventSource === "undefined") {
  (globalThis as unknown as Record<string, unknown>)["EventSource"] = class {
    addEventListener() {}
    close() {}
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
  };
}
