from pathlib import Path
import json
import subprocess


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, got {count}')
    return text.replace(old, new, 1)

# Shared contract: explicit exceptional resolution mode, never a catalog gender value.
contracts_path = Path('shared/api-contracts.ts')
contracts = contracts_path.read_text(encoding='utf-8')
contracts = replace_once(
    contracts,
    "  createFields?: string[]\n}\n\nexport type CatalogResolutionResponse",
    "  createFields?: string[]\n  legacyUnknownGender?: boolean\n}\n\nexport type CatalogResolutionResponse",
    'catalog resolution input legacy flag',
)
contracts = replace_once(
    contracts,
    "  releasedReservations?: number\n}\n\nexport type InventoryReservation",
    "  releasedReservations?: number\n  legacyUnknownGender?: boolean\n}\n\nexport type InventoryReservation",
    'catalog resolution response legacy flag',
)
contracts_path.write_text(contracts, encoding='utf-8')

review_path = Path('worker/domains/catalog-review.ts')
review = review_path.read_text(encoding='utf-8')
review = replace_once(
    review,
    "import { upsertReferenceValue } from './references.ts'\n",
    "import { upsertReferenceValue } from './references.ts'\nimport { writeActivityLog } from './activity.ts'\n",
    'activity import',
)
review = replace_once(
    review,
    "    AND COALESCE(${oi}.stock_writeoff_status, '') NOT IN ('catalog_excluded', 'catalog_excluded_history', 'workshop_no_catalog')",
    "    AND COALESCE(${oi}.stock_writeoff_status, '') NOT IN ('catalog_excluded', 'catalog_excluded_history', 'workshop_no_catalog', 'legacy_unknown_gender')",
    'catalog review exclusion status',
)
review = replace_once(
    review,
    "  createFields?: unknown;\n};",
    "  createFields?: unknown;\n  legacyUnknownGender?: unknown;\n};",
    'review facts legacy flag',
)
review = replace_once(
    review,
    "  const createProduct = Boolean(input.createProduct);\n  let productId = Math.max(0, toInt(input.productId, 0));",
    "  const createProduct = Boolean(input.createProduct);\n  const legacyUnknownGender = Boolean(input.legacyUnknownGender);\n  let productId = Math.max(0, toInt(input.productId, 0));",
    'legacy mode local',
)
review = replace_once(
    review,
    "  // Validate the learned raw spelling before creating any product/reference/execution. An alias\n  // conflict must never leave half-created master data behind.\n  await assertCatalogProductAliasTargetAvailable(db, anchor.product_name_snapshot, product?.id || 0);",
    "  if (legacyUnknownGender && (!product?.id || createProduct)) {\n    throw new Error('Историческое исключение можно применить только к уже существующему базовому товару.');\n  }\n\n  // Validate the learned raw spelling before creating any product/reference/execution. An alias\n  // conflict must never leave half-created master data behind.\n  await assertCatalogProductAliasTargetAvailable(db, anchor.product_name_snapshot, product?.id || 0);",
    'legacy existing-product guard',
)
review = replace_once(
    review,
    "  if (gender !== 'ЖЕН' && gender !== 'МУЖ') throw new Error('Для товара «Унисекс» выберите пол конкретной вещи: ЖЕН или МУЖ.');\n\n  // Read-only preflight first.",
    "  const legacyGenderException = Boolean(legacyUnknownGender && product?.id && requestedGenderScope === 'unisex' && !gender);\n  if (legacyUnknownGender && !legacyGenderException) {\n    throw new Error('«Не удалось выяснить пол» доступно только когда существующий товар действительно требует выбора пола, а данных нет.');\n  }\n  if (!legacyGenderException && gender !== 'ЖЕН' && gender !== 'МУЖ') throw new Error('Для товара «Унисекс» выберите пол конкретной вещи: ЖЕН или МУЖ.');\n\n  // Read-only preflight first.",
    'legacy gender exception validation',
)
legacy_anchor = "  const timestamp = new Date().toISOString();\n  const execution = await ensureCatalogExecutionV3(db, product.id, material, length, timestamp);"
legacy_block = """  const timestamp = new Date().toISOString();

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

  const execution = await ensureCatalogExecutionV3(db, product.id, material, length, timestamp);"""
