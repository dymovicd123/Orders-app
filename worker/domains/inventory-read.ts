// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { setAppSetting } from '../core/settings.ts'
import { readTableColumnSet } from '../core/sql.ts'
import { canonicalStockPositionValue, cleanText, normalizeExchangeReturnSource, normalizeOrderItemSourceType, normalizeReturnRestockSource, normalizeSourceType, toInt, upperText, workshopOnlyComment } from '../core/text.ts'
import { isHumanInventoryModelEnabled } from './catalog.ts'
import { isReversibleInventoryMovementReference } from './inventory-reservations.ts'
import { enrichWorkshopTaskRowsFromOrderItems } from './workshop.ts'

export async function listInventory(db: D1Database, url: URL) {
  const source = normalizeSourceType(url.searchParams.get('source'));
  const q = cleanText(url.searchParams.get('q'));
  const qTokens = q.split(/\s+/).map(token => token.trim()).filter(Boolean).slice(0, 8);
  const limit = Math.min(1000, Math.max(50, toInt(url.searchParams.get('limit'), 300)));
  const includeMovements = !['0', 'false', 'no'].includes(cleanText(url.searchParams.get('includeMovements')).toLowerCase());

  const searchableSql = `LOWER(
    COALESCE(s.product_name_snapshot, '') || ' ' ||
    COALESCE(s.gender_snapshot, '') || ' ' ||
    COALESCE(s.color_snapshot, '') || ' ' ||
    COALESCE(s.material_snapshot, '') || ' ' ||
    COALESCE(s.length_snapshot, '') || ' ' ||
    COALESCE(s.size_snapshot, '') || ' ' ||
    COALESCE(s.last_action, '') || ' ' ||
    COALESCE(s.last_source_ref, '')
  )`;
  const searchClauses = qTokens.map(() => `(
    INSTR(${searchableSql}, ?) > 0 OR INSTR(${searchableSql}, ?) > 0 OR INSTR(${searchableSql}, ?) > 0
  )`).join(' AND ');
  const stockSql = `SELECT
      s.id, s.inventory_source, s.product_id, s.variant_id, s.product_name_snapshot, s.gender_snapshot, s.color_snapshot,
      s.material_snapshot, s.length_snapshot, s.size_snapshot, s.quantity, s.reserved_quantity,
      s.last_action, s.last_source_ref, s.updated_at, s.created_at
     FROM inventory_stock s
     LEFT JOIN catalog_variants active_variant ON active_variant.id = s.variant_id
     LEFT JOIN catalog_products active_product ON active_product.id = active_variant.product_id
     WHERE s.inventory_source = ?
       AND (s.variant_id IS NULL OR (active_variant.is_active = 1 AND active_product.is_active = 1))${searchClauses ? ` AND ${searchClauses}` : ''}
     ORDER BY s.product_name_snapshot, COALESCE(s.gender_snapshot, ''), COALESCE(s.color_snapshot, ''),
       COALESCE(s.material_snapshot, ''), COALESCE(s.length_snapshot, ''), COALESCE(s.size_snapshot, '')
     LIMIT ?`;

  const inventorySearchBindings = qTokens.flatMap(token => [token, token.toUpperCase(), token.toLowerCase()]);
  const rows = await db.prepare(stockSql)
    .bind(source, ...inventorySearchBindings, limit)
    .all<Record<string, unknown>>();

  const items = rows.results || [];
  const humanInventoryModelEnabled = await isHumanInventoryModelEnabled(db);

  const movements = includeMovements
    ? await db.prepare(
      `SELECT
        m.id, m.inventory_source, m.movement_type, m.product_id, m.variant_id, m.product_name_snapshot, m.gender_snapshot, m.color_snapshot,
        m.material_snapshot, m.length_snapshot, m.size_snapshot, m.quantity_delta, m.quantity_after,
        m.reference_type, m.reference_id, m.comment, m.created_at,
        r.reversed_at, r.reversal_movement_id,
        CASE WHEN rr.original_movement_id IS NOT NULL THEN 1 ELSE 0 END AS is_reversal
       FROM inventory_movements m
       LEFT JOIN inventory_movement_reversals r ON r.original_movement_id = m.id
       LEFT JOIN inventory_movement_reversals rr ON rr.reversal_movement_id = m.id
       WHERE m.inventory_source = ?
       ORDER BY m.id DESC
       LIMIT 120`
    ).bind(source).all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] };

  const total = items.reduce((sum, row) => sum + Math.max(0, toInt(row.quantity, 0)), 0);
  const reservedTotal = humanInventoryModelEnabled
    ? items.reduce((sum, row) => sum + Math.max(0, toInt(row.reserved_quantity, 0)), 0)
    : 0;
  const availableTotal = humanInventoryModelEnabled
    ? items.reduce((sum, row) => sum + (toInt(row.quantity, 0) - Math.max(0, toInt(row.reserved_quantity, 0))), 0)
    : items.reduce((sum, row) => sum + toInt(row.quantity, 0), 0);
  const zeroCount = items.filter(row => {
    const available = humanInventoryModelEnabled ? toInt(row.quantity, 0) - Math.max(0, toInt(row.reserved_quantity, 0)) : toInt(row.quantity, 0);
    return available === 0;
  }).length;

  return {
    ok: true,
    source,
    inventoryModelVersion: humanInventoryModelEnabled ? 2 : 1,
    count: items.length,
    total,
    reservedTotal,
    availableTotal,
    zeroCount,
    items: items.map(row => ({
      id: toInt(row.id, 0),
      inventorySource: cleanText(row.inventory_source),
      productId: toInt(row.product_id, 0),
      variantId: toInt(row.variant_id, 0),
      productName: cleanText(row.product_name_snapshot),
      gender: cleanText(row.gender_snapshot),
      color: cleanText(row.color_snapshot),
      material: canonicalStockPositionValue(row.material_snapshot),
      length: canonicalStockPositionValue(row.length_snapshot),
      size: cleanText(row.size_snapshot),
      quantity: toInt(row.quantity, 0),
      reservedQuantity: humanInventoryModelEnabled ? Math.max(0, toInt(row.reserved_quantity, 0)) : 0,
      availableQuantity: humanInventoryModelEnabled
        ? toInt(row.quantity, 0) - Math.max(0, toInt(row.reserved_quantity, 0))
        : toInt(row.quantity, 0),
      lastAction: cleanText(row.last_action),
      lastSourceRef: cleanText(row.last_source_ref),
      updatedAt: cleanText(row.updated_at),
      createdAt: cleanText(row.created_at),
    })),
    movementsIncluded: includeMovements,
    movements: (movements.results || []).map(row => ({
      id: toInt(row.id, 0),
      inventorySource: cleanText(row.inventory_source),
      movementType: cleanText(row.movement_type),
      productId: toInt(row.product_id, 0),
      variantId: toInt(row.variant_id, 0),
      productName: cleanText(row.product_name_snapshot),
      gender: cleanText(row.gender_snapshot),
      color: cleanText(row.color_snapshot),
      material: cleanText(row.material_snapshot),
      length: cleanText(row.length_snapshot),
      size: cleanText(row.size_snapshot),
      quantityDelta: toInt(row.quantity_delta, 0),
      quantityAfter: toInt(row.quantity_after, 0),
      referenceType: cleanText(row.reference_type),
      referenceId: cleanText(row.reference_id),
      comment: cleanText(row.comment),
      createdAt: cleanText(row.created_at),
      reversedAt: cleanText(row.reversed_at),
      reversalMovementId: toInt(row.reversal_movement_id, 0),
      isReversal: toInt(row.is_reversal, 0) === 1,
      canReverse: !cleanText(row.reversed_at)
        && toInt(row.is_reversal, 0) !== 1
        && toInt(row.quantity_delta, 0) !== 0
        && isReversibleInventoryMovementReference(row.reference_type),
    })),
  };
}



