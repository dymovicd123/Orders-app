import fs from 'node:fs'
import crypto from 'node:crypto'

const PROD_DB_ID = '17e68a41-1d58-4a36-8a63-47c3e32443c4'
const BRANCH2_DB_ID = '40065052-854e-44b8-bcd5-251bdd488301'
const API_BASE = 'https://api.cloudflare.com/client/v4'
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim()
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim()
const MODE = String(process.argv[2] || '').trim()
const SQL_PATH = process.argv[3] || '/tmp/branch2-main-catalog-sync.sql'
const MANIFEST_PATH = process.argv[4] || '/tmp/branch2-main-catalog-sync-manifest.json'
const PLAN_PATH = process.argv[5] || '/tmp/branch2-main-catalog-sync-plan.json'

const MASTER_TABLES = ['catalog_products','catalog_stock_positions','catalog_variants']
const ALIAS_TABLES = ['catalog_product_aliases','catalog_input_aliases','catalog_value_aliases']
const CATALOG_REFERENCE_KINDS = new Set(['material','length','color','size','child_age'])
const CLEAN_ZERO_TABLES = [
  'critical_operation_entities','critical_operations','financial_events','cash_register_entries',
  'activity_log','archive_runs','retained_order_summaries','inventory_operation_evidence',
  'inventory_operation_request_fingerprints','inventory_handover_reviews','inventory_transfer_items',
  'inventory_transfer_documents','inventory_stocktake_items','inventory_stocktake_sessions',
  'inventory_stock_checks','inventory_movement_reversals','inventory_lifecycle_events',
  'inventory_operations','return_workshop_task_reversals','financial_integrity_repairs',
  'exchange_items','exchanges','return_items','returns','workshop_tasks','payments',
  'inventory_reservations','catalog_identity_order_item_links','order_items','orders','customers',
  'inventory_movements'
]
const TRANSACTION_SEQUENCE_TABLES = [
  'customers','orders','order_items','payments','returns','return_items','workshop_tasks',
  'exchanges','exchange_items','activity_log','archive_runs','cash_register_entries',
  'financial_events','retained_order_summaries','inventory_reservations','inventory_handover_reviews',
  'inventory_stocktake_items','inventory_stock_checks','inventory_transfer_documents',
  'inventory_transfer_items','inventory_operation_evidence','financial_integrity_repairs',
  'return_workshop_task_reversals','inventory_movements'
]

function check(condition, message) {
  if (!condition) throw new Error(message)
}

function quoted(name) {
  check(/^[A-Za-z0-9_]+$/.test(name), 'Unsafe SQL identifier: ' + name)
  return '"' + name + '"'
}

function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') {
    check(Number.isFinite(value), 'Non-finite numeric SQL value')
    return String(value)
  }
  if (typeof value === 'boolean') return value ? '1' : '0'
  return "'" + String(value).replaceAll("'", "''") + "'"
}

async function d1Query(databaseId, sql, params = []) {
  check(ACCOUNT_ID && API_TOKEN, 'Cloudflare account/token environment is required')
  if (databaseId === PROD_DB_ID) {
    const head = sql.trimStart().slice(0, 16).toUpperCase()
    check(head.startsWith('SELECT') || head.startsWith('PRAGMA'), 'Production D1 is read-only in this sync')
  }
  const response = await fetch(
    API_BASE + '/accounts/' + ACCOUNT_ID + '/d1/database/' + databaseId + '/query',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + API_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    }
  )
  const payload = await response.json().catch(() => null)
  check(response.ok && payload && payload.success !== false,
    'D1 query failed for ' + databaseId + ': ' + response.status + ' ' + JSON.stringify(payload && (payload.errors || payload)))
  const chunks = Array.isArray(payload.result) ? payload.result : [payload.result]
  for (const chunk of chunks) {
    if (chunk && chunk.success === false) throw new Error('D1 statement failed: ' + JSON.stringify(chunk))
  }
  return chunks.flatMap(chunk => Array.isArray(chunk && chunk.results) ? chunk.results : [])
}

