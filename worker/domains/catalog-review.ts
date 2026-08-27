// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import type { CatalogReferenceOptions, CatalogResolutionContext, CatalogResolutionResponse } from '../../shared/api-contracts.ts'
import { canonicalStockPositionValue, cleanText, normalizeAudienceCategory, normalizeOrderStatus, normalizeShippingStatus, normalizeSourceType, toInt, upperText } from '../core/text.ts'
import { assertCatalogProductAliasTargetAvailable, catalogReferenceDbValueExists, createCatalogProduct, findCatalogCombinationV3, findCatalogExecutionV3, findCatalogProductByIdentity, normalizeCatalogCombinationColor, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize, rememberCatalogProductAlias, rememberCatalogValueAlias, resolveCatalogValueAlias } from './catalog.ts'
import { normalizeOrderItems } from './order-core.ts'
import { releaseOrderReservationV2, reserveOrderItemV2, resolveCatalogProductAndVariantV2, resolveWorkshopCatalogProductOnly } from './order-reservations.ts'

export function orderItemWasPhysicallyIssued(row: Record<string, unknown>) {
  const status = cleanText(row.stock_writeoff_status);
  return status === 'fulfilled' || status === 'written_off' || status === 'negative';
}


export function normalizedCatalogReviewKey(row: Record<string, unknown>) {
  const category = normalizeAudienceCategory(row.audience_type, row.size_snapshot);
  return [
    upperText(row.product_name_snapshot),
    cleanText(category).toLowerCase(),
    upperText(row.gender_snapshot),
    upperText(row.color_snapshot),
    canonicalStockPositionValue(row.material_snapshot) || '',
    canonicalStockPositionValue(row.length_snapshot) || '',
    upperText(row.size_snapshot),
  ].join('¦');
}



export const CATALOG_REVIEW_RECENT_DAYS = 30;


export function catalogReviewBasePredicate(oi = 'oi', o = 'o') {
  return `${oi}.quantity > 0
    AND (${oi}.product_id IS NULL OR ${oi}.variant_id IS NULL)
    AND COALESCE(${oi}.stock_writeoff_status, '') NOT IN ('catalog_excluded', 'catalog_excluded_history', 'workshop_no_catalog')
    AND COALESCE(${o}.order_status, 'active') NOT IN ('deleted', 'archived')
    AND COALESCE(${o}.archived_at, '') = ''
    AND COALESCE((
      SELECT SUM(ri.quantity)
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
      WHERE ri.order_item_id = ${oi}.id
        AND COALESCE(r.status, 'completed') <> 'cancelled'
    ), 0) < ${oi}.quantity`;
}


export function catalogReviewRecentEntryPredicate(oi = 'oi', o = 'o') {
  return `datetime(COALESCE(NULLIF(${oi}.created_at, ''), NULLIF(${o}.created_at, ''), ${o}.order_date || 'T00:00:00Z')) >= datetime('now', '-${CATALOG_REVIEW_RECENT_DAYS} days')`;
}


export function catalogReviewOperationalPredicate(oi = 'oi', o = 'o') {
  const recent = catalogReviewRecentEntryPredicate(oi, o);
  return `(
    ${recent}
    AND (
      (COALESCE(${oi}.is_workshop, 0) = 1
        AND ${oi}.product_id IS NULL
        AND EXISTS (
          SELECT 1 FROM workshop_tasks wt
          WHERE wt.order_item_id = ${oi}.id
            AND wt.quantity > 0
            AND wt.status IN ('active', 'ready')
        )
      )
      OR (
        COALESCE(${oi}.is_workshop, 0) = 0
        AND COALESCE(${o}.shipping_status, 'not_sent') <> 'sent'
      )
    )
  )`;
}


export function catalogReviewOrderScopePredicate(oi = 'oi', o = 'o') {
  return `(
    (COALESCE(${oi}.is_workshop, 0) = 1
      AND ${oi}.product_id IS NULL
      AND EXISTS (
        SELECT 1 FROM workshop_tasks wt
        WHERE wt.order_item_id = ${oi}.id AND wt.quantity > 0 AND wt.status IN ('active', 'ready')
      )
    )
    OR (COALESCE(${oi}.is_workshop, 0) = 0 AND COALESCE(${o}.shipping_status, 'not_sent') <> 'sent')
  )`;
}


