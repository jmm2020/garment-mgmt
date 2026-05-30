# Runbook: InvenTree Docker Self-Host Setup

**Status**: Active
**Owner**: Operations
**Cadence**: One-time setup; re-run after a data loss event or fresh environment provision

> **TL;DR**
> Stand up InvenTree on Docker Compose in ~20 minutes.
> The Production Hub reads `INVENTREE_BASE_URL` and `INVENTREE_API_TOKEN` from `.env` —
> complete this runbook before wiring those values in.

Per [ADR-0006](../adr/0006-inventree-for-raw-materials.md), InvenTree replaces Cin7 Core as
the raw-material warehouse layer. The Production Hub pushes stock-in and stock-out events to
InvenTree via its REST API (`POST /api/stock/` on lot receipt, `POST /api/stock/remove/` on
cut-ticket close). InvenTree is self-hosted via Docker alongside the existing `garment-mgmt-pg`
container. This runbook covers the one-time setup of that InvenTree instance.

---

## 1. Prerequisites

**Software**

- Docker Engine ≥ 24 and the Compose v2 plugin (`docker compose version` ≥ 2.20).
  If `docker compose` (no hyphen) is not available, install the plugin:
  `sudo apt-get install docker-compose-plugin` (Debian/Ubuntu).
- `curl` and `jq` on the host (smoke-test steps below use both).

**Disk**

- ≥ 2 GB free for the InvenTree image layers plus initial data.
- The Postgres data volume and media volume each consume roughly 100–500 MB at small scale.

**Ports**

The following ports must be free on the host. The 30xx range is deliberately avoided because
the Production Hub server runs on 3000.

| Service             | Host port | Container port |
| ------------------- | --------- | -------------- |
| InvenTree web UI    | 8088      | 8000           |
| InvenTree Postgres  | 5433      | 5432           |
| Redis               | 6379      | 6379           |

Check availability before proceeding:

```bash
for port in 8088 5433 6379; do
  ss -tlnp "sport = :$port" | grep -q LISTEN \
    && echo "PORT $port IN USE — resolve before continuing" \
    || echo "Port $port OK"
done
```

---

## 2. Docker Compose snippet

InvenTree is **optional infrastructure** — Hub development (schema changes, service tests, CLI)
does not require it. Keep it out of the checked-in `docker-compose.yml` so the default dev stack
stays lightweight. Instead, create a **standalone** `docker-compose.inventree.yml` and bring it
up with `docker compose -f docker-compose.inventree.yml`. InvenTree gets its own dedicated
Postgres instance (`inventree-pg`) so it stays fully isolated from the Hub's `garment-mgmt-pg`.

`docker-compose.inventree.yml`:

```yaml
services:
  # ── InvenTree dependencies ────────────────────────────────────────────────

  inventree-pg:
    image: postgres:16-alpine
    container_name: inventree-pg
    restart: unless-stopped
    environment:
      POSTGRES_USER: inventree
      POSTGRES_PASSWORD: inventree
      POSTGRES_DB: inventree
    ports:
      - "5433:5432"
    volumes:
      - inventree_db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U inventree -d inventree"]
      interval: 5s
      timeout: 5s
      retries: 10

  inventree-redis:
    image: redis:7-alpine
    container_name: inventree-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - inventree_redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  # ── InvenTree application ─────────────────────────────────────────────────

  inventree-web:
    image: inventree/inventree:stable
    container_name: inventree-web
    restart: unless-stopped
    depends_on:
      inventree-pg:
        condition: service_healthy
      inventree-redis:
        condition: service_healthy
    environment:
      INVENTREE_DB_ENGINE: django.db.backends.postgresql
      INVENTREE_DB_NAME: inventree
      INVENTREE_DB_USER: inventree
      INVENTREE_DB_PASSWORD: inventree
      INVENTREE_DB_HOST: inventree-pg
      INVENTREE_DB_PORT: "5432"
      INVENTREE_CACHE_HOST: inventree-redis
      INVENTREE_CACHE_PORT: "6379"
      INVENTREE_ADMIN_USER: admin
      INVENTREE_ADMIN_PASSWORD: change-me-on-first-login
      INVENTREE_ADMIN_EMAIL: admin@example.com
      # Must match the Production Hub's TZ so batch timestamps align.
      # Set this to your local timezone (e.g. America/New_York, Europe/London).
      TZ: America/New_York
    ports:
      - "8088:8000"
    volumes:
      - inventree_data:/home/inventree/data

volumes:
  inventree_data:
  inventree_db:
  inventree_redis:
```

**Volume layout**