review = replace_once(review, legacy_anchor, legacy_block, 'legacy resolution branch')
review_path.write_text(review, encoding='utf-8')

reservations_path = Path('worker/domains/order-reservations.ts')
reservations = reservations_path.read_text(encoding='utf-8')
old_excluded = "('fulfilled', 'written_off', 'negative', 'catalog_excluded', 'catalog_excluded_history', 'workshop_no_catalog')"
new_excluded = "('fulfilled', 'written_off', 'negative', 'catalog_excluded', 'catalog_excluded_history', 'workshop_no_catalog', 'legacy_unknown_gender')"
count = reservations.count(old_excluded)
if count != 2:
    raise SystemExit(f'shipment exclusion lists: expected 2 anchors, got {count}')
reservations = reservations.replace(old_excluded, new_excluded)
reservations_path.write_text(reservations, encoding='utf-8')

modal_path = Path('src/features/orders/OrderCatalogResolutionModal.tsx')
modal = modal_path.read_text(encoding='utf-8')
modal = replace_once(
    modal,
    "  const factsBlocked = productMissing || newProductIncomplete || genderMissing || explicitColorMissing || explicitSizeMissing || unconfirmedNewFields.length > 0\n  const pendingLabels = [",
    "  const nonGenderFactsBlocked = productMissing || newProductIncomplete || explicitColorMissing || explicitSizeMissing || unconfirmedNewFields.length > 0\n  const factsBlocked = nonGenderFactsBlocked || genderMissing\n  const canMarkLegacyUnknownGender = Boolean(isAdmin && genderMissing && !draft?.createProduct && draft?.productId && !context?.isWorkshop && !nonGenderFactsBlocked)\n  const pendingLabels = [",
    'legacy eligibility',
)
modal = replace_once(
    modal,
    "  const resolveFacts = async () => {\n    if (!activeItem || !draft || resolving || factsBlocked || !isAdmin) return\n    if (exactDraftVariant?.id) {\n      await resolveSelected(Number(exactDraftVariant.id))\n      return\n    }",
    "  const resolveFacts = async (options: { legacyUnknownGender?: boolean } = {}) => {\n    const legacyUnknownGender = Boolean(options.legacyUnknownGender)\n    if (!activeItem || !draft || resolving || !isAdmin) return\n    if (legacyUnknownGender ? !canMarkLegacyUnknownGender : factsBlocked) return\n    if (!legacyUnknownGender && exactDraftVariant?.id) {\n      await resolveSelected(Number(exactDraftVariant.id))\n      return\n    }",
    'resolve facts legacy option',
)
modal = replace_once(
    modal,
    "        createFields: Object.entries(createFields).filter(([, enabled]) => enabled).map(([field]) => field),\n      }",
    "        createFields: Object.entries(createFields).filter(([, enabled]) => enabled).map(([field]) => field),\n        legacyUnknownGender,\n      }",
    'legacy payload flag',
)
old_gender_choice = """                  {genderMissing ? (
                    <div className="order-catalog-resolution-inline-choice"><span>Пол:</span><button type="button" onClick={() => changeField('gender', 'ЖЕН')}>Женский</button><button type="button" onClick={() => changeField('gender', 'МУЖ')}>Мужской</button></div>
                  ) : null}
"""
new_gender_choice = """                  {genderMissing ? (
                    <div className="order-catalog-resolution-gender-decision">
                      <div className="order-catalog-resolution-inline-choice"><span>Пол:</span><button type="button" onClick={() => changeField('gender', 'ЖЕН')}>Женский</button><button type="button" onClick={() => changeField('gender', 'МУЖ')}>Мужской</button><button type="button" className="is-legacy" disabled={!canMarkLegacyUnknownGender || resolving} onClick={() => void resolveFacts({ legacyUnknownGender: true })}>Не удалось выяснить</button></div>
                      <small>«Не удалось выяснить» не создаёт бесполый SKU. Эта строка станет явным историческим исключением и не будет списана по точному складскому варианту.</small>
                    </div>
                  ) : null}
"""
modal = replace_once(modal, old_gender_choice, new_gender_choice, 'legacy gender action')
modal_path.write_text(modal, encoding='utf-8')