export async function fetchCatalogReviewRows(db: D1Database, limit: number, orderId = 0) {
  const base = catalogReviewBasePredicate('oi', 'o');
  const scope = orderId > 0 ? `${catalogReviewOrderScopePredicate('oi', 'o')} AND oi.order_id = ?` : catalogReviewOperationalPredicate('oi', 'o');
  const statement = db.prepare(
    `SELECT oi.id AS order_item_id, oi.id, oi.order_id, o.external_id, o.order_date, o.shipping_status, o.shipping_date,
            o.order_status, o.archived_at, oi.product_id, oi.variant_id, oi.product_name_snapshot, oi.audience_type,
            oi.gender_snapshot, oi.color_snapshot, oi.material_snapshot, oi.length_snapshot, oi.size_snapshot,
            oi.quantity, oi.source_type, oi.is_workshop, oi.stock_writeoff_status, oi.created_at
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE ${base}
       AND ${scope}
     ORDER BY oi.id DESC LIMIT ?`
  );
  return orderId > 0 ? await statement.bind(orderId, limit).all<Record<string, unknown>>() : await statement.bind(limit).all<Record<string, unknown>>();
}


export async function fetchCatalogReviewResolutionCandidates(db: D1Database, anchorOrderId: number) {
  const base = catalogReviewBasePredicate('oi', 'o');
  const operational = catalogReviewOperationalPredicate('oi', 'o');
  const orderScope = catalogReviewOrderScopePredicate('oi', 'o');
  return await db.prepare(
    `SELECT oi.*, o.external_id, o.shipping_status, o.shipping_date, o.order_status, o.archived_at
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE ${base}
       AND (${operational} OR (oi.order_id = ? AND ${orderScope}))
     ORDER BY oi.id ASC LIMIT 2000`
  ).bind(anchorOrderId).all<Record<string, unknown>>();
}


export type CatalogReviewSelectedVariant = {
  variant_id: number;
  product_id: number;
  product_name?: string;
  category?: string;
  gender?: string | null;
  color?: string | null;
  material?: string | null;
  length?: string | null;
  size_label?: string | null;
};


export function catalogReviewRowToOrderItem(row: Record<string, unknown>) {
  return {
    productName: cleanText(row.product_name_snapshot),
    audienceType: normalizeAudienceCategory(row.audience_type, row.size_snapshot) === 'child' ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ',
    category: normalizeAudienceCategory(row.audience_type, row.size_snapshot),
    gender: cleanText(row.gender_snapshot),
    color: cleanText(row.color_snapshot),
    material: canonicalStockPositionValue(row.material_snapshot) || '',
    length: canonicalStockPositionValue(row.length_snapshot) || '',
    size: cleanText(row.size_snapshot),
    quantity: Math.max(1, toInt(row.quantity, 1)),
    unitPrice: 0,
    lineTotal: 0,
    isWorkshop: false,
    inventorySource: normalizeSourceType(row.source_type),
    sourceType: normalizeSourceType(row.source_type),
    workshopComment: '',
    workshopUrgent: false,
    workshopDueDate: '',
  } as ReturnType<typeof normalizeOrderItems>[number];
}


export type CatalogReviewFactsInput = {
  productId?: unknown;
  createProduct?: unknown;
  productName?: unknown;
  material?: unknown;
  length?: unknown;
  category?: unknown;
  gender?: unknown;
  color?: unknown;
  size?: unknown;
  createFields?: unknown;
};


