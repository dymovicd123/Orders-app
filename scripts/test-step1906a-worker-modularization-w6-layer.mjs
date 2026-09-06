import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = process.cwd()
const workerRoot = path.join(root, 'worker')
const catalogPath = path.join(workerRoot, 'domains/catalog.ts')
const legacyTestPath = path.join(root, 'scripts/test-step1906a-worker-modularization-legacy.mjs')
const manifestPath = path.join(root, 'scripts/w6-4-catalog-sku-card-worker-manifest.json')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalizeMovedDeclaration = (text) => text.replace(/^export\s+/, '')

const baselineUpdateCatalogVariant = `export async function updateCatalogVariant(db: D1Database, id: number, input: { productId?: unknown; category?: unknown; gender?: unknown; color?: unknown; material?: unknown; length?: unknown; sizeLabel?: unknown; isActive?: unknown; sortOrder?: unknown }) {
  const existing = await db.prepare(
    \`SELECT id, product_id, stock_position_id, category, gender, color, material, length, size_label, is_active, sort_order
     FROM catalog_variants WHERE id = ? LIMIT 1\`
  ).bind(id).first<Record<string, unknown>>();
  if (!existing?.id) throw new Error('Variant not found.');

  const productId = input.productId === undefined ? toInt(existing.product_id, 0) : toInt(input.productId, 0);
  const targetSize = input.sizeLabel === undefined ? cleanText(existing.size_label) : normalizeCatalogCombinationSize(input.sizeLabel);
  const category = input.category === undefined ? normalizeAudienceCategory(existing.category, targetSize) : normalizeAudienceCategory(input.category, targetSize);
  const gender = input.gender === undefined ? normalizeCatalogCombinationGender(existing.gender) : normalizeCatalogCombinationGender(input.gender);
  const color = await resolveCatalogValueAlias(db, 'color', input.color === undefined ? normalizeCatalogCombinationColor(existing.color) : normalizeCatalogCombinationColor(input.color));
  const material = await resolveCatalogValueAlias(db, 'material', input.material === undefined ? canonicalStockPositionValue(existing.material) : canonicalStockPositionValue(input.material));
  const length = await resolveCatalogValueAlias(db, 'length', input.length === undefined ? canonicalStockPositionValue(existing.length) : canonicalStockPositionValue(input.length));
  const sizeLabel = await resolveCatalogValueAlias(db, category === 'child' ? 'child_age' : 'size', targetSize);
  const isActive = input.isActive === undefined ? toInt(existing.is_active, 1) : (cleanText(input.isActive).toLowerCase() === 'false' ? 0 : 1);
  const sortOrder = input.sortOrder === undefined ? toInt(existing.sort_order, 0) : toInt(input.sortOrder, 0);
  const timestamp = new Date().toISOString();

  if (await isCatalogIdentityV3Enabled(db)) {
    if (canonicalStockPositionValue(existing.material) !== material) await requireCatalogAdminReferenceValue(db, 'material', material, 'Материал');
    if (canonicalStockPositionValue(existing.length) !== length) await requireCatalogAdminReferenceValue(db, 'length', length, 'Длина');
    if (normalizeCatalogCombinationColor(existing.color) !== color) await requireCatalogAdminReferenceValue(db, 'color', color, 'Цвет');
    if (normalizeCatalogCombinationSize(existing.size_label) !== sizeLabel || normalizeAudienceCategory(existing.category, existing.size_label) !== category) {
      await requireCatalogAdminReferenceValue(db, category === 'child' ? 'child_age' : 'size', sizeLabel, category === 'child' ? 'Возраст' : 'Размер');
    }
    const execution = await ensureCatalogExecutionV3(db, productId, material, length, timestamp);
    const identityChanged = productId !== toInt(existing.product_id, 0)
      || execution.id !== toInt(existing.stock_position_id, 0)
      || category !== normalizeAudienceCategory(existing.category, existing.size_label)
      || gender !== normalizeCatalogCombinationGender(existing.gender)
      || color !== normalizeCatalogCombinationColor(existing.color)
      || sizeLabel !== normalizeCatalogCombinationSize(existing.size_label);
    if (identityChanged && await catalogVariantHasOperationalUsage(db, id)) {
      throw new Error('Эта комбинация уже использовалась в заказах или движениях склада. Нельзя переписать её историю. Создайте правильную комбинацию отдельно; старую затем можно отключить.');
    }
    const duplicate = await findCatalogCombinationV3(db, execution.id, category, gender, color, sizeLabel, id);
    if (duplicate?.id && isActive) throw new Error('Такая комбинация уже существует. Не создавайте второй дубль.');
    await db.prepare(
      \`UPDATE catalog_variants
       SET product_id = ?, stock_position_id = ?, category = ?, gender = ?, color = ?, material = ?, length = ?,
           size_label = ?, is_active = ?, sort_order = ?, updated_at = ?
       WHERE id = ?\`
    ).bind(productId, execution.id, category, gender || null, color || null, material, length, sizeLabel || null, isActive, sortOrder, timestamp, id).run();
    return { ok: true };
  }

  await db.prepare(
    \`UPDATE catalog_variants
     SET product_id = ?, category = ?, gender = ?, color = ?, material = ?, length = ?, size_label = ?, is_active = ?, sort_order = ?, updated_at = ?
     WHERE id = ?\`
  ).bind(productId, category, gender || null, color || null, material || null, length || null, sizeLabel || null, isActive, sortOrder, timestamp, id).run();
  return { ok: true };
}`