async function d1BatchWrite(databaseId, statements, chunkSize = 40) {
  check(ACCOUNT_ID && API_TOKEN, 'Cloudflare account/token environment is required')
  check(databaseId === BRANCH2_DB_ID, 'D1 batch writes are allowed only to Branch2')
  check(Array.isArray(statements) && statements.length > 0, 'Branch2 write plan is empty')

  for (let offset = 0; offset < statements.length; offset += chunkSize) {
    const chunk = statements.slice(offset, offset + chunkSize)
    const response = await fetch(
      API_BASE + '/accounts/' + ACCOUNT_ID + '/d1/database/' + databaseId + '/query',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + API_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ batch: chunk.map(sql => ({ sql })) }),
      }
    )
    const payload = await response.json().catch(() => null)
    check(response.ok && payload && payload.success !== false,
      'Branch2 D1 batch failed at statement ' + offset + ': ' + response.status + ' ' + JSON.stringify(payload && (payload.errors || payload)))
    const results = Array.isArray(payload.result) ? payload.result : [payload.result]
    check(results.length === chunk.length,
      'Branch2 D1 batch result count mismatch at statement ' + offset + ': expected ' + chunk.length + ', got ' + results.length)
    results.forEach((result, index) => {
      check(result && result.success !== false,
        'Branch2 D1 statement failed at index ' + (offset + index) + ': ' + JSON.stringify(result))
    })
    console.log('Applied Branch2 sync statements ' + offset + '..' + (offset + chunk.length - 1) + ' of ' + statements.length)
  }
}

async function tableInfo(databaseId, table) {
  return await d1Query(databaseId, 'PRAGMA table_info(' + quoted(table) + ')')
}

async function readAll(databaseId, table) {
  const info = await tableInfo(databaseId, table)
  check(info.length > 0, 'Missing table ' + table + ' in D1 ' + databaseId)
  const firstColumn = String(info[0].name)
  const rows = await d1Query(databaseId, 'SELECT * FROM ' + quoted(table) + ' ORDER BY ' + quoted(firstColumn))
  return { info, rows }
}

function canonicalRows(table, rows) {
  const ignorePrimaryKey = ALIAS_TABLES.includes(table) || table === 'reference_values'
  const normalized = rows.map(row => {
    const out = {}
    for (const key of Object.keys(row).sort()) {
      if (ignorePrimaryKey && key === 'id') continue
      out[key] = row[key]
    }
    return out
  })
  normalized.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return normalized
}

function hashRows(table, rows) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalRows(table, rows))).digest('hex')
}

function findEthnoCardigan(products, variants) {
  const product = products.find(row => {
    const name = String(row.name || '').normalize('NFKC').toLocaleUpperCase('ru-RU')
    return name.includes('ЭТНО') && name.includes('КАРДИГАН')
  })
  if (!product) return null
  const productVariants = variants.filter(row =>
    Number(row.product_id) === Number(product.id) && Number(row.is_active === undefined ? 1 : row.is_active) === 1
  )
  return {
    id: Number(product.id),
    name: String(product.name || ''),
    genderScope: String(product.gender_scope || ''),
    activeVariants: productVariants.length,
    femaleVariants: productVariants.filter(row => String(row.gender || '').trim().toLocaleUpperCase('ru-RU').includes('ЖЕН')).length,
    maleVariants: productVariants.filter(row => String(row.gender || '').trim().toLocaleUpperCase('ru-RU').includes('МУЖ')).length,
    blankGenderVariants: productVariants.filter(row => !String(row.gender || '').trim()).length,
  }
}

