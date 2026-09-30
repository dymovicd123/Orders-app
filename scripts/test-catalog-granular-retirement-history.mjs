import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const section = (source, start, end) => {
  const a = source.indexOf(start)
  check(a >= 0, 'Missing section: ' + start)
  const b = end ? source.indexOf(end, a + start.length) : -1
  return source.slice(a, b > a ? b : undefined)
}

const migration = read('migrations/0079_v72_catalog_granular_retirement_history.sql')
const retirement = read('worker/domains/catalog-retirement.ts')
const catalog = read('worker/domains/catalog.ts')
const historyUi = read('src/features/inventory/views/CatalogRetirementHistory.tsx')
const groupUi = read('src/features/inventory/views/catalogPolishExecutionGroups.tsx')
const groupAction = read('src/features/inventory/views/CatalogVariantGroupRetirementAction.tsx')
const css = read('src/styles/w6-3-catalog-polish.css')

const groupRetire = section(retirement, 'export async function retireCatalogVariantGroup', 'export type CatalogRetirementPreview')
const historyRead = section(retirement, 'export type CatalogRetirementHistoryEntityType', 'export async function restoreCatalogRetirement')
const variantUpdate = section(catalog, 'export async function updateCatalogVariant', 'export async function deleteCatalogVariant')

check(migration.includes('CREATE TABLE IF NOT EXISTS catalog_retirement_history_events'), 'granular retirement history table missing')
check(migration.includes("event_type TEXT NOT NULL CHECK (event_type IN ('variant', 'group'))"), 'granular history scope constraint missing')
check(migration.includes('variant_id INTEGER'), 'exact SKU history cannot preserve retired variant id')
check(!/\bUPDATE\b|\bDELETE\s+FROM\b|\bINSERT\s+INTO\s+(?:catalog_variants|inventory_stock|order_items|inventory_reservations)\b/i.test(migration), '0079 must be additive schema only')

check(groupRetire.includes('await db.batch(['), 'local group retirement/history are not committed through one batch')
check(groupRetire.includes('INSERT INTO catalog_retirement_history_events') && groupRetire.includes("SELECT 'group'"), 'local group retirement is not durably recorded')
check(groupRetire.includes('v.is_active=0 AND v.updated_at=?'), 'local group history can be written without proving the guarded retirement completed')
check(variantUpdate.includes('INSERT INTO catalog_retirement_history_events') && variantUpdate.includes("SELECT 'variant'"), 'exact SKU retirement is not durably recorded')
check(variantUpdate.includes('await db.batch(['), 'exact SKU retirement/history are not committed through one batch')
check(variantUpdate.includes('v.id=? AND v.is_active=0 AND v.updated_at=?'), 'exact SKU history can be written without proving retirement')

check(historyRead.includes("'operation' AS history_source") && historyRead.includes("'granular' AS history_source"), 'deleted-history read does not unify whole and granular events')
check(historyRead.includes('UNION ALL'), 'deleted-history read is not a unified chronological feed')
check(historyRead.includes("CatalogRetirementEntityType | 'group' | 'variant'"), 'history API does not model group/exact SKU scopes')
check(historyRead.includes('0 AS restorable'), 'granular history incorrectly exposes whole-retirement restore semantics')
check(historyRead.includes('1 AS restorable'), 'whole product/execution restore capability disappeared')

check(historyUi.includes("'execution' | 'product' | 'group' | 'variant'"), 'history UI does not model all deletion scopes')
check(historyUi.includes("if (row.entityType === 'group') return 'Группа'"), 'history UI does not label group deletions')
check(historyUi.includes("return 'Точная позиция'"), 'history UI does not label exact SKU deletions')
check(historyUi.includes('!row.restorable ? ('), 'granular history still exposes the whole-retirement restore button')
check(historyUi.includes('история заказов и движений сохранена'), 'granular history does not explain preserved history')
check(historyUi.includes('Удалённые товары и позиции'), 'unified deleted-history heading missing')

check(groupUi.includes('catalog-color-subgroup-heading'), 'group action is still placed below subgroup metadata')
check(groupAction.includes('className="danger compact catalog-local-retirement-button"'), 'group removal action is still visually secondary')
check(css.includes('.catalog-color-subgroup-heading') && css.includes('justify-content: space-between'), 'group heading does not place action opposite subgroup identity')
check(css.includes('button.catalog-local-retirement-button') && css.includes('min-height: 34px'), 'group removal button remains too small')
check(css.includes('background: #fff4f4') && css.includes('border: 1px solid #df8e8e'), 'group removal button lacks a visible danger treatment')
check(css.includes('@media (max-width: 620px)') && css.includes('width: 100%'), 'group removal action has no usable mobile layout')

console.log('CATALOG GRANULAR RETIREMENT HISTORY/UI PASSED — exact SKU + local group deletions are durable in unified history and the group delete action is visible in the subgroup header')
