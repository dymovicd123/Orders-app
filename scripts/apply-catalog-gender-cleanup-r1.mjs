import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function write(rel, value) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), value)
}

function replaceOnce(rel, before, after) {
  const source = read(rel)
  if (source.includes(after)) return
  const index = source.indexOf(before)
  if (index < 0) throw new Error(`Anchor not found in ${rel}: ${before.slice(0, 120)}`)
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`Anchor is not unique in ${rel}: ${before.slice(0, 120)}`)
  write(rel, source.slice(0, index) + after + source.slice(index + before.length))
}

function replaceRegexOnce(rel, regex, replacement, alreadyPattern = null) {
  const source = read(rel)
  if (alreadyPattern && alreadyPattern.test(source)) return
  const matches = [...source.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`))]
  if (matches.length !== 1) throw new Error(`Expected one regex match in ${rel}, got ${matches.length}: ${regex}`)
  write(rel, source.replace(regex, replacement))
}

const migration = `PRAGMA foreign_keys = ON;

-- Step 0068 / Catalog Gender Scope R1
-- Product-level gender is authoritative:
--   female -> transaction forms auto-use ЖЕН
--   male   -> transaction forms auto-use МУЖ
--   unisex -> a human chooses ЖЕН or МУЖ for the concrete SKU/order line
-- Historical snapshots are intentionally preserved. Only canonical catalog links/current stock are repaired.

ALTER TABLE catalog_products
  ADD COLUMN gender_scope TEXT NOT NULL DEFAULT 'unisex'
  CHECK (gender_scope IN ('female','male','unisex'));

CREATE TABLE IF NOT EXISTS catalog_gender_scope_repairs (
  product_id INTEGER PRIMARY KEY,
  product_name TEXT NOT NULL,
  previous_scope TEXT NOT NULL,
  assigned_scope TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  repaired_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_gender_variant_repairs (
  old_variant_id INTEGER PRIMARY KEY,
  keeper_variant_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  target_gender TEXT NOT NULL,
  repair_mode TEXT NOT NULL CHECK (repair_mode IN ('in_place','merge','retire_unused_unisex_blank')),
  repaired_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_gender_stock_baseline (
  stock_id INTEGER PRIMARY KEY,
  inventory_source TEXT NOT NULL,
  variant_id INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL,
  reserved_before INTEGER NOT NULL,
  captured_at TEXT NOT NULL
);

-- Capture the default before changing it so the cleanup is auditable.
INSERT OR IGNORE INTO catalog_gender_scope_repairs(product_id, product_name, previous_scope, assigned_scope, rule_key, repaired_at)
SELECT id, name, gender_scope, gender_scope, 'baseline', CURRENT_TIMESTAMP
FROM catalog_products;

-- Client-approved one-gender models from the historical strict catalog rules.
UPDATE catalog_products SET gender_scope = 'female', updated_at = CURRENT_TIMESTAMP
WHERE UPPER(TRIM(name)) IN (
  'БАЯН СҰЛУ ШАПАН','БАЯН СУЛУ ШАПАН','ЕҢЛІК ШАПАН','ЕНЛІК ШАПАН','СӘУКЕЛЕ ШАПАН','САУКЕЛЕ ШАПАН','АЙДАР ШАПАН',
  'БАЯН СҰЛУ ЖИЛЕТ','БАЯН СУЛУ ЖИЛЕТ','ТҰМАР ЖИЛЕТ','ТУМАР ЖИЛЕТ','АЙДАЙ ЖИЛЕТ','ЗЕЙНЕ ЖИЛЕТ','ҚОРЛАН ЖИЛЕТ','КОРЛАН ЖИЛЕТ',
  'АЙНҰРЫМ-АЙ КӨЙЛЕК','АЙНУРЫМ-АЙ КОЙЛЕК','БИКЕШ КӨЙЛЕК','БИКЕШ КОЙЛЕК','КЕРБЕЗ КӨЙЛЕК','КЕРБЕЗ КОЙЛЕК','АРУ КӨЙЛЕК','АРУ КОЙЛЕК',
  'НӘЗІК КӨЙЛЕК','НАЗІК КОЙЛЕК','НӘЗІК КОРСЕТ','НАЗІК КОРСЕТ','АҚ НӘЗІК КОРСЕТ','АК НАЗІК КОРСЕТ','КӨРКЕМ КОРСЕТ','КОРКЕМ КОРСЕТ',
  'ТҰМАР КОРСЕТ','ТУМАР КОРСЕТ','НАЗ КОРСЕТ','ВОРОТНИК','ОРАМАЛ АТЛАС','ОРАМАЛ ҚҰДАҒИ','ОРАМАЛ КУДАГИ',
  'ШЕКЕЛІК АЙНҰРЫМ-АЙ','ШЕКЕЛІК АЙНУРЫМ-АЙ','КӨЙЛЕК','КОЙЛЕК'
);

UPDATE catalog_products SET gender_scope = 'male', updated_at = CURRENT_TIMESTAMP
WHERE UPPER(TRIM(name)) IN (
  'ҚОЗЫ КӨРПЕШ ШАПАН','КОЗЫ КОРПЕШ ШАПАН','КЕБЕК ШАПАН','АЙДАР БОМБЕР','ҚОЗЫ КӨРПЕШ ЖИЛЕТ','КОЗЫ КОРПЕШ ЖИЛЕТ'
);

UPDATE catalog_products SET gender_scope = 'unisex', updated_at = CURRENT_TIMESTAMP
WHERE UPPER(TRIM(name)) IN (
  'ДАРА ШАПАН','САРДАР ШАПАН','ҚАЗЫНА ШАПАН','КАЗЫНА ШАПАН','АЛАН БОМБЕР','СӘУЛЕТ ЖИЛЕТ','САУЛЕТ ЖИЛЕТ','БАЙСАЛ ЖИЛЕТ','БАСҚА','БАСКА'
);

-- For models not covered by the approved list, infer only when the active catalog is unanimous.
-- Mixed/blank-only models stay unisex rather than being guessed.
UPDATE catalog_products AS p
SET gender_scope = CASE
      WHEN EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='ЖЕН')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='МУЖ')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND TRIM(COALESCE(v.gender,''))='') THEN 'female'
      WHEN EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='МУЖ')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='ЖЕН')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND TRIM(COALESCE(v.gender,''))='') THEN 'male'
      ELSE 'unisex'
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE UPPER(TRIM(name)) NOT IN (
  'БАЯН СҰЛУ ШАПАН','БАЯН СУЛУ ШАПАН','ЕҢЛІК ШАПАН','ЕНЛІК ШАПАН','СӘУКЕЛЕ ШАПАН','САУКЕЛЕ ШАПАН','АЙДАР ШАПАН',
  'БАЯН СҰЛУ ЖИЛЕТ','БАЯН СУЛУ ЖИЛЕТ','ТҰМАР ЖИЛЕТ','ТУМАР ЖИЛЕТ','АЙДАЙ ЖИЛЕТ','ЗЕЙНЕ ЖИЛЕТ','ҚОРЛАН ЖИЛЕТ','КОРЛАН ЖИЛЕТ',
  'АЙНҰРЫМ-АЙ КӨЙЛЕК','АЙНУРЫМ-АЙ КОЙЛЕК','БИКЕШ КӨЙЛЕК','БИКЕШ КОЙЛЕК','КЕРБЕЗ КӨЙЛЕК','КЕРБЕЗ КОЙЛЕК','АРУ КӨЙЛЕК','АРУ КОЙЛЕК',
  'НӘЗІК КӨЙЛЕК','НАЗІК КОЙЛЕК','НӘЗІК КОРСЕТ','НАЗІК КОРСЕТ','АҚ НӘЗІК КОРСЕТ','АК НАЗІК КОРСЕТ','КӨРКЕМ КОРСЕТ','КОРКЕМ КОРСЕТ',
  'ТҰМАР КОРСЕТ','ТУМАР КОРСЕТ','НАЗ КОРСЕТ','ВОРОТНИК','ОРАМАЛ АТЛАС','ОРАМАЛ ҚҰДАҒИ','ОРАМАЛ КУДАГИ','ШЕКЕЛІК АЙНҰРЫМ-АЙ','ШЕКЕЛІК АЙНУРЫМ-АЙ','КӨЙЛЕК','КОЙЛЕК',
  'ҚОЗЫ КӨРПЕШ ШАПАН','КОЗЫ КОРПЕШ ШАПАН','КЕБЕК ШАПАН','АЙДАР БОМБЕР','ҚОЗЫ КӨРПЕШ ЖИЛЕТ','КОЗЫ КОРПЕШ ЖИЛЕТ',
  'ДАРА ШАПАН','САРДАР ШАПАН','ҚАЗЫНА ШАПАН','КАЗЫНА ШАПАН','АЛАН БОМБЕР','СӘУЛЕТ ЖИЛЕТ','САУЛЕТ ЖИЛЕТ','БАЙСАЛ ЖИЛЕТ','БАСҚА','БАСКА'
);