function declarationMap(text, fileName) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const result = new Map()
  for (const statement of source.statements) {
    const name = (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name
      ? statement.name.text
      : null
    if (name) result.set(name, { text: statement.getText(source), start: statement.getStart(source), end: statement.end })
  }
  return result
}

function countWorkerDeclarations(catalogOverride = null) {
  let count = 0
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.ts')) {
        const text = full === catalogPath && catalogOverride !== null ? catalogOverride : fs.readFileSync(full, 'utf8')
        const source = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
        for (const statement of source.statements) {
          if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) count += 1
          else if (ts.isVariableStatement(statement)) {
            count += statement.declarationList.declarations.filter((declaration) => ts.isIdentifier(declaration.name)).length
          }
        }
      }
    }
  }
  walk(workerRoot)
  return count
}

try {
  check(fs.existsSync(legacyTestPath), '1906A legacy structural gate missing')
  check(fs.existsSync(manifestPath), 'W6.4 Worker delta manifest missing')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  check(manifest?.version === 1 && manifest?.revision === 'w6-4-catalog-sku-card', 'W6.4 Worker delta manifest invalid')
  check(Object.keys(manifest.changes || {}).join(',') === 'updateCatalogVariant', 'W6.4 Worker changed-declaration allow-list widened unexpectedly')
  check(Object.keys(manifest.added || {}).join(',') === 'assertCatalogVariantMayDeactivate', 'W6.4 Worker added-declaration allow-list widened unexpectedly')

  const actualCatalog = fs.readFileSync(catalogPath, 'utf8')
  const actualDeclarations = declarationMap(actualCatalog, catalogPath)
  const update = actualDeclarations.get('updateCatalogVariant')
  const helper = actualDeclarations.get('assertCatalogVariantMayDeactivate')
  check(update && helper, 'W6.4 catalog declarations missing')
  check(sha(normalizeMovedDeclaration(update.text)) === manifest.changes.updateCatalogVariant.after, 'W6.4 updateCatalogVariant changed beyond exact manifest')
  check(sha(normalizeMovedDeclaration(helper.text)) === manifest.added.assertCatalogVariantMayDeactivate, 'W6.4 retirement guard changed beyond exact manifest')
  check(sha(normalizeMovedDeclaration(baselineUpdateCatalogVariant)) === manifest.changes.updateCatalogVariant.before, 'W6.4 baseline updateCatalogVariant text does not match accepted pre-W6 hash')

  let legacyCatalog = actualCatalog
  legacyCatalog = legacyCatalog.slice(0, update.start) + baselineUpdateCatalogVariant + legacyCatalog.slice(update.end)
  const legacyDeclarationsAfterUpdate = declarationMap(legacyCatalog, catalogPath)
  const legacyHelper = legacyDeclarationsAfterUpdate.get('assertCatalogVariantMayDeactivate')
  check(legacyHelper, 'W6.4 legacy reconstruction could not locate retirement guard')
  legacyCatalog = legacyCatalog.slice(0, legacyHelper.start) + legacyCatalog.slice(legacyHelper.end)

  const actualCount = countWorkerDeclarations(actualCatalog)
  const legacyCount = countWorkerDeclarations(legacyCatalog)
  check(actualCount === legacyCount + 1, `W6.4 Worker declaration delta is not exactly +1: ${actualCount}/${legacyCount}`)

  fs.writeFileSync(catalogPath, legacyCatalog)
  try {
    await import(`${pathToFileURL(legacyTestPath).href}?w64=${Date.now()}`)
  } finally {
    fs.writeFileSync(catalogPath, actualCatalog)
  }

  const restoredCatalog = fs.readFileSync(catalogPath, 'utf8')
  check(restoredCatalog === actualCatalog, 'W6.4 structural gate failed to restore catalog source after legacy check')
  console.log(`W6.4 WORKER STRUCTURAL LAYER PASSED — legacy 1906A baseline preserved, exact +1 declaration delta accepted (${legacyCount} → ${actualCount})`)
} catch (error) {
  console.error(`W6.4 WORKER STRUCTURAL LAYER FAILED: ${error?.message || error}`)
  process.exit(1)
}
