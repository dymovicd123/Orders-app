#!/usr/bin/env bash
set -euo pipefail

DB='orders_db_branch2'
BRANCH2_ID='40065052-854e-44b8-bcd5-251bdd488301'
PROD_ID='17e68a41-1d58-4a36-8a63-47c3e32443c4'
mkdir -p evidence

# Exact target + exact migration bytes.
grep -q '"name": "orders-app-branch2"' wrangler.jsonc
grep -q '"database_name": "orders_db_branch2"' wrangler.jsonc
grep -q '"database_id": "40065052-854e-44b8-bcd5-251bdd488301"' wrangler.jsonc
! grep -q 'orders_db_prod' wrangler.jsonc
npx wrangler d1 list --json > /tmp/d1.json
node <<'NODE'
const fs = require('fs')
const raw = JSON.parse(fs.readFileSync('/tmp/d1.json','utf8'))
const rows = Array.isArray(raw) ? raw : (raw.result || [])
const id = name => { const r = rows.find(x => x.name === name); return r && (r.uuid || r.id || r.database_id || '') }
if (id('orders_db_branch2') !== '40065052-854e-44b8-bcd5-251bdd488301') throw new Error('Branch2 D1 identity drifted')
if (id('orders_db_prod') !== '17e68a41-1d58-4a36-8a63-47c3e32443c4') throw new Error('Production D1 identity drifted')
if (id('orders_db_branch2') === id('orders_db_prod')) throw new Error('Branch2 and Production resolve to same D1')
NODE
[[ "$(git hash-object migrations/0065_v72_d1_read_budget_r5_workshop_variant_order_index.sql)" == '7cb6addfce38589872f610ae57b16ee8a4f52edd' ]]
[[ "$(git hash-object migrations/0066_v72_d1_read_budget_r5_finance_summary_indexes.sql)" == 'acb79dcee9750d7588bd049cb6eb495812f4ad87' ]]
[[ "$(git hash-object migrations/0067_v72_o1_read_budget_indexes.sql)" == 'd5b3c065b9ad3f7209aee7f7037741b45bff1fda' ]]
[[ "$(git hash-object migrations/0068_v72_catalog_product_gender_scope.sql)" == '6e47f180a27f1b546ad42740d7e6fc5494ee7d1b' ]]
[[ "$(git hash-object migrations/0069_v72_return_exchange_physical_receipt.sql)" == '261643a6a9f1747091fa5fb117e2f7483b9e1843' ]]
echo 'Exact isolated Branch2 target and migration blobs confirmed.'

# The full semantic preflight already passed in read-only run 35116318061.
# Recheck the exact audited catalog shape immediately before writes.
SQL="$(sed '/^[[:space:]]*--/d' scripts/branch2-0068-preflight.sql)"
npx wrangler d1 execute "$DB" --remote --json --command="$SQL" > evidence/0068-prewrite-guard.json
node <<'NODE'
const fs = require('fs')
const raw = JSON.parse(fs.readFileSync('evidence/0068-prewrite-guard.json','utf8'))
const chunks = Array.isArray(raw) ? raw : [raw]
if (chunks.length !== 3 || chunks.some(x => !x.success || Number(x?.meta?.rows_written || 0) !== 0)) throw new Error('0068 prewrite guard not read-only/successful')
const scopes = Object.fromEntries((chunks[0].results || []).map(r => [r.intended_scope, Number(r.products)]))
if (scopes.female !== 30 || scopes.male !== 7 || scopes.unisex !== 13) throw new Error(`Catalog shape drift: ${JSON.stringify(scopes)}`)
const repairs = chunks[1].results || []
if (repairs.length !== 6) throw new Error(`Expected six audited in-place variants, got ${repairs.length}`)
const refs = ['order_items_refs','workshop_refs','reservation_refs','input_alias_refs','lifecycle_refs','transfer_refs','stock_check_refs','stocktake_refs']
for (const r of repairs) {
  if (r.repair_mode !== 'in_place' || Number(r.old_id) !== Number(r.keeper_id)) throw new Error(`Unexpected merge candidate: ${JSON.stringify(r)}`)
  if (Number(r.stock_rows) || Number(r.stock_qty) || Number(r.reserved_qty) || refs.some(k => Number(r[k]))) throw new Error(`Audited variant gained operational footprint: ${JSON.stringify(r)}`)
}
if (Number(chunks[2]?.results?.[0]?.retire_unused_unisex_blank_candidates) !== 2) throw new Error('Unisex placeholder candidate count drifted')
console.log('Prewrite guard passed: exact audited Branch2 0068 shape is unchanged.')
NODE