export async function getCatalogReviewContext(db: D1Database, orderItemId: number): Promise<CatalogResolutionContext> {
  const anchor = await db.prepare(
    `SELECT oi.*, o.external_id, o.shipping_status, o.shipping_date, o.order_status, o.archived_at
     FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ? LIMIT 1`
  ).bind(orderItemId).first<Record<string, unknown>>();
  if (!anchor?.id) throw new Error('Позиция заказа для разбора не найдена.');

  const category = normalizeAudienceCategory(anchor.audience_type, anchor.size_snapshot);
  const facts = {
    productName: cleanText(anchor.product_name_snapshot),
    material: await resolveCatalogValueAlias(db, 'material', canonicalStockPositionValue(anchor.material_snapshot)),
    length: await resolveCatalogValueAlias(db, 'length', canonicalStockPositionValue(anchor.length_snapshot)),
    category,
    gender: normalizeCatalogCombinationGender(anchor.gender_snapshot),
    color: await resolveCatalogValueAlias(db, 'color', normalizeCatalogCombinationColor(anchor.color_snapshot)),
    size: await resolveCatalogValueAlias(db, category === 'child' ? 'child_age' : 'size', normalizeCatalogCombinationSize(anchor.size_snapshot)),
  };
  const product = toInt(anchor.product_id, 0)
    ? await db.prepare(`SELECT id, name, category FROM catalog_products WHERE id = ? AND is_active = 1 LIMIT 1`).bind(toInt(anchor.product_id, 0)).first<{ id: number; name: string; category: string }>()
    : await findCatalogProductByIdentity(db, facts.productName, 0, { activeOnly: true }) as { id: number; name: string; category: string } | null;

  const referencesResult = await db.prepare(
    `SELECT kind, value FROM reference_values WHERE is_active = 1 AND kind IN ('material','length','color','size','child_age') ORDER BY sort_order, value`
  ).all<{ kind: string; value: string }>();
  // Loading hundreds of products is only necessary when the base product itself is unknown.
  // Known-product issues stay focused on the one missing fact and keep the page lightweight.
  const productsResult = product?.id
    ? { results: [] as Array<{ id: number; name: string; category: string }> }
    : await db.prepare(
        `SELECT id, name, category FROM catalog_products WHERE is_active = 1 ORDER BY name COLLATE NOCASE, id LIMIT 300`
      ).all<{ id: number; name: string; category: string }>();
  const references: CatalogReferenceOptions = { materials: ['СТАНДАРТ'], lengths: ['СТАНДАРТ'], colors: [], sizes: [], childAges: [] };
  for (const row of referencesResult.results || []) {
    const value = upperText(row.value);
    if (!value) continue;
    if (row.kind === 'material' && !references.materials.includes(value)) references.materials.push(value);
    else if (row.kind === 'length' && !references.lengths.includes(value)) references.lengths.push(value);
    else if (row.kind === 'color' && !references.colors.includes(value)) references.colors.push(value);
    else if (row.kind === 'size' && !references.sizes.includes(value)) references.sizes.push(value);
    else if (row.kind === 'child_age' && !references.childAges.includes(value)) references.childAges.push(value);
  }

  let execution: { id: number; product_id: number; material: string; length: string; is_active: number } | null = null;
  let existingVariant: { id: number } | null = null;
  const unknownFields: string[] = [];
  let issueType = 'unknown_product';

  if (toInt(anchor.is_workshop, 0)) {
    issueType = 'workshop_product';
  } else {
    if (product?.id) {
      execution = await findCatalogExecutionV3(db, product.id, facts.material, facts.length);
      if (execution?.id) {
        existingVariant = await findCatalogCombinationV3(db, execution.id, facts.category, facts.gender, facts.color, facts.size);
      }
    }

    // Exact existing identity is authoritative even if a reference row is stale. Otherwise
    // every independent fact is classified before the UI invites the admin to confirm it.
    if (!existingVariant?.id) {
      if (!await catalogReferenceDbValueExists(db, 'material', facts.material)) unknownFields.push('material');
      if (!await catalogReferenceDbValueExists(db, 'length', facts.length)) unknownFields.push('length');
      if (facts.gender && facts.gender !== 'ЖЕН' && facts.gender !== 'МУЖ') unknownFields.push('gender');
      if (!await catalogReferenceDbValueExists(db, 'color', facts.color)) unknownFields.push('color');
      const sizeKind = facts.category === 'child' ? 'child_age' : 'size';
      if (!await catalogReferenceDbValueExists(db, sizeKind, facts.size)) unknownFields.push('size');
    }

    if (!product?.id) issueType = 'unknown_product';
    else if (existingVariant?.id) issueType = 'exact_existing';
    else if (unknownFields.length) issueType = 'unknown_attribute';
    else if (!execution?.id) issueType = 'new_execution';
    else issueType = 'missing_combination';
  }

  const executions = product?.id
    ? (await db.prepare(`SELECT id, material, length FROM catalog_stock_positions WHERE product_id = ? AND is_active = 1 ORDER BY material, length, id`).bind(product.id).all<{ id: number; material: string; length: string }>()).results || []
    : [];

  return {
    ok: true,
    orderItemId,
    issueType,
    unknownFields,
    isWorkshop: Boolean(toInt(anchor.is_workshop, 0)),
    shippingStatus: cleanText(anchor.shipping_status),
    facts,
    product: product ? { id: product.id, name: cleanText(product.name), category: cleanText(product.category) } : null,
    execution: execution ? { id: execution.id, material: execution.material, length: execution.length } : null,
    existingVariantId: toInt(existingVariant?.id, 0) || null,
    products: (productsResult.results || []).map((row) => ({ id: toInt(row.id, 0), name: cleanText(row.name), category: cleanText(row.category) })),
    executions: executions.map((row) => ({ id: toInt(row.id, 0), material: canonicalStockPositionValue(row.material), length: canonicalStockPositionValue(row.length) })),
    references,
  };
}


