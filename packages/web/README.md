# @garment-mgmt/web

React 18 · Vite 5 · TanStack Query v5 · React Router 6

## Development

```bash
# 1. Start the API server (handles auth + data)
pnpm --filter @garment-mgmt/server dev

# 2. Start the Vite dev server (hot reload, proxies /api + /auth to :3000)
pnpm --filter @garment-mgmt/web dev
```

Open http://localhost:5173. Login credentials are those seeded in your local DB.

The Vite proxy forwards all `/api/*` and `/auth/*` requests to `http://localhost:3000`
so the session cookie stays same-origin.

## Production build

```bash
pnpm --filter @garment-mgmt/web build
```

Output lands in `packages/web/dist/`. The server serves it via `@fastify/static` at `/`
with a SPA deep-link fallback (any non-API GET → `index.html`).

## Testing

```bash
pnpm --filter @garment-mgmt/web test
```

Tests use jsdom + @testing-library/react. API calls are mocked via `vi.spyOn(client, 'get')`.

## Real-time events — SSE contract

The server emits `text/event-stream` at `GET /api/events/stream` (auth-gated).

Each state transition emits:

```
event: transition
data: {"kind":"batch"|"pvt","id":<number>,"ref":"<batchNo|runNo>","fromStatus":"<string>|null","toStatus":"<string>","at":"<ISO8601>"}
```

The client (`useEventStream` hook) subscribes once on App mount, invalidates
relevant TanStack Query keys on each event, and closes on logout/unmount.
**The event is a signal — never a write.** All data comes from the API.

Heartbeat: `: ping` comment every 25 seconds keeps the connection alive through
load-balancer idle timeouts.
