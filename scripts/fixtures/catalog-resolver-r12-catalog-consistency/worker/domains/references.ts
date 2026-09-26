// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { json, readJson } from '../core/http.ts'
import { mapSqlRows } from '../core/sql.ts'
import { canonicalStockPositionValue, cleanText, normalizePhone, toInt, upperText } from '../core/text.ts'
import type { ReferenceKind, ReferenceValueRecord } from '../core/types.ts'
import { normalizeManagerColor } from './activity.ts'

export async function getPendingInventoryWriteoffCount(db: D1Database) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE oi.is_workshop = 0
       AND oi.stock_writeoff_status IN ('writeoff_disabled', 'pending_manual_writeoff')
       AND oi.quantity > 0
       AND COALESCE(o.order_status, '') <> 'deleted'`
  ).first<{ count: number }>();
  return toInt(row?.count, 0);
}


export async function listDistinctText(db: D1Database, sql: string, bindings: Array<string | number> = []) {
  const result = bindings.length
    ? await db.prepare(sql).bind(...bindings).all<{ value: string }>()
    : await db.prepare(sql).all<{ value: string }>();
  return (result.results || [])
    .map(row => cleanText((row as any).value))
    .filter(Boolean);
}


// Canonical default reference values are created by D1 migrations.
// Runtime GET/CRUD paths must never reseed or rewrite the reference tables.

export function normalizeReferenceKind(value: unknown): ReferenceKind | null {
  const text = cleanText(value).toLowerCase();
  if (text === 'managers' || text === 'manager') return 'managers';
  if (text === 'cities' || text === 'city') return 'cities';
  if (text === 'deliverytypes' || text === 'delivery_type' || text === 'deliverytype') return 'deliveryTypes';
  if (text === 'paymentmethods' || text === 'payment_method' || text === 'paymentmethod') return 'paymentMethods';
  if (text === 'colors' || text === 'color') return 'colors';
  if (text === 'materials' || text === 'material') return 'materials';
  if (text === 'lengths' || text === 'length') return 'lengths';
  if (text === 'sizes' || text === 'size') return 'sizes';
  if (text === 'childages' || text === 'child_age' || text === 'childage') return 'childAges';
  if (text === 'returnreasons' || text === 'return_reason' || text === 'returnreason') return 'returnReasons';
  if (text === 'writeoffreasons' || text === 'writeoff_reason' || text === 'writeoffreason') return 'writeoffReasons';
  return null;
}


export function referenceKindToDbKind(kind: ReferenceKind) {
  switch (kind) {
    case 'cities':
      return 'city';
    case 'deliveryTypes':
      return 'delivery_type';
    case 'paymentMethods':
      return 'payment_method';
    case 'childAges':
      return 'child_age';
    case 'returnReasons':
      return 'return_reason';
    case 'writeoffReasons':
      return 'writeoff_reason';
    case 'colors':
      return 'color';
    case 'materials':
      return 'material';
    case 'lengths':
      return 'length';
    case 'sizes':
      return 'size';
    default:
      return kind;
  }
}


export async function listReferenceValues(db: D1Database, kind: ReferenceKind) {

  if (kind === 'managers') {
    const result = await db.prepare(
      `SELECT
         id,
         name AS value,
         is_active AS isActive,
         0 AS sortOrder,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM managers
       ORDER BY is_active DESC, name ASC, id ASC`
    ).all<ReferenceValueRecord>();

    return {
      ok: true,
      kind,
      items: (result.results || []).map(row => ({
        id: Number(row.id),
        value: row.value,
        isActive: Boolean(row.isActive),
        sortOrder: Number(row.sortOrder || 0),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    };
  }

  const dbKind = referenceKindToDbKind(kind);
  const result = await db.prepare(
    `SELECT
       id,
       value,
       is_active AS isActive,
       sort_order AS sortOrder,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM reference_values
     WHERE kind = ?
     ORDER BY is_active DESC, sort_order ASC, value ASC, id ASC`
  ).bind(dbKind).all<ReferenceValueRecord>();

  return {
    ok: true,
    kind,
    items: (result.results || []).map(row => ({
      id: Number(row.id),
      value: row.value,
      isActive: Boolean(row.isActive),
      sortOrder: Number(row.sortOrder || 0),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
  };
}


export async function getReferenceValueCounts(db: D1Database, kinds: ReferenceKind[]) {
  const requested = Array.from(new Set(kinds.filter(kind => kind !== 'managers')));
  const counts: Record<string, { total: number; active: number; inactive: number }> = {};
  for (const kind of requested) counts[kind] = { total: 0, active: 0, inactive: 0 };
  if (!requested.length) return { ok: true, counts };

  const dbKinds = requested.map(referenceKindToDbKind);
  const placeholders = dbKinds.map(() => '?').join(', ');
  const result = await db.prepare(
    `SELECT kind, COUNT(*) AS total,
            SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active
     FROM reference_values
     WHERE kind IN (${placeholders})
     GROUP BY kind`
  ).bind(...dbKinds).all<{ kind: string; total: number; active: number }>();

  const dbToApi = new Map(requested.map(kind => [referenceKindToDbKind(kind), kind]));
  for (const row of result.results || []) {
    const kind = dbToApi.get(cleanText(row.kind));
    if (!kind) continue;
    const total = toInt(row.total, 0);
    const active = toInt(row.active, 0);
    counts[kind] = { total, active, inactive: Math.max(0, total - active) };
  }
  return { ok: true, counts };
}



export function isCatalogCharacteristicDbKind(kind: string) {
  return ['color', 'material', 'length', 'size', 'child_age'].includes(cleanText(kind));
}


export async function countCatalogReferenceUsage(db: D1Database, dbKind: string, rawValue: unknown) {
  const value = upperText(rawValue);
  if (!value || !isCatalogCharacteristicDbKind(dbKind)) return 0;
  let sql = '';
  if (dbKind === 'color') sql = `SELECT COUNT(*) AS count FROM catalog_variants WHERE is_active = 1 AND UPPER(TRIM(COALESCE(color,''))) = ?`;
  else if (dbKind === 'material') sql = `SELECT COUNT(*) AS count FROM catalog_variants WHERE is_active = 1 AND COALESCE(NULLIF(UPPER(TRIM(material)),''),'СТАНДАРТ') = ?`;
  else if (dbKind === 'length') sql = `SELECT COUNT(*) AS count FROM catalog_variants WHERE is_active = 1 AND COALESCE(NULLIF(UPPER(TRIM(length)),''),'СТАНДАРТ') = ?`;
  else if (dbKind === 'size') sql = `SELECT COUNT(*) AS count FROM catalog_variants WHERE is_active = 1 AND COALESCE(category,'adult') <> 'child' AND UPPER(TRIM(COALESCE(size_label,''))) = ?`;
  else sql = `SELECT COUNT(*) AS count FROM catalog_variants WHERE is_active = 1 AND COALESCE(category,'adult') = 'child' AND UPPER(TRIM(COALESCE(size_label,''))) = ?`;
  const normalized = (dbKind === 'material' || dbKind === 'length') ? (canonicalStockPositionValue(value) || 'СТАНДАРТ') : value;
  const row = await db.prepare(sql).bind(normalized).first<{ count: number }>();
  return Math.max(0, toInt(row?.count, 0));
}


export async function assertReferenceValueCanChange(db: D1Database, dbKind: string, id: number, nextValue?: string, nextActive?: number) {
  if (!id || !isCatalogCharacteristicDbKind(dbKind)) return;
  const existing = await db.prepare(`SELECT value, is_active FROM reference_values WHERE id = ? AND kind = ? LIMIT 1`).bind(id, dbKind).first<Record<string, unknown>>();
  if (!existing) return;
  const currentValue = upperText(existing.value);
  const valueChanges = nextValue !== undefined && upperText(nextValue) !== currentValue;
  const disables = nextActive !== undefined && Number(nextActive) === 0 && toInt(existing.is_active, 1) === 1;
  if (!valueChanges && !disables) return;
  const usage = await countCatalogReferenceUsage(db, dbKind, currentValue);
  if (!usage) return;
  throw new Error(`Значение «${currentValue}» используется в ${usage} активн${usage === 1 ? 'ом варианте' : 'ых вариантах'} каталога. Простое переименование/отключение разорвёт справочник и варианты. Добавьте новое значение отдельно; объединение используемых значений выполняется только контролируемой миграцией каталога.`);
}


export async function upsertReferenceValue(db: D1Database, input: { kind?: unknown; value?: unknown; sortOrder?: unknown; isActive?: unknown }, id?: number) {
  const kind = normalizeReferenceKind(input.kind);
  if (!kind) {
    throw new Error('Unknown reference kind.');
  }

  const value = upperText(input.value);
  if (!value) {
    throw new Error('Reference value is required.');
  }

  const isActive = Number(input.isActive) === 0 ? 0 : 1;
  const sortOrder = Math.max(0, toInt(input.sortOrder, 0));
  const now = new Date().toISOString();

  if (kind === 'managers') {
    if (id) {
      await db.prepare(
        `UPDATE managers
         SET name = ?, is_active = ?, updated_at = ?
         WHERE id = ?`
      ).bind(value, isActive, now, id).run();
    } else {
      await db.prepare(
        `INSERT INTO managers (name, is_active, color_key, hired_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(value, isActive, normalizeManagerColor('', Date.now()), now.slice(0, 10), now, now).run();
    }

    return { ok: true, kind, value };
  }

  const dbKind = referenceKindToDbKind(kind);
  if (id) {
    await assertReferenceValueCanChange(db, dbKind, id, value, isActive);
    await db.prepare(
      `UPDATE reference_values
       SET value = ?, is_active = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    ).bind(value, isActive, sortOrder, now, id).run();
  } else {
    await db.prepare(
      `INSERT INTO reference_values (kind, value, is_active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(kind, value) DO UPDATE SET
         is_active = excluded.is_active,
         sort_order = excluded.sort_order,
         updated_at = excluded.updated_at`
    ).bind(dbKind, value, isActive, sortOrder, now, now).run();
  }

  return { ok: true, kind, value };
}


export async function disableReferenceValue(db: D1Database, kind: ReferenceKind, id: number) {
  const now = new Date().toISOString();
  if (kind === 'managers') {
    await db.prepare('UPDATE managers SET is_active = 0, updated_at = ? WHERE id = ?').bind(now, id).run();
    return { ok: true };
  }

  const dbKind = referenceKindToDbKind(kind);
  await assertReferenceValueCanChange(db, dbKind, id, undefined, 0);
  await db.prepare('UPDATE reference_values SET is_active = 0, updated_at = ? WHERE id = ?').bind(now, id).run();
  return { ok: true };
}


export async function resolveManagerId(db: D1Database, managerName: unknown) {
  const name = upperText(managerName);
  if (!name) return null;

  const activeMatches = await db.prepare(
    'SELECT id FROM managers WHERE name = ? AND is_active = 1 ORDER BY id'
  ).bind(name).all<{ id: number }>();
  const activeIds = (activeMatches.results || []).map(row => Number(row.id || 0)).filter(Boolean);
  if (activeIds.length === 1) return activeIds[0];
  if (activeIds.length > 1) {
    throw new Error(`Есть несколько активных сотрудников с именем ${name}. Выберите сотрудника из цветного списка.`);
  }

  const former = await db.prepare('SELECT id FROM managers WHERE name = ? AND is_active = 0 LIMIT 1').bind(name).first<{ id: number }>();
  if (former?.id) {
    throw new Error(`${name} находится в бывших сотрудниках. Обновите страницу и выберите действующего сотрудника из списка.`);
  }

  const now = new Date().toISOString();
  const inserted = await db.prepare(
    `INSERT INTO managers (name, color_key, hired_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(name, normalizeManagerColor('', Date.now()), now.slice(0, 10), now, now).run();

  return Number(inserted.meta?.last_row_id || 0) || null;
}


export async function upsertCustomerIdentityForOrderCreate(
  db: D1Database,
  customerPhone: unknown,
  customerName: unknown,
  city: unknown,
  timestamp: string,
) {
  const phone = normalizePhone(customerPhone)
  if (!phone) return null

  const displayName = cleanText(customerName) || null
  const nextCity = cleanText(city) || null
  await db.prepare(
    `INSERT INTO customers
      (phone_normalized, display_name, city, first_order_at, last_order_at, orders_count, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, 0, ?, ?)
     ON CONFLICT(phone_normalized) DO UPDATE SET
       display_name = COALESCE(NULLIF(excluded.display_name, ''), customers.display_name),
       city = COALESCE(NULLIF(excluded.city, ''), customers.city),
       updated_at = excluded.updated_at`
  ).bind(phone, displayName, nextCity, timestamp, timestamp).run()
  const customer = await db.prepare(
    'SELECT id FROM customers WHERE phone_normalized = ? LIMIT 1'
  ).bind(phone).first<{ id: number }>()
  return Number(customer?.id || 0) || null
}


export async function upsertCustomerId(
  db: D1Database,
  customerPhone: unknown,
  customerName: unknown,
  city: unknown,
  timestamp: string,
  incrementOrderCount: boolean,
) {
  const phone = normalizePhone(customerPhone)
  if (!phone) return null

  const displayName = cleanText(customerName) || null
  const nextCity = cleanText(city) || null
  await db.prepare(
    `INSERT INTO customers
      (phone_normalized, display_name, city, first_order_at, last_order_at, orders_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(phone_normalized) DO UPDATE SET
       display_name = COALESCE(NULLIF(excluded.display_name, ''), customers.display_name),
       city = COALESCE(NULLIF(excluded.city, ''), customers.city),
       orders_count = COALESCE(customers.orders_count, 0) + CASE WHEN ? = 1 THEN 1 ELSE 0 END,
       last_order_at = excluded.last_order_at,
       updated_at = excluded.updated_at`
  ).bind(
    phone,
    displayName,
    nextCity,
    timestamp,
    timestamp,
    timestamp,
    timestamp,
    incrementOrderCount ? 1 : 0,
  ).run()
  const customer = await db.prepare(
    'SELECT id FROM customers WHERE phone_normalized = ? LIMIT 1'
  ).bind(phone).first<{ id: number }>()
  return Number(customer?.id || 0) || null
}


export async function getReferenceData(db: D1Database) {
  const runD1Bounded = async (tasks: Array<() => Promise<any>>) => {
    const results: any[] = [];
    for (let index = 0; index < tasks.length; index += 6) {
      results.push(...await Promise.all(tasks.slice(index, index + 6).map(task => task())));
    }
    return results;
  };

  // Справочники берём из канонического каталога и таблиц-справочников,
  // а не из истории заказов: так подсказки остаются чистыми и предсказуемыми.
  const [managerOptionsResult, cities, deliveryTypes, paymentMethods, products, adultProducts, childProducts, colors, materials, lengths, sizes, childAges, returnReasons, writeoffReasons] = await runD1Bounded([
    () => db.prepare(`SELECT id, name, COALESCE(color_key, '#2563EB') AS color_key, COALESCE(hired_at, substr(created_at, 1, 10)) AS hired_at FROM managers WHERE name IS NOT NULL AND name <> '' AND is_active = 1 ORDER BY name, hired_at, id LIMIT 200`).all<any>(),
    () => listDistinctText(db, `SELECT DISTINCT value AS value FROM reference_values WHERE kind = ? AND value IS NOT NULL AND value <> '' AND is_active = 1 ORDER BY sort_order, value LIMIT 100`, ['city']),
    () => listDistinctText(db, `SELECT DISTINCT value AS value FROM reference_values WHERE kind = ? AND value IS NOT NULL AND value <> '' AND is_active = 1 ORDER BY sort_order, value LIMIT 100`, ['delivery_type']),
    () => listDistinctText(db, `SELECT DISTINCT value AS value FROM reference_values WHERE kind = ? AND value IS NOT NULL AND value <> '' AND is_active = 1 ORDER BY sort_order, value LIMIT 100`, ['payment_method']),
    () => listDistinctText(db, `SELECT DISTINCT name AS value FROM catalog_products WHERE name IS NOT NULL AND name <> '' AND is_active = 1 ORDER BY value LIMIT 200`),
    () => listDistinctText(db, `SELECT DISTINCT p.name AS value
      FROM catalog_products p
      LEFT JOIN catalog_variants v ON v.product_id = p.id AND v.is_active = 1
      WHERE p.name IS NOT NULL AND p.name <> '' AND p.is_active = 1
        AND (COALESCE(v.category, p.category, 'adult') = 'adult' OR v.id IS NULL AND COALESCE(p.category, 'adult') = 'adult')
      ORDER BY value LIMIT 200`),
    () => listDistinctText(db, `SELECT DISTINCT p.name AS value
      FROM catalog_products p
      JOIN catalog_variants v ON v.product_id = p.id AND v.is_active = 1
      WHERE p.name IS NOT NULL AND p.name <> '' AND p.is_active = 1
        AND (COALESCE(v.category, 'adult') = 'child' OR TRIM(COALESCE(v.size_label, '')) IN ('1','2','3','4','5','6','7','8','9','10','11','12'))
      ORDER BY value LIMIT 200`),
    () => listDistinctText(db, `SELECT DISTINCT value AS value FROM reference_values WHERE kind = ? AND value IS NOT NULL AND value <> '' AND is_active = 1 ORDER BY sort_order, value LIMIT 200`, ['color']),
    () => listDistinctText(db, `SELECT DISTINCT value AS value FROM reference_values WHERE kind = ? AND value IS NOT NULL AND value <> '' AND is_active = 1 ORDER BY sort_order, value LIMIT 100`, ['material']),
    () => listDistinctText(db, `SELECT DISTINCT value AS value FROM reference_values WHERE kind = ? AND value IS NOT NULL AND value <> '' AND is_active = 1 ORDER BY sort_order, value LIMIT 100`, ['length']),
    () => listDistinctText(db, `SELECT DISTINCT value AS value FROM reference_values WHERE kind = ? AND value IS NOT NULL AND value <> '' AND is_active = 1 ORDER BY sort_order, value LIMIT 200`, ['size']),
    () => listDistinctText(db, `SELECT DISTINCT value AS value FROM reference_values WHERE kind = ? AND value IS NOT NULL AND value <> '' AND is_active = 1 ORDER BY sort_order, value LIMIT 200`, ['child_age']),
    () => listDistinctText(db, `SELECT DISTINCT value AS value FROM reference_values WHERE kind = ? AND value IS NOT NULL AND value <> '' AND is_active = 1 ORDER BY sort_order, value LIMIT 100`, ['return_reason']),
    () => listDistinctText(db, `SELECT DISTINCT value AS value FROM reference_values WHERE kind = ? AND value IS NOT NULL AND value <> '' AND is_active = 1 ORDER BY sort_order, value LIMIT 100`, ['writeoff_reason']),
  ]);

  const managerOptions = mapSqlRows(managerOptionsResult).map((row: any) => ({
    id: toInt(row.id, 0),
    name: cleanText(row.name),
    colorKey: normalizeManagerColor(row.color_key, toInt(row.id, 0) - 1),
    hiredAt: cleanText(row.hired_at),
  }));
  const managers = managerOptions.map((row) => row.name);

  return {
    ok: true,
    managers,
    managerOptions,
    cities,
    deliveryTypes,
    paymentMethods,
    products,
    adultProducts,
    childProducts,
    colors,
    materials,
    lengths,
    sizes,
    childAges,
    returnReasons,
    writeoffReasons,
  };
}


export async function createReferenceValue(db: D1Database, request: Request) {
  const input = await readJson<{ kind?: unknown; value?: unknown; sortOrder?: unknown; isActive?: unknown }>(request);
  return json(await upsertReferenceValue(db, input), { status: 201 });
}


export async function updateReferenceValue(db: D1Database, id: number, request: Request) {
  const input = await readJson<{ kind?: unknown; value?: unknown; sortOrder?: unknown; isActive?: unknown }>(request);
  return json(await upsertReferenceValue(db, input, id));
}


export async function deleteReferenceValue(db: D1Database, id: number, request: Request) {
  const input = await readJson<{ kind?: unknown }>(request);
  const kind = normalizeReferenceKind(input.kind);
  if (!kind) {
    return json({ ok: false, message: 'Unknown reference kind.' }, { status: 400 });
  }
  return json(await disableReferenceValue(db, kind, id));
}