export async function resolveCatalogReviewFacts(db: D1Database, orderItemId: number, input: CatalogReviewFactsInput): Promise<CatalogResolutionResponse> {
  const anchor = await db.prepare(
    `SELECT oi.*, o.external_id, o.shipping_status, o.shipping_date, o.order_status, o.archived_at
     FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ? LIMIT 1`
  ).bind(orderItemId).first<Record<string, unknown>>();
  if (!anchor?.id) throw new Error('Позиция заказа для разбора не найдена.');
  const inputKey = normalizedCatalogReviewKey(anchor);
  const candidates = await fetchCatalogReviewResolutionCandidates(db, toInt(anchor.order_id, 0));
  const matching = (candidates.results || []).filter((row) => normalizedCatalogReviewKey(row) === inputKey);
  if (!matching.length) throw new Error('Эта задача уже разобрана. Обновите список.');

  const workshopRows = matching.filter((row) => toInt(row.is_workshop, 0) === 1);
  const normalRows = matching.filter((row) => toInt(row.is_workshop, 0) !== 1);
  const category = normalizeAudienceCategory(input.category ?? anchor.audience_type, input.size ?? anchor.size_snapshot);
  const createProduct = Boolean(input.createProduct);
  let productId = Math.max(0, toInt(input.productId, 0));
  const requestedProductName = cleanText(input.productName) || cleanText(anchor.product_name_snapshot);

  let product: { id: number; name: string } | null = null;
  if (productId) {
    product = await db.prepare(`SELECT id, name FROM catalog_products WHERE id = ? AND is_active = 1 LIMIT 1`).bind(productId).first<{ id: number; name: string }>();
    if (!product?.id) throw new Error('Выбранный товар не найден или отключён.');
  } else if (!createProduct) {
    throw new Error('Выберите существующий товар или явно подтвердите создание нового базового товара.');
  } else {
    if (!requestedProductName) throw new Error('Введите название нового товара для каталога.');
    const duplicate = await findCatalogProductByIdentity(db, requestedProductName);
    if (duplicate?.id) throw new Error(`Такой базовый товар уже существует: ${cleanText(duplicate.name)}. Выберите его вместо создания дубля.`);
  }

  // Alias conflicts are checked before any allowed base-product creation.
  await assertCatalogProductAliasTargetAvailable(db, anchor.product_name_snapshot, product?.id || 0);

  const material = await resolveCatalogValueAlias(db, 'material', canonicalStockPositionValue(input.material ?? anchor.material_snapshot));
  const length = await resolveCatalogValueAlias(db, 'length', canonicalStockPositionValue(input.length ?? anchor.length_snapshot));
  const gender = normalizeCatalogCombinationGender(input.gender ?? anchor.gender_snapshot);
  const color = await resolveCatalogValueAlias(db, 'color', normalizeCatalogCombinationColor(input.color ?? anchor.color_snapshot));
  const size = await resolveCatalogValueAlias(db, category === 'child' ? 'child_age' : 'size', normalizeCatalogCombinationSize(input.size ?? anchor.size_snapshot));

  // Pure Workshop resolution intentionally stops at the base product.
  if (!normalRows.length) {
    if (!product?.id) {
      const created = await createCatalogProduct(db, { name: requestedProductName, category });
      productId = toInt(created.id, 0);
      product = { id: productId, name: cleanText(created.name) };
    }
    if (!product?.id) throw new Error('Не удалось определить базовый товар.');
    const timestamp = new Date().toISOString();
    await rememberCatalogProductAlias(db, anchor.product_name_snapshot, product.id, timestamp);
    let workshopLinked = 0;
    for (const row of workshopRows) {
      const id = toInt(row.id ?? row.order_item_id, 0);
      if (!id) continue;
      await db.prepare(`UPDATE order_items SET product_id = ?, variant_id = NULL, stock_writeoff_status = 'workshop' WHERE id = ?`).bind(product.id, id).run();
      await db.prepare(`UPDATE workshop_tasks SET product_id = ?, variant_id = NULL, updated_at = ? WHERE order_item_id = ?`).bind(product.id, timestamp, id).run();
      workshopLinked += 1;
    }
    return { ok: true, linked: workshopLinked, workshopLinked, message: `Цеховая позиция связана с товаром «${cleanText(product.name)}». Складская комбинация для неё не требуется.` };
  }

  if (gender && gender !== 'ЖЕН' && gender !== 'МУЖ') throw new Error('Пол должен быть выбран из списка.');

  // Phase 3A: ordinary order review may create/confirm the BASE product, but it may
  // only link an already-existing physical execution/variation. It must not create
  // reference values, executions or catalog_variants from demand alone.
  if (!product?.id) {
    const created = await createCatalogProduct(db, { name: requestedProductName, category });
    productId = toInt(created.id, 0);
    product = { id: productId, name: cleanText(created.name) };
  }
  if (!product?.id) throw new Error('Не удалось определить базовый товар.');

  const execution = await findCatalogExecutionV3(db, product.id, material, length);
  const combination = execution?.id
    ? await findCatalogCombinationV3(db, execution.id, category, gender, color, size)
    : null;
  if (!combination?.id) {
    throw new Error('Такой складской вариант ещё не зарегистрирован физической операцией. Разбор заказа не создаёт новые исполнения или вариации: они появятся после прихода, ревизии или другого явного движения товара.');
  }

  const timestamp = new Date().toISOString();
  const selected = await db.prepare(
    `SELECT v.id AS variant_id, v.product_id, p.name AS product_name, COALESCE(v.category, p.category, 'adult') AS category,
            v.gender, v.color, v.material, v.length, v.size_label
     FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
     WHERE v.id = ? AND v.is_active = 1 AND p.is_active = 1 LIMIT 1`
  ).bind(combination.id).first<CatalogReviewSelectedVariant>();
  if (!selected?.variant_id) throw new Error('Не удалось получить существующую комбинацию товара.');

  await rememberCatalogProductAlias(db, anchor.product_name_snapshot, product.id, timestamp);
  await rememberCatalogValueAlias(db, 'material', anchor.material_snapshot, material, timestamp);
  await rememberCatalogValueAlias(db, 'length', anchor.length_snapshot, length, timestamp);
  await rememberCatalogValueAlias(db, 'color', anchor.color_snapshot, color, timestamp);
  await rememberCatalogValueAlias(db, category === 'child' ? 'child_age' : 'size', anchor.size_snapshot, size, timestamp);
  const result = await resolveCatalogReviewRows(db, matching, selected, inputKey, timestamp, { writeAlias: false });
  const workshopLinked = matching.filter((row) => toInt(row.is_workshop, 0) === 1 && toInt(row.id ?? row.order_item_id, 0) > 0 && toInt(row.order_id, 0) > 0).length;
  return {
    ...result,
    workshopLinked,
    createdCombination: false,
    message: `Позиции связаны с существующей складской комбинацией: ${result.linked}.`,
  };
}


