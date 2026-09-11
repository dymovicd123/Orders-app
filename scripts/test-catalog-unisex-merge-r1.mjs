import fs from 'node:fs'

let failed = false
const check = (condition, message) => {
  if (!condition) {
    failed = true
    console.error('FAIL:', message)
  } else {
    console.log('OK:', message)
  }
}

const worker = fs.readFileSync('worker/domains/catalog.ts', 'utf8')
const ui = fs.readFileSync('src/features/inventory/views/renderInventoryCatalogPanel.tsx', 'utf8')

check(worker.includes("WHEN UPPER(TRIM(COALESCE(gender, ''))) LIKE '%ЖЕН%' THEN 'ЖЕН'"), 'duplicate lookup normalizes legacy gender text')
check(worker.includes("WHEN TRIM(COALESCE(color, '')) = '' THEN 'БЕЗ ЦВЕТА'"), 'duplicate lookup canonicalizes blank color')
check(worker.includes("WHEN UPPER(TRIM(COALESCE(size_label, ''))) IN ('', 'БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р') THEN ''"), 'duplicate lookup canonicalizes one-size labels')
check(worker.includes("if (productScope === 'unisex' && duplicate?.id)"), 'merge path is limited to unisex blank-to-concrete duplicate correction')
check(worker.includes("FROM catalog_gender_variant_repairs\n         WHERE old_variant_id = ? LIMIT 1"), 'merge replays are idempotently recognized from audit')
check(worker.includes("WHERE i.variant_id IN (?, ?) AND s.status = 'active'"), 'active stocktake blocks merge')
check(worker.includes("WHERE source_item.variant_id = ? AND d.status = 'applied'"), 'live transfer collision blocks merge')
check(worker.includes("UPDATE order_items SET variant_id = ? WHERE variant_id = ?"), 'order canonical links move to keeper')
check(worker.includes("UPDATE inventory_movements SET variant_id = ? WHERE variant_id = ?"), 'movement canonical links move to keeper')
check(worker.includes("UPDATE workshop_tasks SET variant_id = ? WHERE variant_id = ?"), 'workshop canonical links move to keeper')
check(worker.includes("UPDATE inventory_reservations SET variant_id = ? WHERE variant_id = ?"), 'reservation canonical links move to keeper')
check(worker.includes("UPDATE catalog_input_aliases SET variant_id = ? WHERE variant_id = ?"), 'catalog aliases move to keeper')
check(worker.includes("UPDATE inventory_lifecycle_events SET variant_id = ? WHERE variant_id = ?"), 'lifecycle links move to keeper')
check(worker.includes("UPDATE inventory_stock_checks SET variant_id = ? WHERE variant_id = ?"), 'physical-check links move to keeper')
check(worker.includes("AND NOT EXISTS (\n               SELECT 1 FROM inventory_transfer_items sibling"), 'transfer history avoids uniqueness collisions')
check(worker.includes("AND NOT EXISTS (\n               SELECT 1 FROM inventory_stocktake_items sibling"), 'stocktake history avoids uniqueness collisions')
check(worker.includes("SET quantity = COALESCE(quantity, 0) + COALESCE((SELECT quantity FROM inventory_stock WHERE id = ? AND variant_id = ?), 0)"), 'same-source physical stock is rolled into keeper')
check(worker.includes("last_action = 'Объединение позиции каталога'"), 'superseded stock row is explicitly marked')
check(worker.includes("SELECT SUM(r.quantity)\n                 FROM inventory_reservations r"), 'keeper reserved quantity is rebuilt from active reservations')
check(worker.includes("VALUES (?, ?, ?, ?, 'merge', ?)"), 'merge is audited')
check(worker.includes("return { ok: true, correctedGender: true, merged: true, keeperVariantId"), 'merge success is explicit')
check(!worker.includes('UPDATE order_items SET gender_snapshot'), 'historical order text snapshots are not rewritten')
check(ui.includes('если ЖЕН/МУЖ-дубль уже есть, система безопасно объединит позиции'), 'catalog UI explains safe merge behavior')

if (failed) process.exit(1)
console.log('Catalog unisex merge R1: OK')
