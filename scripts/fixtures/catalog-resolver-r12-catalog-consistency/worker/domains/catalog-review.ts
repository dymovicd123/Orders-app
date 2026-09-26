// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import type { CatalogReferenceOptions, CatalogResolutionContext, CatalogResolutionResponse } from '../../shared/api-contracts.ts'
import { canonicalStockPositionValue, cleanText, normalizeAudienceCategory, normalizeOrderStatus, normalizeShippingStatus, normalizeSourceType, toInt, upperText } from '../core/text.ts'
import type { ReferenceKind } from '../core/types.ts'
import { assertCatalogProductAliasTargetAvailable, catalogGenderForProductScope, catalogReferenceDbValueExists, createCatalogCombinationV3, createCatalogProduct, ensureCatalogExecutionV3, findCatalogCombinationV3, findCatalogExecutionV3, findCatalogProductByIdentity, getCatalogProductGenderScope, makeVariantExternalId, normalizeCatalogCombinationColor, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize, normalizeCatalogProductGenderScope, rememberCatalogProductAlias, rememberCatalogValueAlias, resolveCatalogValueAlias } from './catalog.ts'
import { normalizeOrderItems } from './order-core.ts'
import { releaseOrderReservationV2, reserveOrderItemV2, resolveCatalogProductAndVariantV2, resolveWorkshopCatalogProductOnly } from './order-reservations.ts'
import { upsertReferenceValue } from './references.ts'
import { writeActivityLog } from './activity.ts'

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

// A human-confirmed mapping is reusable only when the raw row already identifies one exact
// physical SKU. Incomplete rows (blank gender/color/size, Workshop product-only tasks) remain
// intentionally scoped to the one row so a confirmation cannot leak across genuinely different items.
export function catalogReviewInputCanLearnExact(row: Record<string, unknown>) {
  if (toInt(row.is_workshop, 0)) return false;
  const gender = normalizeCatalogCombinationGender(row.gender_snapshot);
  return Boolean(
    cleanText(row.product_name_snapshot)
    && (gender === 'ЖЕН' || gender === 'МУЖ')
    && cleanText(row.color_snapshot)
    && cleanText(row.material_snapshot)
    && cleanText(row.length_snapshot)
    && cleanText(row.size_snapshot)
  );
}



export const CATALOG_REVIEW_RECENT_DAYS = 30;