export async function excludeCatalogReviewQueueItem(db: D1Database, orderItemId: number) {
  const anchor = await db.prepare(
    `SELECT oi.*, o.external_id, o.shipping_status, o.shipping_date, o.order_status, o.archived_at
     FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ? LIMIT 1`
  ).bind(orderItemId).first<Record<string, unknown>>();
  if (!anchor?.id) throw new Error('Позиция заказа для разбора не найдена.');

  const inputKey = normalizedCatalogReviewKey(anchor);
  const candidates = await fetchCatalogReviewResolutionCandidates(db, toInt(anchor.order_id, 0));
  const matching = (candidates.results || []).filter((row) => normalizedCatalogReviewKey(row) === inputKey);
  if (!matching.length) throw new Error('Эта задача уже разобрана. Обновите список.');

  const timestamp = new Date().toISOString();
  let excluded = 0;
  let releasedReservations = 0;
  for (const row of matching) {
    const id = toInt(row.id ?? row.order_item_id, 0);
    if (!id) continue;
    const isWorkshop = toInt(row.is_workshop, 0) === 1;
    if (isWorkshop) {
      await db.batch([
        db.prepare(`UPDATE order_items SET product_id = NULL, variant_id = NULL, stock_writeoff_status = 'workshop_no_catalog' WHERE id = ?`).bind(id),
        db.prepare(`UPDATE workshop_tasks SET product_id = NULL, variant_id = NULL, updated_at = ? WHERE order_item_id = ?`).bind(timestamp, id),
      ]);
      excluded += 1;
      continue;
    }

    const reservation = await db.prepare(`SELECT id, status FROM inventory_reservations WHERE order_item_id = ? LIMIT 1`).bind(id).first<Record<string, unknown>>();
    const reservationStatus = cleanText(reservation?.status);
    if (reservation?.id && reservationStatus === 'active') {
      if (await releaseOrderReservationV2(db, id, timestamp, 'Администратор оставил позицию вне каталога')) releasedReservations += 1;
    } else if (reservation?.id && reservationStatus === 'unresolved') {
      await db.prepare(
        `UPDATE inventory_reservations
         SET status = 'released', unresolved_reason = 'catalog_excluded_by_admin', released_at = ?, updated_at = ?
         WHERE id = ? AND status = 'unresolved'`
      ).bind(timestamp, timestamp, toInt(reservation.id, 0)).run();
      releasedReservations += 1;
    }

    const historical = normalizeShippingStatus(row.shipping_status) === 'sent' || normalizeOrderStatus(row.order_status) !== 'active' || Boolean(cleanText(row.archived_at));
    await db.prepare(
      `UPDATE order_items
       SET product_id = NULL, variant_id = NULL, stock_writeoff_status = ?, stock_quantity_before = NULL, stock_quantity_after = NULL
       WHERE id = ?`
    ).bind(historical ? 'catalog_excluded_history' : 'catalog_excluded', id).run();
    excluded += 1;
  }

  return {
    ok: true,
    excluded,
    releasedReservations,
    message: excluded === 1
      ? 'Позиция оставлена только в заказе. В каталог и складской учёт она не добавлена.'
      : `Позиции оставлены только в заказах: ${excluded}. В каталог и складской учёт они не добавлены.`,
  };
}