| Volume           | Contains                                              |
| ---------------- | ----------------------------------------------------- |
| `inventree_data` | InvenTree media files (uploaded attachments, reports) |
| `inventree_db`   | InvenTree Postgres data directory                     |
| `inventree_redis`| Redis persistence files                               |

---

## 3. First-run bootstrap

Bring the stack up:

```bash
docker compose -f docker-compose.inventree.yml up -d
```

Watch the InvenTree logs — the first start runs database migrations automatically and may take
60–90 seconds:

```bash
docker compose -f docker-compose.inventree.yml logs -f inventree-web
```

Wait until you see a line resembling:

```
Uvicorn running on http://0.0.0.0:8000
```

**Initial admin account**

The `INVENTREE_ADMIN_USER` / `INVENTREE_ADMIN_PASSWORD` / `INVENTREE_ADMIN_EMAIL` environment
variables create the superuser on first start. After logging in to the web UI
(`http://localhost:8088`) for the first time, **change the password immediately**:

```
Settings → User Management → [admin] → Change Password
```

> If you prefer to create the admin account manually instead of via env vars, remove those
> three env vars from the compose file and run:
>
> ```bash
> docker compose -f docker-compose.inventree.yml exec inventree-web invoke superuser
> ```
>
> Follow the prompts for username, email, and password.

**Apply any pending migrations** (safe to re-run; no-ops if up to date):

```bash
docker compose -f docker-compose.inventree.yml exec inventree-web invoke update
```

---

## 4. Token generation

The Production Hub authenticates to InvenTree with a static API token. Generate one in the
InvenTree web UI:

1. Log in at `http://localhost:8088`.
2. Navigate to the user profile: click the admin avatar (top-right) → **Profile**.
3. Scroll to the **API Access Tokens** section.
4. Click **Create new token** — give it a label such as `garment-mgmt-hub`.
5. Copy the token value; it is displayed exactly once.

Alternatively, mint a token via `curl` using the admin credentials:

```bash
curl -s -X POST http://localhost:8088/api/user/token/ \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"change-me-on-first-login"}' \
  | jq -r '.token'
```

Store the token in the Production Hub `.env` file:

```bash
INVENTREE_BASE_URL=http://localhost:8088
INVENTREE_API_TOKEN=<token-from-step-above>
```

> **Never commit these values.** `.env` is gitignored.

---

## 5. Smoke test

Confirm InvenTree is reachable and the token authenticates:

```bash
curl -s \
  -H "Authorization: Token ${INVENTREE_API_TOKEN}" \
  "${INVENTREE_BASE_URL}/api/" \
  | jq '{version: .version, apiVersion: .apiVersion}'
```

**Success** — InvenTree responds with its version info:

```json
{
  "version": "0.16.x",
  "apiVersion": 212
}
```

**Failure cases**

| Symptom                              | Likely cause                                                    |
| ------------------------------------ | --------------------------------------------------------------- |
| `connection refused`                 | Container not yet started or port mapping wrong                 |
| `HTTP 403 Forbidden`                 | Token not set, wrong token, or trailing whitespace in env var   |
| `jq: error (null input)`             | InvenTree returning non-JSON; check `docker compose -f docker-compose.inventree.yml logs inventree-web` |
| Container exits immediately          | Postgres/Redis healthcheck not passing; `docker compose ps` to verify |

Test the two endpoints the Hub client uses directly:

```bash
# List stock items — should return { count: 0, results: [] } on a fresh install
curl -s \
  -H "Authorization: Token ${INVENTREE_API_TOKEN}" \
  "${INVENTREE_BASE_URL}/api/stock/" \
  | jq '{count: .count}'

# List parts — same
curl -s \
  -H "Authorization: Token ${INVENTREE_API_TOKEN}" \
  "${INVENTREE_BASE_URL}/api/part/" \
  | jq '{count: .count}'
```

---

## 6. Backup and restore

### 6a. Backup

Run both steps together; the media volume and database must be backed up as a consistent pair.

```bash
# 1. Dump the InvenTree database
docker compose -f docker-compose.inventree.yml exec inventree-pg \
  pg_dump -U inventree inventree \
  > backup-inventree-$(date +%Y%m%d).sql

# 2. Archive the media volume (attachments, reports)
docker run --rm \
  -v inventree_data:/source:ro \
  -v "$(pwd)":/backup \
  alpine tar czf /backup/backup-inventree-media-$(date +%Y%m%d).tar.gz -C /source .
```

Store both files off-host (object storage, NAS, etc.).

### 6b. Restore