css_path = Path('src/features/orders/OrderCatalogResolutionModal.css')
css = css_path.read_text(encoding='utf-8')
css += """

.order-catalog-resolution-gender-decision {
  display: grid;
  gap: 5px;
}

.order-catalog-resolution-gender-decision small {
  max-width: 560px;
  color: #7a4d00;
  font-size: 11px;
  line-height: 1.35;
}

.order-catalog-resolution-inline-choice button.is-legacy {
  border-color: #d7b36a;
  background: #fff8e8;
  color: #744b00;
}

.order-catalog-resolution-inline-choice button.is-legacy:disabled {
  opacity: .45;
  cursor: not-allowed;
}
"""
css_path.write_text(css, encoding='utf-8')

# Focused regression for the exceptional path.
test_path = Path('scripts/test-contextual-catalog-resolution-r1.mjs')
test = test_path.read_text(encoding='utf-8')
test = replace_once(
    test,
    "  const utils = read('src/app/utils.ts')\n",
    "  const utils = read('src/app/utils.ts')\n  const contracts = read('shared/api-contracts.ts')\n",
    'load contracts in regression',
)
test = replace_once(
    test,
    "  check(modal.includes('Без уточнения отправить заказ нельзя'), 'Resolver must keep the no-bypass safety rule in human language')\n",
    "  check(modal.includes('Без уточнения отправить заказ нельзя'), 'Resolver must keep the no-bypass safety rule in human language')\n  check(contracts.includes('legacyUnknownGender?: boolean'), 'API contract must model the explicit legacy unknown-gender action')\n  check(modal.includes('Не удалось выяснить') && modal.includes('legacyUnknownGender: true'), 'Resolver must offer an explicit unknown-gender historical exception without inventing a gender')\n  check(review.includes(\"stock_writeoff_status = 'legacy_unknown_gender'\"), 'Backend must persist a dedicated legacy unknown-gender status instead of a genderless SKU')\n  check(review.includes('if (legacyGenderException)') && review.indexOf('if (legacyGenderException)') < review.indexOf('const execution = await ensureCatalogExecutionV3'), 'Legacy unknown gender must exit before execution/SKU creation')\n  check(reservations.includes(\"'legacy_unknown_gender'\"), 'Shipment blocker must intentionally recognize the explicit historical exception')\n",
    'legacy regression assertions',
)
test = test.replace('CONTEXTUAL CATALOG RESOLUTION R4 PASSED', 'CONTEXTUAL CATALOG RESOLUTION R5 PASSED')
test = test.replace('CONTEXTUAL CATALOG RESOLUTION R4 FAILED', 'CONTEXTUAL CATALOG RESOLUTION R5 FAILED')
test_path.write_text(test, encoding='utf-8')

# Refresh exact frontend manifest for the two resolver files.
manifest_path = Path('scripts/contextual-catalog-resolution-r1-frontend-manifest.json')
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
for path in ['src/features/orders/OrderCatalogResolutionModal.tsx', 'src/features/orders/OrderCatalogResolutionModal.css']:
    text = Path(path).read_text(encoding='utf-8')
    manifest['files'][path]['afterGitBlob'] = subprocess.check_output(['git', 'hash-object', path], text=True).strip()
    manifest['files'][path]['afterLines'] = len(text.replace('\r\n', '\n').split('\n'))
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('legacy unknown gender resolver patch applied')