export async function resolveCatalogReviewRows(
  db: D1Database,
  matching: Record<string, unknown>[],
  selected: CatalogReviewSelectedVariant,
  inputKey: string,
  timestamp = new Date().toISOString(),
  options: { writeAlias?: boolean } = {},
) {
  const variantId = toInt(selected.variant_id, 0);
  const productId = toInt(selected.product_id, 0);
  if (!variantId || !productId) throw new Error('Выбранная комбинация каталога не найдена или отключена.');

  if (options.writeAlias !== false) {
    await db.prepare(
      `INSERT INTO catalog_input_aliases (input_key, variant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(input_key) DO UPDATE SET variant_id = excluded.variant_id, updated_at = excluded.updated_at`
    ).bind(inputKey, variantId, timestamp, timestamp).run();
  }

  let linked = 0;
  let reserved = 0;
  let historicalLinked = 0;
  let skipped = 0;

  for (const row of matching) {
    const id = toInt(row.id ?? row.order_item_id, 0);
    const orderId = toInt(row.order_id, 0);
    if (!id || !orderId) continue;

    // Workshop identity stops at the base product. Even legacy/manual review endpoints
    // must not attach or create an ordinary warehouse SKU for a custom workshop piece.
    if (toInt(row.is_workshop, 0)) {
      await db.prepare(`UPDATE order_items SET product_id = ?, variant_id = NULL, stock_writeoff_status = 'workshop' WHERE id = ?`).bind(productId, id).run();
      await db.prepare(`UPDATE workshop_tasks SET product_id = ?, variant_id = NULL, updated_at = ? WHERE order_item_id = ?`).bind(productId, timestamp, id).run();
      linked += 1;
      continue;
    }

    await db.prepare(`UPDATE order_items SET product_id = ?, variant_id = ? WHERE id = ?`).bind(productId, variantId, id).run();
    await db.prepare(`UPDATE workshop_tasks SET product_id = ?, variant_id = ?, updated_at = ? WHERE order_item_id = ?`).bind(productId, variantId, timestamp, id).run();
    linked += 1;
    const orderStatus = normalizeOrderStatus(row.order_status);
    if (orderStatus === 'deleted' || orderStatus === 'archived' || cleanText(row.archived_at)) {
      skipped += 1;
      continue;
    }

    // Historical sent orders are identity repair only. Never manufacture a new present-day
    // stock movement because an old catalog link was corrected later.
    if (normalizeShippingStatus(row.shipping_status) === 'sent') {
      const existingReservation = await db.prepare(`SELECT id, status FROM inventory_reservations WHERE order_item_id = ? LIMIT 1`).bind(id).first<Record<string, unknown>>();
      if (existingReservation?.id && cleanText(existingReservation.status) === 'unresolved') {
        await db.prepare(
          `UPDATE inventory_reservations SET product_id = ?, variant_id = ?, status = 'released', unresolved_reason = 'historical_identity_link', released_at = ?, updated_at = ? WHERE id = ?`
        ).bind(productId, variantId, timestamp, timestamp, toInt(existingReservation.id, 0)).run();
      }
      await db.prepare(`UPDATE order_items SET stock_writeoff_status = 'catalog_linked_history' WHERE id = ?`).bind(id).run();
      historicalLinked += 1;
      continue;
    }

    const item = catalogReviewRowToOrderItem(row);
    const existingReservation = await db.prepare(`SELECT id, status FROM inventory_reservations WHERE order_item_id = ? LIMIT 1`).bind(id).first<Record<string, unknown>>();
    if (existingReservation?.id && cleanText(existingReservation.status) === 'unresolved') {
      await db.prepare(`DELETE FROM inventory_reservations WHERE id = ?`).bind(toInt(existingReservation.id, 0)).run();
    }
    await reserveOrderItemV2(db, orderId, cleanText(row.external_id), item, productId, variantId, timestamp, id, 'order', cleanText(row.external_id));
    reserved += 1;
  }

  return { ok: true, linked, reserved, historicalLinked, fulfilled: 0, skipped };
}


