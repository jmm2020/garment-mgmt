# Runbook: Rotate `SHOPIFY_ADMIN_TOKEN`

**Status**: Active
**Owner**: Operations
**Cadence**: Annual (security hygiene)

> **TL;DR**
> Rotate `SHOPIFY_ADMIN_TOKEN` in ~15 minutes with zero dropped inventory pushes.
> If rotation fails, revert the env var and redeploy; no DB repair needed.

`SHOPIFY_ADMIN_TOKEN` is a long-lived Shopify custom-app Admin API access token. It
authorizes the outbound inventory push job (`packages/server/src/jobs/shopify-inventory-push.ts`)
and the variant-metafield writer. The token is read fresh from `env.SHOPIFY_ADMIN_TOKEN`
on every push-job tick — there is no in-memory cache to flush, so a plain env update +
redeploy is sufficient to cut over.

This runbook covers a manual, operator-driven rotation. Automating rotation is out of
scope.

---

## 1. Pre-flight checks

Goal: rotate from a known-clean state so you can tell a token problem apart from a
pre-existing backlog.

1. **Check push-queue depth.** Completed batches that have not yet pushed inventory:

   ```bash
   psql "$DATABASE_URL" -c "
     SELECT count(*) AS pending_push
     FROM production_batches
     WHERE status = 'completed' AND shopify_pushed_at IS NULL;
   "
   ```

   If `pending_push > 0`, let the push job drain first (each cycle runs every
   `SHOPIFY_PUSH_INTERVAL_MS`, default 30 s). Re-run until it reaches `0`.

2. **Check for stuck / failing pushes.** Batches completed more than 5 minutes ago that
   still have not pushed usually indicate an auth or network problem — fix that before
   layering a rotation on top:

   ```bash
   psql "$DATABASE_URL" -c "
     SELECT batch_no, completed_at, shopify_pushed_at
     FROM production_batches
     WHERE status = 'completed'
       AND shopify_pushed_at IS NULL
       AND completed_at < now() - interval '5 minutes'
     ORDER BY completed_at DESC
     LIMIT 10;
   "
   ```

   Expect 0 rows on a healthy system.

3. **Note the current token prefix.** Record the first 12 chars of the live
   `shpat_…` token (e.g. `shpat_1a2b3c`). You will use it to confirm you reverted to the
   right value during a rollback.

---

## 2. Issue a new token in the Shopify Admin UI

Shopify custom-app tokens do not expire on their own; you generate a replacement and the
old one stays valid until you explicitly revoke it (see §5).

1. Navigate:
   `Shopify Admin → Settings → Apps and sales channels → [your custom app] → API credentials → Admin API access token → Rotate token`
   (See Shopify docs: "Rotate your access token" for current UI screenshots — the path
   occasionally moves between Admin versions.)

2. Confirm the app still grants the required scopes (verbatim from `.env.example`):
   - `write_inventory`
   - `read_inventory`
   - `read_products`
   - `read_locations`
   - `write_metafields`

3. **Copy the new token immediately.** Shopify displays it exactly once. Store it in your
   secrets manager before leaving the page.

---

## 3. Deploy with the new token (zero-drop procedure)

1. **Stop the push loop** if it runs as a standalone process (future: `pnpm push-job`).
   Send `SIGTERM` / `Ctrl-C`. _Caveat: as of this writing the push loop
   (`startInventoryPushLoop`) is defined but not yet wired into server startup, so there
   is no separate process to stop — the server restart in step 4 is sufficient. Update
   this step if/when the loop is wired into `index.ts`._

2. **Update the env var.** Set `SHOPIFY_ADMIN_TOKEN` to the new value in your production
   environment (platform-specific: Heroku config vars / Railway / `.env` on bare metal).

3. **Verify syntax.** The new value must start with `shpat_` and have no trailing
   whitespace:

   ```bash
   [[ "$SHOPIFY_ADMIN_TOKEN" == shpat_* ]] && echo "prefix OK" || echo "BAD PREFIX"
   ```