export type InventoryAuditExpected = {
  checkType: string;
  source: string;
  movementType: string;
  referenceType: string;
  referenceId: string;
  referenceTypes?: string[];
  referenceIds?: string[];
  externalOrderId?: string;
  productName: string;
  gender?: string | null;
  color?: string | null;
  material?: string | null;
  length?: string | null;
  size?: string | null;
  variantId?: number | null;
  quantityDelta: number;
  status: 'ok' | 'missing' | 'resolved';
  note: string;
  issueKey: string;
  resolvedAt?: string;
  resolutionComment?: string;
};


export async function findInventoryMovementMatch(
  db: D1Database,
  expected: {
    source: string; movementType: string; referenceType: string; referenceId: string;
    referenceTypes?: string[]; referenceIds?: string[]; productName: string; gender?: string | null;
    color?: string | null; material?: string | null; length?: string | null; size?: string | null;
    variantId?: number | null; quantityDelta: number;
  },
) {
  const referenceTypes = expected.referenceTypes?.length ? expected.referenceTypes : [expected.referenceType];
  const referenceIds = expected.referenceIds?.length ? expected.referenceIds : [expected.referenceId];
  const typePlaceholders = referenceTypes.map(() => '?').join(', ');
  const idPlaceholders = referenceIds.map(() => '?').join(', ');
  const byVariant = expected.variantId
    ? 'AND variant_id = ?'
    : `AND product_name_snapshot = ?
       AND COALESCE(gender_snapshot, '') = COALESCE(?, '')
       AND COALESCE(color_snapshot, '') = COALESCE(?, '')
       AND COALESCE(NULLIF(UPPER(TRIM(material_snapshot)), ''), 'СТАНДАРТ') = COALESCE(NULLIF(UPPER(TRIM(?)), ''), 'СТАНДАРТ')
       AND COALESCE(NULLIF(UPPER(TRIM(length_snapshot)), ''), 'СТАНДАРТ') = COALESCE(NULLIF(UPPER(TRIM(?)), ''), 'СТАНДАРТ')
       AND COALESCE(size_snapshot, '') = COALESCE(?, '')`;
  const bindings: Array<string | number | null> = [
    expected.source,
    expected.movementType,
    ...referenceTypes,
    ...referenceIds,
    expected.quantityDelta,
  ];
  if (expected.variantId) {
    bindings.push(expected.variantId);
  } else {
    bindings.push(
      expected.productName,
      expected.gender || null,
      expected.color || null,
      expected.material || null,
      expected.length || null,
      expected.size || null,
    );
  }
  return await db.prepare(
    `SELECT id, quantity_after AS quantityAfter FROM inventory_movements
     WHERE inventory_source = ?
       AND movement_type = ?
       AND reference_type IN (${typePlaceholders})
       AND reference_id IN (${idPlaceholders})
       AND quantity_delta = ?
       ${byVariant}
     ORDER BY id DESC LIMIT 1`
  ).bind(...bindings).first<{ id: number; quantityAfter: number }>();
}


export function movementSnapshotFromRow(row: Record<string, unknown>) {
  return {
    productName: cleanText(row.product_name_snapshot),
    gender: cleanText(row.gender_snapshot) || null,
    color: cleanText(row.color_snapshot) || null,
    material: cleanText(row.material_snapshot) || null,
    length: cleanText(row.length_snapshot) || null,
    size: cleanText(row.size_snapshot) || null,
    variantId: toInt(row.variant_id, 0) || null,
  };
}


export const INVENTORY_AUDIT_RESOLUTION_PREFIX = 'inventory_audit_resolution_';


