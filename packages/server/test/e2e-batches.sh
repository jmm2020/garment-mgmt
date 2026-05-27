#!/usr/bin/env bash
# End-to-end happy path: gm pvt create→validate then gm batch receive→complete
# Drives the full PVT + production-batch flow through the gm CLI against a
# running local server. Companion to e2e.sh; covers PR #2's PRD acceptance #6.
set -euo pipefail

HOST="${HOST:-http://localhost:3000}"
ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-dev}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

gm() {
  (cd "$REPO_ROOT" && pnpm --silent --filter @garment-mgmt/cli start -- "$@")
}
# post/get/JAR are used only in step 2 to verify the HTTP API is reachable;
# the main flow drives the server through the gm CLI session.
post() {
  local path=$1 body=$2
  curl -sS -c "$JAR" -b "$JAR" -H "content-type: application/json" -d "$body" "$HOST$path"
}
get() {
  curl -sS -c "$JAR" -b "$JAR" "$HOST$1"
}
assert_eq() {
  local label=$1 got=$2 want=$3
  if [[ "$got" != "$want" ]]; then
    echo "FAIL [$label]: expected '$want', got '$got'" >&2
    exit 1
  fi
}

echo "[e2e-batches] 1/8 seed fixtures"
FIXTURE=$(cd "$REPO_ROOT" && DATABASE_URL="${DATABASE_URL:-postgres://dev:dev@localhost:5432/garment_mgmt}" \
  pnpm --silent --filter @garment-mgmt/server exec tsx test/helpers/seed-e2e-batches.ts \
  | tail -n 1)
USER_ID=$(echo "$FIXTURE" | jq -r '.userId')
VAR_ID=$(echo "$FIXTURE" | jq -r '.variantId')
MK_ID=$(echo "$FIXTURE" | jq -r '.markerId')
PROD_CT_ID=$(echo "$FIXTURE" | jq -r '.productionCutTicketId')
PVT_CT_ID=$(echo "$FIXTURE" | jq -r '.pvtCutTicketId')
echo "  user=$USER_ID var=$VAR_ID marker=$MK_ID prod_ct=$PROD_CT_ID pvt_ct=$PVT_CT_ID"

echo "[e2e-batches] 2/8 login"
GM_PASSWORD="$ADMIN_PASSWORD" gm login "$ADMIN_EMAIL" --host "$HOST"
post "/auth/login" "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" > /dev/null
ME=$(get "/auth/me" | jq -e -r '.email')
echo "  http-session: $ME"
echo "  logged in as $ADMIN_EMAIL"

echo "[e2e-batches] 3/8 pvt create"
PVT_JSON=$(gm pvt create --variant "$VAR_ID" --marker "$MK_ID" \
  --cutter "$USER_ID" --cut-ticket "$PVT_CT_ID")
RUN_NO=$(echo "$PVT_JSON" | jq -r '.runNo')
[[ "$RUN_NO" != "null" && -n "$RUN_NO" ]] || { echo "FAIL: pvt create returned no runNo" >&2; exit 1; }
echo "  run_no=$RUN_NO"

echo "[e2e-batches] 4/8 pvt ship → receive → validate"
gm pvt ship "$RUN_NO" > /dev/null
gm pvt receive "$RUN_NO" > /dev/null
gm pvt validate "$RUN_NO" > /dev/null

PVT_STATUS=$(gm pvt show "$RUN_NO" | jq -r '.status')
assert_eq "pvt.status" "$PVT_STATUS" "validated"
echo "  pvt validated OK"

echo "[e2e-batches] 5/8 batch receive"
BATCH_JSON=$(gm batch receive \
  --cut-ticket "$PROD_CT_ID" \
  --variant    "$VAR_ID"     \
  --qty        "10"          \
  --cutter     "$USER_ID")
BATCH_NO=$(echo "$BATCH_JSON" | jq -r '.batchNo')
[[ "$BATCH_NO" != "null" && -n "$BATCH_NO" ]] || { echo "FAIL: batch receive returned no batchNo" >&2; exit 1; }
echo "  batch_no=$BATCH_NO"

echo "[e2e-batches] 6/8 batch stage → start → submit-qc → complete"
gm batch stage      "$BATCH_NO"                              > /dev/null
gm batch start      "$BATCH_NO"                              > /dev/null
gm batch submit-qc  "$BATCH_NO" --qty "10"                   > /dev/null
gm batch complete   "$BATCH_NO" --qty "10" --verdict "pass"  > /dev/null

echo "[e2e-batches] 7/8 assert status=completed"
DETAIL=$(gm batch show "$BATCH_NO")
assert_eq "batch.status" "$(echo "$DETAIL" | jq -r '.status')" "completed"
echo "  status=completed OK"

echo "[e2e-batches] 8/8 assert shopify_pushed_at within 60s"
DEADLINE=$((SECONDS + 60))
PUSHED="null"
while (( SECONDS < DEADLINE )); do
  PUSHED=$(gm batch show "$BATCH_NO" | jq -r '.shopifyPushedAt // "null"')
  [[ "$PUSHED" != "null" ]] && break
  sleep 2
done
if [[ "$PUSHED" == "null" ]]; then
  echo "FAIL: shopify_pushed_at not set within 60s" >&2
  exit 1
fi
echo "  shopify_pushed_at=$PUSHED OK"

echo ""
echo "[e2e-batches] SUCCESS"
