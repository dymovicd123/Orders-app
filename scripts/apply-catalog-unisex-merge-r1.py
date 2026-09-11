from pathlib import Path

p = Path('worker/domains/catalog.ts')
s = p.read_text()

old = """       AND COALESCE(category, 'adult') = ?
       AND COALESCE(gender, '') = ?
       AND COALESCE(color, '') = ?
       AND COALESCE(size_label, '') = ?
"""
new = """       AND COALESCE(category, 'adult') = ?
       AND CASE
         WHEN UPPER(TRIM(COALESCE(gender, ''))) LIKE '%ЖЕН%' THEN 'ЖЕН'
         WHEN UPPER(TRIM(COALESCE(gender, ''))) LIKE '%МУЖ%' THEN 'МУЖ'
         ELSE UPPER(TRIM(COALESCE(gender, '')))
       END = ?
       AND CASE
         WHEN TRIM(COALESCE(color, '')) = '' THEN 'БЕЗ ЦВЕТА'
         ELSE UPPER(TRIM(color))
       END = ?
       AND CASE
         WHEN UPPER(TRIM(COALESCE(size_label, ''))) IN ('', 'БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р') THEN ''
         ELSE UPPER(TRIM(size_label))
       END = ?
"""
assert s.count(old) == 1, f'duplicate resolver anchor count={s.count(old)}'
s = s.replace(old, new)