4. **Redeploy / restart the server.** On restart the push job picks up the new token on
   its next tick (within `SHOPIFY_PUSH_INTERVAL_MS`, default 30 s).

5. **No DB changes needed.** The token is read fresh from env on every tick — there is no
   cached credential and no batch state to repair.

---

## 4. Verification

### 4a. Confirm the new token authenticates (read-only)

Use a read-only `shop` query rather than a write — a write test would alter live
inventory. This hits the same GraphQL endpoint and auth header the push job uses
(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/graphql.json`,
`X-Shopify-Access-Token`):

```bash
curl -s -X POST \
  "https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/graphql.json" \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Access-Token: ${SHOPIFY_ADMIN_TOKEN}" \
  -d '{"query":"{ shop { name id } }"}' \
  | jq '.data.shop'
```

**Success:**

```json
{ "name": "Your Shop Name", "id": "gid://shopify/Shop/1234567890" }
```

**Failure (bad/expired token):** `.data.shop` is `null` and the response carries an
`errors` array (e.g. `[API] Invalid API key or access token`). Treat any `null`
`data.shop` as an auth failure → go to §5.

### 4b. Confirm the push job is healthy after cutover

```bash
# Confirm DB reachable (read-only)
psql "$DATABASE_URL" -c "SELECT 1" > /dev/null && echo "DB reachable"

# Should return 0 rows if the push job is healthy (all completed batches pushed)
psql "$DATABASE_URL" -c "
  SELECT batch_no, completed_at, shopify_pushed_at
  FROM production_batches
  WHERE status = 'completed' AND shopify_pushed_at IS NULL
  ORDER BY completed_at DESC
  LIMIT 10;
"
```

A few rows immediately after restart are fine — they clear on the next tick. Rows that
persist beyond one `SHOPIFY_PUSH_INTERVAL_MS` cycle indicate the new token is not working
→ go to §5.

---

## 5. Rollback

Trigger rollback if §4 shows a `403`/`null shop`, or the push-job logs report `auth`
errors after the cutover.

1. **Revert the env var.** Set `SHOPIFY_ADMIN_TOKEN` back to the previous token value
   (match the prefix you noted in §1.3; retrieve the full value from your secrets manager
   or last deployment config).
2. **Redeploy.**
3. **No manual repair.** Batches that ran against the bad token between the two deploys
   still have `shopify_pushed_at IS NULL`; the push job retries them automatically on the
   next tick. The push is idempotent — `shopify_pushed_at` is set only on a successful
   adjustment.

> **Rollback window:** Shopify does **not** revoke the old token when you issue a new one.
> The old token keeps working until you explicitly revoke it in the Admin UI, which gives
> you a safe window to roll back. Only revoke the old token once §4 has passed and the new
> token has been live and healthy for at least one full push cycle.

---

## 6. Cadence

- **Rotate annually** as a security-hygiene policy (the token never expires on its own).
- Shopify does not surface token age via the API — **track the last rotation date
  manually** (calendar reminder or a note in the custom-app settings).
- Suggested follow-up: open a GitHub issue titled `Shopify token rotation`, due ~12 months
  out, labelled `priority: P3`, each time you rotate.

---

## Quick reference

| Item             | Value                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Env var          | `SHOPIFY_ADMIN_TOKEN` (prefix `shpat_`)                                                    |
| Companion vars   | `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_LOCATION_ID`                                               |
| GraphQL endpoint | `https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/graphql.json`                            |
| Auth header      | `X-Shopify-Access-Token: ${SHOPIFY_ADMIN_TOKEN}`                                           |
| Required scopes  | `write_inventory`, `read_inventory`, `read_products`, `read_locations`, `write_metafields` |
| Push interval    | `SHOPIFY_PUSH_INTERVAL_MS` (default 30 s)                                                  |
| Rollback         | Revert env var + redeploy; old token valid until manually revoked                          |