export function inventoryAuditSignature(expected: Omit<InventoryAuditExpected, 'status' | 'note' | 'issueKey' | 'resolvedAt' | 'resolutionComment'>) {
  const referenceTypes = (expected.referenceTypes?.length ? expected.referenceTypes : [expected.referenceType]).map(value => cleanText(value).toLowerCase()).sort();
  const referenceIds = (expected.referenceIds?.length ? expected.referenceIds : [expected.referenceId]).map(value => cleanText(value)).sort();
  return [
    cleanText(expected.source).toLowerCase(),
    cleanText(expected.movementType).toLowerCase(),
    referenceTypes.join(','),
    referenceIds.join(','),
    String(toInt(expected.variantId, 0)),
    upperText(expected.productName),
    upperText(expected.gender),
    upperText(expected.color),
    canonicalStockPositionValue(expected.material),
    canonicalStockPositionValue(expected.length),
    upperText(expected.size),
    String(toInt(expected.quantityDelta, 0)),
  ].join('|');
}


export function inventoryAuditIssueKeyFromSignature(signature: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < signature.length; index += 1) {
    const code = signature.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${INVENTORY_AUDIT_RESOLUTION_PREFIX}${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}


export function inventoryAuditMovementMatches(row: Record<string, unknown>, expected: InventoryAuditExpected) {
  const referenceTypes = expected.referenceTypes?.length ? expected.referenceTypes : [expected.referenceType];
  const referenceIds = expected.referenceIds?.length ? expected.referenceIds : [expected.referenceId];
  if (cleanText(row.inventory_source) !== cleanText(expected.source)) return false;
  if (cleanText(row.movement_type) !== cleanText(expected.movementType)) return false;
  if (!referenceTypes.includes(cleanText(row.reference_type))) return false;
  if (!referenceIds.includes(cleanText(row.reference_id))) return false;
  if (toInt(row.quantity_delta, 0) !== toInt(expected.quantityDelta, 0)) return false;
  if (expected.variantId) return toInt(row.variant_id, 0) === toInt(expected.variantId, 0);
  return cleanText(row.product_name_snapshot) === cleanText(expected.productName)
    && cleanText(row.gender_snapshot) === cleanText(expected.gender)
    && cleanText(row.color_snapshot) === cleanText(expected.color)
    && canonicalStockPositionValue(row.material_snapshot) === canonicalStockPositionValue(expected.material)
    && canonicalStockPositionValue(row.length_snapshot) === canonicalStockPositionValue(expected.length)
    && cleanText(row.size_snapshot) === cleanText(expected.size);
}


export async function resolveInventoryAuditMovementStatuses(db: D1Database, rows: InventoryAuditExpected[]) {
  const chunkSize = 120;
  let lookupBatches = 0;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const referenceTypes = Array.from(new Set(chunk.flatMap(row => row.referenceTypes?.length ? row.referenceTypes : [row.referenceType]).map(cleanText).filter(Boolean)));
    const referenceIds = Array.from(new Set(chunk.flatMap(row => row.referenceIds?.length ? row.referenceIds : [row.referenceId]).map(cleanText).filter(Boolean)));
    const movementTypes = Array.from(new Set(chunk.map(row => cleanText(row.movementType)).filter(Boolean)));
    const sources = Array.from(new Set(chunk.map(row => cleanText(row.source)).filter(Boolean)));
    if (!referenceTypes.length || !referenceIds.length || !movementTypes.length || !sources.length) continue;

    const typePlaceholders = referenceTypes.map(() => '?').join(', ');
    const idPlaceholders = referenceIds.map(() => '?').join(', ');
    const movementPlaceholders = movementTypes.map(() => '?').join(', ');
    const sourcePlaceholders = sources.map(() => '?').join(', ');
    const candidates = await db.prepare(
      `SELECT inventory_source, movement_type, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
              material_snapshot, length_snapshot, size_snapshot, quantity_delta, reference_type, reference_id
       FROM inventory_movements
       WHERE reference_type IN (${typePlaceholders})
         AND reference_id IN (${idPlaceholders})
         AND movement_type IN (${movementPlaceholders})
         AND inventory_source IN (${sourcePlaceholders})`
    ).bind(...referenceTypes, ...referenceIds, ...movementTypes, ...sources).all<Record<string, unknown>>();
    lookupBatches += 1;
    const movementRows = candidates.results || [];
    for (const expected of chunk) {
      if (movementRows.some(row => inventoryAuditMovementMatches(row, expected))) expected.status = 'ok';
    }
  }
  return lookupBatches;
}


export async function applyInventoryAuditResolutions(db: D1Database, rows: InventoryAuditExpected[]) {
  const result = await db.prepare(
    `SELECT key, value FROM app_settings WHERE key LIKE ? ORDER BY updated_at DESC`
  ).bind(`${INVENTORY_AUDIT_RESOLUTION_PREFIX}%`).all<{ key: string; value: string }>();
  const stored = new Map((result.results || []).map(row => [cleanText(row.key), cleanText(row.value)]));
  for (const row of rows) {
    if (row.status !== 'missing') continue;
    const raw = stored.get(row.issueKey);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { signature?: string; resolvedAt?: string; comment?: string };
      if (cleanText(parsed.signature) !== inventoryAuditSignature(row)) continue;
      row.status = 'resolved';
      row.resolvedAt = cleanText(parsed.resolvedAt);
      row.resolutionComment = cleanText(parsed.comment);
    } catch {
      // Broken support metadata must never hide a real inventory warning.
    }
  }
}