export async function reconcileCatalogReviewQueue(db: D1Database, url: URL) {
  const groupLimit = Math.min(20, Math.max(1, toInt(url.searchParams.get('limit'), 10)));
  const rowsResult = await fetchCatalogReviewRows(db, 160);
  const rows = rowsResult.results || [];
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = normalizedCatalogReviewKey(row);
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }

  let resolvedGroups = 0;
  let linkedItems = 0;
  let reserved = 0;
  let historicalLinked = 0;
  let touchedGroups = 0;

  for (const [inputKey, matching] of groups) {
    if (resolvedGroups >= groupLimit) break;
    touchedGroups += 1;
    const normalSample = matching.find((row) => toInt(row.is_workshop, 0) !== 1) || null;
    if (!normalSample) {
      // Pure workshop groups may learn/resolve only the base product. Reconciliation must
      // never create a warehouse execution/variant just because workshop characteristics are known.
      const workshopItem = catalogReviewRowToOrderItem(matching[0]);
      const workshopResolved = await resolveWorkshopCatalogProductOnly(db, workshopItem);
      if (!workshopResolved.productId) continue;
      const timestamp = new Date().toISOString();
      let workshopLinked = 0;
      for (const row of matching) {
        const rowId = toInt(row.id ?? row.order_item_id, 0);
        if (!rowId) continue;
        await db.prepare(`UPDATE order_items SET product_id = ?, variant_id = NULL, stock_writeoff_status = 'workshop' WHERE id = ?`).bind(workshopResolved.productId, rowId).run();
        await db.prepare(`UPDATE workshop_tasks SET product_id = ?, variant_id = NULL, updated_at = ? WHERE order_item_id = ?`).bind(workshopResolved.productId, timestamp, rowId).run();
        workshopLinked += 1;
      }
      resolvedGroups += 1;
      linkedItems += workshopLinked;
      continue;
    }

    const item = catalogReviewRowToOrderItem(normalSample);
    const resolved = await resolveCatalogProductAndVariantV2(db, item);

    // Even when the exact combination still needs a human decision, remembering a safely
    // recognized base product reduces the next task to the actual missing detail.
    if (resolved.productId) {
      for (const row of matching) {
        const rowId = toInt(row.id ?? row.order_item_id, 0);
        if (rowId && !toInt(row.product_id, 0)) {
          await db.prepare(`UPDATE order_items SET product_id = ? WHERE id = ?`).bind(resolved.productId, rowId).run();
          await db.prepare(`UPDATE workshop_tasks SET product_id = ?, updated_at = ? WHERE order_item_id = ?`).bind(resolved.productId, new Date().toISOString(), rowId).run();
        }
      }
    }

    if (!resolved.productId || !resolved.variantId) continue;
    const selected = await db.prepare(
      `SELECT v.id AS variant_id, v.product_id, p.name AS product_name, COALESCE(v.category, p.category, 'adult') AS category,
              v.gender, v.color, v.material, v.length, v.size_label
       FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
       WHERE v.id = ? AND v.is_active = 1 AND p.is_active = 1 LIMIT 1`
    ).bind(resolved.variantId).first<CatalogReviewSelectedVariant>();
    if (!selected?.variant_id) continue;
    const result = await resolveCatalogReviewRows(db, matching, selected, inputKey, new Date().toISOString(), { writeAlias: false });
    resolvedGroups += 1;
    linkedItems += result.linked;
    reserved += result.reserved;
    historicalLinked += result.historicalLinked;
  }

  return { ok: true, resolvedGroups, linkedItems, reserved, historicalLinked, scannedGroups: touchedGroups };
}


