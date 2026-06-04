# PRD: Iteration 3 — Operator UI + Real-time

**Iteration**: 3
**Status**: Implemented (2026-06-04)
**Owner**: jmm2020
**Companion PRD**: [`production-tracking.md`](./production-tracking.md) (iteration 2)

---

## TL;DR

Iteration 2 shipped the production-tracking + PVT backend (batches, PVT runs, Shopify push) driven entirely by the `gm` CLI and the REST API. Iteration 3 puts a **web UI** on top of that existing API so the floor runs the daily loop in a browser instead of a terminal, and adds **real-time updates** (Server-Sent Events) so screens reflect a transition within a second of it firing — no refresh.

The UI is a **read/act layer over endpoints that already exist**. The only net-new backend is a single authenticated SSE stream plus an in-process event emitter that the existing transition functions publish to. Scope is deliberately the daily floor loop: **Dashboard, Batches, PVT**. Sew-lines and the iteration-1 surfaces (lots, cut-tickets) are deferred to iteration 4.

---

## Problem

After iteration 2, every floor action is a CLI call (`gm batch start PB-2026-0042`). That works for a developer on a terminal, but the people who actually run the floor — cutters, sew leads, the QC lead, the company's PVT inspector — need a screen they can glance at and tap. Today they cannot:

- See, at a glance, how many batches are in each state or which PVTs are about to expire.
- Drive a batch through its stations without memorising CLI syntax.
- Know that a transition happened unless they re-run a `list` command.

Iteration 3 closes that gap without touching the iteration-2 domain logic.

---

## Goals

1. **The floor loop runs in a browser.** A non-technical operator can receive → stage → start → submit-qc → complete a batch, and validate a PVT, entirely from the UI — no CLI.
2. **Screens are live.** When any actor transitions a batch or PVT, every open Dashboard/Batches/PVT view reflects it within ~1s, with no manual refresh.
3. **Zero new domain logic.** The UI and SSE layer call the existing services/routes. No business rule is re-implemented in the frontend; the server stays the single source of truth.
4. **One deployable.** In production the existing Fastify server serves the built UI as static assets — no separate web host to operate.
5. **Same identity model.** The UI authenticates with the same `gm_sid` session the CLI uses; no new auth backend.

## Non-goals

- Sew-line capacity UI and iteration-1 surfaces (lots, cut-tickets, BOMs, POs) — **iteration 4**.
- Offline / PWA / installable app — iteration 4+.
- Native mobile — iteration 4+ (the UI should be responsive enough for a floor tablet, but no native build).
- WebSocket bidirectional channel — SSE is one-way server→client and is sufficient; bidirectional is out of scope forever for this app.
- Role-based access control / per-actor permissions — the UI uses the existing single-session auth; granular roles are a later iteration.
- Editing completed/terminal records — the iteration-2 append-only invariants hold; the UI offers no edit-after-terminal.

---

## User story

> *Devon works pre-production. He opens the floor tablet to the **Dashboard**: 4 batches `received_from_cutter`, 2 `in_production`, 1 `awaiting_qc`, and a yellow banner — "PVT PVT-2026-0007 (Performance Hoodie) expires in 5 days." He taps the `awaiting_qc` batch, lands on **Batch detail** — the full event timeline plus a **Complete** button. The QC lead, on her own tablet across the floor, has the same batch open; when Devon's lead taps **Submit QC → 47**, her screen updates the status chip to `awaiting_qc` and reveals the **Complete** action a second later, with no refresh. She completes it `--qty 45 --verdict pass_with_notes`. Sixty seconds later the iteration-2 push job syncs Shopify; the Dashboard throughput counter ticks up.*
>
> *Later, the company's inspector opens **PVT**, filters to `inspecting`, taps PVT-2026-0009, and clicks **Validate**. The per-product authorization badge flips to green; the cut-floor's Dashboard banner for that product clears in real time.*

---

## Architecture decisions

Three design questions were open going in; resolved here with rationale (lowest-friction, convention-matching choices for this monorepo).

### 1. Frontend stack — React + Vite SPA in a new `packages/web`

