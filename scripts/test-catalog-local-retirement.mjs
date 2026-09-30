import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const retirement = read('worker/domains/catalog-retirement.ts')
const catalog = read('worker/domains/catalog.ts')
const worker = read('worker/index.ts')
const ui = read('src/features/inventory/views/catalogPolishExecutionGroups.tsx')
const action = read('src/features/inventory/views/CatalogVariantGroupRetirementAction.tsx')

const previewStart = retirement.indexOf('export async function previewCatalogVariantGroupRetirement')
const retireStart = retirement.indexOf('export async function retireCatalogVariantGroup')
const nextSection = retirement.indexOf('export type CatalogRetirementPreview', retireStart)
check(previewStart >= 0 && retireStart > previewStart && nextSection > retireStart, 'local group retirement functions are missing')
const previewBody = retirement.slice(previewStart, retireStart)
const retireBody = retirement.slice(retireStart, nextSection)

check(retirement.includes("${alias}.stock_position_id = ?"), 'local group scope is not bound to one execution')
check(retirement.includes("COALESCE(${alias}.category, 'adult') = ?"), 'local group scope is not bound to audience category')
check(retirement.includes("END = ?") && retirement.includes("normalizeCatalogCombinationGender"), 'local group scope is not bound to gender')
check(retirement.includes("normalizeCatalogCombinationColor"), 'local group scope is not bound to color')
check(!retirement.includes("if (!gender) throw new Error('Не удалось однозначно определить пол группы.')"), 'legacy blank-gender subgroup cannot be locally retired')
check(previewBody.includes('inventory_stock') && previewBody.includes('reserved_quantity'), 'local preview does not inspect Physical/Reserved')
check(previewBody.includes("inventory_reservations") && previewBody.includes("r.status='active'"), 'local preview does not inspect active reservations')
check(previewBody.includes('order_items') && previewBody.includes("shipping_status"), 'local preview does not block active unsent orders')
check(previewBody.includes('workshop_tasks') && previewBody.includes("wt.status = 'active'"), 'local preview does not block active Workshop work')
check(!previewBody.includes("'active','ready'"), 'ready Workshop task must not block local retirement')
check(previewBody.includes('inventory_lifecycle_events') && previewBody.includes("status='pending'"), 'local preview does not block pending lifecycle')
check(previewBody.includes('inventory_stocktake_sessions') && previewBody.includes("s.status='active'"), 'local preview does not block active stocktake')

check(retireBody.includes('WITH target_variants AS'), 'local retirement is not one scoped guarded mutation')
check(retireBody.includes('UPDATE catalog_variants') && retireBody.includes('SET is_active = 0'), 'local retirement does not soft-retire variants')
for (const forbidden of [
  'UPDATE inventory_stock',
  'UPDATE inventory_reservations',
  'UPDATE order_items',
  'UPDATE workshop_tasks',
  'UPDATE catalog_stock_positions',
  'UPDATE catalog_products',
]) {
  check(!retireBody.includes(forbidden), `local retirement must not rewrite operational/history rows: ${forbidden}`)
}
check((retireBody.match(/AND NOT EXISTS/g) || []).length >= 6, 'local retirement lacks atomic blocker rechecks')
check(retireBody.includes('changed !== preview.activeVariantCount'), 'local retirement does not detect stale/concurrent partial outcome')

const inactiveGuard = catalog.indexOf("Эта позиция уже выведена из рабочего каталога и является исторической")
const executionEnsure = catalog.indexOf('const execution = await ensureCatalogExecutionV3', catalog.indexOf('export async function updateCatalogVariant'))
check(inactiveGuard >= 0 && inactiveGuard < executionEnsure, 'ordinary PATCH can still mutate/recreate an inactive historical SKU')

check(worker.includes('/variant-groups\\/retirement-preview'), 'admin local retirement preview route is missing')
check(worker.includes('/variant-groups\\/retire'), 'admin local retirement mutation route is missing')
check(worker.includes('requireAdminAccess(request)'), 'Catalog local retirement is not admin-gated')
check(worker.includes("eventType: 'catalog_variant_group_retired'"), 'local retirement lacks best-effort activity evidence')

check(ui.includes("CatalogVariantGroupRetirementAction"), 'Catalog subgroup does not expose local retirement control')
check(ui.includes('executionId={groupStockPositionId}'), 'UI local retirement is not scoped to the current execution')
check(ui.includes('category={subgroup.category}') && ui.includes('gender={subgroup.genderValue}') && ui.includes('color={colorGroup.value}'), 'UI local retirement does not send raw subgroup identity')
check(ui.includes('genderLabel={subgroup.gender}') && ui.includes('colorLabel={colorGroup.label}'), 'UI local retirement does not keep human labels separate from raw identity')
check(action.includes('Удалить только эту группу?'), 'local retirement confirmation does not explain its narrow scope')
check(action.includes('Другие цвета, пол и исполнения не изменятся'), 'local retirement copy does not promise locality')
check(action.includes('disabled={deleting || blockers.length > 0}'), 'UI can confirm a locally blocked retirement')

console.log('CATALOG LOCAL RETIREMENT PASSED — exact execution/category/gender/color group retirement is strict, blocker-guarded, history-preserving, and inactive SKU PATCH is immutable')