# Recovery point immediately before first mutation.
npx wrangler d1 time-travel info "$DB" | tee evidence/time-travel-before-write.txt
npx wrangler d1 execute "$DB" --remote --command="SELECT COUNT(*) AS stock_rows,COALESCE(SUM(quantity),0) AS stock_qty,COALESCE(SUM(reserved_quantity),0) AS reserved_qty FROM inventory_stock; SELECT COUNT(*) AS active_variants FROM catalog_variants WHERE is_active=1; SELECT COUNT(*) AS order_items FROM order_items; SELECT COUNT(*) AS workshop_tasks FROM workshop_tasks; SELECT COUNT(*) AS reservations FROM inventory_reservations;" | tee evidence/business-counts-before.txt

# Classify current state. Refuse partial migrations.
idx="$(npx wrangler d1 execute "$DB" --remote --command="SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_catalog_variants_product_active_desc_sort','idx_payments_payment_date_order_amount','idx_orders_current_debt_partial','idx_order_items_pending_writeoff_status_order','idx_order_items_workshop_order_quantity','idx_o1_exchanges_payment_finance','idx_o1_stock_checks_normalized_time','idx_o1_stock_checks_exact_stocktake') ORDER BY name;" 2>&1)"
idx_count=$(grep -c '"name"' <<<"$idx" || true)
[[ "$idx_count" == 0 || "$idx_count" == 8 ]] || { echo "Partial 0065-0067 state: $idx_count/8" >&2; exit 10; }

schema68="$(npx wrangler d1 execute "$DB" --remote --command="PRAGMA table_info(catalog_products); SELECT name FROM sqlite_master WHERE type='table' AND name IN ('catalog_gender_scope_repairs','catalog_gender_variant_repairs','catalog_gender_stock_baseline'); SELECT name FROM sqlite_master WHERE type='index' AND name='idx_catalog_products_gender_scope';" 2>&1)"
c68=0
grep -q 'gender_scope' <<<"$schema68" && c68=$((c68+1))
for x in catalog_gender_scope_repairs catalog_gender_variant_repairs catalog_gender_stock_baseline idx_catalog_products_gender_scope; do grep -q "$x" <<<"$schema68" && c68=$((c68+1)); done
[[ "$c68" == 0 || "$c68" == 5 ]] || { echo "Partial 0068 state: $c68/5" >&2; exit 11; }

r="$(npx wrangler d1 execute "$DB" --remote --command="PRAGMA table_info(return_items);" 2>&1)"
e="$(npx wrangler d1 execute "$DB" --remote --command="PRAGMA table_info(exchange_items);" 2>&1)"
ix="$(npx wrangler d1 execute "$DB" --remote --command="SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_return_items_physical_receipt','idx_exchange_items_physical_receipt');" 2>&1)"
c69=0
grep -q 'physical_tracking' <<<"$r" && c69=$((c69+1)); grep -q 'physical_received_at' <<<"$r" && c69=$((c69+1))
grep -q 'physical_tracking' <<<"$e" && c69=$((c69+1)); grep -q 'physical_received_at' <<<"$e" && c69=$((c69+1))
grep -q 'idx_return_items_physical_receipt' <<<"$ix" && c69=$((c69+1)); grep -q 'idx_exchange_items_physical_receipt' <<<"$ix" && c69=$((c69+1))
[[ "$c69" == 0 || "$c69" == 6 ]] || { echo "Partial 0069 state: $c69/6" >&2; exit 12; }
echo "State before writes: 0065-0067=$idx_count/8, 0068=$c68/5, 0069=$c69/6"

if [[ "$idx_count" == 0 ]]; then
  for f in migrations/0065_v72_d1_read_budget_r5_workshop_variant_order_index.sql migrations/0066_v72_d1_read_budget_r5_finance_summary_indexes.sql migrations/0067_v72_o1_read_budget_indexes.sql; do
    echo "Applying $f to Branch2 only"
    npx wrangler d1 execute "$DB" --remote --file="$f"
  done
fi

if [[ "$c68" == 0 ]]; then
  echo 'Applying exact 0068 to Branch2 only'
  set +e
  npx wrangler d1 execute "$DB" --remote --file=migrations/0068_v72_catalog_product_gender_scope.sql
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    after="$(npx wrangler d1 execute "$DB" --remote --command="PRAGMA table_info(catalog_products);" 2>&1)"
    if grep -q 'gender_scope' <<<"$after"; then
      echo '0068 returned non-zero after schema changed; refusing retry. Use recovery bookmark if postflight fails.' >&2
      exit 20
    fi
    echo '0068 failed with no schema change; refusing automatic retry.' >&2
    exit 21
  fi