- **Decision**: A new workspace package `packages/web` — **React 18 + TypeScript + Vite**, **TanStack Query** for server-state (fetch/cache/invalidate), minimal component styling (Tailwind acceptable; not load-bearing). It consumes the existing `/api/*` REST endpoints.
- **Why not Next.js / SSR**: the backend is already a standalone Fastify REST API and the domain logic lives there. An SPA over that API is the smallest addition — no second runtime, no data-fetching framework to reconcile with the existing routes. The "read/act layer over existing endpoints" framing is literally a client.
- **Dev**: Vite dev server with a proxy (`/api` and `/auth` and the SSE path → Fastify `:PORT`), so the cookie stays same-origin in the browser.
- **Prod**: `pnpm --filter @garment-mgmt/web build` emits static assets; Fastify serves them via `@fastify/static` at `/` (SPA fallback to `index.html`). One process, one deployable. API routes keep their `/api`, `/auth`, `/webhooks` prefixes; the static handler is the catch-all.

### 2. Auth — reuse the existing `gm_sid` session

- **Decision**: The UI reuses the iteration-2 `/auth` session-login flow and the `gm_sid` httpOnly session cookie (the same one the CLI uses via `@fastify/session`). A **Login** screen posts credentials to the existing `/auth` login route; on success the cookie is set by the server and the browser sends it automatically (same-origin in prod; preserved through the Vite proxy in dev).
- **401 handling**: any `/api/*` or SSE response of `401` routes the SPA to the Login screen. No tokens in `localStorage`; the httpOnly cookie is the only credential.
- **No new auth backend.** If a logout route doesn't already exist, adding one is a trivial sub-task of the auth-shell issue, not new design.

### 3. Real-time — Server-Sent Events (one new endpoint + an in-process emitter)

- **Decision**: **SSE**, not WebSocket. Updates are one-way (server→client); SSE is simpler, rides ordinary HTTP, reconnects natively (`EventSource`), and passes through the same cookie auth.
- **Server**: an in-process `EventEmitter` (single-process app) in a new `events/bus.ts`. The existing batch and PVT transition functions emit a small event after a successful commit — `{ kind: "batch"|"pvt", id, ref, fromStatus, toStatus, at }`. A new authenticated route **`GET /api/events/stream`** holds the connection open, subscribes to the bus, and writes each event as an SSE `data:` frame. Heartbeat comment every ~25s to keep proxies from closing idle streams.
- **Client**: a single `EventSource` opened once the user is authenticated. On each event the client invalidates the relevant TanStack Query keys (`batches`, `batch:<id>`, `pvt`, `pvt-status:<productId>`), so views refetch the authoritative data — the event is a **signal, not a payload of record**. This keeps the server as source of truth and avoids client-side state drift.
- **Test/no-op safety**: emitting is fire-and-forget; if no subscribers, transitions are unaffected. Integration tests assert an event is emitted on transition; an SSE smoke test asserts a subscribed client receives it.

---

## Scope

### In scope

1. **`packages/web` workspace** — React + Vite + TS + TanStack Query; wired into pnpm workspace, `tsconfig.base` extends, eslint/prettier configs consistent with the repo.
2. **App shell + routing** — client routes: `/login`, `/` (Dashboard), `/batches`, `/batches/:ref`, `/pvt`, `/pvt/:runNo`. Responsive layout suitable for a floor tablet.
3. **Auth shell** — Login screen against `/auth`; authenticated layout; 401→login redirect; logout control.
4. **API client** — a thin typed `fetch` wrapper (credentials: include) mirroring the CLI's request semantics; shared response-envelope/error handling matching the server's error shape.
5. **Dashboard screen** — batch counts by status; PVT alerts (expiring within N days / expired) from `/api/products/:id/pvt-status` + `/api/pvt?activeOnly`; today's throughput (completed count). Composes existing list endpoints.
6. **Batches list** — filterable table (status / sku / since / cutter) over `GET /api/batches`; row → detail.
7. **Batch detail** — header (batch_no, sku, qty planned/actual, status chip), event timeline from `GET /api/batches/:id`, and station-action buttons wired to the existing routes: stage, start, submit-qc (qty), complete (qty/verdict/note), cancel (reason). Buttons enabled only for legal `from_status` (UI mirrors the legal graph; server still enforces).
8. **PVT list** — filterable over `GET /api/pvt` (status / variant / activeOnly); row → detail.
9. **PVT detail** — run header + timeline + inspector actions (ship, receive, validate [note], reject [reason], cancel [reason]) against existing `/api/pvt/:runNo/*` routes; shows `expires_at` and authorization state.
10. **SSE backend** — `events/bus.ts` emitter; emit-on-transition in batch + PVT services (after commit); authenticated `GET /api/events/stream` route with heartbeat.
11. **SSE client** — single `EventSource`; query-cache invalidation by event kind/ref; auto-reconnect; closes on logout.
12. **Static serving** — `@fastify/static` serves the built `web` assets at `/` with SPA fallback, behind the existing API/auth/webhook prefixes; dev Vite proxy config.
13. **Tests** — web: component/interaction tests for Batch detail action gating and Dashboard composition (Vitest + Testing Library); server: emit-on-transition assertions + an SSE subscribe-receives-event smoke test; an e2e happy path (login → drive a batch → observe live update) is desirable but may be scripted rather than CI-gated if it needs a browser.
14. **README + docs** — add a `packages/web` section (dev `pnpm --filter @garment-mgmt/web dev`, prod build + serve), the `/api/events/stream` contract, and an iteration-3 status row in the roadmap.