export async function pushInventoryAuditExpectation(
  _db: D1Database,
  rows: InventoryAuditExpected[],
  expected: Omit<InventoryAuditExpected, 'status' | 'note' | 'issueKey' | 'resolvedAt' | 'resolutionComment'> & { note?: string },
) {
  const signature = inventoryAuditSignature(expected);
  rows.push({
    ...expected,
    status: 'missing',
    note: expected.note || '',
    issueKey: inventoryAuditIssueKeyFromSignature(signature),
  });
}


export async function getInventoryHardAudit(db: D1Database) {
  const expectedRows: InventoryAuditExpected[] = [];

  const orderItems = await db.prepare(
    `SELECT
       oi.*, o.external_id, ei.id AS exchange_item_id
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN exchange_items ei ON ei.role = 'new' AND ei.order_item_id = oi.id
     WHERE oi.is_workshop = 0
       AND oi.quantity > 0
       AND COALESCE(oi.stock_writeoff_status, '') IN ('written_off', 'negative', 'pending_writeoff', 'fulfilled')
       AND ei.id IS NULL
     ORDER BY oi.id DESC
     LIMIT 700`
  ).all<Record<string, unknown>>();

  for (const row of orderItems.results || []) {
    const source = normalizeSourceType(row.source_type);
    const snapshot = movementSnapshotFromRow(row);
    await pushInventoryAuditExpectation(db, expectedRows, {
      checkType: 'Заказ / редактирование заказа',
      source,
      movementType: 'sale',
      referenceType: 'order',
      referenceTypes: ['order', 'order_edit_new'],
      referenceId: cleanText(row.external_id),
      referenceIds: [cleanText(row.external_id)],
      externalOrderId: cleanText(row.external_id),
      ...snapshot,
      quantityDelta: -Math.max(1, toInt(row.quantity, 1)),
      note: 'Активная нецеховая позиция заказа должна иметь списание склада/бутика.',
    });
  }

  const returnRows = await db.prepare(
    `SELECT ri.*, r.status, r.order_id, o.external_id,
            oi.product_id, oi.variant_id AS order_variant_id,
            lifecycle.status AS lifecycle_status,
            lifecycle.applied_at AS lifecycle_applied_at,
            lifecycle.variant_id AS lifecycle_variant_id,
            lifecycle.inventory_source AS lifecycle_inventory_source
     FROM return_items ri
     JOIN returns r ON r.id = ri.return_id
     JOIN orders o ON o.id = r.order_id
     LEFT JOIN order_items oi ON oi.id = ri.order_item_id
     LEFT JOIN inventory_lifecycle_events lifecycle
       ON lifecycle.operation_type = 'return'
      AND lifecycle.operation_item_id = ri.id
      AND lifecycle.event_type = 'return_in'
     WHERE (ri.restocked = 1 OR lifecycle.applied_at IS NOT NULL)
       AND COALESCE(lifecycle.inventory_source, ri.inventory_source) IN ('warehouse', 'boutique')
     ORDER BY ri.id DESC
     LIMIT 500`
  ).all<Record<string, unknown>>();

  for (const row of returnRows.results || []) {
    const source = normalizeReturnRestockSource(row.lifecycle_inventory_source || row.inventory_source);
    if (source === 'none') continue;
    const lifecycleStatus = cleanText(row.lifecycle_status);
    const lifecycleWasApplied = Boolean(cleanText(row.lifecycle_applied_at));
    const shouldAuditMovement = !lifecycleStatus || lifecycleStatus === 'applied' || lifecycleWasApplied;
    if (!shouldAuditMovement) continue;
    const snapshot = movementSnapshotFromRow({
      ...row,
      variant_id: toInt(row.lifecycle_variant_id, 0) || toInt(row.order_variant_id, 0) || null,
    });
    const qty = Math.max(1, toInt(row.quantity, 1));
    await pushInventoryAuditExpectation(db, expectedRows, {
      checkType: 'Возврат',
      source,
      movementType: 'return',
      referenceType: 'return',
      referenceId: `return:${toInt(row.return_id, 0)}`,
      externalOrderId: cleanText(row.external_id),
      ...snapshot,
      quantityDelta: qty,
      note: 'Возврат в остатки должен создать плюсовое движение.',
    });
    if (cleanText(row.status) === 'cancelled' && (!lifecycleStatus || lifecycleWasApplied)) {
      await pushInventoryAuditExpectation(db, expectedRows, {
        checkType: 'Отмена возврата',
        source,
        movementType: 'revision',
        referenceType: 'return_cancel',
        referenceId: String(toInt(row.return_id, 0)),
        externalOrderId: cleanText(row.external_id),
        ...snapshot,
        quantityDelta: -qty,
        note: 'Отмена возврата должна убрать ранее возвращённое количество из остатков.',
      });
    }
  }

  const exchangeRows = await db.prepare(
    `SELECT e.*, o.external_id,
            old_item.product_name_snapshot AS old_product_name_snapshot,
            old_item.gender_snapshot AS old_gender_snapshot,
            old_item.color_snapshot AS old_color_snapshot,
            old_item.material_snapshot AS old_material_snapshot,
            old_item.length_snapshot AS old_length_snapshot,
            old_item.size_snapshot AS old_size_snapshot,
            old_item.variant_id AS old_variant_id,
            old_item.is_workshop AS old_is_workshop,
            new_item.product_name_snapshot AS new_product_name_snapshot,
            new_item.gender_snapshot AS new_gender_snapshot,
            new_item.color_snapshot AS new_color_snapshot,
            new_item.material_snapshot AS new_material_snapshot,
            new_item.length_snapshot AS new_length_snapshot,
            new_item.size_snapshot AS new_size_snapshot,
            new_item.variant_id AS new_variant_id,
            new_item.quantity AS new_quantity,
            new_item.source_type AS new_source_type,
            new_item.is_workshop AS new_is_workshop,
            new_item.stock_writeoff_status AS new_stock_writeoff_status,
            old_lifecycle.status AS old_lifecycle_status,
            old_lifecycle.applied_at AS old_lifecycle_applied_at,
            new_lifecycle.status AS new_lifecycle_status,
            new_lifecycle.applied_at AS new_lifecycle_applied_at
     FROM exchanges e
     JOIN orders o ON o.id = e.order_id
     LEFT JOIN order_items old_item ON old_item.id = e.old_order_item_id
     LEFT JOIN order_items new_item ON new_item.id = e.new_order_item_id
     LEFT JOIN inventory_lifecycle_events old_lifecycle
       ON old_lifecycle.operation_type = 'exchange' AND old_lifecycle.operation_id = e.id AND old_lifecycle.event_type = 'exchange_old_in'
     LEFT JOIN inventory_lifecycle_events new_lifecycle
       ON new_lifecycle.operation_type = 'exchange' AND new_lifecycle.operation_id = e.id AND new_lifecycle.event_type = 'exchange_new_out'
     ORDER BY e.id DESC
     LIMIT 500`
  ).all<Record<string, unknown>>();

  for (const row of exchangeRows.results || []) {
    const exchangeId = toInt(row.id, 0);
    const oldSource = normalizeExchangeReturnSource(row.old_return_source);
    const oldQty = Math.max(1, toInt(row.old_quantity, 1));
    const status = cleanText(row.status) || 'completed';

    const oldLifecycleStatus = cleanText(row.old_lifecycle_status);
    const oldLifecycleWasApplied = Boolean(cleanText(row.old_lifecycle_applied_at));
    const shouldAuditOldMovement = !oldLifecycleStatus || oldLifecycleStatus === 'applied' || oldLifecycleWasApplied;

    if (oldSource !== 'none' && !Boolean(toInt(row.old_is_workshop, 0)) && shouldAuditOldMovement) {
      const oldSnapshot = movementSnapshotFromRow({
        product_name_snapshot: row.old_product_name_snapshot,
        gender_snapshot: row.old_gender_snapshot,
        color_snapshot: row.old_color_snapshot,
        material_snapshot: row.old_material_snapshot,
        length_snapshot: row.old_length_snapshot,
        size_snapshot: row.old_size_snapshot,
        variant_id: row.old_variant_id,
      });
      await pushInventoryAuditExpectation(db, expectedRows, {
        checkType: 'Обмен: возврат старого товара',
        source: oldSource,
        movementType: 'return',
        referenceType: 'exchange',
        referenceId: `exchange:${exchangeId}`,
        externalOrderId: cleanText(row.external_id),
        ...oldSnapshot,
        quantityDelta: oldQty,
        note: 'Старая позиция обмена должна вернуться в выбранный источник.',
      });
      if (status === 'cancelled' && (!oldLifecycleStatus || oldLifecycleWasApplied)) {
        await pushInventoryAuditExpectation(db, expectedRows, {
          checkType: 'Отмена обмена: откат старого товара',
          source: oldSource,
          movementType: 'revision',
          referenceType: 'exchange_cancel',
          referenceId: String(exchangeId),
          externalOrderId: cleanText(row.external_id),
          ...oldSnapshot,
          quantityDelta: -oldQty,
          note: 'Отмена обмена должна убрать старый товар, который вернули в остатки.',
        });
      }
    }

    const newLifecycleStatus = cleanText(row.new_lifecycle_status);
    const newLifecycleWasApplied = Boolean(cleanText(row.new_lifecycle_applied_at));
    const shouldAuditNewMovement = !newLifecycleStatus || newLifecycleStatus === 'applied' || newLifecycleWasApplied;

    if (!Boolean(toInt(row.new_is_workshop, 0)) && toInt(row.new_order_item_id, 0) && toInt(row.new_quantity, 0) > 0 && shouldAuditNewMovement) {
      const newSource = normalizeSourceType(row.new_source_type);
      const newSnapshot = movementSnapshotFromRow({
        product_name_snapshot: row.new_product_name_snapshot,
        gender_snapshot: row.new_gender_snapshot,
        color_snapshot: row.new_color_snapshot,
        material_snapshot: row.new_material_snapshot,
        length_snapshot: row.new_length_snapshot,
        size_snapshot: row.new_size_snapshot,
        variant_id: row.new_variant_id,
      });
      const newQty = Math.max(1, toInt(row.new_quantity, 1));
      await pushInventoryAuditExpectation(db, expectedRows, {
        checkType: 'Обмен: списание нового товара',
        source: newSource,
        movementType: 'sale',
        referenceType: 'exchange_new',
        referenceTypes: ['exchange_new', 'order'],
        referenceId: String(exchangeId),
        referenceIds: [String(exchangeId), cleanText(row.external_id)],
        externalOrderId: cleanText(row.external_id),
        ...newSnapshot,
        quantityDelta: -newQty,
        note: 'Новая нецеховая позиция обмена должна списаться со склада/бутика.',
      });
      if (status === 'cancelled' && (!newLifecycleStatus || newLifecycleWasApplied)) {
        await pushInventoryAuditExpectation(db, expectedRows, {
          checkType: 'Отмена обмена: откат нового товара',
          source: newSource,
          movementType: 'revision',
          referenceType: 'exchange_cancel',
          referenceId: String(exchangeId),
          externalOrderId: cleanText(row.external_id),
          ...newSnapshot,
          quantityDelta: newQty,
          note: 'Отмена обмена должна вернуть списанную новую позицию.',
        });
      }
    }
  }

  const lookupBatches = await resolveInventoryAuditMovementStatuses(db, expectedRows);
  await applyInventoryAuditResolutions(db, expectedRows);

  const missing = expectedRows.filter(row => row.status === 'missing');
  const resolved = expectedRows.filter(row => row.status === 'resolved');
  const ok = expectedRows.filter(row => row.status === 'ok');
  const byType = expectedRows.reduce<Record<string, { total: number; missing: number; resolved: number }>>((acc, row) => {
    if (!acc[row.checkType]) acc[row.checkType] = { total: 0, missing: 0, resolved: 0 };
    acc[row.checkType].total += 1;
    if (row.status === 'missing') acc[row.checkType].missing += 1;
    if (row.status === 'resolved') acc[row.checkType].resolved += 1;
    return acc;
  }, {});

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    summary: {
      totalExpectedMovements: expectedRows.length,
      okMovements: ok.length,
      resolvedMovements: resolved.length,
      missingMovements: missing.length,
      lookupBatches,
    },
    byType: Object.entries(byType).map(([checkType, value]) => ({ checkType, ...value })),
    rows: expectedRows.slice(0, 1000),
    missing: missing.slice(0, 300),
    resolved: resolved.slice(0, 300),
  };
}


