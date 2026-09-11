import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const write = (file, content) => fs.writeFileSync(path.join(root, file), content)

function replaceOnce(file, oldText, newText, label) {
  const source = read(file)
  const count = source.split(oldText).length - 1
  if (count !== 1) throw new Error(`${label}: expected 1 anchor, got ${count}`)
  write(file, source.replace(oldText, newText))
}

replaceOnce(
  'worker/domains/catalog.ts',
  `export async function resolveCatalogGenderForProduct(db: D1Database, productId: number, value: unknown) {
  const scope = await getCatalogProductGenderScope(db, productId);
  const explicitGender = normalizeCatalogCombinationGender(value);
  if (explicitGender === 'ЖЕН' || explicitGender === 'МУЖ') return { scope, gender: explicitGender };
  const fixed = catalogGenderForProductScope(scope);
  if (fixed) return { scope, gender: fixed };
  const gender = explicitGender;
  if (gender !== 'ЖЕН' && gender !== 'МУЖ') {
    throw new Error('Для товара «Унисекс» выберите пол конкретной вещи: ЖЕН или МУЖ.');
  }
  return { scope, gender };
}`,
  `export async function resolveCatalogGenderForProduct(db: D1Database, productId: number, value: unknown) {
  const explicitGender = normalizeCatalogCombinationGender(value);
  // A concrete human choice is authoritative and does not need another D1 read.
  if (explicitGender === 'ЖЕН' || explicitGender === 'МУЖ') return { scope: null, gender: explicitGender };
  const scope = await getCatalogProductGenderScope(db, productId);
  const fixed = catalogGenderForProductScope(scope);
  if (fixed) return { scope, gender: fixed };
  throw new Error('Для товара «Унисекс» выберите пол конкретной вещи: ЖЕН или МУЖ.');
}`,
  'explicit gender read shortcut',
)

replaceOnce(
  'worker/domains/catalog-review.ts',
  `const created = await createCatalogProduct(db, { name: requestedProductName, category });`,
  `const created = await createCatalogProduct(db, { name: requestedProductName, category, genderScope: requestedGenderScope });`,
  'catalog review new-product scope',
)

replaceOnce(
  'src/app/controllers/useWorkspaceViewModel.tsx',
  `if (leftCategory !== rightCategory) return leftCategory - rightCategory
      if (left.frequency !== right.frequency) return right.frequency - left.frequency`,
  `if (leftCategory !== rightCategory) return leftCategory - rightCategory
      if (automaticGender) {
        const leftGender = canonicalOrderGender(left.variants[0]?.gender) === automaticGender ? 0 : 1
        const rightGender = canonicalOrderGender(right.variants[0]?.gender) === automaticGender ? 0 : 1
        if (leftGender !== rightGender) return leftGender - rightGender
      }
      if (left.frequency !== right.frequency) return right.frequency - left.frequency`,
  'workspace default-gender group preference',
)

replaceOnce(
  'src/app/controllers/useWorkspaceViewModel.tsx',
  `gender: automaticGender,
      color: selected.color || '',`,
  `// Product gender is only a default. If the chosen existing SKU carries an
      // explicit opposite gender, keep that concrete catalog fact instead of fabricating
      // a default-gender SKU with the selected color/size/material.
      gender: automaticGender ? (selected.gender || automaticGender) : '',
      color: selected.color || '',`,
  'workspace selected variant gender',
)

replaceOnce(
  'src/app/controllers/useOperationalViewModel.ts',
  `const variants = catalogVariantsByProductId.get(Number(match.id)) || []
    const first = variants.find((variant) => variant.isActive) || null
    const productGenderScope = String(match.genderScope || 'unisex')
    const automaticGender = productGenderScope === 'female' ? 'ЖЕН' : productGenderScope === 'male' ? 'МУЖ' : ''`,
  `const variants = catalogVariantsByProductId.get(Number(match.id)) || []
    const productGenderScope = String(match.genderScope || 'unisex')
    const automaticGender = productGenderScope === 'female' ? 'ЖЕН' : productGenderScope === 'male' ? 'МУЖ' : ''
    const activeVariants = variants.filter((variant) => variant.isActive)
    const first = (automaticGender
      ? activeVariants.find((variant) => normalizeSuggestion(variant.gender) === automaticGender)
      : null) || activeVariants[0] || null`,
  'arrival default-gender variant preference',
)

replaceOnce(
  'src/features/inventory/views/renderInventoryCatalogPanel.tsx',
  `setCatalogProductDraft({ id: product.id, name: product.name, category: getCatalogProductEffectiveCategory(product) })
    setCatalogVariantDraft({`,
  `setCatalogProductDraft({ id: product.id, name: product.name, category: getCatalogProductEffectiveCategory(product), genderScope: productGenderScope(product) })
    setCatalogVariantDraft({`,
  'variant editor complete product draft',
)