UPDATE catalog_gender_scope_repairs
SET assigned_scope=(SELECT p.gender_scope FROM catalog_products p WHERE p.id=catalog_gender_scope_repairs.product_id),
    rule_key=CASE
      WHEN (SELECT p.gender_scope FROM catalog_products p WHERE p.id=catalog_gender_scope_repairs.product_id)='female' THEN 'approved_or_unanimous_female'
      WHEN (SELECT p.gender_scope FROM catalog_products p WHERE p.id=catalog_gender_scope_repairs.product_id)='male' THEN 'approved_or_unanimous_male'
      ELSE 'approved_or_conservative_unisex'
    END,
    repaired_at=CURRENT_TIMESTAMP;

-- Build a deterministic map for wrong/blank variants of fixed-scope products.
DROP TABLE IF EXISTS _step0068_gender_map;
CREATE TEMP TABLE _step0068_gender_map AS
SELECT
  v.id AS old_id,
  v.product_id,
  CASE p.gender_scope WHEN 'female' THEN 'ЖЕН' ELSE 'МУЖ' END AS target_gender,
  COALESCE((
    SELECT target.id
    FROM catalog_variants target
    WHERE target.product_id=v.product_id
      AND target.stock_position_id=v.stock_position_id
      AND COALESCE(target.category,'adult')=COALESCE(v.category,'adult')
      AND UPPER(TRIM(COALESCE(target.gender,'')))=CASE p.gender_scope WHEN 'female' THEN 'ЖЕН' ELSE 'МУЖ' END
      AND UPPER(TRIM(COALESCE(target.color,'')))=UPPER(TRIM(COALESCE(v.color,'')))
      AND TRIM(COALESCE(target.size_label,''))=TRIM(COALESCE(v.size_label,''))
      AND target.is_active=1
    ORDER BY target.id ASC LIMIT 1
  ), v.id) AS keeper_id
FROM catalog_variants v
JOIN catalog_products p ON p.id=v.product_id
WHERE v.is_active=1
  AND p.gender_scope IN ('female','male')
  AND UPPER(TRIM(COALESCE(v.gender,''))) <> CASE p.gender_scope WHEN 'female' THEN 'ЖЕН' ELSE 'МУЖ' END;

INSERT OR IGNORE INTO catalog_gender_variant_repairs(old_variant_id,keeper_variant_id,product_id,target_gender,repair_mode,repaired_at)
SELECT old_id,keeper_id,product_id,target_gender,CASE WHEN old_id=keeper_id THEN 'in_place' ELSE 'merge' END,CURRENT_TIMESTAMP
FROM _step0068_gender_map;

-- Capture every stock row participating in a merge, including an already-existing keeper row.
INSERT OR IGNORE INTO catalog_gender_stock_baseline(stock_id,inventory_source,variant_id,quantity_before,reserved_before,captured_at)
SELECT s.id,s.inventory_source,s.variant_id,COALESCE(s.quantity,0),COALESCE(s.reserved_quantity,0),CURRENT_TIMESTAMP
FROM inventory_stock s
WHERE s.variant_id IN (SELECT old_id FROM _step0068_gender_map UNION SELECT keeper_id FROM _step0068_gender_map);

DROP INDEX IF EXISTS idx_inventory_stock_variant_unique;

-- Canonical references. Historical textual snapshots are not rewritten.
UPDATE order_items SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=order_items.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);
UPDATE inventory_movements SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=inventory_movements.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);
UPDATE workshop_tasks SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=workshop_tasks.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);
UPDATE inventory_reservations SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=inventory_reservations.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);
UPDATE catalog_input_aliases SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=catalog_input_aliases.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);
UPDATE inventory_lifecycle_events SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=inventory_lifecycle_events.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);
UPDATE inventory_transfer_items SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=inventory_transfer_items.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);
UPDATE inventory_stock_checks SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=inventory_stock_checks.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);
UPDATE inventory_stocktake_items SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=inventory_stocktake_items.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);

-- Rebuild affected current stock from the immutable baseline so duplicate rows merge without double counting.
DROP TABLE IF EXISTS _step0068_stock_rollup;
CREATE TEMP TABLE _step0068_stock_rollup AS
SELECT
  MIN(b.stock_id) AS keeper_stock_id,
  b.inventory_source,
  COALESCE((SELECT m.keeper_id FROM _step0068_gender_map m WHERE m.old_id=b.variant_id), b.variant_id) AS variant_id,
  SUM(b.quantity_before) AS quantity,
  SUM(b.reserved_before) AS reserved_quantity
FROM catalog_gender_stock_baseline b
WHERE b.variant_id IN (SELECT old_id FROM _step0068_gender_map UNION SELECT keeper_id FROM _step0068_gender_map)
GROUP BY b.inventory_source, COALESCE((SELECT m.keeper_id FROM _step0068_gender_map m WHERE m.old_id=b.variant_id), b.variant_id);

UPDATE inventory_stock
SET variant_id=(SELECT r.variant_id FROM _step0068_stock_rollup r WHERE r.keeper_stock_id=inventory_stock.id),
    quantity=(SELECT r.quantity FROM _step0068_stock_rollup r WHERE r.keeper_stock_id=inventory_stock.id),
    reserved_quantity=(SELECT r.reserved_quantity FROM _step0068_stock_rollup r WHERE r.keeper_stock_id=inventory_stock.id),
    updated_at=CURRENT_TIMESTAMP
WHERE id IN (SELECT keeper_stock_id FROM _step0068_stock_rollup);

DELETE FROM inventory_stock
WHERE id IN (SELECT stock_id FROM catalog_gender_stock_baseline)
  AND id NOT IN (SELECT keeper_stock_id FROM _step0068_stock_rollup);

-- Correct the surviving fixed-scope variants and retire merged duplicates.
UPDATE catalog_variants
SET gender=(SELECT target_gender FROM _step0068_gender_map m WHERE m.old_id=catalog_variants.id),
    updated_at=CURRENT_TIMESTAMP
WHERE id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id=keeper_id);

UPDATE catalog_variants
SET is_active=0, updated_at=CURRENT_TIMESTAMP
WHERE id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);