export async function setInventoryAuditResolution(
  db: D1Database,
  issueKey: string,
  resolved: boolean,
  actor: string,
  comment: string,
) {
  const normalizedKey = cleanText(issueKey);
  if (!normalizedKey.startsWith(INVENTORY_AUDIT_RESOLUTION_PREFIX)) throw new Error('Некорректный идентификатор проверки.');

  if (!resolved) {
    await db.prepare('DELETE FROM app_settings WHERE key = ?').bind(normalizedKey).run();
    return await getInventoryHardAudit(db);
  }

  const audit = await getInventoryHardAudit(db);
  const target = audit.missing.find((row: InventoryAuditExpected) => row.issueKey === normalizedKey);
  if (!target) return audit;
  const now = new Date().toISOString();
  await setAppSetting(db, normalizedKey, JSON.stringify({
    signature: inventoryAuditSignature(target),
    resolvedAt: now,
    actor: cleanText(actor),
    comment: cleanText(comment) || 'Фактический остаток проверен сотрудником.',
  }));
  return await getInventoryHardAudit(db);
}



export function dashboardItemKey(row: Record<string, unknown>) {
  return [
    row.product_name_snapshot,
    row.gender_snapshot,
    row.color_snapshot,
    row.material_snapshot,
    row.length_snapshot,
    row.size_snapshot,
  ].map(part => cleanText(part).toUpperCase()).join('|');
}


