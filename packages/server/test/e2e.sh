#!/usr/bin/env bash
# End-to-end happy path: login → create vendor → material → PO → receive → product → BOM → activate → cut ticket → close
set -euo pipefail

HOST="${HOST:-http://localhost:3000}"
ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-dev}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

post() {
  local path=$1 body=$2
  curl -sS -c "$JAR" -b "$JAR" -H "content-type: application/json" -d "$body" "$HOST$path"
}
get() {
  curl -sS -c "$JAR" -b "$JAR" "$HOST$1"
}
id_of() {
  node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).id))"
}

echo "[e2e] login admin"
post "/auth/login" "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" > /dev/null
get "/auth/me" | grep -q '"email"'

TS=$(date +%s)
echo "[e2e] create vendor"
VENDOR_ID=$(post "/api/vendors" "{\"code\":\"E2E-$TS\",\"name\":\"E2E Mill\",\"vendorType\":\"mill\",\"country\":\"US\"}" | id_of)
echo "  vendor_id=$VENDOR_ID"

echo "[e2e] create material"
MAT_ID=$(post "/api/materials" "{\"sku\":\"E2E-MAT-$TS\",\"name\":\"E2E Ripstop\",\"materialType\":\"fabric_shell\",\"unitOfMeasure\":\"yard\"}" | id_of)
echo "  material_id=$MAT_ID"

echo "[e2e] add variant"
VAR_ID=$(post "/api/materials/$MAT_ID/variants" "{\"variantSku\":\"E2E-VAR-$TS\",\"colorway\":\"Spruce\"}" | id_of)
echo "  variant_id=$VAR_ID"

echo "[e2e] create PO"
PO_ID=$(post "/api/pos" "{\"poNumber\":\"PO-E2E-$TS\",\"vendorId\":$VENDOR_ID}" | id_of)
echo "  po_id=$PO_ID"

echo "[e2e] add PO line"
LINE_ID=$(post "/api/pos/$PO_ID/lines" "{\"materialVariantId\":$VAR_ID,\"quantityOrdered\":\"100\",\"unitCost\":\"5.50\"}" | id_of)
echo "  line_id=$LINE_ID"

echo "[e2e] send + confirm PO"
post "/api/pos/$PO_ID/send" '{}' > /dev/null
post "/api/pos/$PO_ID/confirm" '{}' > /dev/null

echo "[e2e] receive PO line (2 lots, same dye_lot)"
post "/api/pos/lines/$LINE_ID/receive" "{\"lots\":[{\"lotCode\":\"LOT-A\",\"dyeLot\":\"DL-001\",\"countryOfOrigin\":\"US\",\"quantityReceived\":\"60\",\"qualityStatus\":\"passed\"},{\"lotCode\":\"LOT-B\",\"dyeLot\":\"DL-001\",\"countryOfOrigin\":\"US\",\"quantityReceived\":\"40\",\"qualityStatus\":\"passed\"}]}" > /dev/null

echo "[e2e] create product"
PROD_ID=$(post "/api/products" "{\"styleCode\":\"E2E-STYLE-$TS\",\"name\":\"E2E Vest\"}" | id_of)
echo "  product_id=$PROD_ID"

echo "[e2e] add product variant"
post "/api/products/$PROD_ID/variants" "{\"size\":\"M\",\"colorway\":\"Spruce\",\"fgSku\":\"FG-$TS-M\"}" > /dev/null

echo "[e2e] create BOM"
BOM_ID=$(post "/api/boms" "{\"productId\":$PROD_ID,\"components\":[{\"materialVariantId\":$VAR_ID,\"quantityPerUnit\":\"2.5\",\"unitOfMeasure\":\"yard\",\"isVisiblePanel\":true,\"position\":\"shell_front\"}]}" | id_of)
echo "  bom_id=$BOM_ID"

echo "[e2e] approve + activate BOM"
post "/api/boms/$BOM_ID/approve" '{}' > /dev/null
post "/api/boms/$BOM_ID/activate" '{}' > /dev/null

echo "[e2e] create cut ticket"
CT_ID=$(post "/api/cut-tickets" "{\"ticketNumber\":\"CT-E2E-$TS\",\"productId\":$PROD_ID,\"bomId\":$BOM_ID,\"plannedQuantityBySize\":{\"M\":10}}" | id_of)
echo "  cut_ticket_id=$CT_ID"

echo "[e2e] start cut ticket"
post "/api/cut-tickets/$CT_ID/start" '{}' > /dev/null

echo "[e2e] fetch allocations"
ALLOCS=$(get "/api/cut-tickets/$CT_ID")
ALLOC_ID=$(node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(d.allocations[0].id))" <<< "$ALLOCS")
echo "  alloc_id=$ALLOC_ID"

echo "[e2e] close cut ticket"
post "/api/cut-tickets/$CT_ID/close" "{\"actuals\":[{\"cutTicketLotId\":$ALLOC_ID,\"actualQuantityCut\":\"25\",\"actualQuantityReturned\":\"0.5\"}]}" > /dev/null

LOT_ID=$(node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(d.allocations[0].materialLotId))" <<< "$ALLOCS")
echo "[e2e] provenance for lot $LOT_ID"
get "/api/lots/$LOT_ID/provenance" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));if(!d.vendor||!d.po)throw new Error('provenance chain broken');console.log('  vendor:',d.vendor.name,' po:',d.po.poNumber)"

echo "[e2e] SUCCESS"