export async function listCatalogReviewQueue(db: D1Database, url: URL) {
  const limit = Math.min(50, Math.max(10, toInt(url.searchParams.get('limit'), 24)));
  const orderId = Math.max(0, toInt(url.searchParams.get('orderId'), 0));
  const base = catalogReviewBasePredicate('oi', 'o');
  const scope = orderId > 0
    ? `${catalogReviewOrderScopePredicate('oi', 'o')} AND oi.order_id = ${orderId}`
    : catalogReviewOperationalPredicate('oi', 'o');
  const unresolvedCte = `
    WITH unresolved AS (
      SELECT oi.id AS order_item_id, oi.order_id, o.external_id, o.order_date, o.shipping_status, o.shipping_date,
             o.order_status, o.archived_at, oi.product_id, oi.variant_id, oi.product_name_snapshot, oi.audience_type,
             oi.gender_snapshot, oi.color_snapshot, oi.material_snapshot, oi.length_snapshot, oi.size_snapshot,
             oi.quantity, oi.source_type, oi.is_workshop, oi.stock_writeoff_status, oi.created_at,
             UPPER(TRIM(COALESCE(oi.product_name_snapshot, ''))) AS n_product,
             CASE WHEN UPPER(TRIM(COALESCE(oi.audience_type, ''))) LIKE '%ДЕТ%' OR LOWER(TRIM(COALESCE(oi.audience_type, ''))) = 'child' THEN 'child' ELSE 'adult' END AS n_category,
             UPPER(TRIM(COALESCE(oi.gender_snapshot, ''))) AS n_gender,
             UPPER(TRIM(COALESCE(oi.color_snapshot, ''))) AS n_color,
             CASE WHEN TRIM(COALESCE(oi.material_snapshot, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(oi.material_snapshot)) END AS n_material,
             CASE WHEN TRIM(COALESCE(oi.length_snapshot, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(oi.length_snapshot)) END AS n_length,
             UPPER(TRIM(COALESCE(oi.size_snapshot, ''))) AS n_size
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE ${base}
        AND ${scope}
    )`;

  const stats = await db.prepare(`${unresolvedCte}, grouped AS (
      SELECT 1 FROM unresolved
      GROUP BY n_product, n_category, n_gender, n_color, n_material, n_length, n_size
    )
    SELECT (SELECT COUNT(*) FROM unresolved) AS affected_items,
           (SELECT COUNT(*) FROM grouped) AS group_count;`).first<{ affected_items: number; group_count: number }>();

  const rows = await db.prepare(`${unresolvedCte}, grouped AS (
      SELECT MAX(order_item_id) AS sample_id, COUNT(*) AS affected_count
      FROM unresolved
      GROUP BY n_product, n_category, n_gender, n_color, n_material, n_length, n_size
      ORDER BY sample_id DESC
      LIMIT ?
    )
    SELECT u.*, g.affected_count
    FROM grouped g
    JOIN unresolved u ON u.order_item_id = g.sample_id
    ORDER BY g.sample_id DESC;`).bind(limit).all<Record<string, unknown>>();


  const count = Math.max(0, toInt(stats?.group_count, 0));
  const affectedItems = Math.max(0, toInt(stats?.affected_items, 0));
  return {
    ok: true,
    mode: orderId > 0 ? 'order' : 'current',
    orderId: orderId || null,
    recentDays: CATALOG_REVIEW_RECENT_DAYS,
    count,
    affectedItems,
    truncated: count > limit,
    autoResolved: 0,
    items: (rows.results || []).map((row) => ({
      orderItemId: toInt(row.order_item_id, 0),
      orderId: toInt(row.order_id, 0),
      externalId: cleanText(row.external_id),
      orderDate: cleanText(row.order_date),
      shippingStatus: cleanText(row.shipping_status),
      shippingDate: cleanText(row.shipping_date),
      productId: toInt(row.product_id, 0) || null,
      variantId: toInt(row.variant_id, 0) || null,
      productName: cleanText(row.product_name_snapshot),
      category: normalizeAudienceCategory(row.audience_type, row.size_snapshot),
      gender: cleanText(row.gender_snapshot),
      color: cleanText(row.color_snapshot),
      material: canonicalStockPositionValue(row.material_snapshot),
      length: canonicalStockPositionValue(row.length_snapshot),
      size: cleanText(row.size_snapshot),
      quantity: Math.max(1, toInt(row.quantity, 1)),
      sourceType: cleanText(row.is_workshop) === '1' || toInt(row.is_workshop, 0) ? 'workshop' : normalizeSourceType(row.source_type),
      inputKey: normalizedCatalogReviewKey(row),
      affectedCount: Math.max(1, toInt(row.affected_count, 1)),
    })),
  };
}


export async function resolveCatalogReviewQueueItem(db: D1Database, orderItemId: number, variantId: number) {
  if (!orderItemId || !variantId) throw new Error('Выберите позицию заказа и существующий вариант каталога.');
  const selected = await db.prepare(
    `SELECT v.id AS variant_id, v.product_id, p.name AS product_name, COALESCE(v.category, p.category, 'adult') AS category,
            v.gender, v.color, v.material, v.length, v.size_label
     FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
     WHERE v.id = ? AND v.is_active = 1 AND p.is_active = 1 LIMIT 1`
  ).bind(variantId).first<CatalogReviewSelectedVariant>();
  if (!selected?.variant_id) throw new Error('Выбранный вариант каталога не найден или отключён.');

  const anchor = await db.prepare(
    `SELECT oi.*, o.external_id, o.shipping_status, o.shipping_date, o.order_status, o.archived_at
     FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ? LIMIT 1`
  ).bind(orderItemId).first<Record<string, unknown>>();
  if (!anchor?.id) throw new Error('Позиция заказа для разбора не найдена.');
  const inputKey = normalizedCatalogReviewKey(anchor);
  const candidates = await fetchCatalogReviewResolutionCandidates(db, toInt(anchor.order_id, 0));
  const matching = (candidates.results || []).filter((row) => normalizedCatalogReviewKey(row) === inputKey);
  return await resolveCatalogReviewRows(db, matching, selected, inputKey);
}
