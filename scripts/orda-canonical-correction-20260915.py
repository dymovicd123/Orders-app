#!/usr/bin/env python3
import json
import os
import sys
import urllib.request
import urllib.error

ACCOUNT_ID = os.environ["CF_ACCOUNT_ID"]
API_TOKEN = os.environ["CF_API_TOKEN"]
DB_ID = os.environ["DB_ID"]
MODE = os.environ.get("MODE", "preflight").strip().lower()
API = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query"
WRONG_PRODUCT = 74
KEEPER_PRODUCT = 43
WRONG_POSITION = 145
KEEPER_POSITION = 97
VARIANT_IDS = list(range(1259, 1271))
VARIANT_LIST = ",".join(str(v) for v in VARIANT_IDS)


def request(payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(API, data=data, method="POST", headers={
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"D1 HTTP {exc.code}: {text}") from exc
    if not body.get("success"):
        raise RuntimeError(f"D1 request failed: {json.dumps(body, ensure_ascii=False)}")
    for result in body.get("result", []):
        if result.get("success") is False:
            raise RuntimeError(f"D1 statement failed: {json.dumps(body, ensure_ascii=False)}")
    return body


def query(sql, params=None):
    payload = {"sql": sql}
    if params is not None:
        payload["params"] = params
    body = request(payload)
    rows = []
    for result in body.get("result", []):
        rows.extend(result.get("results") or [])
    return rows, body


def batch(statements):
    payload = {"batch": [{"sql": sql} for sql in statements]}
    return request(payload)


def table_exists(name):
    rows, _ = query("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?", [name])
    return bool(rows)


def columns(name):
    if not table_exists(name):
        return []
    rows, _ = query(f'PRAGMA table_info("{name}")')
    return [str(r.get("name")) for r in rows]


def dump(label, sql, params=None):
    rows, _ = query(sql, params)
    print(f"===== {label} ({len(rows)}) =====")
    print(json.dumps(rows, ensure_ascii=False, sort_keys=True))
    return rows


def one(rows, label):
    if len(rows) != 1:
        raise RuntimeError(f"{label}: expected exactly 1 row, got {len(rows)}")
    return rows[0]


def norm(value):
    return "" if value is None else str(value).strip().upper()


def require(condition, message):
    if not condition:
        raise RuntimeError("PREFLIGHT_GUARD_FAILED: " + message)


# Fresh live preflight.
products = dump("PRODUCTS", "SELECT * FROM catalog_products WHERE id IN (43,74) ORDER BY id")
by_product = {int(r["id"]): r for r in products}
require(set(by_product) == {43, 74}, "products 43/74 must both exist")
require(norm(by_product[43].get("name")) == "ОРДА ШАПАН", "product 43 must be ОРДА ШАПАН")
require(norm(by_product[74].get("name")) == "ОРДА", "product 74 must be ОРДА")
require(int(by_product[43].get("is_active", 0)) == 1, "keeper product 43 must be active")

positions = dump("POSITIONS", "SELECT * FROM catalog_stock_positions WHERE id IN (97,145) ORDER BY id")
by_pos = {int(r["id"]): r for r in positions}
require(set(by_pos) == {97, 145}, "positions 97/145 must both exist")
require(int(by_pos[97].get("product_id")) == 43, "position 97 must belong to product 43")
require(int(by_pos[145].get("product_id")) == 74, "position 145 must belong to product 74")
for pid in (97, 145):
    require(norm(by_pos[pid].get("material")) == "КАШЕМИР", f"position {pid} material must be КАШЕМИР")
    require(norm(by_pos[pid].get("length")) == "СТАНДАРТ", f"position {pid} length must be СТАНДАРТ")

variants = dump("WRONG_VARIANTS", f"SELECT * FROM catalog_variants WHERE product_id=74 OR id IN ({VARIANT_LIST}) ORDER BY id")
ids = [int(r["id"]) for r in variants]
require(ids == VARIANT_IDS, f"product 74 variants must be exactly {VARIANT_IDS}; got {ids}")
require(all(int(r.get("product_id")) == 74 for r in variants), "all wrong variants must still belong to product 74")
require(all(int(r.get("stock_position_id")) == 145 for r in variants), "all wrong variants must still use position 145")
require(all(int(r.get("is_active", 0)) == 1 for r in variants), "all wrong variants must be active before correction")

conflicts = dump("TARGET_COMBINATION_CONFLICTS", f"""
SELECT w.id AS wrong_id, t.id AS target_id
FROM catalog_variants w
JOIN catalog_variants t
  ON t.stock_position_id=97
 AND COALESCE(t.category,'')=COALESCE(w.category,'')
 AND COALESCE(t.gender,'')=COALESCE(w.gender,'')
 AND COALESCE(t.color,'')=COALESCE(w.color,'')
 AND COALESCE(t.size_label,'')=COALESCE(w.size_label,'')
 AND t.is_active=1
WHERE w.id IN ({VARIANT_LIST}) AND w.is_active=1
ORDER BY w.id,t.id
""")
require(len(conflicts) == 0, "target position 97 already contains one or more exact variant combinations")

aliases = dump("ORDA_ALIAS", "SELECT * FROM catalog_product_aliases WHERE alias_key='ОРДА' OR raw_value='ОРДА' ORDER BY alias_key")
for row in aliases:
    require(int(row.get("product_id")) in (43, 74), "ОРДА alias points to an unexpected product")

# Current operational references; new orders are allowed, but every product-74 order row must use one of the preserved variants.
orders = dump("ORDER_ITEMS", f"SELECT * FROM order_items WHERE product_id=74 OR variant_id IN ({VARIANT_LIST}) ORDER BY id")
for row in orders:
    if int(row.get("product_id") or 0) == 74:
        require(int(row.get("variant_id") or 0) in VARIANT_IDS, f"order_item {row.get('id')} references product 74 without an expected variant")

stock = dump("INVENTORY_STOCK", f"SELECT * FROM inventory_stock WHERE product_id=74 OR variant_id IN ({VARIANT_LIST}) ORDER BY id")
reservations = dump("RESERVATIONS", f"SELECT * FROM inventory_reservations WHERE product_id=74 OR variant_id IN ({VARIANT_LIST}) ORDER BY id")
movements = dump("MOVEMENTS", f"SELECT * FROM inventory_movements WHERE product_id=74 OR variant_id IN ({VARIANT_LIST}) ORDER BY id")
transfers = dump("TRANSFER_ITEMS", f"SELECT * FROM inventory_transfer_items WHERE product_id=74 OR variant_id IN ({VARIANT_LIST}) ORDER BY id")

for label, rows in (("inventory_stock", stock), ("inventory_reservations", reservations), ("inventory_movements", movements), ("inventory_transfer_items", transfers)):
    for row in rows:
        if int(row.get("product_id") or 0) == 74:
            require(int(row.get("variant_id") or 0) in VARIANT_IDS, f"{label} row {row.get('id')} references product 74 without an expected variant")

# Inspect all known secondary tables. Any live product-74 reference outside explicitly handled tables aborts.
secondary_tables = [
    "inventory_stock_checks", "inventory_stocktake_items", "inventory_lifecycle_events",
    "workshop_tasks", "catalog_identity_order_item_links", "catalog_product_merge_repairs",
    "catalog_manual_retirements", "legacy_import_catalog_links"
]
secondary_refs = {}
for table in secondary_tables:
    cols = columns(table)
    if not cols:
        continue
    clauses = []
    if "product_id" in cols:
        clauses.append("product_id=74")
    if "variant_id" in cols:
        clauses.append(f"variant_id IN ({VARIANT_LIST})")
    if not clauses:
        continue
    rows = dump("SECONDARY_" + table.upper(), f'SELECT * FROM "{table}" WHERE ' + " OR ".join(clauses) + " ORDER BY 1")
    secondary_refs[table] = rows
    # Variant-only aliases/links remain valid because variant IDs are preserved. Product-id references must be canonicalized or absent.
    if "product_id" in cols:
        bad = [r for r in rows if int(r.get("product_id") or 0) == 74]
        require(len(bad) == 0, f"unexpected product 74 references remain in secondary table {table}")

# Legacy catalog_executions is inspected separately. It is not used by current catalog identity, but must be retired safely.
execution_cols = columns("catalog_executions")
executions = []
if execution_cols and "product_id" in execution_cols:
    executions = dump("CATALOG_EXECUTIONS", "SELECT * FROM catalog_executions WHERE product_id IN (43,74) ORDER BY product_id,1")
    print("CATALOG_EXECUTIONS_COLUMNS=" + json.dumps(execution_cols, ensure_ascii=False))

pre_qty = sum(float(r.get("quantity") or 0) for r in stock)
pre_reserved = sum(float(r.get("reserved_qty") or 0) for r in stock)
pre_reservation_ids = [(r.get("id"), r.get("variant_id"), r.get("quantity"), r.get("status")) for r in reservations]
pre_transfer_ids = [(r.get("id"), r.get("variant_id"), r.get("quantity"), r.get("status")) for r in transfers]
pre_order_ids = [r.get("id") for r in orders]
print("PREFLIGHT_SUMMARY=" + json.dumps({
    "mode": MODE,
    "order_item_ids": pre_order_ids,
    "stock_quantity_sum": pre_qty,
    "stock_reserved_sum": pre_reserved,
    "reservation_identity": pre_reservation_ids,
    "transfer_identity": pre_transfer_ids,
}, ensure_ascii=False, sort_keys=True))

if MODE != "apply":
    print("PREFLIGHT_OK_NO_WRITES=1")
    sys.exit(0)

# Determine optional columns to canonicalize without guessing schemas.
def update_set(table, mappings, where):
    cols = set(columns(table))
    parts = []
    for col, expr in mappings:
        if col in cols:
            parts.append(f'"{col}"={expr}')
    if not parts:
        return None
    return f'UPDATE "{table}" SET ' + ", ".join(parts) + " WHERE " + where

statements = []
# Transaction guard table: a failure of either CHECK aborts/rolls back the whole D1 batch.
statements += [
    "CREATE TABLE _ops_orda_guard_20260915 (ok INTEGER NOT NULL CHECK(ok=1))",
    f"INSERT INTO _ops_orda_guard_20260915(ok) SELECT CASE WHEN "
    f"(SELECT COUNT(*) FROM catalog_products WHERE id=43 AND UPPER(TRIM(name))='ОРДА ШАПАН' AND is_active=1)=1 "
    f"AND (SELECT COUNT(*) FROM catalog_products WHERE id=74 AND UPPER(TRIM(name))='ОРДА')=1 "
    f"AND (SELECT COUNT(*) FROM catalog_variants WHERE product_id=74)=12 "
    f"AND (SELECT COUNT(*) FROM catalog_variants WHERE id IN ({VARIANT_LIST}) AND product_id=74 AND stock_position_id=145 AND is_active=1)=12 "
    f"THEN 1 ELSE 0 END",
]

# Canonical alias. Current schema's key is alias_key; update existing ORDA aliases first, then insert if absent.
statements.append("UPDATE catalog_product_aliases SET product_id=43, raw_value='ОРДА', updated_at=CURRENT_TIMESTAMP WHERE alias_key='ОРДА'")
statements.append("INSERT INTO catalog_product_aliases(alias_key,raw_value,product_id,created_at,updated_at) SELECT 'ОРДА','ОРДА',43,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM catalog_product_aliases WHERE alias_key='ОРДА')")

# Preserve variant IDs; only canonicalize their parent product/position.
statements.append(f"UPDATE catalog_variants SET product_id=43, stock_position_id=97, updated_at=CURRENT_TIMESTAMP WHERE id IN ({VARIANT_LIST}) AND product_id=74 AND stock_position_id=145")

updates = [
    ("inventory_stock", [("product_id", "43"), ("stock_position_id", "97"), ("product_name", "'ОРДА ШАПАН'"), ("updated_at", "CURRENT_TIMESTAMP")]),
    ("inventory_reservations", [("product_id", "43"), ("stock_position_id", "97"), ("product_name", "'ОРДА ШАПАН'"), ("product_name_snapshot", "'ОРДА ШАПАН'"), ("updated_at", "CURRENT_TIMESTAMP")]),
    ("inventory_movements", [("product_id", "43"), ("stock_position_id", "97"), ("product_name", "'ОРДА ШАПАН'"), ("product_name_snapshot", "'ОРДА ШАПАН'"), ("updated_at", "CURRENT_TIMESTAMP")]),
    ("inventory_transfer_items", [("product_id", "43"), ("stock_position_id", "97"), ("product_name", "'ОРДА ШАПАН'"), ("product_name_snapshot", "'ОРДА ШАПАН'"), ("updated_at", "CURRENT_TIMESTAMP")]),
    ("order_items", [("product_id", "43"), ("stock_position_id", "97"), ("product_name", "'ОРДА ШАПАН'"), ("product_name_snapshot", "'ОРДА ШАПАН'"), ("updated_at", "CURRENT_TIMESTAMP")]),
]
for table, mapping in updates:
    sql = update_set(table, mapping, f"(product_id=74 OR variant_id IN ({VARIANT_LIST}))")
    if sql:
        statements.append(sql)

# Legacy executions: if active flag exists, retire product-74 rows; otherwise leave historical rows untouched.
if execution_cols and "product_id" in execution_cols and "is_active" in execution_cols:
    sets = ["is_active=0"]
    if "updated_at" in execution_cols:
        sets.append("updated_at=CURRENT_TIMESTAMP")
    statements.append("UPDATE catalog_executions SET " + ", ".join(sets) + " WHERE product_id=74")

# Retire duplicate execution/position/product, preserving rows for audit history.
pos_sets = ["is_active=0"]
if "updated_at" in columns("catalog_stock_positions"):
    pos_sets.append("updated_at=CURRENT_TIMESTAMP")
statements.append("UPDATE catalog_stock_positions SET " + ", ".join(pos_sets) + " WHERE id=145 AND product_id=74")
prod_sets = ["is_active=0"]
if "updated_at" in columns("catalog_products"):
    prod_sets.append("updated_at=CURRENT_TIMESTAMP")
statements.append("UPDATE catalog_products SET " + ", ".join(prod_sets) + " WHERE id=74 AND UPPER(TRIM(name))='ОРДА'")

# Final transaction guard: no current operational reference may still point at wrong product/position.
final_conditions = [
    f"(SELECT COUNT(*) FROM catalog_variants WHERE id IN ({VARIANT_LIST}) AND product_id=43 AND stock_position_id=97)=12",
    "(SELECT COUNT(*) FROM catalog_products WHERE id=74 AND is_active=0)=1",
    "(SELECT COUNT(*) FROM catalog_stock_positions WHERE id=145 AND is_active=0)=1",
    "(SELECT COUNT(*) FROM catalog_product_aliases WHERE alias_key='ОРДА' AND product_id=43)=1",
]
for table in ["order_items", "inventory_stock", "inventory_reservations", "inventory_movements", "inventory_transfer_items"]:
    cols = set(columns(table))
    checks = []
    if "product_id" in cols:
        checks.append("product_id=74")
    if "stock_position_id" in cols:
        checks.append("stock_position_id=145")
    if checks:
        final_conditions.append(f"(SELECT COUNT(*) FROM {table} WHERE " + " OR ".join(checks) + ")=0")
statements.append("INSERT INTO _ops_orda_guard_20260915(ok) SELECT CASE WHEN " + " AND ".join(final_conditions) + " THEN 1 ELSE 0 END")
statements.append("DROP TABLE _ops_orda_guard_20260915")

print(f"APPLY_BATCH_STATEMENTS={len(statements)}")
body = batch(statements)
meta = [r.get("meta", {}) for r in body.get("result", [])]
print("APPLY_META=" + json.dumps(meta, ensure_ascii=False))

# Post verification.
post_variants = dump("POST_VARIANTS", f"SELECT * FROM catalog_variants WHERE id IN ({VARIANT_LIST}) ORDER BY id")
post_stock = dump("POST_STOCK", f"SELECT * FROM inventory_stock WHERE variant_id IN ({VARIANT_LIST}) ORDER BY id")
post_reservations = dump("POST_RESERVATIONS", f"SELECT * FROM inventory_reservations WHERE variant_id IN ({VARIANT_LIST}) ORDER BY id")
post_transfers = dump("POST_TRANSFERS", f"SELECT * FROM inventory_transfer_items WHERE variant_id IN ({VARIANT_LIST}) ORDER BY id")
post_orders = dump("POST_ORDER_ITEMS", f"SELECT * FROM order_items WHERE variant_id IN ({VARIANT_LIST}) ORDER BY id")
post_products = dump("POST_PRODUCTS", "SELECT * FROM catalog_products WHERE id IN (43,74) ORDER BY id")
post_positions = dump("POST_POSITIONS", "SELECT * FROM catalog_stock_positions WHERE id IN (97,145) ORDER BY id")
post_alias = dump("POST_ALIAS", "SELECT * FROM catalog_product_aliases WHERE alias_key='ОРДА'")

require(all(int(r.get("product_id")) == 43 and int(r.get("stock_position_id")) == 97 for r in post_variants), "post variants not canonical")
require(sum(float(r.get("quantity") or 0) for r in post_stock) == pre_qty, "stock quantity changed")
require(sum(float(r.get("reserved_qty") or 0) for r in post_stock) == pre_reserved, "stock reserved quantity changed")
post_reservation_ids = [(r.get("id"), r.get("variant_id"), r.get("quantity"), r.get("status")) for r in post_reservations]
require(post_reservation_ids == pre_reservation_ids, "reservation identity/quantity/status changed")
post_transfer_ids = [(r.get("id"), r.get("variant_id"), r.get("quantity"), r.get("status")) for r in post_transfers]
require(post_transfer_ids == pre_transfer_ids, "transfer identity/quantity/status changed")
require([r.get("id") for r in post_orders] == pre_order_ids, "order item identity changed")
require(all(int(r.get("product_id")) == 43 for r in post_orders), "order items not canonicalized")
require(all(norm(r.get("product_name_snapshot")) == "ОРДА ШАПАН" for r in post_orders if "product_name_snapshot" in r), "order item snapshots not canonicalized")
require(len(post_alias) == 1 and int(post_alias[0].get("product_id")) == 43, "alias not canonical")
require(int([r for r in post_products if int(r["id"]) == 74][0].get("is_active")) == 0, "wrong product still active")
require(int([r for r in post_positions if int(r["id"]) == 145][0].get("is_active")) == 0, "wrong position still active")

print("CORRECTION_OK ORDA_74_TO_ORDA_SHAPAN_43=1")