function insertRows(table, info, rows, preservePrimaryKey) {
  if (!rows.length) return []
  const primaryKeys = new Set(info.filter(col => Number(col.pk || 0) > 0).map(col => String(col.name)))
  const columns = info.map(col => String(col.name)).filter(name => preservePrimaryKey || !primaryKeys.has(name))
  const statements = []
  for (const row of rows) {
    const values = columns.map(name => sqlValue(row[name]))
    if (preservePrimaryKey) {
      const keyColumns = info.filter(col => Number(col.pk || 0) > 0).map(col => String(col.name))
      check(keyColumns.length === 1 && keyColumns[0] === 'id', table + ': expected single id primary key')
      const updates = columns.filter(name => name !== 'id').map(name => quoted(name) + '=excluded.' + quoted(name))
      statements.push(
        'INSERT INTO ' + quoted(table) + ' (' + columns.map(quoted).join(',') + ') VALUES (' + values.join(',') + ') ' +
        'ON CONFLICT(id) DO UPDATE SET ' + updates.join(',') + ';'
      )
    } else {
      statements.push('INSERT INTO ' + quoted(table) + ' (' + columns.map(quoted).join(',') + ') VALUES (' + values.join(',') + ');')
    }
  }
  return statements
}

async function loadSourceSnapshot() {
  const source = {}
  for (const table of MASTER_TABLES.concat(ALIAS_TABLES)) {
    source[table] = await readAll(PROD_DB_ID, table)
    const targetInfo = await tableInfo(BRANCH2_DB_ID, table)
    const targetNames = new Set(targetInfo.map(col => String(col.name)))
    for (const col of source[table].info) {
      check(targetNames.has(String(col.name)), 'Branch2 ' + table + ' misses main column ' + col.name)
    }
    for (const col of targetInfo) {
      const name = String(col.name)
      if (source[table].info.some(mainCol => String(mainCol.name) === name)) continue
      const requiredWithoutDefault = Number(col.notnull || 0) === 1 && col.dflt_value == null && Number(col.pk || 0) === 0
      check(!requiredWithoutDefault, 'Branch2-only required column cannot be populated safely: ' + table + '.' + name)
    }
  }
  const refs = await readAll(PROD_DB_ID, 'reference_values')
  const targetRefInfo = await tableInfo(BRANCH2_DB_ID, 'reference_values')
  const targetRefNames = new Set(targetRefInfo.map(col => String(col.name)))
  for (const col of refs.info) {
    check(targetRefNames.has(String(col.name)), 'Branch2 reference_values misses main column ' + col.name)
  }
  source.reference_values = {
    info: refs.info,
    rows: refs.rows.filter(row => CATALOG_REFERENCE_KINDS.has(String(row.kind || ''))),
  }
  return source
}

function idStageSql(name, rows) {
  const ids = rows.map(row => Number(row.id)).filter(Number.isFinite)
  const table = '_branch2_sync_' + name + '_ids_20260926'
  const out = [
    'DROP TABLE IF EXISTS ' + quoted(table) + ';',
    'CREATE TABLE ' + quoted(table) + ' (id INTEGER PRIMARY KEY);',
  ]
  for (const id of ids) out.push('INSERT INTO ' + quoted(table) + '(id) VALUES (' + id + ');')
  return { table, sql: out }
}

function sequenceResetSql(table) {
  return [
    'UPDATE sqlite_sequence SET seq=(SELECT COALESCE(MAX(id),0) FROM ' + quoted(table) + ') WHERE name=' + sqlValue(table) + ';',
    'INSERT INTO sqlite_sequence(name,seq) SELECT ' + sqlValue(table) + ', COALESCE(MAX(id),0) FROM ' + quoted(table) +
      ' WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name=' + sqlValue(table) + ');',
  ]
}