old = """    if (identityChanged && await catalogVariantHasOperationalUsage(db, id)) {
      const productScope = genderOnlyIdentityChange && existingGender === '' && (gender === 'ЖЕН' || gender === 'МУЖ')
        ? await getCatalogProductGenderScope(db, productId)
        : null;
      const safeLegacyUnisexGenderCorrection = productScope === 'unisex'
        && isActive === 1
        && !deactivating
        && !duplicate?.id;
      if (safeLegacyUnisexGenderCorrection) {
        await db.batch([
          db.prepare('UPDATE catalog_variants SET gender = ?, updated_at = ? WHERE id = ?').bind(gender, timestamp, id),
          db.prepare('UPDATE inventory_stock SET gender_snapshot = ?, updated_at = ? WHERE variant_id = ?').bind(gender, timestamp, id),
          db.prepare(`INSERT OR REPLACE INTO catalog_gender_variant_repairs
             (old_variant_id, keeper_variant_id, product_id, target_gender, repair_mode, repaired_at)
             VALUES (?, ?, ?, ?, 'in_place', ?)`).bind(id, id, productId, gender, timestamp),
        ]);
        return { ok: true, correctedGender: true, merged: false };
      }
      if (productScope === 'unisex' && duplicate?.id) {
        throw new Error('Для выбранного пола уже существует такая же комбинация. Её нужно безопасно объединить с текущей позицией; обычное редактирование не должно терять остаток или историю.');
      }
      throw new Error('Эта комбинация уже использовалась в заказах или движениях склада. Нельзя переписать её историю. Создайте правильную комбинацию отдельно; старую затем можно отключить.');
    }
"""
new = """    const hasOperationalUsage = identityChanged ? await catalogVariantHasOperationalUsage(db, id) : false;
    const productScope = genderOnlyIdentityChange && existingGender === '' && (gender === 'ЖЕН' || gender === 'МУЖ')
      ? await getCatalogProductGenderScope(db, productId)
      : null;

    if (productScope === 'unisex' && duplicate?.id) {
      const previousMerge = await db.prepare(
        `SELECT keeper_variant_id, target_gender, repair_mode
         FROM catalog_gender_variant_repairs
         WHERE old_variant_id = ? LIMIT 1`
      ).bind(id).first<Record<string, unknown>>();
      if (cleanText(previousMerge?.repair_mode) === 'merge') {
        if (toInt(previousMerge?.keeper_variant_id, 0) === toInt(duplicate.id, 0)
          && normalizeCatalogCombinationGender(previousMerge?.target_gender) === gender) {
          return { ok: true, correctedGender: true, merged: true, keeperVariantId: toInt(duplicate.id, 0), replayed: true };
        }
        throw new Error('Эта старая позиция уже была объединена с другой канонической комбинацией. Обновите каталог перед новым исправлением.');
      }

      const sourceIsActive = toInt(existing.is_active, 1) === 1;
      if (!sourceIsActive || isActive !== 1 || deactivating) {
        throw new Error('Эта старая позиция уже не активна. Обновите каталог и повторите исправление на актуальной карточке.');
      }

      const blockers = await db.prepare(
        `SELECT
           EXISTS(
             SELECT 1
             FROM inventory_stocktake_items i
             JOIN inventory_stocktake_sessions s ON s.id = i.session_id
             WHERE i.variant_id IN (?, ?) AND s.status = 'active'
             LIMIT 1
           ) AS active_stocktake,
           EXISTS(
             SELECT 1
             FROM inventory_transfer_items source_item
             JOIN inventory_transfer_items target_item
               ON target_item.transfer_id = source_item.transfer_id
              AND target_item.variant_id = ?
             JOIN inventory_transfer_documents d ON d.id = source_item.transfer_id
             WHERE source_item.variant_id = ? AND d.status = 'applied'
             LIMIT 1
           ) AS applied_transfer_collision`
      ).bind(id, duplicate.id, duplicate.id, id).first<Record<string, unknown>>();
      if (toInt(blockers?.active_stocktake, 0)) {
        throw new Error('Нельзя объединить позиции во время активной ревизии. Завершите или отмените ревизию и повторите исправление.');
      }
      if (toInt(blockers?.applied_transfer_collision, 0)) {
        throw new Error('Эти две позиции встречаются в одном действующем документе перемещения. Сначала завершите разбор перемещения, затем повторите объединение.');
      }

      const stockResult = await db.prepare(
        `SELECT id, inventory_source, variant_id
         FROM inventory_stock
         WHERE variant_id IN (?, ?)
         ORDER BY inventory_source ASC, id ASC`
      ).bind(id, duplicate.id).all<Record<string, unknown>>();
      const stockRows = stockResult.results || [];
      const targetStockBySource = new Map<string, number>();
      for (const row of stockRows) {
        if (toInt(row.variant_id, 0) === toInt(duplicate.id, 0)) {
          targetStockBySource.set(cleanText(row.inventory_source), toInt(row.id, 0));
        }
      }

      const mergeStatements = [
        db.prepare('UPDATE order_items SET variant_id = ? WHERE variant_id = ?').bind(duplicate.id, id),
        db.prepare('UPDATE inventory_movements SET variant_id = ? WHERE variant_id = ?').bind(duplicate.id, id),
        db.prepare('UPDATE workshop_tasks SET variant_id = ? WHERE variant_id = ?').bind(duplicate.id, id),
        db.prepare('UPDATE inventory_reservations SET variant_id = ? WHERE variant_id = ?').bind(duplicate.id, id),
        db.prepare('UPDATE catalog_input_aliases SET variant_id = ? WHERE variant_id = ?').bind(duplicate.id, id),
        db.prepare('UPDATE inventory_lifecycle_events SET variant_id = ? WHERE variant_id = ?').bind(duplicate.id, id),
        db.prepare('UPDATE inventory_stock_checks SET variant_id = ? WHERE variant_id = ?').bind(duplicate.id, id),
        db.prepare(
          `UPDATE inventory_transfer_items
           SET variant_id = ?
           WHERE variant_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM inventory_transfer_items sibling
               WHERE sibling.transfer_id = inventory_transfer_items.transfer_id
                 AND sibling.variant_id = ?
                 AND sibling.id <> inventory_transfer_items.id
             )`
        ).bind(duplicate.id, id, duplicate.id),
        db.prepare(
          `UPDATE inventory_stocktake_items
           SET variant_id = ?
           WHERE variant_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM inventory_stocktake_items sibling
               WHERE sibling.session_id = inventory_stocktake_items.session_id
                 AND sibling.variant_id = ?
                 AND sibling.id <> inventory_stocktake_items.id
             )`
        ).bind(duplicate.id, id, duplicate.id),
      ];

      for (const sourceStock of stockRows) {
        if (toInt(sourceStock.variant_id, 0) !== id) continue;
        const sourceStockId = toInt(sourceStock.id, 0);
        const source = cleanText(sourceStock.inventory_source);
        const targetStockId = targetStockBySource.get(source) || 0;
        if (targetStockId) {
          mergeStatements.push(
            db.prepare(
              `UPDATE inventory_stock
               SET quantity = COALESCE(quantity, 0) + COALESCE((SELECT quantity FROM inventory_stock WHERE id = ? AND variant_id = ?), 0),
                   reserved_quantity = COALESCE(reserved_quantity, 0) + COALESCE((SELECT reserved_quantity FROM inventory_stock WHERE id = ? AND variant_id = ?), 0),
                   updated_at = ?
               WHERE id = ? AND variant_id = ?`
            ).bind(sourceStockId, id, sourceStockId, id, timestamp, targetStockId, duplicate.id),
            db.prepare(
              `UPDATE inventory_stock
               SET quantity = 0,
                   reserved_quantity = 0,
                   last_action = 'Объединение позиции каталога',
                   last_source_ref = ?,
                   updated_at = ?
               WHERE id = ? AND variant_id = ?`
            ).bind(`catalog-merge:${id}->${duplicate.id}`, timestamp, sourceStockId, id),
          );
        } else {
          mergeStatements.push(
            db.prepare(
              `UPDATE inventory_stock
               SET variant_id = ?, product_id = ?, updated_at = ?
               WHERE id = ? AND variant_id = ?`
            ).bind(duplicate.id, productId, timestamp, sourceStockId, id),
          );
        }
      }

      mergeStatements.push(
        db.prepare(
          `UPDATE inventory_stock
           SET product_id = ?,
               product_name_snapshot = (SELECT p.name FROM catalog_products p WHERE p.id = ?),
               gender_snapshot = (SELECT NULLIF(v.gender, '') FROM catalog_variants v WHERE v.id = ?),
               color_snapshot = (SELECT NULLIF(v.color, '') FROM catalog_variants v WHERE v.id = ?),
               material_snapshot = (SELECT NULLIF(v.material, '') FROM catalog_variants v WHERE v.id = ?),
               length_snapshot = (SELECT NULLIF(v.length, '') FROM catalog_variants v WHERE v.id = ?),
               size_snapshot = (SELECT NULLIF(v.size_label, '') FROM catalog_variants v WHERE v.id = ?),
               external_product_id = (SELECT p.external_id FROM catalog_products p WHERE p.id = ?),
               external_variant_id = (SELECT v.external_id FROM catalog_variants v WHERE v.id = ?),
               reserved_quantity = COALESCE((
                 SELECT SUM(r.quantity)
                 FROM inventory_reservations r
                 WHERE r.variant_id = ?
                   AND r.inventory_source = inventory_stock.inventory_source
                   AND r.status = 'active'
               ), 0),
               updated_at = ?
           WHERE variant_id = ?`
        ).bind(productId, productId, duplicate.id, duplicate.id, duplicate.id, duplicate.id, duplicate.id, productId, duplicate.id, duplicate.id, timestamp, duplicate.id),
        db.prepare('UPDATE catalog_variants SET is_active = 0, updated_at = ? WHERE id = ? AND is_active = 1').bind(timestamp, id),
        db.prepare(
          `INSERT OR REPLACE INTO catalog_gender_variant_repairs
           (old_variant_id, keeper_variant_id, product_id, target_gender, repair_mode, repaired_at)
           VALUES (?, ?, ?, ?, 'merge', ?)`
        ).bind(id, duplicate.id, productId, gender, timestamp),
      );
      await db.batch(mergeStatements);
      return { ok: true, correctedGender: true, merged: true, keeperVariantId: toInt(duplicate.id, 0) };
    }

    if (identityChanged && hasOperationalUsage) {
      const safeLegacyUnisexGenderCorrection = productScope === 'unisex'
        && isActive === 1
        && !deactivating
        && !duplicate?.id;
      if (safeLegacyUnisexGenderCorrection) {
        await db.batch([
          db.prepare('UPDATE catalog_variants SET gender = ?, updated_at = ? WHERE id = ?').bind(gender, timestamp, id),
          db.prepare('UPDATE inventory_stock SET gender_snapshot = ?, updated_at = ? WHERE variant_id = ?').bind(gender, timestamp, id),
          db.prepare(`INSERT OR REPLACE INTO catalog_gender_variant_repairs
             (old_variant_id, keeper_variant_id, product_id, target_gender, repair_mode, repaired_at)
             VALUES (?, ?, ?, ?, 'in_place', ?)`).bind(id, id, productId, gender, timestamp),
        ]);
        return { ok: true, correctedGender: true, merged: false };
      }
      throw new Error('Эта комбинация уже использовалась в заказах или движениях склада. Нельзя переписать её историю. Создайте правильную комбинацию отдельно; старую затем можно отключить.');
    }
"""
assert s.count(old) == 1, f'merge branch anchor count={s.count(old)}'
s = s.replace(old, new)
p.write_text(s)

p = Path('src/features/inventory/views/renderInventoryCatalogPanel.tsx')
s = p.read_text()
old = 'Старой унисекс-позиции без пола можно выбрать ЖЕН или МУЖ даже при наличии истории: если такой же конкретной комбинации ещё нет, система сохранит тот же SKU и текущий остаток. Для остальных полей действует прежняя защита: если комбинация уже использовалась, сервер не позволит её переписать.'
new = 'Старой унисекс-позиции без пола можно выбрать ЖЕН или МУЖ даже при наличии истории. Если такой комбинации ещё нет, система сохранит тот же SKU; если ЖЕН/МУЖ-дубль уже есть, система безопасно объединит позиции, не теряя текущий остаток и исторические подписи. Для остальных полей действует прежняя защита: использованную идентичность сервер не перепишет.'
assert s.count(old) == 1, f'UI copy anchor count={s.count(old)}'
p.write_text(s.replace(old, new))

print('UNISEX_MERGE_PATCH_APPLIED')