export function dashboardProductKey(row: Record<string, unknown>) {
  return cleanText(row.product_name_snapshot).toUpperCase();
}


export function daysBetweenDates(fromDate: string, toDate: string) {
  const from = Date.parse(`${fromDate}T00:00:00.000Z`);
  const to = Date.parse(`${toDate}T00:00:00.000Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.floor((to - from) / 86400000));
}


export async function getDashboardInsights(db: D1Database) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const lowStockLimit = 5;
  const workshopAgeLimit = 7;

  const [monthRow, monthClientRow, monthPlanRow, monthCashRow] = await Promise.all([
    db.prepare(
      `SELECT
         COUNT(*) AS order_count,
         COALESCE(SUM(total_amount), 0) AS total_sales,
         COALESCE(SUM(received_amount), 0) AS total_received,
         COALESCE(SUM(return_amount), 0) AS total_returns,
         COALESCE(SUM(debt_amount), 0) AS total_debt,
         COALESCE(AVG(NULLIF(total_amount, 0)), 0) AS avg_check,
         SUM(CASE WHEN shipping_status = 'sent' THEN 1 ELSE 0 END) AS sent_orders,
         SUM(CASE WHEN COALESCE(shipping_status, 'not_sent') <> 'sent' THEN 1 ELSE 0 END) AS not_sent_orders
       FROM orders
       WHERE order_date BETWEEN ? AND ?
         AND order_status <> 'deleted'`
    ).bind(monthStart, today).first<any>(),
    db.prepare(
      `SELECT
         SUM(CASE WHEN first_order_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS new_clients,
         SUM(CASE WHEN COALESCE(orders_count, 0) > 1 THEN 1 ELSE 0 END) AS repeat_clients
       FROM customers`
    ).bind(monthStart, today).first<any>(),
    db.prepare(
      `SELECT COALESCE(planned_amount, 0) AS plan_amount
       FROM department_plans
       WHERE period_start <= ? AND period_end >= ?
       ORDER BY
         CASE
           WHEN period_start = ? AND period_end >= ? THEN 0
           WHEN period_start <= ? AND period_end >= ? THEN 1
           ELSE 2
         END ASC,
         (julianday(period_end) - julianday(period_start)) DESC,
         updated_at DESC,
         id DESC
       LIMIT 1`
    ).bind(today, today, monthStart, today, today, today).first<any>(),
    db.prepare(
      `SELECT
         COALESCE((SELECT SUM(p.amount) FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.payment_date BETWEEN ? AND ? AND o.order_status <> 'deleted'), 0) AS total_received,
         COALESCE((SELECT SUM(r.amount) FROM returns r JOIN orders o ON o.id = r.order_id WHERE r.return_date BETWEEN ? AND ? AND COALESCE(r.status, 'completed') <> 'cancelled' AND o.order_status <> 'deleted'), 0) AS total_returns`
    ).bind(monthStart, today, monthStart, today).first<any>(),
  ]);

  const stockResult = await db.prepare(
    `SELECT
       id, inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
       material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity,
       last_action, last_source_ref, updated_at, created_at
     FROM inventory_stock
     WHERE quantity <= ?
     ORDER BY quantity ASC, updated_at DESC
     LIMIT 500`
  ).bind(lowStockLimit).all<Record<string, unknown>>();

  const demandResult = await db.prepare(
    `SELECT
       oi.id,
       oi.order_id,
       oi.variant_id,
       oi.product_name_snapshot,
       oi.gender_snapshot,
       oi.color_snapshot,
       oi.material_snapshot,
       oi.length_snapshot,
       oi.size_snapshot,
       oi.quantity,
       oi.source_type,
       oi.is_workshop,
       o.external_id,
       o.order_date
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.order_status <> 'deleted'
     ORDER BY o.order_date DESC, oi.id DESC
     LIMIT 8000`
  ).all<Record<string, unknown>>();

  const demandByVariant = new Map<number, { quantity: number; orders: Set<number>; latestOrderId: string; latestOrderDate: string; sourceTypes: Set<string> }>();
  const demandByDetail = new Map<string, { quantity: number; orders: Set<number>; latestOrderId: string; latestOrderDate: string; sourceTypes: Set<string> }>();
  const demandByProduct = new Map<string, { quantity: number; orders: Set<number>; latestOrderId: string; latestOrderDate: string; sourceTypes: Set<string> }>();

  const touchDemand = (map: Map<string | number, { quantity: number; orders: Set<number>; latestOrderId: string; latestOrderDate: string; sourceTypes: Set<string> }>, key: string | number, row: Record<string, unknown>) => {
    if (!key && key !== 0) return;
    const current = map.get(key) || { quantity: 0, orders: new Set<number>(), latestOrderId: '', latestOrderDate: '', sourceTypes: new Set<string>() };
    const quantity = Math.max(1, toInt(row.quantity, 1));
    current.quantity += quantity;
    current.orders.add(toInt(row.order_id, 0));
    const orderDate = cleanText(row.order_date);
    if (orderDate >= current.latestOrderDate) {
      current.latestOrderDate = orderDate;
      current.latestOrderId = cleanText(row.external_id);
    }
    const sourceType = toInt(row.is_workshop, 0) ? 'workshop' : normalizeOrderItemSourceType(row.source_type, 'warehouse');
    current.sourceTypes.add(sourceType);
    map.set(key, current);
  };

  for (const row of demandResult.results || []) {
    const variantId = toInt(row.variant_id, 0);
    if (variantId > 0) touchDemand(demandByVariant as any, variantId, row);
    const detailKey = dashboardItemKey(row);
    if (detailKey.trim()) touchDemand(demandByDetail as any, detailKey, row);
    const productKey = dashboardProductKey(row);
    if (productKey) touchDemand(demandByProduct as any, productKey, row);
  }

  const pickDemand = (row: Record<string, unknown>) => {
    const variantId = toInt(row.variant_id, 0);
    if (variantId > 0 && demandByVariant.has(variantId)) return demandByVariant.get(variantId)!;
    const detailKey = dashboardItemKey(row);
    if (detailKey.trim() && demandByDetail.has(detailKey)) return demandByDetail.get(detailKey)!;
    const productKey = dashboardProductKey(row);
    return demandByProduct.get(productKey) || { quantity: 0, orders: new Set<number>(), latestOrderId: '', latestOrderDate: '', sourceTypes: new Set<string>() };
  };

  const lowStock = (stockResult.results || []).map(row => {
    const demand = pickDemand(row);
    const quantity = toInt(row.quantity, 0);
    const demandQuantity = demand.quantity;
    const orderCount = demand.orders.size;
    const score = (quantity < 0 ? 1200 : quantity === 0 ? 900 : 500)
      + demandQuantity * 12
      + orderCount * 20
      - Math.max(0, quantity) * 30;
    return {
      id: toInt(row.id, 0),
      source: normalizeSourceType(row.inventory_source),
      sourceLabel: normalizeSourceType(row.inventory_source) === 'warehouse' ? 'Склад' : 'Бутик',
      productId: toInt(row.product_id, 0),
      variantId: toInt(row.variant_id, 0),
      productName: cleanText(row.product_name_snapshot),
      gender: cleanText(row.gender_snapshot),
      color: cleanText(row.color_snapshot),
      material: cleanText(row.material_snapshot),
      length: cleanText(row.length_snapshot),
      size: cleanText(row.size_snapshot),
      quantity,
      reservedQuantity: toInt(row.reserved_quantity, 0),
      demandQuantity,
      demandOrders: orderCount,
      latestOrderId: demand.latestOrderId,
      latestOrderDate: demand.latestOrderDate,
      demandSources: Array.from(demand.sourceTypes),
      lastAction: cleanText(row.last_action),
      lastSourceRef: cleanText(row.last_source_ref),
      updatedAt: cleanText(row.updated_at),
      priorityScore: score,
      reason: quantity < 0
        ? `Минус ${Math.abs(quantity)} шт. при спросе ${demandQuantity} шт.`
        : quantity === 0
          ? `Ноль на точке, спрос ${demandQuantity} шт.`
          : `Осталось ${quantity} шт., спрос ${demandQuantity} шт.`,
    };
  }).sort((a, b) => b.priorityScore - a.priorityScore || a.quantity - b.quantity || a.productName.localeCompare(b.productName, 'ru')).slice(0, 80);

  const workshopColumns = await readTableColumnSet(db, 'workshop_tasks');
  const wtColumn = (name: string) => workshopColumns.has(name.toLowerCase()) ? `wt.${name}` : 'NULL';
  const workshopResult = await db.prepare(
    `SELECT
       wt.id,
       wt.order_id,
       ${wtColumn('order_item_id')} AS order_item_id,
       wt.external_order_id,
       ${wtColumn('product_id')} AS product_id,
       wt.product_name_snapshot,
       ${wtColumn('gender_snapshot')} AS gender_snapshot,
       ${wtColumn('color_snapshot')} AS color_snapshot,
       ${wtColumn('material_snapshot')} AS material_snapshot,
       ${wtColumn('length_snapshot')} AS length_snapshot,
       ${wtColumn('size_snapshot')} AS size_snapshot,
       wt.quantity,
       wt.comment,
       wt.urgent,
       wt.due_date,
       wt.status,
       wt.created_at,
       wt.updated_at,
       o.order_date,
       CASE WHEN m.id IS NOT NULL THEN m.name
            WHEN NULLIF(TRIM(COALESCE(o.manager_snapshot_name, '')), '') IS NOT NULL THEN o.manager_snapshot_name || ' · исторический менеджер'
            ELSE 'Менеджер требует уточнения'
       END AS manager_name,
       c.phone_normalized AS customer_phone,
       c.display_name AS customer_name,
       o.city,
       o.delivery_type
     FROM workshop_tasks wt
     JOIN orders o ON o.id = wt.order_id
     LEFT JOIN managers m ON m.id = o.manager_id
     LEFT JOIN customers c ON c.id = o.customer_id
     WHERE wt.status = 'active' AND COALESCE(o.return_amount, 0) <= 0 AND o.order_status NOT IN ('deleted', 'archived')
     ORDER BY wt.urgent DESC, o.order_date ASC, wt.id ASC
     LIMIT 1000`
  ).all<Record<string, unknown>>();

  const allWorkshop = await enrichWorkshopTaskRowsFromOrderItems(db, workshopResult.results || [], workshopColumns);
  const workshopWarnings = allWorkshop.map(row => {
    const orderDate = cleanText(row.order_date) || cleanText(row.created_at).slice(0, 10);
    const waitingDays = daysBetweenDates(orderDate, today);
    const dueDate = cleanText(row.due_date);
    const overdueDays = dueDate ? daysBetweenDates(dueDate, today) : 0;
    const urgent = Boolean(toInt(row.urgent, 0));
    const score = waitingDays * 10 + overdueDays * 30 + (urgent ? 300 : 0);
    return {
      id: toInt(row.id, 0),
      orderId: toInt(row.order_id, 0),
      orderItemId: toInt(row.resolved_order_item_id, 0) || toInt(row.order_item_id, 0) || null,
      externalOrderId: cleanText(row.external_order_id),
      productId: toInt(row.product_id, 0),
      variantId: toInt(row.variant_id, 0),
      productName: cleanText(row.product_name_snapshot),
      gender: cleanText(row.resolved_gender),
      color: cleanText(row.resolved_color),
      material: cleanText(row.resolved_material),
      length: cleanText(row.resolved_length),
      size: cleanText(row.resolved_size),
      audienceType: cleanText(row.resolved_audience_type) || 'ВЗРОСЛЫЙ',
      quantity: toInt(row.quantity, 1),
      comment: workshopOnlyComment(row.comment),
      urgent,
      dueDate,
      status: cleanText(row.status),
      orderDate,
      waitingDays,
      overdueDays,
      managerName: cleanText(row.manager_name),
      customerPhone: cleanText(row.customer_phone),
      customerName: cleanText(row.customer_name),
      city: cleanText(row.city),
      deliveryType: cleanText(row.delivery_type),
      priorityScore: score,
      reason: dueDate && overdueDays > 0
        ? `Просрочено на ${overdueDays} дн., всего в ожидании ${waitingDays} дн.`
        : `${waitingDays} дн. в ожидании`,
    };
  }).filter(row => row.waitingDays >= workshopAgeLimit || row.overdueDays > 0 || row.urgent)
    .sort((a, b) => b.priorityScore - a.priorityScore || b.waitingDays - a.waitingDays || a.productName.localeCompare(b.productName, 'ru'))
    .slice(0, 80);

  const sourceSummary = lowStock.reduce<Record<string, number>>((acc, row) => {
    acc[row.source] = (acc[row.source] || 0) + 1;
    return acc;
  }, {});

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    thresholds: {
      lowStockLimit,
      workshopAgeLimit,
    },
    summary: {
      monthPlan: toInt(monthPlanRow?.plan_amount, 0),
      monthPlanCompletion: toInt(monthPlanRow?.plan_amount, 0) ? Math.max(0, toInt(monthCashRow?.total_received, 0) - toInt(monthCashRow?.total_returns, 0)) / Math.max(1, toInt(monthPlanRow?.plan_amount, 0)) : 0,
      monthOrderCount: toInt(monthRow?.order_count, 0),
      monthTotalSales: toInt(monthRow?.total_sales, 0),
      monthTotalReceived: toInt(monthCashRow?.total_received, 0),
      monthTotalReturns: toInt(monthCashRow?.total_returns, 0),
      monthCurrentDebt: toInt(monthRow?.total_debt, 0),
      monthAvgCheck: Math.round(Number(monthRow?.avg_check || 0)),
      monthSentOrders: toInt(monthRow?.sent_orders, 0),
      monthNotSentOrders: toInt(monthRow?.not_sent_orders, 0),
      monthNewClients: toInt(monthClientRow?.new_clients, 0),
      monthRepeatClients: toInt(monthClientRow?.repeat_clients, 0),
      criticalStockCount: lowStock.filter(row => row.quantity <= lowStockLimit).length,
      negativeStockCount: lowStock.filter(row => row.quantity < 0).length,
      zeroStockCount: lowStock.filter(row => row.quantity === 0).length,
      popularLowStockCount: lowStock.filter(row => row.demandQuantity > 0).length,
      workshopWarningCount: workshopWarnings.length,
      workshopActiveTotal: allWorkshop.length,
      warehouseWarnings: sourceSummary.warehouse || 0,
      boutiqueWarnings: sourceSummary.boutique || 0,
    },
    lowStock,
    workshopWarnings,
  };
}