async function prepare() {
  check(process.env.GITHUB_REF_NAME === 'branch2', 'Catalog sync prepare may run only on branch2')
  const source = await loadSourceSnapshot()
  const ethno = findEthnoCardigan(source.catalog_products.rows, source.catalog_variants.rows)
  check(ethno, 'Main Catalog does not contain an Этно кардиган product; refusing to replace Branch2 Catalog')

  const productStage = idStageSql('main_product', source.catalog_products.rows)
  const positionStage = idStageSql('main_position', source.catalog_stock_positions.rows)
  const variantStage = idStageSql('main_variant', source.catalog_variants.rows)

  const sql = []
  sql.push('PRAGMA foreign_keys = ON;')
  sql.push('CREATE TABLE IF NOT EXISTS "_branch2_catalog_price_backup_20260926" (product_name TEXT NOT NULL, material TEXT NOT NULL, length TEXT NOT NULL, category TEXT NOT NULL, cost_price INTEGER, sale_price INTEGER, created_at TEXT, updated_at TEXT, PRIMARY KEY(product_name, material, length, category));')
  sql.push("INSERT OR IGNORE INTO \"_branch2_catalog_price_backup_20260926\"(product_name,material,length,category,cost_price,sale_price,created_at,updated_at) SELECT UPPER(TRIM(p.name)),UPPER(TRIM(sp.material)),UPPER(TRIM(sp.length)),ep.category,ep.cost_price,ep.sale_price,ep.created_at,ep.updated_at FROM catalog_execution_prices ep JOIN catalog_stock_positions sp ON sp.id=ep.stock_position_id JOIN catalog_products p ON p.id=sp.product_id WHERE p.name NOT LIKE 'BR2-H8-%';")

  for (const table of CLEAN_ZERO_TABLES) sql.push('DELETE FROM ' + quoted(table) + ';')
  sql.push('DELETE FROM order_search_orders_fts;')
  sql.push('DELETE FROM order_search_items_fts;')
  sql.push('DELETE FROM order_search_payments_fts;')
  sql.push('DELETE FROM sqlite_sequence WHERE name IN (' + TRANSACTION_SEQUENCE_TABLES.map(sqlValue).join(',') + ');')
  sql.push('UPDATE inventory_stock SET reserved_quantity=0,updated_at=CURRENT_TIMESTAMP WHERE COALESCE(reserved_quantity,0)<>0;')
  sql.push("UPDATE cash_register_settings SET opening_amount=0,initialized_at=CURRENT_TIMESTAMP,activated_at=CASE WHEN auto_tracking_enabled=1 THEN CURRENT_TIMESTAMP ELSE activated_at END,updated_at=CURRENT_TIMESTAMP WHERE id=1;")

  sql.push(...productStage.sql, ...positionStage.sql, ...variantStage.sql)
  sql.push("DELETE FROM inventory_stock WHERE product_name_snapshot LIKE 'BR2-H8-%' OR (product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM " + quoted(productStage.table) + " x WHERE x.id=inventory_stock.product_id)) OR (variant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM " + quoted(variantStage.table) + " x WHERE x.id=inventory_stock.variant_id));")
  sql.push('DELETE FROM catalog_input_aliases;')
  sql.push('DELETE FROM catalog_product_aliases;')
  sql.push('DELETE FROM catalog_value_aliases;')
  sql.push('DELETE FROM catalog_variants WHERE NOT EXISTS (SELECT 1 FROM ' + quoted(variantStage.table) + ' x WHERE x.id=catalog_variants.id);')
  sql.push('DELETE FROM catalog_stock_positions WHERE NOT EXISTS (SELECT 1 FROM ' + quoted(positionStage.table) + ' x WHERE x.id=catalog_stock_positions.id);')
  sql.push('DELETE FROM catalog_products WHERE NOT EXISTS (SELECT 1 FROM ' + quoted(productStage.table) + ' x WHERE x.id=catalog_products.id);')

  sql.push(...insertRows('catalog_products', source.catalog_products.info, source.catalog_products.rows, true))
  sql.push(...insertRows('catalog_stock_positions', source.catalog_stock_positions.info, source.catalog_stock_positions.rows, true))
  sql.push(...insertRows('catalog_variants', source.catalog_variants.info, source.catalog_variants.rows, true))
  sql.push(...insertRows('catalog_product_aliases', source.catalog_product_aliases.info, source.catalog_product_aliases.rows, false))
  sql.push(...insertRows('catalog_input_aliases', source.catalog_input_aliases.info, source.catalog_input_aliases.rows, false))
  sql.push(...insertRows('catalog_value_aliases', source.catalog_value_aliases.info, source.catalog_value_aliases.rows, false))

  sql.push('DELETE FROM reference_values WHERE kind IN (' + Array.from(CATALOG_REFERENCE_KINDS).map(sqlValue).join(',') + ');')
  sql.push(...insertRows('reference_values', source.reference_values.info, source.reference_values.rows, false))

  sql.push('UPDATE inventory_stock SET product_id=(SELECT v.product_id FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),product_name_snapshot=(SELECT p.name FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id WHERE v.id=inventory_stock.variant_id),gender_snapshot=(SELECT NULLIF(v.gender,\'\') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),color_snapshot=(SELECT NULLIF(v.color,\'\') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),material_snapshot=(SELECT NULLIF(v.material,\'\') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),length_snapshot=(SELECT NULLIF(v.length,\'\') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),size_snapshot=(SELECT NULLIF(v.size_label,\'\') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),reserved_quantity=0,updated_at=CURRENT_TIMESTAMP WHERE variant_id IS NOT NULL AND EXISTS (SELECT 1 FROM ' + quoted(variantStage.table) + ' x WHERE x.id=inventory_stock.variant_id);')

  sql.push('DELETE FROM catalog_execution_prices;')
  sql.push('INSERT INTO catalog_execution_prices(stock_position_id,category,cost_price,sale_price,created_at,updated_at) SELECT sp.id,b.category,b.cost_price,b.sale_price,COALESCE(b.created_at,CURRENT_TIMESTAMP),COALESCE(b.updated_at,CURRENT_TIMESTAMP) FROM "_branch2_catalog_price_backup_20260926" b JOIN catalog_products p ON UPPER(TRIM(p.name))=b.product_name JOIN catalog_stock_positions sp ON sp.product_id=p.id AND UPPER(TRIM(sp.material))=b.material AND UPPER(TRIM(sp.length))=b.length AND sp.is_active=1 ON CONFLICT(stock_position_id,category) DO UPDATE SET cost_price=excluded.cost_price,sale_price=excluded.sale_price,updated_at=excluded.updated_at;')

  for (const table of ['catalog_products','catalog_stock_positions','catalog_variants','catalog_product_aliases','catalog_input_aliases','catalog_value_aliases','inventory_stock']) {
    sql.push(...sequenceResetSql(table))
  }

  sql.push('DROP TABLE ' + quoted(productStage.table) + ';')
  sql.push('DROP TABLE ' + quoted(positionStage.table) + ';')
  sql.push('DROP TABLE ' + quoted(variantStage.table) + ';')
  sql.push('DROP TABLE "_branch2_catalog_price_backup_20260926";')

  fs.writeFileSync(SQL_PATH, sql.join('\n') + '\n')
  fs.writeFileSync(PLAN_PATH, JSON.stringify(sql, null, 2) + '\n')
  const tablesForFingerprint = MASTER_TABLES.concat(ALIAS_TABLES, ['reference_values'])
  const manifest = {
    generatedAt: new Date().toISOString(),
    githubSha: process.env.GITHUB_SHA || '',
    sourceDatabaseId: PROD_DB_ID,
    targetDatabaseId: BRANCH2_DB_ID,
    fingerprints: Object.fromEntries(tablesForFingerprint.map(table => [table, hashRows(table, source[table].rows)])),
    counts: Object.fromEntries(tablesForFingerprint.map(table => [table, source[table].rows.length])),
    ethnoCardigan: ethno,
  }
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')
  console.log(JSON.stringify({ phase: 'prepared', counts: manifest.counts, ethnoCardigan: ethno }, null, 2))
}

