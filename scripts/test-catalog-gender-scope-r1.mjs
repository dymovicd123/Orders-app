import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const migration = read('migrations/0068_v72_catalog_product_gender_scope.sql')
const catalog = read('worker/domains/catalog.ts')
const resolver = read('worker/domains/order-reservations.ts')
const workspace = read('src/app/controllers/useWorkspaceViewModel.tsx')
const operational = read('src/app/controllers/useOperationalViewModel.ts')
const exchange = read('src/features/sections/OrderExchangeSection.tsx')
const panel = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')
const app = read('src/App.tsx')

check(migration.includes("ADD COLUMN gender_scope TEXT NOT NULL DEFAULT 'unisex'"), '0068 must add product gender_scope')
check(migration.includes("'ЕҢЛІК ШАПАН'"), '0068 must carry the approved female Enlik rule')
check(migration.includes("TRIM(COALESCE(v.gender,''))=''"), '0068 must repair blank-gender variants')
check(!migration.includes("AND UPPER(TRIM(COALESCE(v.gender,''))) <> CASE p.gender_scope"), '0068 must preserve explicit opposite-gender variants')
check(migration.includes('catalog_gender_stock_baseline'), '0068 must preserve retry-safe stock merge evidence')
check(migration.includes("p.gender_scope='unisex' AND TRIM(COALESCE(v.gender,''))=''"), '0068 must identify unused unisex blank placeholders')

check(catalog.includes("export type CatalogProductGenderScope = 'female' | 'male' | 'unisex'"), 'Worker product scope type missing')
check(catalog.includes("Для товара «Унисекс» выберите пол конкретной вещи"), 'Worker must require concrete gender for unisex combinations')
check(catalog.includes('genderScope: normalizeCatalogProductGenderScope(row.gender_scope)'), 'Catalog read must expose product scope')
check(catalog.includes('gender_scope, is_active'), 'Catalog create/update must persist product scope')
check(resolver.includes('const enteredGender = normalizeCatalogCombinationGender(item.gender)'), 'Order resolver must respect an explicit human gender')
check(resolver.includes('if (!gender) {'), 'Order resolver must branch before reading product scope')
check(resolver.includes('const productGenderScope = await getCatalogProductGenderScope(db, product.id)'), 'Order resolver must use product scope only as fallback data')
check(workspace.includes("const automaticGender = productGenderScope === 'female' ? 'ЖЕН' : productGenderScope === 'male' ? 'МУЖ' : ''"), 'Order forms must auto-fill fixed scope and leave unisex blank')
check(workspace.includes("if (productGenderScope === 'unisex' && !normalizedGender) unknownFacts.push('пол')"), 'Availability must ask for unisex gender')
check(operational.includes("gender: automaticGender"), 'Arrival product pick must use product scope')
check(exchange.includes('Выберите для унисекс'), 'Exchange gender must be a controlled choice')
check(panel.includes('Назначение по полу'), 'Catalog product form must expose scope selector')
check(!panel.includes('disabled={Boolean(fixedGenderForProduct(selectedProduct))}'), 'Product default must not lock the concrete gender field')
check(panel.includes('можно изменить'), 'Catalog UI must explain that automatic gender remains editable')
check(app.includes('genderScope: catalogProductDraft.genderScope'), 'Catalog save payload must send scope')

console.log('Catalog Gender Scope R1 semantic/static acceptance passed.')