fi

if [[ "$c69" == 0 ]]; then
  echo 'Applying exact 0069 to Branch2 only'
  npx wrangler d1 execute "$DB" --remote --file=migrations/0069_v72_return_exchange_physical_receipt.sql
fi

# Strict postflight.
obj="$(npx wrangler d1 execute "$DB" --remote --command="SELECT name FROM sqlite_master WHERE name IN ('idx_catalog_variants_product_active_desc_sort','idx_payments_payment_date_order_amount','idx_orders_current_debt_partial','idx_order_items_pending_writeoff_status_order','idx_order_items_workshop_order_quantity','idx_o1_exchanges_payment_finance','idx_o1_stock_checks_normalized_time','idx_o1_stock_checks_exact_stocktake','idx_catalog_products_gender_scope','catalog_gender_scope_repairs','catalog_gender_variant_repairs','catalog_gender_stock_baseline','idx_return_items_physical_receipt','idx_exchange_items_physical_receipt') ORDER BY name;" 2>&1)"
printf '%s\n' "$obj" | tee evidence/postflight-objects.txt
for x in idx_catalog_variants_product_active_desc_sort idx_payments_payment_date_order_amount idx_orders_current_debt_partial idx_order_items_pending_writeoff_status_order idx_order_items_workshop_order_quantity idx_o1_exchanges_payment_finance idx_o1_stock_checks_normalized_time idx_o1_stock_checks_exact_stocktake idx_catalog_products_gender_scope catalog_gender_scope_repairs catalog_gender_variant_repairs catalog_gender_stock_baseline idx_return_items_physical_receipt idx_exchange_items_physical_receipt; do
  grep -q "$x" <<<"$obj" || { echo "Missing postflight object $x" >&2; exit 30; }
done
p="$(npx wrangler d1 execute "$DB" --remote --command="PRAGMA table_info(catalog_products);" 2>&1)"; grep -q 'gender_scope' <<<"$p"
r="$(npx wrangler d1 execute "$DB" --remote --command="PRAGMA table_info(return_items);" 2>&1)"; grep -q 'physical_tracking' <<<"$r"; grep -q 'physical_received_at' <<<"$r"
e="$(npx wrangler d1 execute "$DB" --remote --command="PRAGMA table_info(exchange_items);" 2>&1)"; grep -q 'physical_tracking' <<<"$e"; grep -q 'physical_received_at' <<<"$e"
checks="$(npx wrangler d1 execute "$DB" --remote --command="SELECT CASE WHEN COUNT(*)=0 THEN 'FIXED_SCOPE_BLANKS_OK' ELSE 'FIXED_SCOPE_BLANKS_BAD_'||COUNT(*) END AS c FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id WHERE v.is_active=1 AND p.gender_scope IN ('female','male') AND TRIM(COALESCE(v.gender,''))=''; SELECT gender_scope,COUNT(*) AS products FROM catalog_products GROUP BY gender_scope ORDER BY gender_scope; SELECT repair_mode,COUNT(*) AS repairs FROM catalog_gender_variant_repairs GROUP BY repair_mode ORDER BY repair_mode; SELECT COUNT(*) AS stock_baseline_rows FROM catalog_gender_stock_baseline; SELECT CASE WHEN COUNT(*)=0 THEN 'STAGING_CLEAN_OK' ELSE 'STAGING_CLEAN_BAD_'||COUNT(*) END AS c FROM sqlite_master WHERE type='table' AND name IN ('_step0068_gender_map','_step0068_stock_rollup');" 2>&1)"
printf '%s\n' "$checks" | tee evidence/postflight-0068.txt
grep -q 'FIXED_SCOPE_BLANKS_OK' <<<"$checks"
grep -q 'STAGING_CLEAN_OK' <<<"$checks"
npx wrangler d1 execute "$DB" --remote --command="SELECT COUNT(*) AS stock_rows,COALESCE(SUM(quantity),0) AS stock_qty,COALESCE(SUM(reserved_quantity),0) AS reserved_qty FROM inventory_stock; SELECT COUNT(*) AS active_variants FROM catalog_variants WHERE is_active=1; SELECT COUNT(*) AS order_items FROM order_items; SELECT COUNT(*) AS workshop_tasks FROM workshop_tasks; SELECT COUNT(*) AS reservations FROM inventory_reservations;" | tee evidence/business-counts-after.txt

echo 'BRANCH2 SCHEMA SYNC 0065-0069 PASSED.'