{
  const file = 'migrations/0068_v72_catalog_product_gender_scope.sql'
  let source = read(file)
  const mapStart = source.indexOf('CREATE TEMP TABLE _step0068_gender_map AS')
  const start = source.indexOf('  COALESCE((\n    SELECT target.id\n    FROM catalog_variants target', mapStart)
  const endMarker = '  ), v.id) AS keeper_id'
  const end = source.indexOf(endMarker, start)
  if (mapStart < 0 || start < 0 || end < 0) throw new Error('migration deterministic keeper anchors missing')
  const oldBlock = source.slice(start, end + endMarker.length)
  const newBlock = `  COALESCE((
    SELECT target.id
    FROM catalog_variants target
    WHERE target.product_id=v.product_id
      AND COALESCE(target.stock_position_id,-1)=COALESCE(v.stock_position_id,-1)
      AND COALESCE(target.category,'adult')=COALESCE(v.category,'adult')
      AND UPPER(TRIM(COALESCE(target.color,'')))=UPPER(TRIM(COALESCE(v.color,'')))
      AND TRIM(COALESCE(target.size_label,''))=TRIM(COALESCE(v.size_label,''))
      AND target.is_active=1
      AND (
        UPPER(TRIM(COALESCE(target.gender,'')))=CASE p.gender_scope WHEN 'female' THEN 'ЖЕН' ELSE 'МУЖ' END
        OR TRIM(COALESCE(target.gender,''))=''
      )
    ORDER BY
      CASE WHEN UPPER(TRIM(COALESCE(target.gender,'')))=CASE p.gender_scope WHEN 'female' THEN 'ЖЕН' ELSE 'МУЖ' END THEN 0 ELSE 1 END,
      target.id ASC
    LIMIT 1
  ), v.id) AS keeper_id`
  source = source.slice(0, start) + newBlock + source.slice(end + endMarker.length)
  write(file, source)
}

{
  const file = 'scripts/test-catalog-gender-scope-r1.mjs'
  let source = read(file)
  const marker = `console.log('Catalog Gender Scope R1 semantic/static acceptance passed.')`
  if (!source.includes(marker)) throw new Error('catalog gender static test marker missing')
  const extra = `
const genderResolverStart = catalog.indexOf('export async function resolveCatalogGenderForProduct')
const explicitGenderIndex = catalog.indexOf('const explicitGender = normalizeCatalogCombinationGender(value)', genderResolverStart)
const scopeReadIndex = catalog.indexOf('const scope = await getCatalogProductGenderScope(db, productId)', genderResolverStart)
check(genderResolverStart >= 0 && explicitGenderIndex > genderResolverStart && scopeReadIndex > explicitGenderIndex, 'Explicit human gender must be checked before the product-scope D1 read')
check(catalog.includes("return { scope: null, gender: explicitGender }"), 'Explicit human gender must bypass the product default')
check(workspace.includes("gender: automaticGender ? (selected.gender || automaticGender) : ''"), 'Order autocomplete must preserve a concrete opposite-gender SKU')
check(workspace.includes('if (automaticGender) {'), 'Order autocomplete must prefer the product default when choosing among existing groups')
check(operational.includes('activeVariants.find((variant) => normalizeSuggestion(variant.gender) === automaticGender)'), 'Arrival must prefer a variant matching the product gender default')
check(migration.includes('COALESCE(target.stock_position_id,-1)=COALESCE(v.stock_position_id,-1)'), '0068 keeper matching must be NULL-safe')
check(migration.includes("OR TRIM(COALESCE(target.gender,''))=''"), '0068 must deterministically consolidate duplicate blank fixed-scope variants')
const review = read('worker/domains/catalog-review.ts')
check(review.includes('createCatalogProduct(db, { name: requestedProductName, category, genderScope: requestedGenderScope })'), 'Catalog review new-product path must persist gender scope')
`
  source = source.replace(marker, extra + '\n' + marker)
  write(file, source)
}