export function catalogReviewBasePredicate(oi = 'oi', o = 'o') {
  return `${oi}.quantity > 0
    AND (${oi}.product_id IS NULL OR ${oi}.variant_id IS NULL OR COALESCE(${oi}.stock_writeoff_status, '') = 'catalog_unresolved')
    AND COALESCE(${oi}.stock_writeoff_status, '') NOT IN ('catalog_excluded', 'catalog_excluded_history', 'workshop_no_catalog', 'legacy_unknown_gender')
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
    observedPhysicalQuantity: null,
    shortageAcknowledged: false,
  } as ReturnType<typeof normalizeOrderItems>[number];
}


export type CatalogReviewFactsInput = {
  productId?: unknown;
  createProduct?: unknown;
  productName?: unknown;
  genderScope?: unknown;
  material?: unknown;
  length?: unknown;
  category?: unknown;
  gender?: unknown;
  color?: unknown;
  size?: unknown;
  createFields?: unknown;
  legacyUnknownGender?: unknown;
};


export async function getCatalogReviewContext(db: D1Database, orderItemId: number, preview: CatalogReviewFactsInput = {}): Promise<CatalogResolutionContext> {
  let anchor = await db.prepare(
    `SELECT oi.*, o.external_id, o.shipping_status, o.shipping_date, o.order_status, o.archived_at
     FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ? LIMIT 1`
  ).bind(orderItemId).first<Record<string, unknown>>();
  if (!anchor?.id) throw new Error('Позиция заказа для разбора не найдена.');

  // An already-linked active SKU is stronger current identity than old manager-entered
  // snapshots. On the initial resolver load, hydrate facts from that canonical variant so
  // the form never asks again for a gender/color/size that the Orders table already knows.
  if (!Object.keys(preview).length && toInt(anchor.variant_id, 0)) {
    const linked = await db.prepare(
      `SELECT v.id AS variant_id, v.product_id, p.name AS product_name,
              COALESCE(v.category, p.category, 'adult') AS category,
              v.gender, v.color, v.material, v.length, v.size_label
       FROM catalog_variants v
       JOIN catalog_products p ON p.id = v.product_id
       WHERE v.id = ? AND v.is_active = 1 AND p.is_active = 1
       LIMIT 1`
    ).bind(toInt(anchor.variant_id, 0)).first<CatalogReviewSelectedVariant>();
    if (linked?.variant_id && linked.product_id) {
      anchor = {
        ...anchor,
        product_id: linked.product_id,
        product_name_snapshot: cleanText(linked.product_name) || anchor.product_name_snapshot,
        audience_type: cleanText(linked.category) || anchor.audience_type,
        gender_snapshot: cleanText(linked.gender),
        color_snapshot: cleanText(linked.color),
        material_snapshot: canonicalStockPositionValue(linked.material),
        length_snapshot: canonicalStockPositionValue(linked.length),
        size_snapshot: cleanText(linked.size_label),
      };
    }
  }

  const category = normalizeAudienceCategory(preview.category ?? anchor.audience_type, preview.size ?? anchor.size_snapshot);
  const facts = {
    productName: cleanText(anchor.product_name_snapshot),
    material: await resolveCatalogValueAlias(db, 'material', canonicalStockPositionValue(preview.material ?? anchor.material_snapshot)),
    length: await resolveCatalogValueAlias(db, 'length', canonicalStockPositionValue(preview.length ?? anchor.length_snapshot)),
    category,
    gender: normalizeCatalogCombinationGender(preview.gender ?? anchor.gender_snapshot),
    color: await resolveCatalogValueAlias(db, 'color', normalizeCatalogCombinationColor(preview.color ?? anchor.color_snapshot)),
    size: await resolveCatalogValueAlias(db, category === 'child' ? 'child_age' : 'size', normalizeCatalogCombinationSize(preview.size ?? anchor.size_snapshot)),
  };
  const product = toInt(preview.productId ?? anchor.product_id, 0)
    ? await db.prepare(`SELECT id, name, category FROM catalog_products WHERE id = ? AND is_active = 1 LIMIT 1`).bind(toInt(preview.productId ?? anchor.product_id, 0)).first<{ id: number; name: string; category: string }>()
    : preview.productId !== undefined ? null : await findCatalogProductByIdentity(db, facts.productName, 0, { activeOnly: true }) as { id: number; name: string; category: string } | null;
  const productGenderScope = product?.id ? await getCatalogProductGenderScope(db, product.id) : 'unisex';
  if (product?.id) facts.gender = facts.gender || catalogGenderForProductScope(productGenderScope);

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
      if ((productGenderScope === 'unisex' && !facts.gender) || (facts.gender && facts.gender !== 'ЖЕН' && facts.gender !== 'МУЖ')) unknownFields.push('gender');
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
    product: product ? { id: product.id, name: cleanText(product.name), category: cleanText(product.category), genderScope: productGenderScope } : null,
    execution: execution ? { id: execution.id, material: execution.material, length: execution.length } : null,
    existingVariantId: toInt(existingVariant?.id, 0) || null,
    exactVariant: existingVariant?.id && product ? { id: existingVariant.id, productId: product.id, productName: cleanText(product.name), facts: { ...facts } } : null,
    canLeaveGenderUnknown: Boolean(product?.id && productGenderScope === 'unisex' && !facts.gender && !toInt(anchor.is_workshop, 0)),
    products: (productsResult.results || []).map((row) => ({ id: toInt(row.id, 0), name: cleanText(row.name), category: cleanText(row.category) })),
    executions: executions.map((row) => ({ id: toInt(row.id, 0), material: canonicalStockPositionValue(row.material), length: canonicalStockPositionValue(row.length) })),
    references,
  };
}


export async function resolveCatalogReviewFacts(
  db: D1Database,
  orderItemId: number,
  input: CatalogReviewFactsInput,
  options: { singleItem?: boolean } = {},
): Promise<CatalogResolutionResponse> {
  const anchor = await db.prepare(
    `SELECT oi.*, o.external_id, o.shipping_status, o.shipping_date, o.order_status, o.archived_at
     FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ? LIMIT 1`
  ).bind(orderItemId).first<Record<string, unknown>>();
  if (!anchor?.id) throw new Error('Позиция заказа для разбора не найдена.');
  const inputKey = normalizedCatalogReviewKey(anchor);
  const candidates = await fetchCatalogReviewResolutionCandidates(db, toInt(anchor.order_id, 0));
  const matching = options.singleItem
    ? (candidates.results || []).filter((row) => toInt(row.id ?? row.order_item_id, 0) === orderItemId)
    : (candidates.results || []).filter((row) => normalizedCatalogReviewKey(row) === inputKey);
  if (!matching.length) throw new Error('Эта задача уже разобрана. Обновите список.');

  const workshopRows = matching.filter((row) => toInt(row.is_workshop, 0) === 1);
  const normalRows = matching.filter((row) => toInt(row.is_workshop, 0) !== 1);
  const category = normalizeAudienceCategory(input.category ?? anchor.audience_type, input.size ?? anchor.size_snapshot);
  const createProduct = Boolean(input.createProduct);
  const legacyUnknownGender = Boolean(input.legacyUnknownGender);
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

  if (legacyUnknownGender && (!product?.id || createProduct)) {
    throw new Error('Историческое исключение можно применить только к уже существующему базовому товару.');
  }

  // Validate the learned raw spelling before creating any product/reference/execution. An alias
  // conflict must never leave half-created master data behind.
  await assertCatalogProductAliasTargetAvailable(db, anchor.product_name_snapshot, product?.id || 0);

  const createFields = new Set(Array.isArray(input.createFields) ? (input.createFields as unknown[]).map(cleanText) : []);
  const material = await resolveCatalogValueAlias(db, 'material', canonicalStockPositionValue(input.material ?? anchor.material_snapshot));
  const length = await resolveCatalogValueAlias(db, 'length', canonicalStockPositionValue(input.length ?? anchor.length_snapshot));
  const requestedGenderScope = product?.id ? await getCatalogProductGenderScope(db, product.id) : (cleanText(input.genderScope) ? normalizeCatalogProductGenderScope(input.genderScope) : null);
  if (!product?.id && !requestedGenderScope) throw new Error('Для нового товара выберите назначение по полу: Женский, Мужской или Унисекс.');
  const gender = normalizeCatalogCombinationGender(input.gender ?? anchor.gender_snapshot) || catalogGenderForProductScope(requestedGenderScope || 'unisex');
  const color = await resolveCatalogValueAlias(db, 'color', normalizeCatalogCombinationColor(input.color ?? anchor.color_snapshot));
  const size = await resolveCatalogValueAlias(db, category === 'child' ? 'child_age' : 'size', normalizeCatalogCombinationSize(input.size ?? anchor.size_snapshot));

  // Pure workshop tasks intentionally stop at the base product and never validate/create a warehouse SKU.
  if (!normalRows.length) {
    if (!product?.id) {
      const created = await createCatalogProduct(db, { name: requestedProductName, category, genderScope: requestedGenderScope });
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

  const legacyGenderException = Boolean(legacyUnknownGender && product?.id && requestedGenderScope === 'unisex' && !gender);
  if (legacyUnknownGender && !legacyGenderException) {
    throw new Error('«Не удалось выяснить пол» доступно только когда существующий товар действительно требует выбора пола, а данных нет.');
  }
  if (!legacyGenderException && gender !== 'ЖЕН' && gender !== 'МУЖ') throw new Error('Для товара «Унисекс» выберите пол конкретной вещи: ЖЕН или МУЖ.');

  // Read-only preflight first. A missing checkbox must fail before creating a product,
  // reference value, execution, alias or touching any order/workshop row.
  const referencePlan: Array<{ field: string; dbKind: string; apiKind: ReferenceKind; value: string }> = [
    { field: 'material', dbKind: 'material', apiKind: 'materials', value: material },
    { field: 'length', dbKind: 'length', apiKind: 'lengths', value: length },
    { field: 'color', dbKind: 'color', apiKind: 'colors', value: color },
    { field: 'size', dbKind: category === 'child' ? 'child_age' : 'size', apiKind: category === 'child' ? 'childAges' : 'sizes', value: size },
  ];
  const missingReferences: typeof referencePlan = [];
  for (const entry of referencePlan) {
    if (!entry.value || ((entry.dbKind === 'material' || entry.dbKind === 'length') && entry.value === 'СТАНДАРТ')) continue;
    if (!await catalogReferenceDbValueExists(db, entry.dbKind, entry.value)) missingReferences.push(entry);
  }
  const unconfirmed = missingReferences.find((entry) => !createFields.has(entry.field));
  if (unconfirmed) throw new Error(`Значение «${unconfirmed.value}» ещё не существует. Выберите существующее или явно добавьте его как новое.`);

  if (!product?.id) {
    const created = await createCatalogProduct(db, { name: requestedProductName, category, genderScope: requestedGenderScope });
    productId = toInt(created.id, 0);
    product = { id: productId, name: cleanText(created.name) };
  }
  if (!product?.id) throw new Error('Не удалось определить базовый товар.');

  for (const entry of missingReferences) {
    await upsertReferenceValue(db, { kind: entry.apiKind, value: entry.value, isActive: 1, sortOrder: 0 });
  }

  const timestamp = new Date().toISOString();

  if (legacyGenderException) {
    let linked = 0;
    let workshopLinked = 0;
    let releasedReservations = 0;
    const audienceType = category === 'child' ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ';
    const explicitSize = cleanText(input.size) || cleanText(anchor.size_snapshot) || 'БЕЗ РАЗМЕРА';
    const explicitColor = cleanText(input.color) || color || 'БЕЗ ЦВЕТА';

    for (const row of matching) {
      const id = toInt(row.id ?? row.order_item_id, 0);
      if (!id) continue;
      if (toInt(row.is_workshop, 0) === 1) {
        await db.prepare(`UPDATE order_items SET product_id = ?, variant_id = NULL, stock_writeoff_status = 'workshop' WHERE id = ?`).bind(product.id, id).run();
        await db.prepare(`UPDATE workshop_tasks SET product_id = ?, variant_id = NULL, updated_at = ? WHERE order_item_id = ?`).bind(product.id, timestamp, id).run();
        workshopLinked += 1;
        linked += 1;
        continue;
      }

      const reservation = await db.prepare(`SELECT id, status FROM inventory_reservations WHERE order_item_id = ? LIMIT 1`).bind(id).first<Record<string, unknown>>();
      const reservationStatus = cleanText(reservation?.status);
      if (reservation?.id && reservationStatus === 'active') {
        if (await releaseOrderReservationV2(db, id, timestamp, 'Пол исторической позиции не удалось установить')) releasedReservations += 1;
      } else if (reservation?.id && reservationStatus === 'unresolved') {
        await db.prepare(
          `UPDATE inventory_reservations
           SET status = 'released', unresolved_reason = 'legacy_unknown_gender', released_at = ?, updated_at = ?
           WHERE id = ? AND status = 'unresolved'`
        ).bind(timestamp, timestamp, toInt(reservation.id, 0)).run();
        releasedReservations += 1;
      }

      await db.prepare(
        `UPDATE order_items
         SET product_id = ?, variant_id = NULL, audience_type = ?, gender_snapshot = NULL,
             color_snapshot = ?, material_snapshot = ?, length_snapshot = ?, size_snapshot = ?,
             stock_writeoff_status = 'legacy_unknown_gender', stock_quantity_before = NULL, stock_quantity_after = NULL
         WHERE id = ?`
      ).bind(product.id, audienceType, explicitColor, material, length, explicitSize, id).run();
      linked += 1;
    }

    try {
      await writeActivityLog(db, {
        eventType: 'catalog_legacy_unknown_gender', entityType: 'order', entityId: toInt(anchor.order_id, 0),
        orderId: toInt(anchor.order_id, 0), externalOrderId: cleanText(anchor.external_id),
        title: `Пол позиции не удалось установить: ${cleanText(product.name)}`,
        details: `Позиция сохранена как историческое исключение без точного складского SKU и без физического списания по варианту. Материал: ${material}; цвет: ${explicitColor}; размер: ${explicitSize}.`,
        createdAt: timestamp,
      });
    } catch (error) {
      console.warn('Legacy unknown-gender activity log failed after committed resolution', error);
    }

    return {
      ok: true,
      linked,
      workshopLinked,
      releasedReservations,
      legacyUnknownGender: true,
      message: 'Пол не удалось установить. Позиция сохранена как историческое исключение без бесполого SKU и без точного физического списания по варианту.',
    };
  }

  const execution = await ensureCatalogExecutionV3(db, product.id, material, length, timestamp);
  const combination = await createCatalogCombinationV3(db, {
    productId: product.id,
    executionId: execution.id,
    category,
    gender,
    color,
    material: execution.material,
    length: execution.length,
    sizeLabel: size,
    externalId: makeVariantExternalId(product.name, category, gender, color, execution.material, execution.length, size),
  }, timestamp);
  const selected = await db.prepare(
    `SELECT v.id AS variant_id, v.product_id, p.name AS product_name, COALESCE(v.category, p.category, 'adult') AS category,
            v.gender, v.color, v.material, v.length, v.size_label
     FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
     WHERE v.id = ? AND v.is_active = 1 AND p.is_active = 1 LIMIT 1`
  ).bind(combination.id).first<CatalogReviewSelectedVariant>();
  if (!selected?.variant_id) throw new Error('Не удалось получить созданную комбинацию товара.');

  // Alias is written only after every normal-item fact has passed validation and a canonical
  // target exists. Mixed workshop rows are handled by resolveCatalogReviewRows afterwards,
  // so a validation error cannot partially remove them from the review queue.
  await rememberCatalogProductAlias(db, anchor.product_name_snapshot, product.id, timestamp);
  await rememberCatalogValueAlias(db, 'material', anchor.material_snapshot, material, timestamp);
  await rememberCatalogValueAlias(db, 'length', anchor.length_snapshot, length, timestamp);
  await rememberCatalogValueAlias(db, 'color', anchor.color_snapshot, color, timestamp);
  await rememberCatalogValueAlias(db, category === 'child' ? 'child_age' : 'size', anchor.size_snapshot, size, timestamp);
  const reusableExactInput = Boolean(options.singleItem && catalogReviewInputCanLearnExact(anchor));
  let resolutionRows = matching;
  if (reusableExactInput) {
    const fanoutCandidates = await fetchCatalogReviewResolutionCandidates(db, toInt(anchor.order_id, 0));
    const identicalOpenRows = (fanoutCandidates.results || []).filter((row) => normalizedCatalogReviewKey(row) === inputKey);
    if (identicalOpenRows.length) resolutionRows = identicalOpenRows;
  }
  const result = await resolveCatalogReviewRows(db, resolutionRows, selected, inputKey, timestamp, { writeAlias: reusableExactInput });
  const workshopLinked = resolutionRows.filter((row) => toInt(row.is_workshop, 0) === 1 && toInt(row.id ?? row.order_item_id, 0) > 0 && toInt(row.order_id, 0) > 0).length;
  return {
    ...result,
    workshopLinked,
    createdCombination: Boolean(combination.created),
    message: combination.created
      ? `Создана точная комбинация и связаны позиции: ${result.linked}.`
      : `Позиции связаны с существующей комбинацией: ${result.linked}.`,
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

    const orderStatus = normalizeOrderStatus(row.order_status);
    if (orderStatus === 'deleted' || orderStatus === 'archived' || cleanText(row.archived_at)) {
      await db.prepare(`UPDATE order_items SET product_id = ?, variant_id = ? WHERE id = ?`).bind(productId, variantId, id).run();
      await db.prepare(`UPDATE workshop_tasks SET product_id = ?, variant_id = ?, updated_at = ? WHERE order_item_id = ?`).bind(productId, variantId, timestamp, id).run();
      linked += 1;
      skipped += 1;
      continue;
    }

    // Historical sent orders are identity repair only. Never manufacture a new present-day
    // stock movement because an old catalog link was corrected later.
    if (normalizeShippingStatus(row.shipping_status) === 'sent') {
      await db.prepare(`UPDATE order_items SET product_id = ?, variant_id = ? WHERE id = ?`).bind(productId, variantId, id).run();
      await db.prepare(`UPDATE workshop_tasks SET product_id = ?, variant_id = ?, updated_at = ? WHERE order_item_id = ?`).bind(productId, variantId, timestamp, id).run();
      linked += 1;
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
    const targetSource = normalizeSourceType(item.inventorySource);
    let existingReservation = await db.prepare(
      `SELECT id, status, quantity, inventory_source, product_id, variant_id
       FROM inventory_reservations
       WHERE order_item_id = ?
       LIMIT 1`
    ).bind(id).first<Record<string, unknown>>();
    const existingStatus = cleanText(existingReservation?.status);

    // A line that was already physically issued must remain historical physical truth.
    // Resolver may repair its catalog identity, but must never manufacture a new reservation.
    if (orderItemWasPhysicallyIssued(row) || existingStatus === 'fulfilled') {
      await db.prepare(`UPDATE order_items SET product_id = ?, variant_id = ? WHERE id = ?`).bind(productId, variantId, id).run();
      await db.prepare(`UPDATE workshop_tasks SET product_id = ?, variant_id = ?, updated_at = ? WHERE order_item_id = ?`).bind(productId, variantId, timestamp, id).run();
      linked += 1;
      reserved += 1;
      continue;
    }

    if (existingReservation?.id && existingStatus === 'active') {
      const currentSource = normalizeSourceType(existingReservation.inventory_source);
      const currentVariantId = toInt(existingReservation.variant_id, 0);
      const currentQuantity = Math.max(0, toInt(existingReservation.quantity, 0));
      const reservationMatchesTarget = currentSource === targetSource
        && currentVariantId === variantId
        && currentQuantity === Math.max(1, toInt(item.quantity, 1));

      if (reservationMatchesTarget) {
        // Variant is the physical identity. Keep the reservation id/lineage and only refresh
        // its redundant product FK if an older row was incomplete.
        await db.prepare(
          `UPDATE inventory_reservations SET product_id = ?, updated_at = ? WHERE id = ? AND status = 'active'`
        ).bind(productId, timestamp, toInt(existingReservation.id, 0)).run();
      } else {
        // Resolver is changing the physical identity of work that has not been issued yet.
        // Release the old reservation first so the old SKU's reserved_quantity is corrected.
        await releaseOrderReservationV2(db, id, timestamp, 'Исправлена canonical identity позиции заказа');
        await db.batch([
          db.prepare(`DELETE FROM inventory_reservations WHERE id = ? AND status = 'released'`).bind(toInt(existingReservation.id, 0)),
          // If creating the replacement reservation fails, keep this row in Resolver instead
          // of silently losing it from the review queue.
          db.prepare(
            `UPDATE order_items
             SET stock_writeoff_status = 'catalog_unresolved', stock_quantity_before = NULL, stock_quantity_after = NULL
             WHERE id = ?`
          ).bind(id),
        ]);
        existingReservation = null;
      }
    } else if (existingReservation?.id && existingStatus !== 'fulfilled') {
      // Unresolved/released legacy reservation rows are current-state placeholders, not audit
      // history. Remove them before creating the exact active reservation.
      await db.batch([
        db.prepare(`DELETE FROM inventory_reservations WHERE id = ? AND status <> 'fulfilled'`).bind(toInt(existingReservation.id, 0)),
        db.prepare(
          `UPDATE order_items
           SET stock_writeoff_status = 'catalog_unresolved', stock_quantity_before = NULL, stock_quantity_after = NULL
           WHERE id = ?`
        ).bind(id),
      ]);
      existingReservation = null;
    }

    await reserveOrderItemV2(
      db,
      orderId,
      cleanText(row.external_id),
      item,
      productId,
      variantId,
      timestamp,
      id,
      'order',
      cleanText(row.external_id),
    );

    // reserveOrderItemV2 is deliberately retry-safe and may return an existing row. Prove that
    // the committed reservation now matches the Resolver decision before exposing that decision
    // as current order truth. This also closes a concurrent conflicting Resolver race safely.
    const committedReservation = await db.prepare(
      `SELECT id, status, quantity, inventory_source, product_id, variant_id
       FROM inventory_reservations
       WHERE order_item_id = ?
       LIMIT 1`
    ).bind(id).first<Record<string, unknown>>();
    const committedMatchesTarget = cleanText(committedReservation?.status) === 'active'
      && normalizeSourceType(committedReservation?.inventory_source) === targetSource
      && toInt(committedReservation?.variant_id, 0) === variantId
      && toInt(committedReservation?.product_id, 0) === productId
      && Math.max(0, toInt(committedReservation?.quantity, 0)) === Math.max(1, toInt(item.quantity, 1));
    if (!committedMatchesTarget) {
      throw new Error('Резерв позиции изменился одновременно с исправлением каталога. Обновите заказ и повторите действие.');
    }

    // Current working identity is published only after the matching physical reservation exists.
    await db.prepare(`UPDATE order_items SET product_id = ?, variant_id = ? WHERE id = ?`).bind(productId, variantId, id).run();
    await db.prepare(`UPDATE workshop_tasks SET product_id = ?, variant_id = ?, updated_at = ? WHERE order_item_id = ?`).bind(productId, variantId, timestamp, id).run();
    linked += 1;
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


export async function reconcileCatalogReviewOrder(db: D1Database, orderId: number) {
  if (!orderId) return { ok: true, resolvedGroups: 0, linkedItems: 0, reserved: 0 };
  const rowsResult = await fetchCatalogReviewRows(db, 160, orderId);
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

  // Repair rows that already carry an exact SKU one-by-one before grouping any unresolved
  // snapshots. This is intentionally per-row: two blank-gender snapshots may legitimately
  // point to different male/female variants, so a known variant must never be propagated
  // from one order line to another merely because their raw snapshots look the same.
  const remainingRows: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (toInt(row.is_workshop, 0) === 1 || !toInt(row.variant_id, 0)) {
      remainingRows.push(row);
      continue;
    }
    try {
      const selected = await db.prepare(
        `SELECT v.id AS variant_id, v.product_id, p.name AS product_name, COALESCE(v.category, p.category, 'adult') AS category,
                v.gender, v.color, v.material, v.length, v.size_label
         FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
         WHERE v.id = ? AND v.is_active = 1 AND p.is_active = 1 LIMIT 1`
      ).bind(toInt(row.variant_id, 0)).first<CatalogReviewSelectedVariant>();
      if (!selected?.variant_id || !selected.product_id) {
        remainingRows.push(row);
        continue;
      }
      const result = await resolveCatalogReviewRows(db, [row], selected, normalizedCatalogReviewKey(row), new Date().toISOString(), { writeAlias: false });
      resolvedGroups += 1;
      linkedItems += result.linked;
      reserved += result.reserved;
    } catch (error) {
      console.warn('Order-scoped canonical variant repair skipped one row', error);
      remainingRows.push(row);
    }
  }

  const unresolvedGroups = new Map<string, Record<string, unknown>[]>();
  for (const row of remainingRows) {
    const key = normalizedCatalogReviewKey(row);
    const list = unresolvedGroups.get(key) || [];
    list.push(row);
    unresolvedGroups.set(key, list);
  }

  for (const [inputKey, matching] of unresolvedGroups) {
    const sample = matching.find((row) => toInt(row.is_workshop, 0) !== 1) || null;
    if (!sample) continue;
    try {
      const item = catalogReviewRowToOrderItem(sample);
      const resolved = await resolveCatalogProductAndVariantV2(db, item);
      if (resolved.productId) {
        const timestamp = new Date().toISOString();
        for (const row of matching) {
          const rowId = toInt(row.id ?? row.order_item_id, 0);
          if (rowId && !toInt(row.product_id, 0)) {
            await db.prepare(`UPDATE order_items SET product_id = ? WHERE id = ?`).bind(resolved.productId, rowId).run();
            await db.prepare(`UPDATE workshop_tasks SET product_id = ?, updated_at = ? WHERE order_item_id = ?`).bind(resolved.productId, timestamp, rowId).run();
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
    } catch (error) {
      console.warn('Order-scoped catalog auto-reconciliation skipped one ambiguous group', error);
    }
  }
  return { ok: true, resolvedGroups, linkedItems, reserved };
}


export async function resolveOrderCatalogReviewExistingVariant(db: D1Database, orderId: number, orderItemId: number, variantId: number) {
  if (!orderId || !orderItemId || !variantId) throw new Error('Выберите проблемную позицию и существующий вариант каталога.');
  const anchor = await db.prepare(
    `SELECT oi.*, o.external_id, o.shipping_status, o.shipping_date, o.order_status, o.archived_at
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE oi.id = ? AND oi.order_id = ? LIMIT 1`
  ).bind(orderItemId, orderId).first<Record<string, unknown>>();
  if (!anchor?.id) throw new Error('Позиция не найдена в этом заказе.');
  if (normalizeShippingStatus(anchor.shipping_status) === 'sent') throw new Error('Заказ уже отправлен. Складскую привязку здесь менять нельзя.');
  if (normalizeOrderStatus(anchor.order_status) !== 'active' || cleanText(anchor.archived_at)) throw new Error('Этот заказ уже не активен.');

  const selected = await db.prepare(
    `SELECT v.id AS variant_id, v.product_id, p.name AS product_name, COALESCE(v.category, p.category, 'adult') AS category,
            v.gender, v.color, v.material, v.length, v.size_label
     FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
     WHERE v.id = ? AND v.is_active = 1 AND p.is_active = 1 LIMIT 1`
  ).bind(variantId).first<CatalogReviewSelectedVariant>();
  if (!selected?.variant_id || !selected.product_id) throw new Error('Выбранный вариант каталога не найден или отключён.');
  const knownProductId = toInt(anchor.product_id, 0);
  if (knownProductId && knownProductId !== toInt(selected.product_id, 0)) {
    throw new Error('Для этой позиции базовый товар уже известен. Выберите вариант именно этого товара.');
  }

  const inputKey = normalizedCatalogReviewKey(anchor);
  const reusableExactInput = catalogReviewInputCanLearnExact(anchor);
  const rowsResult = reusableExactInput
    ? await fetchCatalogReviewResolutionCandidates(db, orderId)
    : await fetchCatalogReviewRows(db, 160, orderId);
  const matching = reusableExactInput
    ? (rowsResult.results || []).filter((row) => normalizedCatalogReviewKey(row) === inputKey)
    : (rowsResult.results || []).filter((row) => toInt(row.id ?? row.order_item_id, 0) === orderItemId);
  if (!matching.length) throw new Error('Эта позиция уже разобрана. Обновите заказ.');
  // Complete exact raw facts are reusable evidence: remember the full input signature and
  // resolve already-open identical rows now. Incomplete rows stay strictly row-scoped.
  return await resolveCatalogReviewRows(db, matching, selected, inputKey, new Date().toISOString(), { writeAlias: reusableExactInput });
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