-- Current stock snapshots follow the canonical variant. Historical order/movement snapshots stay untouched.
UPDATE inventory_stock
SET product_id=(SELECT v.product_id FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    product_name_snapshot=(SELECT p.name FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id WHERE v.id=inventory_stock.variant_id),
    gender_snapshot=(SELECT NULLIF(v.gender,'') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    color_snapshot=(SELECT NULLIF(v.color,'') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    material_snapshot=(SELECT NULLIF(v.material,'') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    length_snapshot=(SELECT NULLIF(v.length,'') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    size_snapshot=(SELECT NULLIF(v.size_label,'') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    updated_at=CURRENT_TIMESTAMP
WHERE variant_id IN (SELECT keeper_id FROM _step0068_gender_map);

-- Unisex rows with no gender and no operational footprint are pure placeholders: retire them.
-- Anything ambiguous that has stock/history remains visible for a human choice instead of being guessed.
INSERT OR IGNORE INTO catalog_gender_variant_repairs(old_variant_id,keeper_variant_id,product_id,target_gender,repair_mode,repaired_at)
SELECT v.id,v.id,v.product_id,'', 'retire_unused_unisex_blank',CURRENT_TIMESTAMP
FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id
WHERE v.is_active=1 AND p.gender_scope='unisex' AND TRIM(COALESCE(v.gender,''))=''
  AND NOT EXISTS(SELECT 1 FROM inventory_stock s WHERE s.variant_id=v.id AND (COALESCE(s.quantity,0)<>0 OR COALESCE(s.reserved_quantity,0)<>0))
  AND NOT EXISTS(SELECT 1 FROM order_items oi WHERE oi.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_movements im WHERE im.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM workshop_tasks wt WHERE wt.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_reservations ir WHERE ir.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_lifecycle_events le WHERE le.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_transfer_items ti WHERE ti.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_stock_checks sc WHERE sc.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_stocktake_items si WHERE si.variant_id=v.id);

UPDATE catalog_variants
SET is_active=0, updated_at=CURRENT_TIMESTAMP
WHERE id IN (SELECT old_variant_id FROM catalog_gender_variant_repairs WHERE repair_mode='retire_unused_unisex_blank');

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_stock_variant_unique
  ON inventory_stock(inventory_source,variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_catalog_products_gender_scope
  ON catalog_products(gender_scope,is_active,name);

DROP TABLE IF EXISTS _step0068_gender_map;
DROP TABLE IF EXISTS _step0068_stock_rollup;
`;
write('migrations/0068_v72_catalog_product_gender_scope.sql', migration)

// shared API contracts
replaceOnce('shared/api-contracts.ts',
  "export type AudienceCategory = 'adult' | 'child'\nexport type PaymentKind = 'primary' | 'debt_close' | 'extra'",
  "export type AudienceCategory = 'adult' | 'child'\nexport type CatalogGenderScope = 'female' | 'male' | 'unisex'\nexport type PaymentKind = 'primary' | 'debt_close' | 'extra'",
)
replaceOnce('shared/api-contracts.ts',
  "export type CatalogResolutionFacts = {\n  productId?: number\n  material: string",
  "export type CatalogResolutionFacts = {\n  productId?: number\n  genderScope?: CatalogGenderScope | ''\n  material: string",
)
replaceOnce('shared/api-contracts.ts',
  "export type CatalogResolutionProduct = {\n  id: number\n  name: string\n  category?: string\n}",
  "export type CatalogResolutionProduct = {\n  id: number\n  name: string\n  category?: string\n  genderScope?: CatalogGenderScope\n}",
)

// frontend API types
replaceOnce('src/app/types.ts',
  "export type CatalogProductRecord = {\n  id: number\n  name: string\n  category: string",
  "export type CatalogGenderScope = 'female' | 'male' | 'unisex'\n\nexport type CatalogProductRecord = {\n  id: number\n  name: string\n  category: string\n  genderScope: CatalogGenderScope",
)

// App state and product save payload
replaceOnce('src/App.tsx',
  "  const [catalogProductDraft, setCatalogProductDraft] = useState({\n    id: 0,\n    name: '',\n    category: 'adult' as 'adult' | 'child',\n  })",
  "  const [catalogProductDraft, setCatalogProductDraft] = useState({\n    id: 0,\n    name: '',\n    category: 'adult' as 'adult' | 'child',\n    genderScope: '' as '' | 'female' | 'male' | 'unisex',\n  })",
)
replaceOnce('src/App.tsx',
  "    const payload = {\n      name: catalogProductDraft.name,\n      category: catalogProductDraft.category,\n    }",
  "    const payload = {\n      name: catalogProductDraft.name,\n      category: catalogProductDraft.category,\n      genderScope: catalogProductDraft.genderScope,\n    }",
)

// backend catalog product scope model + enforcement
replaceOnce('worker/domains/catalog.ts',
  "export function normalizeCatalogCombinationGender(value: unknown) {\n  const text = upperText(value);\n  if (!text) return '';\n  if (text.includes('ЖЕН')) return 'ЖЕН';\n  if (text.includes('МУЖ')) return 'МУЖ';\n  return text;\n}\n",
  `export type CatalogProductGenderScope = 'female' | 'male' | 'unisex';\n\nexport function normalizeCatalogProductGenderScope(value: unknown): CatalogProductGenderScope {\n  const text = cleanText(value).toLowerCase();\n  if (['female', 'жен', 'женский', 'ж'].includes(text)) return 'female';\n  if (['male', 'муж', 'мужской', 'м'].includes(text)) return 'male';\n  return 'unisex';\n}\n\nexport function catalogGenderForProductScope(scope: CatalogProductGenderScope) {\n  return scope === 'female' ? 'ЖЕН' : scope === 'male' ? 'МУЖ' : '';\n}\n\nexport async function isCatalogProductGenderScopeEnabled(db: D1Database) {\n  try {\n    await db.prepare('SELECT gender_scope FROM catalog_products LIMIT 1').first();\n    return true;\n  } catch {\n    return false;\n  }\n}\n\nexport async function getCatalogProductGenderScope(db: D1Database, productId: number): Promise<CatalogProductGenderScope> {\n  if (!productId) return 'unisex';\n  if (await isCatalogProductGenderScopeEnabled(db)) {\n    const row = await db.prepare('SELECT gender_scope FROM catalog_products WHERE id = ? LIMIT 1').bind(productId).first<{ gender_scope: string }>();\n    return normalizeCatalogProductGenderScope(row?.gender_scope);\n  }\n  const profile = await db.prepare(\n    \`SELECT\n       MAX(CASE WHEN UPPER(TRIM(COALESCE(gender,'')))='ЖЕН' THEN 1 ELSE 0 END) AS has_female,\n       MAX(CASE WHEN UPPER(TRIM(COALESCE(gender,'')))='МУЖ' THEN 1 ELSE 0 END) AS has_male,\n       MAX(CASE WHEN TRIM(COALESCE(gender,''))='' THEN 1 ELSE 0 END) AS has_blank\n     FROM catalog_variants WHERE product_id = ? AND is_active = 1\`\n  ).bind(productId).first<Record<string, unknown>>();\n  const female = toInt(profile?.has_female, 0) > 0;\n  const male = toInt(profile?.has_male, 0) > 0;\n  const blank = toInt(profile?.has_blank, 0) > 0;\n  if (female && !male && !blank) return 'female';\n  if (male && !female && !blank) return 'male';\n  return 'unisex';\n}\n\nexport async function resolveCatalogGenderForProduct(db: D1Database, productId: number, value: unknown) {\n  const scope = await getCatalogProductGenderScope(db, productId);\n  const fixed = catalogGenderForProductScope(scope);\n  if (fixed) return { scope, gender: fixed };\n  const gender = normalizeCatalogCombinationGender(value);\n  if (gender !== 'ЖЕН' && gender !== 'МУЖ') {\n    throw new Error('Для товара «Унисекс» выберите пол конкретной вещи: ЖЕН или МУЖ.');\n  }\n  return { scope, gender };\n}\n\nexport function normalizeCatalogCombinationGender(value: unknown) {\n  const text = upperText(value);\n  if (!text) return '';\n  if (text.includes('ЖЕН')) return 'ЖЕН';\n  if (text.includes('МУЖ')) return 'МУЖ';\n  return text;\n}\n`,
)

replaceOnce('worker/domains/catalog.ts',
  "export async function listCatalog(db: D1Database) {\n  const productsResult = await db.prepare(\n    `SELECT\n      id, name, category, is_active, created_at, updated_at\n     FROM catalog_products",
  "export async function listCatalog(db: D1Database) {\n  const genderScopeEnabled = await isCatalogProductGenderScopeEnabled(db);\n  const productsResult = await db.prepare(\n    `SELECT\n      id, name, category, ${genderScopeEnabled ? 'gender_scope' : \"'unisex' AS gender_scope\"}, is_active, created_at, updated_at\n     FROM catalog_products",
)
replaceOnce('worker/domains/catalog.ts',
  "        category: cleanText(row.category),\n        isActive: Boolean(toInt(row.is_active, 1)),",
  "        category: cleanText(row.category),\n        genderScope: normalizeCatalogProductGenderScope(row.gender_scope),\n        isActive: Boolean(toInt(row.is_active, 1)),",
)

replaceRegexOnce('worker/domains/catalog.ts',
  /export async function createCatalogProduct\(db: D1Database, input: \{ name\?: unknown; category\?: unknown \}\) \{[\s\S]*?return \{ ok: true, id: Number\(result\.meta\?\.last_row_id \|\| 0\), name, category \};\n\}/,
  `export async function createCatalogProduct(db: D1Database, input: { name?: unknown; category?: unknown; genderScope?: unknown }) {\n  const name = upperText(input.name);\n  if (!name) throw new Error('Product name is required.');\n  const duplicate = await findCatalogProductByIdentity(db, name);\n  if (duplicate?.id) throw new Error(\`Такой базовый товар уже существует: \${cleanText(duplicate.name)}.\`);\n  if (input.genderScope === undefined || !cleanText(input.genderScope)) {\n    throw new Error('Выберите назначение товара по полу: Женский, Мужской или Унисекс.');\n  }\n  if (!await isCatalogProductGenderScopeEnabled(db)) {\n    throw new Error('Схема каталога ещё не поддерживает назначение товара по полу. Примените миграцию 0068 и повторите действие.');\n  }\n  const category = normalizeCatalogCategory(input.category);\n  const genderScope = normalizeCatalogProductGenderScope(input.genderScope);\n  const createdAt = new Date().toISOString();\n  const result = await db.prepare(\n    \`INSERT INTO catalog_products (name, category, gender_scope, is_active, created_at, updated_at)\n     VALUES (?, ?, ?, 1, ?, ?)\`\n  ).bind(name, category, genderScope, createdAt, createdAt).run();\n  return { ok: true, id: Number(result.meta?.last_row_id || 0), name, category, genderScope };\n}`,
  /gender_scope, is_active, created_at/,
)

replaceRegexOnce('worker/domains/catalog.ts',
  /export async function updateCatalogProduct\(db: D1Database, id: number, input: \{ name\?: unknown; category\?: unknown; isActive\?: unknown \}\) \{[\s\S]*?return \{ ok: true \};\n\}/,
  `export async function updateCatalogProduct(db: D1Database, id: number, input: { name?: unknown; category?: unknown; genderScope?: unknown; isActive?: unknown }) {\n  const existing = await db.prepare('SELECT id FROM catalog_products WHERE id = ?').bind(id).first<{ id: number }>();\n  if (!existing) throw new Error('Product not found.');\n  const name = input.name !== undefined ? upperText(input.name) : undefined;\n  const category = input.category !== undefined ? normalizeCatalogCategory(input.category) : undefined;\n  if (name) {\n    const duplicate = await findCatalogProductByIdentity(db, name, id);\n    if (duplicate?.id) throw new Error(\`Такой базовый товар уже существует: \${cleanText(duplicate.name)}.\`);\n  }\n  const genderScope = input.genderScope === undefined ? undefined : normalizeCatalogProductGenderScope(input.genderScope);\n  if (genderScope !== undefined && !await isCatalogProductGenderScopeEnabled(db)) {\n    throw new Error('Схема каталога ещё не поддерживает назначение товара по полу. Примените миграцию 0068 и повторите действие.');\n  }\n  const isActive = input.isActive === undefined ? undefined : (cleanText(input.isActive).toLowerCase() === 'false' ? 0 : 1);\n  const createdAt = new Date().toISOString();\n  await db.prepare(\n    \`UPDATE catalog_products\n     SET name = COALESCE(?, name),\n         category = COALESCE(?, category),\n         gender_scope = COALESCE(?, gender_scope),\n         is_active = COALESCE(?, is_active),\n         updated_at = ?\n     WHERE id = ?\`\n  ).bind(name || null, category || null, genderScope ?? null, isActive ?? null, createdAt, id).run();\n  return { ok: true };\n}`,
  /gender_scope = COALESCE/,
)

replaceOnce('worker/domains/catalog.ts',
  "  const product = await db.prepare('SELECT id FROM catalog_products WHERE id = ?').bind(productId).first<{ id: number }>();\n  if (!product) throw new Error('Product not found.');\n  const category = normalizeAudienceCategory(input.category, input.sizeLabel) as 'adult' | 'child';\n  const gender = normalizeCatalogCombinationGender(input.gender);",
  "  const product = await db.prepare('SELECT id FROM catalog_products WHERE id = ?').bind(productId).first<{ id: number }>();\n  if (!product) throw new Error('Product not found.');\n  const category = normalizeAudienceCategory(input.category, input.sizeLabel) as 'adult' | 'child';\n  const genderResolution = await resolveCatalogGenderForProduct(db, productId, input.gender);\n  const gender = genderResolution.gender;",
)
replaceOnce('worker/domains/catalog.ts',
  "  const gender = input.gender === undefined ? normalizeCatalogCombinationGender(existing.gender) : normalizeCatalogCombinationGender(input.gender);",
  "  const genderResolution = await resolveCatalogGenderForProduct(db, productId, input.gender === undefined ? existing.gender : input.gender);\n  const gender = genderResolution.gender;",
)
replaceOnce('worker/domains/catalog.ts',
  "  const gender = normalizeCatalogCombinationGender(input.gender);\n  const color = normalizeCatalogCombinationColor(input.color);\n  const sizeLabel = normalizeCatalogCombinationSize(input.sizeLabel);",
  "  const genderResolution = await resolveCatalogGenderForProduct(db, input.productId, input.gender);\n  const gender = genderResolution.gender;\n  const color = normalizeCatalogCombinationColor(input.color);\n  const sizeLabel = normalizeCatalogCombinationSize(input.sizeLabel);",
)

// Order resolver: fixed-scope products self-fill; unisex must be chosen explicitly.
replaceOnce('worker/domains/order-reservations.ts',
  "import { catalogReferenceDbValueExists, catalogReferenceValueExists, createCatalogCombinationV3, ensureCatalogExecutionV3, findCatalogCombinationV3, findCatalogExecutionV3, findCatalogProductByIdentity, isCatalogIdentityV3Enabled, isHumanInventoryModelEnabled, loadCanonicalVariantSnapshot, makeVariantExternalId, normalizeCatalogCombinationColor, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize, resolveCatalogValueAlias } from './catalog.ts'",
  "import { catalogGenderForProductScope, catalogReferenceDbValueExists, catalogReferenceValueExists, createCatalogCombinationV3, ensureCatalogExecutionV3, findCatalogCombinationV3, findCatalogExecutionV3, findCatalogProductByIdentity, getCatalogProductGenderScope, isCatalogIdentityV3Enabled, isHumanInventoryModelEnabled, loadCanonicalVariantSnapshot, makeVariantExternalId, normalizeCatalogCombinationColor, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize, resolveCatalogValueAlias } from './catalog.ts'",
)
replaceOnce('worker/domains/order-reservations.ts',
  "  const gender = normalizeCatalogCombinationGender(item.gender);\n  const rawColor = upperText(item.color);",
  "  const productGenderScope = await getCatalogProductGenderScope(db, product.id);\n  const gender = catalogGenderForProductScope(productGenderScope) || normalizeCatalogCombinationGender(item.gender);\n  if (productGenderScope === 'unisex' && gender !== 'ЖЕН' && gender !== 'МУЖ') {\n    return { productId: toInt(product.id, 0) || null, variantId: null, matchStatus: 'unresolved_attribute', inputKey };\n  }\n  const rawColor = upperText(item.color);",
)

// Workspace auto-fill for create/edit/exchange + availability truth.
replaceOnce('src/app/controllers/useWorkspaceViewModel.tsx',
  "    const variants = (catalogVariantsByProductId.get(Number(product.id)) || []).filter((variant) => variant.isActive)\n    if (!variants.length) {",
  "    const productGenderScope = String(product.genderScope || 'unisex') as 'female' | 'male' | 'unisex'\n    const automaticGender = productGenderScope === 'female' ? 'ЖЕН' : productGenderScope === 'male' ? 'МУЖ' : ''\n    const variants = (catalogVariantsByProductId.get(Number(product.id)) || []).filter((variant) => variant.isActive)\n    if (!variants.length) {",
)
replaceOnce('src/app/controllers/useWorkspaceViewModel.tsx',
  "        gender: '',\n        color: '',\n        material: 'СТАНДАРТ',",
  "        gender: automaticGender,\n        color: '',\n        material: 'СТАНДАРТ',",
)
replaceOnce('src/app/controllers/useWorkspaceViewModel.tsx',
  "      gender: selected.gender || '',\n      color: selected.color || '',",
  "      gender: automaticGender,\n      color: selected.color || '',",
)
replaceOnce('src/app/controllers/useWorkspaceViewModel.tsx',
  "    const catalogProduct = resolveClientCatalogProduct(productName)\n    const resolvedProductName = catalogProduct?.name || productName",
  "    const catalogProduct = resolveClientCatalogProduct(productName)\n    const productGenderScope = String(catalogProduct?.genderScope || 'unisex') as 'female' | 'male' | 'unisex'\n    const scopedItemGender = productGenderScope === 'female' ? 'ЖЕН' : productGenderScope === 'male' ? 'МУЖ' : canonicalOrderGender(item.gender)\n    const resolvedProductName = catalogProduct?.name || productName",
)
replaceOnce('src/app/controllers/useWorkspaceViewModel.tsx',
  "      && canonicalOrderGender(variant.gender) === canonicalOrderGender(item.gender)",
  "      && canonicalOrderGender(variant.gender) === scopedItemGender",
)
replaceOnce('src/app/controllers/useWorkspaceViewModel.tsx',
  "    const normalizedGender = canonicalOrderGender(item.gender)\n    if (normalizedGender && normalizedGender !== 'ЖЕН' && normalizedGender !== 'МУЖ') unknownFacts.push('пол')",
  "    const normalizedGender = scopedItemGender\n    if (productGenderScope === 'unisex' && !normalizedGender) unknownFacts.push('пол')\n    else if (normalizedGender && normalizedGender !== 'ЖЕН' && normalizedGender !== 'МУЖ') unknownFacts.push('пол')",
)
replaceOnce('src/app/controllers/useWorkspaceViewModel.tsx',
  "      && canonicalOrderGender(row.gender) === canonicalOrderGender(item.gender)",
  "      && canonicalOrderGender(row.gender) === scopedItemGender",
)

// Arrival: product scope controls initial gender, never an arbitrary first variant.
replaceOnce('src/app/controllers/useOperationalViewModel.ts',
  "    const variants = (catalogVariantsByProductId.get(Number(match.id)) || []).filter((variant) => variant.isActive)\n    const first = variants[0]\n    setInventoryArrivalPositions((current) => current.map((position) => position.id === id ? {\n      ...position,\n      productInput: match.name,\n      productId: Number(match.id),\n      category: first ? getCatalogVariantCategory(first) : getCatalogProductEffectiveCategory(match),\n      gender: first?.gender || position.gender,",
  "    const variants = (catalogVariantsByProductId.get(Number(match.id)) || []).filter((variant) => variant.isActive)\n    const first = variants[0]\n    const productGenderScope = String(match.genderScope || 'unisex')\n    const automaticGender = productGenderScope === 'female' ? 'ЖЕН' : productGenderScope === 'male' ? 'МУЖ' : ''\n    setInventoryArrivalPositions((current) => current.map((position) => position.id === id ? {\n      ...position,\n      productInput: match.name,\n      productId: Number(match.id),\n      category: first ? getCatalogVariantCategory(first) : getCatalogProductEffectiveCategory(match),\n      gender: automaticGender,",
)

// Exchange gender is a controlled choice, not free text.
replaceOnce('src/features/sections/OrderExchangeSection.tsx',
  "                          <label><span>Пол</span><input value={exchangeDraft.newItem.gender || ''} onChange={(event) => setExchangeDraft((current) => ({ ...current, newItem: resetObservedStock(current.newItem, { gender: event.target.value }) }))} /></label>",
  "                          <label><span>Пол</span><select value={exchangeDraft.newItem.gender || ''} onChange={(event) => setExchangeDraft((current) => ({ ...current, newItem: resetObservedStock(current.newItem, { gender: event.target.value }) }))}><option value=\"\">Выберите для унисекс</option><option value=\"ЖЕН\">ЖЕН</option><option value=\"МУЖ\">МУЖ</option></select></label>",
)

// Catalog UI: product-level scope is explicit; variant gender follows it.
replaceOnce('src/features/inventory/views/renderInventoryCatalogPanel.tsx',
  "const executionKey = (material: unknown, length: unknown) => `${normalizedKey(material)}¦${normalizedKey(length)}`",
  "const productGenderScope = (product: any): 'female' | 'male' | 'unisex' => ['female', 'male', 'unisex'].includes(String(product?.genderScope || '')) ? product.genderScope : 'unisex'\nconst fixedGenderForProduct = (product: any) => productGenderScope(product) === 'female' ? 'ЖЕН' : productGenderScope(product) === 'male' ? 'МУЖ' : ''\nconst productGenderScopeLabel = (product: any) => productGenderScope(product) === 'female' ? 'Женский' : productGenderScope(product) === 'male' ? 'Мужской' : 'Унисекс'\n\nconst executionKey = (material: unknown, length: unknown) => `${normalizedKey(material)}¦${normalizedKey(length)}`",
)
replaceOnce('src/features/inventory/views/renderInventoryCatalogPanel.tsx',
  "const blankVariant = (productId: number, category: string) => ({\n  id: 0,\n  productId: productId ? String(productId) : '',\n  category: category === 'child' ? 'child' : 'adult',\n  gender: '',",
  "const blankVariant = (productId: number, category: string, product?: any) => ({\n  id: 0,\n  productId: productId ? String(productId) : '',\n  category: category === 'child' ? 'child' : 'adult',\n  gender: fixedGenderForProduct(product),",
)
replaceOnce('src/features/inventory/views/renderInventoryCatalogPanel.tsx',
  "    setCatalogProductDraft({ id: product.id, name: product.name, category })\n    setCatalogVariantDraft(blankVariant(Number(product.id), catalogCategoryFilter === 'child' ? 'child' : category))",
  "    setCatalogProductDraft({ id: product.id, name: product.name, category, genderScope: productGenderScope(product) })\n    setCatalogVariantDraft(blankVariant(Number(product.id), catalogCategoryFilter === 'child' ? 'child' : category, product))",
)
replaceOnce('src/features/inventory/views/renderInventoryCatalogPanel.tsx',
  "    setCatalogProductDraft({ id: 0, name: '', category })\n    setCatalogVariantDraft(blankVariant(0, category))",
  "    setCatalogProductDraft({ id: 0, name: '', category, genderScope: '' })\n    setCatalogVariantDraft(blankVariant(0, category))",
)
replaceOnce('src/features/inventory/views/renderInventoryCatalogPanel.tsx',
  "    setCatalogProductDraft({ id: product.id, name: product.name, category })\n    setCatalogVariantDraft(blankVariant(Number(product.id), category))",
  "    setCatalogProductDraft({ id: product.id, name: product.name, category, genderScope: productGenderScope(product) })\n    setCatalogVariantDraft(blankVariant(Number(product.id), category, product))",
)
replaceOnce('src/features/inventory/views/renderInventoryCatalogPanel.tsx',
  "    setCatalogProductDraft({ id: product.id, name: product.name, category: getCatalogProductEffectiveCategory(product) })\n    setCatalogVariantDraft(blankVariant(Number(product.id), category))",
  "    setCatalogProductDraft({ id: product.id, name: product.name, category: getCatalogProductEffectiveCategory(product), genderScope: productGenderScope(product) })\n    setCatalogVariantDraft(blankVariant(Number(product.id), category, product))",
)
replaceOnce('src/features/inventory/views/renderInventoryCatalogPanel.tsx',
  "      gender: variant.gender,",
  "      gender: fixedGenderForProduct(product) || variant.gender,",
)
replaceOnce('src/features/inventory/views/renderInventoryCatalogPanel.tsx',
  "    setCatalogProductDraft({ id: selectedProduct.id, name: selectedProduct.name, category: getCatalogProductEffectiveCategory(selectedProduct) })\n    setCatalogVariantDraft(blankVariant(Number(selectedProduct.id), getCatalogProductEffectiveCategory(selectedProduct)))",
  "    setCatalogProductDraft({ id: selectedProduct.id, name: selectedProduct.name, category: getCatalogProductEffectiveCategory(selectedProduct), genderScope: productGenderScope(selectedProduct) })\n    setCatalogVariantDraft(blankVariant(Number(selectedProduct.id), getCatalogProductEffectiveCategory(selectedProduct), selectedProduct))",
)
replaceOnce('src/features/inventory/views/renderInventoryCatalogPanel.tsx',
  "                  <p>Создайте только базовое название. Цвет, материал, длина, размер и пол добавляются как варианты.</p>",
  "                  <p>Задайте базовое название и назначение по полу. Для женского/мужского товара пол дальше подставляется автоматически; у унисекс человек выбирает пол конкретной вещи.</p>",
)
replaceOnce('src/features/inventory/views/renderInventoryCatalogPanel.tsx',
  "                <button className=\"primary\" type=\"button\" onClick={() => void saveCatalogProduct()}>Добавить товар</button>",
  "                <label>\n                  <span>Назначение по полу</span>\n                  <select value={catalogProductDraft.id ? '' : (catalogProductDraft.genderScope || '')} onChange={(event) => setCatalogProductDraft((current: any) => ({ ...current, id: 0, genderScope: event.target.value }))}>\n                    <option value=\"\">Выберите</option>\n                    <option value=\"female\">Женский</option>\n                    <option value=\"male\">Мужской</option>\n                    <option value=\"unisex\">Унисекс</option>\n                  </select>\n                  <small>У «Унисекс» пол не угадывается: в заказе, приходе или обмене человек выберет ЖЕН/МУЖ.</small>\n                </label>\n                <button className=\"primary\" type=\"button\" disabled={!catalogProductDraft.genderScope} onClick={() => void saveCatalogProduct()}>Добавить товар</button>",
)
replaceOnce('src/features/inventory/views/renderInventoryCatalogPanel.tsx',
  "                    {selectedAdultCount && selectedChildCount ? <span>{selectedAdultCount} взрослых · {selectedChildCount} детских</span> : selectedChildCount ? <span>Детский товар</span> : <span>Взрослый товар</span>}",
  "                    {selectedAdultCount && selectedChildCount ? <span>{selectedAdultCount} взрослых · {selectedChildCount} детских</span> : selectedChildCount ? <span>Детский товар</span> : <span>Взрослый товар</span>}\n                    <span>Пол: <b>{productGenderScopeLabel(selectedProduct)}</b></span>",
)
replaceOnce('src/features/inventory/views/renderInventoryCatalogPanel.tsx',
  "                        onChange={(event) => setCatalogProductDraft({ id: selectedProduct.id, name: event.target.value, category: catalogProductDraft.id === selectedProduct.id ? catalogProductDraft.category : getCatalogProductEffectiveCategory(selectedProduct) })}",
  "                        onChange={(event) => setCatalogProductDraft({ id: selectedProduct.id, name: event.target.value, category: catalogProductDraft.id === selectedProduct.id ? catalogProductDraft.category : getCatalogProductEffectiveCategory(selectedProduct), genderScope: catalogProductDraft.id === selectedProduct.id ? catalogProductDraft.genderScope : productGenderScope(selectedProduct) })}",
)
replaceOnce('src/features/inventory/views/renderInventoryCatalogPanel.tsx',
  "                        onChange={(event) => setCatalogProductDraft({ id: selectedProduct.id, name: catalogProductDraft.id === selectedProduct.id ? catalogProductDraft.name : selectedProduct.name, category: event.target.value === 'child' ? 'child' : 'adult' })}",
  "                        onChange={(event) => setCatalogProductDraft({ id: selectedProduct.id, name: catalogProductDraft.id === selectedProduct.id ? catalogProductDraft.name : selectedProduct.name, category: event.target.value === 'child' ? 'child' : 'adult', genderScope: catalogProductDraft.id === selectedProduct.id ? catalogProductDraft.genderScope : productGenderScope(selectedProduct) })}",
)
replaceOnce('src/features/inventory/views/renderInventoryCatalogPanel.tsx',
  "                    <button className=\"primary compact\" type=\"button\" onClick={() => void saveCatalogProduct()}>Сохранить товар</button>",
  "                    <label>\n                      <span>Назначение по полу</span>\n                      <select value={catalogProductDraft.id === selectedProduct.id ? (catalogProductDraft.genderScope || productGenderScope(selectedProduct)) : productGenderScope(selectedProduct)} onChange={(event) => setCatalogProductDraft((current: any) => ({ ...current, id: selectedProduct.id, name: current.id === selectedProduct.id ? current.name : selectedProduct.name, category: current.id === selectedProduct.id ? current.category : getCatalogProductEffectiveCategory(selectedProduct), genderScope: event.target.value }))}>\n                        <option value=\"female\">Женский</option><option value=\"male\">Мужской</option><option value=\"unisex\">Унисекс</option>\n                      </select>\n                    </label>\n                    <button className=\"primary compact\" type=\"button\" onClick={() => void saveCatalogProduct()}>Сохранить товар</button>",
)
replaceOnce('src/features/inventory/views/renderInventoryCatalogPanel.tsx',
  "                      <select value={catalogVariantDraft.productId === String(selectedProduct.id) ? catalogVariantDraft.gender : ''} onChange={(event) => setCatalogVariantDraft((current: any) => ({ ...current, productId: String(selectedProduct.id), gender: event.target.value }))}>\n                        <option value=\"\">Не указан</option>\n                        <option value=\"МУЖ\">МУЖ</option>\n                        <option value=\"ЖЕН\">ЖЕН</option>\n                      </select>",
  "                      <select disabled={Boolean(fixedGenderForProduct(selectedProduct))} value={fixedGenderForProduct(selectedProduct) || (catalogVariantDraft.productId === String(selectedProduct.id) ? catalogVariantDraft.gender : '')} onChange={(event) => setCatalogVariantDraft((current: any) => ({ ...current, productId: String(selectedProduct.id), gender: event.target.value }))}>\n                        {!fixedGenderForProduct(selectedProduct) ? <option value=\"\">Выберите для унисекс</option> : null}\n                        <option value=\"МУЖ\">МУЖ</option>\n                        <option value=\"ЖЕН\">ЖЕН</option>\n                      </select>\n                      <small>{fixedGenderForProduct(selectedProduct) ? 'Пол задан на уровне товара и подставляется автоматически.' : 'Унисекс: выберите пол этой конкретной комбинации.'}</small>",
)

// Catalog review/lifecycle state carries product scope so implicit product creation is never ambiguous.
replaceOnce('src/features/sections/InventorySection.tsx',
  "type ResolutionFactsState = CatalogResolutionFacts & { productId: number }",
  "type ResolutionFactsState = CatalogResolutionFacts & { productId: number; genderScope: '' | 'female' | 'male' | 'unisex' }",
)
replaceOnce('src/features/sections/InventorySection.tsx',
  "useState<ResolutionFactsState>({ productId: 0, material: 'СТАНДАРТ', length: 'СТАНДАРТ', category: 'adult', gender: '', color: '', size: '' })",
  "useState<ResolutionFactsState>({ productId: 0, genderScope: '', material: 'СТАНДАРТ', length: 'СТАНДАРТ', category: 'adult', gender: '', color: '', size: '' })",
)
// same initializer occurs twice; replace the remaining occurrence
replaceOnce('src/features/sections/InventorySection.tsx',
  "useState<ResolutionFactsState>({ productId: 0, material: 'СТАНДАРТ', length: 'СТАНДАРТ', category: 'adult', gender: '', color: '', size: '' })",
  "useState<ResolutionFactsState>({ productId: 0, genderScope: '', material: 'СТАНДАРТ', length: 'СТАНДАРТ', category: 'adult', gender: '', color: '', size: '' })",
)
replaceOnce('src/features/sections/InventorySection.tsx',
  "        productId: Number(context?.product?.id || 0),\n        material: facts.material || 'СТАНДАРТ',",
  "        productId: Number(context?.product?.id || 0),\n        genderScope: context?.product?.genderScope || '',\n        material: facts.material || 'СТАНДАРТ',",
)
replaceOnce('src/features/sections/InventorySection.tsx',
  "        productId: Number(context?.product?.id || item.productId || 0),\n        material: facts.material || item.material || 'СТАНДАРТ',",
  "        productId: Number(context?.product?.id || item.productId || 0),\n        genderScope: context?.product?.genderScope || '',\n        material: facts.material || item.material || 'СТАНДАРТ',",
)
replaceOnce('src/features/sections/InventorySection.tsx',
  "  const catalogReviewGenderNeedsChoice = reviewFieldUnknown('gender') && !['', 'ЖЕН', 'МУЖ'].includes(normalizeSuggestion(catalogReviewFacts.gender))",
  "  const catalogReviewGenderNeedsChoice = catalogReviewFacts.genderScope === 'unisex'\n    ? !['ЖЕН', 'МУЖ'].includes(normalizeSuggestion(catalogReviewFacts.gender))\n    : reviewFieldUnknown('gender') && !['', 'ЖЕН', 'МУЖ'].includes(normalizeSuggestion(catalogReviewFacts.gender))\n  const catalogReviewScopeNeedsChoice = catalogReviewCreateProduct && !catalogReviewFacts.genderScope",
)
replaceOnce('src/features/sections/InventorySection.tsx',
  "  const catalogReviewBlockingFields = [...catalogReviewUnconfirmedFields, ...(catalogReviewGenderNeedsChoice ? ['gender'] : [])]",
  "  const catalogReviewBlockingFields = [...catalogReviewUnconfirmedFields, ...(catalogReviewGenderNeedsChoice ? ['gender'] : []), ...(catalogReviewScopeNeedsChoice ? ['genderScope'] : [])]",
)
replaceOnce('src/features/sections/InventorySection.tsx',
  "  const inventoryLifecycleGenderNeedsChoice = !['', 'ЖЕН', 'МУЖ'].includes(normalizeSuggestion(inventoryLifecycleFacts.gender))",
  "  const inventoryLifecycleGenderNeedsChoice = inventoryLifecycleFacts.genderScope === 'unisex'\n    ? !['ЖЕН', 'МУЖ'].includes(normalizeSuggestion(inventoryLifecycleFacts.gender))\n    : !['', 'ЖЕН', 'МУЖ'].includes(normalizeSuggestion(inventoryLifecycleFacts.gender))\n  const inventoryLifecycleScopeNeedsChoice = inventoryLifecycleCreateProduct && !inventoryLifecycleFacts.genderScope",
)
replaceOnce('src/features/sections/InventorySection.tsx',
  "  const inventoryLifecycleBlockingFields = [...inventoryLifecycleUnconfirmedFields, ...(inventoryLifecycleGenderNeedsChoice ? ['gender'] : [])]",
  "  const inventoryLifecycleBlockingFields = [...inventoryLifecycleUnconfirmedFields, ...(inventoryLifecycleGenderNeedsChoice ? ['gender'] : []), ...(inventoryLifecycleScopeNeedsChoice ? ['genderScope'] : [])]",
)

// Legacy review/lifecycle UI: choice appears only when a new base product is being created.
replaceOnce('src/features/inventory/views/catalogLegacyAdminModes.tsx',
  "{catalogReviewCreateProduct ? <label><span>Название в каталоге</span><input value={catalogReviewNewProductName} onChange={(event) => setCatalogReviewNewProductName(event.target.value)} placeholder=\"Исправьте опечатку или задайте нормальное название\" /><small>Менеджер ввёл: {catalogReviewActiveItem.productName || 'Без названия'}. Исходный текст останется в истории заказа.</small></label> : null}",
  "{catalogReviewCreateProduct ? <><label><span>Название в каталоге</span><input value={catalogReviewNewProductName} onChange={(event) => setCatalogReviewNewProductName(event.target.value)} placeholder=\"Исправьте опечатку или задайте нормальное название\" /><small>Менеджер ввёл: {catalogReviewActiveItem.productName || 'Без названия'}. Исходный текст останется в истории заказа.</small></label><label className=\"needs-choice\"><span>Для кого этот товар?</span><select value={catalogReviewFacts.genderScope || ''} onChange={(event) => setCatalogReviewFacts((current: any) => ({ ...current, genderScope: event.target.value, gender: event.target.value === 'female' ? 'ЖЕН' : event.target.value === 'male' ? 'МУЖ' : '' }))}><option value=\"\">Выберите</option><option value=\"female\">Женский</option><option value=\"male\">Мужской</option><option value=\"unisex\">Унисекс</option></select><small>Жен/Муж будет подставляться автоматически. Для унисекс пол конкретной вещи выбирается отдельно.</small></label></> : null}",
)
replaceOnce('src/features/inventory/views/catalogLegacyAdminModes.tsx',
  "gender: 'пол' } as any)[field]).join(', ')}.",
  "gender: 'пол', genderScope: 'назначение товара по полу' } as any)[field]).join(', ')}.",
)

// backend review/lifecycle scope support
replaceOnce('worker/domains/catalog-review.ts',
  "import { assertCatalogProductAliasTargetAvailable, catalogReferenceDbValueExists, createCatalogCombinationV3, createCatalogProduct, ensureCatalogExecutionV3, findCatalogCombinationV3, findCatalogExecutionV3, findCatalogProductByIdentity, makeVariantExternalId, normalizeCatalogCombinationColor, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize, rememberCatalogProductAlias, rememberCatalogValueAlias, resolveCatalogValueAlias } from './catalog.ts'",
  "import { assertCatalogProductAliasTargetAvailable, catalogGenderForProductScope, catalogReferenceDbValueExists, createCatalogCombinationV3, createCatalogProduct, ensureCatalogExecutionV3, findCatalogCombinationV3, findCatalogExecutionV3, findCatalogProductByIdentity, getCatalogProductGenderScope, makeVariantExternalId, normalizeCatalogCombinationColor, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize, normalizeCatalogProductGenderScope, rememberCatalogProductAlias, rememberCatalogValueAlias, resolveCatalogValueAlias } from './catalog.ts'",
)
replaceOnce('worker/domains/catalog-review.ts',
  "  productName?: unknown;\n  material?: unknown;",
  "  productName?: unknown;\n  genderScope?: unknown;\n  material?: unknown;",
)
replaceOnce('worker/domains/catalog-review.ts',
  "  const product = toInt(anchor.product_id, 0)\n    ? await db.prepare(`SELECT id, name, category FROM catalog_products WHERE id = ? AND is_active = 1 LIMIT 1`).bind(toInt(anchor.product_id, 0)).first<{ id: number; name: string; category: string }>()\n    : await findCatalogProductByIdentity(db, facts.productName, 0, { activeOnly: true }) as { id: number; name: string; category: string } | null;",
  "  const product = toInt(anchor.product_id, 0)\n    ? await db.prepare(`SELECT id, name, category FROM catalog_products WHERE id = ? AND is_active = 1 LIMIT 1`).bind(toInt(anchor.product_id, 0)).first<{ id: number; name: string; category: string }>()\n    : await findCatalogProductByIdentity(db, facts.productName, 0, { activeOnly: true }) as { id: number; name: string; category: string } | null;\n  const productGenderScope = product?.id ? await getCatalogProductGenderScope(db, product.id) : 'unisex';\n  if (product?.id) facts.gender = catalogGenderForProductScope(productGenderScope) || facts.gender;",
)
replaceOnce('worker/domains/catalog-review.ts',
  "      if (facts.gender && facts.gender !== 'ЖЕН' && facts.gender !== 'МУЖ') unknownFields.push('gender');",
  "      if ((productGenderScope === 'unisex' && !facts.gender) || (facts.gender && facts.gender !== 'ЖЕН' && facts.gender !== 'МУЖ')) unknownFields.push('gender');",
)
replaceOnce('worker/domains/catalog-review.ts',
  "    product: product ? { id: product.id, name: cleanText(product.name), category: cleanText(product.category) } : null,",
  "    product: product ? { id: product.id, name: cleanText(product.name), category: cleanText(product.category), genderScope: productGenderScope } : null,",
)
replaceOnce('worker/domains/catalog-review.ts',
  "  const gender = normalizeCatalogCombinationGender(input.gender ?? anchor.gender_snapshot);",
  "  const requestedGenderScope = product?.id ? await getCatalogProductGenderScope(db, product.id) : (cleanText(input.genderScope) ? normalizeCatalogProductGenderScope(input.genderScope) : null);\n  if (!product?.id && !requestedGenderScope) throw new Error('Для нового товара выберите назначение по полу: Женский, Мужской или Унисекс.');\n  const gender = catalogGenderForProductScope(requestedGenderScope || 'unisex') || normalizeCatalogCombinationGender(input.gender ?? anchor.gender_snapshot);",
)
replaceOnce('worker/domains/catalog-review.ts',
  "      const created = await createCatalogProduct(db, { name: requestedProductName, category });",
  "      const created = await createCatalogProduct(db, { name: requestedProductName, category, genderScope: requestedGenderScope });",
)
replaceOnce('worker/domains/catalog-review.ts',
  "    const created = await createCatalogProduct(db, { name: requestedProductName, category });",
  "    const created = await createCatalogProduct(db, { name: requestedProductName, category, genderScope: requestedGenderScope });",
)
replaceOnce('worker/domains/catalog-review.ts',
  "  if (gender && gender !== 'ЖЕН' && gender !== 'МУЖ') throw new Error('Пол должен быть выбран из списка.');",
  "  if (gender !== 'ЖЕН' && gender !== 'МУЖ') throw new Error('Для товара «Унисекс» выберите пол конкретной вещи: ЖЕН или МУЖ.');",
)

replaceOnce('worker/domains/lifecycle.ts',
  "import { assertCatalogProductAliasTargetAvailable, catalogReferenceDbValueExists, createCatalogCombinationV3, createCatalogProduct, ensureCatalogExecutionV3, findCatalogCombinationV3, findCatalogExecutionV3, findCatalogProductByIdentity, loadCanonicalVariantSnapshot, makeVariantExternalId, normalizeCatalogCombinationColor, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize, rememberCatalogProductAlias, rememberCatalogValueAlias, resolveCatalogValueAlias } from './catalog.ts'",
  "import { assertCatalogProductAliasTargetAvailable, catalogGenderForProductScope, catalogReferenceDbValueExists, createCatalogCombinationV3, createCatalogProduct, ensureCatalogExecutionV3, findCatalogCombinationV3, findCatalogExecutionV3, findCatalogProductByIdentity, getCatalogProductGenderScope, loadCanonicalVariantSnapshot, makeVariantExternalId, normalizeCatalogCombinationColor, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize, normalizeCatalogProductGenderScope, rememberCatalogProductAlias, rememberCatalogValueAlias, resolveCatalogValueAlias } from './catalog.ts'",
)
replaceOnce('worker/domains/lifecycle.ts',
  "  const product = toInt(event.product_id, 0)\n    ? await db.prepare(`SELECT id, name, category FROM catalog_products WHERE id = ? AND is_active = 1 LIMIT 1`).bind(toInt(event.product_id, 0)).first<{ id: number; name: string; category: string }>()\n    : await findCatalogProductByIdentity(db, facts.productName, 0, { activeOnly: true }) as { id: number; name: string; category: string } | null;",
  "  const product = toInt(event.product_id, 0)\n    ? await db.prepare(`SELECT id, name, category FROM catalog_products WHERE id = ? AND is_active = 1 LIMIT 1`).bind(toInt(event.product_id, 0)).first<{ id: number; name: string; category: string }>()\n    : await findCatalogProductByIdentity(db, facts.productName, 0, { activeOnly: true }) as { id: number; name: string; category: string } | null;\n  const productGenderScope = product?.id ? await getCatalogProductGenderScope(db, product.id) : 'unisex';\n  if (product?.id) facts.gender = catalogGenderForProductScope(productGenderScope) || facts.gender;",
)
replaceOnce('worker/domains/lifecycle.ts',
  "    if (facts.gender && facts.gender !== 'ЖЕН' && facts.gender !== 'МУЖ') unknownFields.push('gender');",
  "    if ((productGenderScope === 'unisex' && !facts.gender) || (facts.gender && facts.gender !== 'ЖЕН' && facts.gender !== 'МУЖ')) unknownFields.push('gender');",
)
replaceOnce('worker/domains/lifecycle.ts',
  "    product: product ? { id: product.id, name: cleanText(product.name), category: cleanText(product.category) } : null,",
  "    product: product ? { id: product.id, name: cleanText(product.name), category: cleanText(product.category), genderScope: productGenderScope } : null,",
)
replaceOnce('worker/domains/lifecycle.ts',
  "  const gender = normalizeCatalogCombinationGender(input.gender ?? event.gender_snapshot);",
  "  const requestedGenderScope = product?.id ? await getCatalogProductGenderScope(db, product.id) : (cleanText(input.genderScope) ? normalizeCatalogProductGenderScope(input.genderScope) : null);\n  if (!product?.id && !requestedGenderScope) throw new Error('Для нового товара выберите назначение по полу: Женский, Мужской или Унисекс.');\n  const gender = catalogGenderForProductScope(requestedGenderScope || 'unisex') || normalizeCatalogCombinationGender(input.gender ?? event.gender_snapshot);",
)
replaceOnce('worker/domains/lifecycle.ts',
  "  if (gender && gender !== 'ЖЕН' && gender !== 'МУЖ') throw new Error('Пол должен быть выбран из списка.');",
  "  if (gender !== 'ЖЕН' && gender !== 'МУЖ') throw new Error('Для товара «Унисекс» выберите пол конкретной вещи: ЖЕН или МУЖ.');",
)
replaceOnce('worker/domains/lifecycle.ts',
  "    const created = await createCatalogProduct(db, { name: requestedProductName, category });",
  "    const created = await createCatalogProduct(db, { name: requestedProductName, category, genderScope: requestedGenderScope });",
)

// Catalog routes accept scope explicitly (runtime JSON already preserved extra fields, this keeps the boundary typed).
replaceOnce('worker/index.ts',
  "const input = await readJson<{ name?: unknown; category?: unknown }>(request);\n        return json(await createCatalogProduct(env.DB, input), { status: 201 });",
  "const input = await readJson<{ name?: unknown; category?: unknown; genderScope?: unknown }>(request);\n        return json(await createCatalogProduct(env.DB, input), { status: 201 });",
)
replaceOnce('worker/index.ts',
  "const input = await readJson<{ name?: unknown; category?: unknown; isActive?: unknown }>(request);\n        return json(await updateCatalogProduct(env.DB, toInt(productMatch[1], 0), input));",
  "const input = await readJson<{ name?: unknown; category?: unknown; genderScope?: unknown; isActive?: unknown }>(request);\n        return json(await updateCatalogProduct(env.DB, toInt(productMatch[1], 0), input));",
)

const test = `import fs from 'node:fs'\nimport path from 'node:path'\n\nconst root = process.cwd()\nconst read = (file) => fs.readFileSync(path.join(root, file), 'utf8')\nconst check = (condition, message) => { if (!condition) throw new Error(message) }\n\nconst migration = read('migrations/0068_v72_catalog_product_gender_scope.sql')\nconst catalog = read('worker/domains/catalog.ts')\nconst resolver = read('worker/domains/order-reservations.ts')\nconst workspace = read('src/app/controllers/useWorkspaceViewModel.tsx')\nconst operational = read('src/app/controllers/useOperationalViewModel.ts')\nconst exchange = read('src/features/sections/OrderExchangeSection.tsx')\nconst panel = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')\nconst app = read('src/App.tsx')\n\ncheck(migration.includes("ADD COLUMN gender_scope TEXT NOT NULL DEFAULT 'unisex'"), '0068 must add product gender_scope')\ncheck(migration.includes("'ЕҢЛІК ШАПАН'"), '0068 must carry the approved female Enlik rule')\ncheck(migration.includes("CASE p.gender_scope WHEN 'female' THEN 'ЖЕН' ELSE 'МУЖ' END"), '0068 must repair fixed-scope variants')\ncheck(migration.includes('catalog_gender_stock_baseline'), '0068 must preserve retry-safe stock merge evidence')\ncheck(migration.includes("p.gender_scope='unisex' AND TRIM(COALESCE(v.gender,''))=''"), '0068 must identify unused unisex blank placeholders')\n\ncheck(catalog.includes("export type CatalogProductGenderScope = 'female' | 'male' | 'unisex'"), 'Worker product scope type missing')\ncheck(catalog.includes("Для товара «Унисекс» выберите пол конкретной вещи"), 'Worker must require concrete gender for unisex combinations')\ncheck(catalog.includes('genderScope: normalizeCatalogProductGenderScope(row.gender_scope)'), 'Catalog read must expose product scope')\ncheck(catalog.includes('gender_scope, is_active'), 'Catalog create/update must persist product scope')\ncheck(resolver.includes("productGenderScope === 'unisex' && gender !== 'ЖЕН' && gender !== 'МУЖ'"), 'Order resolver must not guess unisex gender')\ncheck(workspace.includes("const automaticGender = productGenderScope === 'female' ? 'ЖЕН' : productGenderScope === 'male' ? 'МУЖ' : ''"), 'Order forms must auto-fill fixed scope and leave unisex blank')\ncheck(workspace.includes("if (productGenderScope === 'unisex' && !normalizedGender) unknownFacts.push('пол')"), 'Availability must ask for unisex gender')\ncheck(operational.includes("gender: automaticGender"), 'Arrival product pick must use product scope')\ncheck(exchange.includes('Выберите для унисекс'), 'Exchange gender must be a controlled choice')\ncheck(panel.includes('Назначение по полу'), 'Catalog product form must expose scope selector')\ncheck(panel.includes('disabled={Boolean(fixedGenderForProduct(selectedProduct))}'), 'Fixed-scope variant editor must not ask repeatedly')\ncheck(app.includes('genderScope: catalogProductDraft.genderScope'), 'Catalog save payload must send scope')\n\nconsole.log('Catalog Gender Scope R1 semantic/static acceptance passed.')\n`;
write('scripts/test-catalog-gender-scope-r1.mjs', test)

replaceOnce('package.json',
  "&& node scripts/test-order-shortage-save-nonblocking.mjs\",",
  "&& node scripts/test-order-shortage-save-nonblocking.mjs && node scripts/test-catalog-gender-scope-r1.mjs\",",
)

console.log('Catalog Gender Scope R1 patch applied.')