### Out of scope (this iteration)

- Sew-line capacity UI, lots/cut-tickets/BOM/PO surfaces (iteration 4).
- Role-based permissions, multi-user presence indicators.
- WebSocket / bidirectional realtime.
- Server-side rendering, PWA/offline, native mobile.
- Editing or reopening terminal (`completed`/`cancelled`/`validated`/`rejected`) records.

---

## Real-time event contract

`GET /api/events/stream` (auth required; `text/event-stream`). Each message:

```
event: transition
data: {"kind":"batch","id":42,"ref":"PB-2026-0042","fromStatus":"in_production","toStatus":"awaiting_qc","at":"2026-06-03T18:21:09Z"}
```

- `kind`: `"batch" | "pvt"`.
- `ref`: operator-facing id (`PB-YYYY-####` or `PVT-YYYY-####`).
- Heartbeat: a `: ping` comment every ~25s.
- The payload is a **signal**; clients refetch the authoritative resource. No domain data is considered canonical from the stream.

Invariants:

| Invariant | Enforced by |
| --- | --- |
| Events emit only after a committed transition | Emit call placed after the existing service commit, never before |
| Stream requires auth | Same session preHandler as `/api/*` |
| No subscribers ⇒ transitions unaffected | Fire-and-forget emit; emitter never throws into the transition path |
| Client never mutates from stream | Event triggers query invalidation → refetch, never a local write |

---

## Acceptance criteria

The iteration is mergeable when:

1. `pnpm typecheck && pnpm lint && pnpm test` exit 0 across all packages (now including `web`).
2. A user can log in, and drive a batch through receive→…→complete entirely from the UI against a local server.
3. Two browser sessions on the same batch: a transition in one is reflected in the other within ~1s with no manual refresh (demonstrated by the SSE smoke test at the unit level; manual/E2E at the UI level).
4. Batch/PVT action buttons are disabled for illegal `from_status`; attempting an illegal action is additionally rejected by the server (negative test).
5. Server emits exactly one `transition` event per successful batch/PVT transition (test asserts emit count + shape).
6. `GET /api/events/stream` requires auth (401 without session) and delivers a subscribed event (smoke test).
7. Production build: `pnpm --filter @garment-mgmt/web build` then the Fastify server serves the SPA at `/` with deep-link fallback to `index.html`; `/api/*` and `/auth` still resolve.
8. README documents the `web` dev/prod workflow and the SSE contract.

---

## Testing strategy

- **Web unit/interaction** (Vitest + Testing Library): Dashboard composition from mocked list responses; Batch-detail action gating per status; PVT-detail inspector actions; API-client 401→login behavior.
- **Server**: emit-on-transition assertions in the existing batch/pvt test suites; an SSE test that opens the stream, fires a transition, and asserts the frame arrives; auth test for the stream.
- **E2E (best-effort, not necessarily CI-gated)**: a Playwright script for login → drive batch → observe live update, runnable locally; gate only if the harness supports headless browser in CI.

---

## Rollout / operational considerations

- **Single process**: SSE connections are held open by the same Fastify process that serves the API + static assets. For the current single-facility, low-concurrency floor (handful of tablets) this is fine. If connection count ever grows, move the emitter behind a pub/sub (Redis) — explicitly deferred.
- **Proxies/timeouts**: heartbeat comments keep intermediaries from closing idle streams; `EventSource` auto-reconnects on drop.
- **No new env vars required** for the core feature. (An optional `WEB_DIST_PATH` override for the static dir is acceptable but should default to the built path.)

---

## Follow-ups (filed as issues after merge)

| Title | Priority |
| --- | --- |
| Sew-line capacity UI (iteration 4) | P2 |
| Lots / cut-tickets / BOM / PO surfaces (iteration 4) | P2 |
| Role-based access control for the UI | P3 |
| Playwright E2E gated in CI (if browser-in-CI lands) | P3 |
| Redis-backed event bus (only if SSE connection count grows) | P4 |