write('scripts/test-catalog-gender-migration-r1.mjs', `import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = process.cwd()
const migrationSql = fs.readFileSync(path.join(root, 'migrations/0068_v72_catalog_product_gender_scope.sql'), 'utf8')
const db = new DatabaseSync(':memory:')
const one = (sql, ...params) => db.prepare(sql).get(...params)

db.exec(\`
  PRAGMA foreign_keys = ON;
  CREATE TABLE catalog_products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'adult', is_active INTEGER NOT NULL DEFAULT 1, updated_at TEXT);
  CREATE TABLE catalog_stock_positions (id INTEGER PRIMARY KEY, product_id INTEGER, material TEXT, length TEXT, is_active INTEGER DEFAULT 1);
  CREATE TABLE catalog_variants (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, stock_position_id INTEGER, category TEXT, gender TEXT, color TEXT, material TEXT, length TEXT, size_label TEXT, is_active INTEGER NOT NULL DEFAULT 1, updated_at TEXT);
  CREATE TABLE inventory_stock (id INTEGER PRIMARY KEY, inventory_source TEXT NOT NULL, product_id INTEGER, variant_id INTEGER, product_name_snapshot TEXT, gender_snapshot TEXT, color_snapshot TEXT, material_snapshot TEXT, length_snapshot TEXT, size_snapshot TEXT, quantity INTEGER DEFAULT 0, reserved_quantity INTEGER DEFAULT 0, updated_at TEXT);
  CREATE UNIQUE INDEX idx_inventory_stock_variant_unique ON inventory_stock(inventory_source, variant_id) WHERE variant_id IS NOT NULL;
  CREATE TABLE order_items (id INTEGER PRIMARY KEY, variant_id INTEGER, gender_snapshot TEXT);
  CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY, variant_id INTEGER, gender_snapshot TEXT);
  CREATE TABLE workshop_tasks (id INTEGER PRIMARY KEY, variant_id INTEGER);
  CREATE TABLE inventory_reservations (id INTEGER PRIMARY KEY, variant_id INTEGER);
  CREATE TABLE catalog_input_aliases (id INTEGER PRIMARY KEY, variant_id INTEGER);
  CREATE TABLE inventory_lifecycle_events (id INTEGER PRIMARY KEY, variant_id INTEGER);
  CREATE TABLE inventory_transfer_items (id INTEGER PRIMARY KEY, variant_id INTEGER);
  CREATE TABLE inventory_stock_checks (id INTEGER PRIMARY KEY, variant_id INTEGER);
  CREATE TABLE inventory_stocktake_items (id INTEGER PRIMARY KEY, variant_id INTEGER);

  INSERT INTO catalog_products(id,name,category,is_active) VALUES
    (1,'ЕҢЛІК ШАПАН','adult',1),(2,'БЕЛГІСІЗ УНИСЕКС','adult',1),(3,'ҚОЗЫ КӨРПЕШ ШАПАН','adult',1),(4,'БАЯН СҰЛУ ШАПАН','adult',1);
  INSERT INTO catalog_stock_positions(id,product_id,material,length) VALUES
    (11,1,'СТАНДАРТ','СТАНДАРТ'),(21,2,'СТАНДАРТ','СТАНДАРТ'),(31,3,'СТАНДАРТ','СТАНДАРТ');
  INSERT INTO catalog_variants(id,product_id,stock_position_id,category,gender,color,material,length,size_label,is_active) VALUES
    (101,1,11,'adult','','ҚЫЗЫЛ','СТАНДАРТ','СТАНДАРТ','46',1),(102,1,11,'adult','ЖЕН','ҚЫЗЫЛ','СТАНДАРТ','СТАНДАРТ','46',1),(103,1,11,'adult','МУЖ','КӨК','СТАНДАРТ','СТАНДАРТ','48',1),
    (201,2,21,'adult','','АҚ','СТАНДАРТ','СТАНДАРТ','46',1),(202,2,21,'adult','','ҚАРА','СТАНДАРТ','СТАНДАРТ','48',1),
    (301,3,31,'adult','','ҚАРА','СТАНДАРТ','СТАНДАРТ','50',1),(302,3,31,'adult','','ҚАРА','СТАНДАРТ','СТАНДАРТ','50',1),
    (401,4,NULL,'adult','','АЛТЫН','СТАНДАРТ','СТАНДАРТ','44',1),(402,4,NULL,'adult','','АЛТЫН','СТАНДАРТ','СТАНДАРТ','44',1);
  INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES
    (1,'warehouse',1,101,'ЕҢЛІК ШАПАН','','ҚЫЗЫЛ','СТАНДАРТ','СТАНДАРТ','46',3,1),(2,'warehouse',1,102,'ЕҢЛІК ШАПАН','ЖЕН','ҚЫЗЫЛ','СТАНДАРТ','СТАНДАРТ','46',5,2),(3,'warehouse',1,103,'ЕҢЛІК ШАПАН','МУЖ','КӨК','СТАНДАРТ','СТАНДАРТ','48',7,0),(4,'warehouse',2,202,'БЕЛГІСІЗ УНИСЕКС','','ҚАРА','СТАНДАРТ','СТАНДАРТ','48',2,0),(5,'warehouse',3,301,'ҚОЗЫ КӨРПЕШ ШАПАН','','ҚАРА','СТАНДАРТ','СТАНДАРТ','50',2,0),(6,'warehouse',3,302,'ҚОЗЫ КӨРПЕШ ШАПАН','','ҚАРА','СТАНДАРТ','СТАНДАРТ','50',4,1),(7,'boutique',4,401,'БАЯН СҰЛУ ШАПАН','','АЛТЫН','СТАНДАРТ','СТАНДАРТ','44',1,0),(8,'boutique',4,402,'БАЯН СҰЛУ ШАПАН','','АЛТЫН','СТАНДАРТ','СТАНДАРТ','44',2,0);
  INSERT INTO order_items(id,variant_id,gender_snapshot) VALUES (1,101,''),(2,103,'МУЖ'),(3,202,'');
  INSERT INTO inventory_movements(id,variant_id,gender_snapshot) VALUES (1,101,''),(2,103,'МУЖ');
  INSERT INTO workshop_tasks(id,variant_id) VALUES (1,101);
  INSERT INTO inventory_reservations(id,variant_id) VALUES (1,101);
  INSERT INTO catalog_input_aliases(id,variant_id) VALUES (1,101);
  INSERT INTO inventory_lifecycle_events(id,variant_id) VALUES (1,101);
  INSERT INTO inventory_transfer_items(id,variant_id) VALUES (1,101);
  INSERT INTO inventory_stock_checks(id,variant_id) VALUES (1,101);
  INSERT INTO inventory_stocktake_items(id,variant_id) VALUES (1,101);
\`)

db.exec(migrationSql)
const scope = (id) => one('SELECT gender_scope FROM catalog_products WHERE id=?', id).gender_scope
const variant = (id) => one('SELECT gender,is_active FROM catalog_variants WHERE id=?', id)
if (scope(1) !== 'female' || scope(2) !== 'unisex' || scope(3) !== 'male' || scope(4) !== 'female') throw new Error('product gender-scope assignment failed')
if (variant(103).gender !== 'МУЖ' || variant(103).is_active !== 1) throw new Error('explicit opposite-gender override was damaged')
if (variant(301).gender !== 'МУЖ' || variant(301).is_active !== 1 || variant(302).is_active !== 0) throw new Error('duplicate blank male variants were not consolidated')
if (variant(401).gender !== 'ЖЕН' || variant(401).is_active !== 1 || variant(402).is_active !== 0) throw new Error('NULL stock-position blank variants were not consolidated')
if (variant(101).is_active !== 0 || variant(102).gender !== 'ЖЕН') throw new Error('blank female duplicate was not merged')
const enlik = one("SELECT quantity,reserved_quantity,gender_snapshot FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=102")
if (enlik.quantity !== 8 || enlik.reserved_quantity !== 3 || enlik.gender_snapshot !== 'ЖЕН') throw new Error('Enlik stock merge lost truth')
if (one("SELECT quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=103").quantity !== 7) throw new Error('opposite-gender stock changed')
const maleMerge = one("SELECT quantity,reserved_quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=301")
if (maleMerge.quantity !== 6 || maleMerge.reserved_quantity !== 1) throw new Error('blank-to-blank stock merge failed')
if (one("SELECT quantity FROM inventory_stock WHERE inventory_source='boutique' AND variant_id=401").quantity !== 3) throw new Error('NULL-position stock merge failed')
const order = one('SELECT variant_id,gender_snapshot FROM order_items WHERE id=1')
const movement = one('SELECT variant_id,gender_snapshot FROM inventory_movements WHERE id=1')
if (order.variant_id !== 102 || order.gender_snapshot !== '' || movement.variant_id !== 102 || movement.gender_snapshot !== '') throw new Error('historical snapshot invariant failed')
for (const table of ['workshop_tasks','inventory_reservations','catalog_input_aliases','inventory_lifecycle_events','inventory_transfer_items','inventory_stock_checks','inventory_stocktake_items']) {
  if (one(\`SELECT variant_id FROM \${table} WHERE id=1\`).variant_id !== 102) throw new Error(\`\${table} repoint failed\`)
}
if (variant(201).is_active !== 0 || variant(202).is_active !== 1) throw new Error('ambiguous unisex placeholder handling failed')
const repair = one('SELECT repair_mode,keeper_variant_id FROM catalog_gender_variant_repairs WHERE old_variant_id=101')
if (repair.repair_mode !== 'merge' || repair.keeper_variant_id !== 102) throw new Error('repair audit row missing')
console.log('Catalog Gender Migration R1 behavioral acceptance passed.')
`)

replaceOnce(
  'package.json',
  ` && node scripts/test-catalog-gender-scope-r1.mjs",`,
  ` && node scripts/test-catalog-gender-scope-r1.mjs && node scripts/test-catalog-gender-migration-r1.mjs",`,
  'release check migration test',
)

console.log('Catalog gender hardening R2 patch generated.')