```bash
# 1. Stop InvenTree (leave Postgres and Redis running)
docker compose -f docker-compose.inventree.yml stop inventree-web

# 2. Drop and recreate the database
docker compose -f docker-compose.inventree.yml exec inventree-pg \
  psql -U inventree -c "DROP DATABASE inventree;"
docker compose -f docker-compose.inventree.yml exec inventree-pg \
  psql -U inventree -c "CREATE DATABASE inventree;"

# 3. Restore the SQL dump
docker compose -f docker-compose.inventree.yml exec -T inventree-pg \
  psql -U inventree inventree < backup-inventree-YYYYMMDD.sql

# 4. Restore the media volume
docker run --rm \
  -v inventree_data:/target \
  -v "$(pwd)":/backup \
  alpine sh -c "cd /target && tar xzf /backup/backup-inventree-media-YYYYMMDD.tar.gz"

# 5. Restart InvenTree
docker compose -f docker-compose.inventree.yml start inventree-web
```

Verify with the smoke test in §5 after restore.

---

## 7. Common pitfalls

**`INVENTREE_BASE_URL` trailing slash**

The smoke-test and token-generation curl commands in this runbook use shell string
interpolation (`"${INVENTREE_BASE_URL}/api/"`). A trailing slash produces a double-slash
(`http://localhost:8088//api/`) that some HTTP servers reject. Include no trailing slash
in `INVENTREE_BASE_URL`:

```bash
# Correct
INVENTREE_BASE_URL=http://localhost:8088

# Wrong — double-slash in constructed URLs will cause 404s
INVENTREE_BASE_URL=http://localhost:8088/
```

**`INVENTREE_API_TOKEN` whitespace**

Trailing newlines or spaces in the env var value cause `403 Forbidden`. Verify:

```bash
printf '%s' "$INVENTREE_API_TOKEN" | wc -c
# Should match the token length exactly (typically 40 characters)
```

**CSRF tokens are not required for REST API calls**

InvenTree's REST API uses token-based authentication (`Authorization: Token …`). CSRF tokens
are only required for browser-session (cookie) auth. The Production Hub client sends only the
`Authorization` header — no `X-CSRFToken` header is needed or expected.

**Time zone mismatch**

Set `TZ` in the InvenTree container to the same value as the Production Hub's runtime timezone.
Batch timestamps flow from the Hub into InvenTree stock records; a timezone mismatch shifts the
`updated` timestamps on stock items and makes reconciliation difficult. To check the Hub's
effective TZ:

```bash
node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"
```

Set the InvenTree container's `TZ` environment variable to the same value.

**Port conflicts with Redis**

Redis default port (6379) is commonly used by other local services. If `6379` is occupied on
the host, change the host-side mapping in the compose snippet (e.g., `"6380:6379"`) — only the
`INVENTREE_CACHE_PORT` env var seen by InvenTree matters, not the host binding.

**`invoke update` vs `invoke superuser`**

`invoke update` runs migrations and collects static files — safe to re-run any time. `invoke
superuser` only creates the admin user and is a no-op if one already exists. Run `invoke update`
after every InvenTree image upgrade; `invoke superuser` is a one-time setup step.

**`inventree/inventree:stable` vs pinned version**

The compose snippet uses `stable` (rolling latest stable). For reproducible deployments, pin to
a specific version tag (e.g., `inventree/inventree:0.16.4`) and update deliberately. Check
[InvenTree releases](https://github.com/inventree/InvenTree/releases) for the current stable
tag.

---

## Quick reference

| Item                  | Value                                          |
| --------------------- | ---------------------------------------------- |
| InvenTree web UI      | `http://localhost:8088`                        |
| Env var — base URL    | `INVENTREE_BASE_URL=http://localhost:8088`     |
| Env var — API token   | `INVENTREE_API_TOKEN=<token>`                  |
| Auth header           | `Authorization: Token ${INVENTREE_API_TOKEN}`  |
| InvenTree Postgres    | `localhost:5433` / db `inventree` / user `inventree` |
| Redis                 | `localhost:6379`                               |
| Hub REST endpoints    | `GET /api/stock/`, `POST /api/stock/`, `POST /api/stock/remove/`, `GET /api/part/`, `POST /api/part/` |
| Compose file          | `docker-compose.inventree.yml` (standalone, not the Hub's `docker-compose.yml`) |
| Bootstrap command     | `docker compose -f docker-compose.inventree.yml exec inventree-web invoke update` |
| ADR reference         | [ADR-0006](../adr/0006-inventree-for-raw-materials.md) |
| InvenTree Docker docs | https://docs.inventree.org/en/latest/start/docker/ |