async function apply() {
  check(process.env.GITHUB_REF_NAME === 'branch2', 'Catalog sync apply may run only on branch2')
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  check(manifest.sourceDatabaseId === PROD_DB_ID && manifest.targetDatabaseId === BRANCH2_DB_ID, 'Sync manifest database identity drifted')
  const statements = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'))
  check(Array.isArray(statements) && statements.length > 0, 'Prepared Branch2 sync plan is missing')
  check(statements.every(statement => typeof statement === 'string' && !statement.includes(PROD_DB_ID) && !statement.includes('orders_db_prod')),
    'Prepared Branch2 write plan contains Production identity')
  await d1BatchWrite(BRANCH2_DB_ID, statements)
  console.log(JSON.stringify({ phase: 'applied', statements: statements.length, targetDatabaseId: BRANCH2_DB_ID }, null, 2))
}

async function verify() {
  check(process.env.GITHUB_REF_NAME === 'branch2', 'Catalog sync verification may run only on branch2')
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  check(manifest.sourceDatabaseId === PROD_DB_ID && manifest.targetDatabaseId === BRANCH2_DB_ID, 'Sync manifest database identity drifted')

  const actual = {}
  for (const table of MASTER_TABLES.concat(ALIAS_TABLES)) actual[table] = (await readAll(BRANCH2_DB_ID, table)).rows
  const refs = await readAll(BRANCH2_DB_ID, 'reference_values')
  actual.reference_values = refs.rows.filter(row => CATALOG_REFERENCE_KINDS.has(String(row.kind || '')))

  for (const table of MASTER_TABLES.concat(ALIAS_TABLES, ['reference_values'])) {
    check(hashRows(table, actual[table]) === manifest.fingerprints[table], 'Branch2 ' + table + ' does not match the captured main Catalog snapshot')
    check(actual[table].length === manifest.counts[table], 'Branch2 ' + table + ' count differs from main snapshot')
  }

  for (const table of CLEAN_ZERO_TABLES) {
    const rows = await d1Query(BRANCH2_DB_ID, 'SELECT COUNT(*) AS count FROM ' + quoted(table))
    check(Number((rows[0] && rows[0].count) || 0) === 0, 'Branch2 cleanup incomplete: ' + table + ' still has rows')
  }
  for (const table of ['order_search_orders_fts','order_search_items_fts','order_search_payments_fts']) {
    const rows = await d1Query(BRANCH2_DB_ID, 'SELECT COUNT(*) AS count FROM ' + quoted(table))
    check(Number((rows[0] && rows[0].count) || 0) === 0, 'Branch2 FTS cleanup incomplete: ' + table + ' still has rows')
  }

  const residue = await d1Query(BRANCH2_DB_ID,
    "SELECT (SELECT COUNT(*) FROM catalog_products WHERE name LIKE 'BR2-H8-%') AS fixture_products," +
    "(SELECT COUNT(*) FROM inventory_stock WHERE product_name_snapshot LIKE 'BR2-H8-%') AS fixture_stock," +
    "(SELECT COALESCE(SUM(reserved_quantity),0) FROM inventory_stock) AS reserved_total," +
    "(SELECT COUNT(*) FROM sqlite_master WHERE name LIKE '_branch2_sync_%' OR name='_branch2_catalog_price_backup_20260926') AS helper_tables"
  )
  const rr = residue[0] || {}
  check(Number(rr.fixture_products || 0) === 0, 'BR2-H8 fixture products survived cleanup')
  check(Number(rr.fixture_stock || 0) === 0, 'BR2-H8 fixture stock survived cleanup')
  check(Number(rr.reserved_total || 0) === 0, 'Reserved stock survived order cleanup')
  check(Number(rr.helper_tables || 0) === 0, 'One-shot sync helper tables survived cleanup')

  const ethno = findEthnoCardigan(actual.catalog_products, actual.catalog_variants)
  check(ethno, 'Этно кардиган is still absent from Branch2 after main Catalog sync')
  check(JSON.stringify(ethno) === JSON.stringify(manifest.ethnoCardigan), 'Этно кардиган Branch2 facts differ from captured main Catalog')

  console.log(JSON.stringify({
    phase: 'verified',
    transactionalTablesCleared: CLEAN_ZERO_TABLES.length,
    catalogCounts: manifest.counts,
    ethnoCardigan: ethno,
    reservedStock: 0,
    fixtureProducts: 0,
    helperTables: 0,
  }, null, 2))
}

if (MODE === 'prepare') await prepare()
else if (MODE === 'apply') await apply()
else if (MODE === 'verify') await verify()
else throw new Error('Usage: node scripts/branch2-sync-main-catalog-once.mjs prepare|apply|verify [sqlPath] [manifestPath] [planPath]')
