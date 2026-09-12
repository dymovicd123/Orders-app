from pathlib import Path

path = Path('worker/domains/returns-exchanges.ts')
text = path.read_text()

def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 anchor, found {count}')
    text = text.replace(old, new, 1)

replace_once(
"""    items?: Array<{ orderItemId?: number; quantity?: number; amount?: number; restock?: boolean }>;
""",
"""    items?: Array<{ orderItemId?: number; quantity?: number; amount?: number; restock?: boolean; physicalState?: 'pending' | 'warehouse' | 'boutique' | 'no_stock' }>;
""",
'return input contract')

replace_once(
"""  const selectedItemMap = new Map<number, { orderItemId: number; quantity: number; amount: number; restock: boolean | null }>();
""",
"""  const selectedItemMap = new Map<number, { orderItemId: number; quantity: number; amount: number; restock: boolean | null; physicalState: 'pending' | 'warehouse' | 'boutique' | 'no_stock' | null }>();
""",
'return selected map')

replace_once(
"""    const explicitRestock = typeof rawItem?.restock === 'boolean' ? rawItem.restock : null;
    const current = selectedItemMap.get(orderItemId);
    if (current && current.restock !== null && explicitRestock !== null && current.restock !== explicitRestock) {
      throw new Error(`Для позиции #${orderItemId} переданы противоречивые решения по возврату в остаток.`);
    }
    selectedItemMap.set(orderItemId, {
      orderItemId,
      quantity: (current?.quantity || 0) + quantity,
      amount: (current?.amount || 0) + Math.max(0, toInt(rawItem?.amount, 0)),
      restock: explicitRestock ?? current?.restock ?? null,
    });
""",
"""    const explicitRestock = typeof rawItem?.restock === 'boolean' ? rawItem.restock : null;
    const rawPhysicalState = cleanText(rawItem?.physicalState);
    const physicalState = ['pending', 'warehouse', 'boutique', 'no_stock'].includes(rawPhysicalState)
      ? rawPhysicalState as 'pending' | 'warehouse' | 'boutique' | 'no_stock'
      : null;
    if (rawPhysicalState && !physicalState) throw new Error(`Неизвестный физический статус возврата для позиции #${orderItemId}.`);
    const current = selectedItemMap.get(orderItemId);
    if (current && current.restock !== null && explicitRestock !== null && current.restock !== explicitRestock) {
      throw new Error(`Для позиции #${orderItemId} переданы противоречивые решения по возврату в остаток.`);
    }
    if (current?.physicalState && physicalState && current.physicalState !== physicalState) {
      throw new Error(`Для позиции #${orderItemId} переданы противоречивые физические статусы.`);
    }
    selectedItemMap.set(orderItemId, {
      orderItemId,
      quantity: (current?.quantity || 0) + quantity,
      amount: (current?.amount || 0) + Math.max(0, toInt(rawItem?.amount, 0)),
      restock: explicitRestock ?? current?.restock ?? null,
      physicalState: physicalState ?? current?.physicalState ?? null,
    });
""",
'return physical state parse')

replace_once(
"""    selected: { orderItemId: number; quantity: number; amount: number; restock: boolean | null };
    orderItem: Record<string, unknown>;
    quantity: number;
    isWorkshop: boolean;
    wantsRestock: boolean;
""",
"""    selected: { orderItemId: number; quantity: number; amount: number; restock: boolean | null; physicalState: 'pending' | 'warehouse' | 'boutique' | 'no_stock' | null };
    orderItem: Record<string, unknown>;
    quantity: number;
    isWorkshop: boolean;
    physicalTracking: boolean;
    physicalState: 'pending' | 'warehouse' | 'boutique' | 'no_stock' | null;
    inventorySource: 'warehouse' | 'boutique' | null;
    wantsRestock: boolean;
""",
'return validated type')

replace_once(
"""    const isWorkshop = Boolean(toInt(orderItem.is_workshop, 0));
    // Workshop production normally goes straight to the client. A returned Workshop item
    // therefore enters inventory only after an explicit per-line decision. Legacy clients
    // that omit the flag keep the old default for ordinary Warehouse/Boutique lines, but
    // omission is deliberately no-stock for Workshop lines.
    const itemRestockRequested = isWorkshop ? selected.restock === true : selected.restock !== false;
    if (isWorkshop && itemRestockRequested && restockSource === 'boutique') {
      throw new Error(`Товар из Цеха «${cleanText(orderItem.product_name_snapshot)}» нельзя возвращать в остаток Бутика. Выберите «Не возвращать в остатки» или «Склад».`);
    }
    const wantsRestock = restockSource !== 'none' && itemRestockRequested;
""",
"""    const isWorkshop = Boolean(toInt(orderItem.is_workshop, 0));
    const physicalState = selected.physicalState;
    const physicalTracking = physicalState !== null;
    const trackedInventorySource = physicalState === 'warehouse' || physicalState === 'boutique' ? physicalState : null;
    // Legacy payloads keep the old restock semantics. New UI payloads are explicit:
    // pending = not physically received yet; no_stock = received but intentionally not stocked.
    const itemRestockRequested = isWorkshop ? selected.restock === true : selected.restock !== false;
    const inventorySource = physicalTracking ? trackedInventorySource : (restockSource !== 'none' && itemRestockRequested ? restockSource : null);
    if (isWorkshop && inventorySource === 'boutique') {
      throw new Error(`Товар из Цеха «${cleanText(orderItem.product_name_snapshot)}» нельзя возвращать в остаток Бутика. Выберите «Ещё не пришёл», «Получен без остатка» или «Склад».`);
    }
    const wantsRestock = inventorySource !== null;
""",
'return destination semantics')

replace_once(
"""    validatedSelectedItems.push({
      selected,
      orderItem,
      quantity: selected.quantity,
      isWorkshop,
      wantsRestock,
    });
""",
"""    validatedSelectedItems.push({
      selected,
      orderItem,
      quantity: selected.quantity,
      isWorkshop,
      physicalTracking,
      physicalState,
      inventorySource,
      wantsRestock,
    });
""",
'return validated push')

replace_once(
"""    const { selected, orderItem, quantity, wantsRestock, isWorkshop } = validated;
""",
"""    const { selected, orderItem, quantity, wantsRestock, isWorkshop, physicalTracking, physicalState, inventorySource } = validated;
""",
'return loop destructure')

replace_once(
"""        `INSERT INTO return_items (
          return_id, order_item_id, product_name_snapshot, quantity, amount, inventory_source, restocked,
          gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
      ).bind(
        returnId, selected.orderItemId, cleanText(orderItem.product_name_snapshot), quantity, selected.amount,
        wantsRestock ? restockSource : null, cleanText(orderItem.gender_snapshot) || null,
        cleanText(orderItem.color_snapshot) || null, cleanText(orderItem.material_snapshot) || null,
        cleanText(orderItem.length_snapshot) || null, cleanText(orderItem.size_snapshot) || null, createdAt,
      ),
""",
"""        `INSERT INTO return_items (
          return_id, order_item_id, product_name_snapshot, quantity, amount, inventory_source, restocked,
          physical_tracking, physical_received_at,
          gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        returnId, selected.orderItemId, cleanText(orderItem.product_name_snapshot), quantity, selected.amount,
        inventorySource, physicalTracking ? 1 : 0, physicalTracking && physicalState !== 'pending' ? createdAt : null,
        cleanText(orderItem.gender_snapshot) || null, cleanText(orderItem.color_snapshot) || null,
        cleanText(orderItem.material_snapshot) || null, cleanText(orderItem.length_snapshot) || null,
        cleanText(orderItem.size_snapshot) || null, createdAt,
      ),
""",
'return insert physical fields')

replace_once(
"""        inventorySource: restockSource as 'warehouse' | 'boutique',
""",
"""        inventorySource: inventorySource as 'warehouse' | 'boutique',
""",
'return lifecycle destination')

replace_once(
"""          source: restockSource,
""",
"""          source: inventorySource,
""",
'return pending inventory source')

replace_once(
"""    oldReturnSource?: unknown;
""",
"""    oldReturnSource?: unknown;
    oldPhysicalState?: 'pending' | 'warehouse' | 'boutique' | 'no_stock';
""",
'exchange input contract')

replace_once(
"""  const oldReturnSource = normalizeExchangeReturnSource(input.oldReturnSource);
  if (oldItemIsWorkshop && oldReturnSource === 'boutique') {
    throw new Error(`Старую вещь из Цеха «${cleanText(oldItem.product_name_snapshot)}» нельзя принимать в остаток Бутика. Для цеховой вещи доступны только «Не возвращать в остатки» или явный приём на Склад.`);
  }
""",
"""  const rawOldPhysicalState = cleanText(input.oldPhysicalState);
  const oldPhysicalState = ['pending', 'warehouse', 'boutique', 'no_stock'].includes(rawOldPhysicalState)
    ? rawOldPhysicalState as 'pending' | 'warehouse' | 'boutique' | 'no_stock'
    : null;
  if (rawOldPhysicalState && !oldPhysicalState) throw new Error('Неизвестный физический статус старой вещи обмена.');
  const oldPhysicalTracking = oldPhysicalState !== null;
  const trackedOldReturnSource = oldPhysicalState === 'warehouse' || oldPhysicalState === 'boutique' ? oldPhysicalState : 'none';
  const oldReturnSource = oldPhysicalTracking ? trackedOldReturnSource : normalizeExchangeReturnSource(input.oldReturnSource);
  if (oldItemIsWorkshop && oldReturnSource === 'boutique') {
    throw new Error(`Старую вещь из Цеха «${cleanText(oldItem.product_name_snapshot)}» нельзя принимать в остаток Бутика. Для цеховой вещи доступны только «Ещё не пришла», «Получена без остатка» или явный приём на Склад.`);
  }
""",
'exchange physical state semantics')

replace_once(
"""      `INSERT INTO exchange_items (
        exchange_id, role, order_item_id, product_name_snapshot, gender_snapshot, color_snapshot,
        material_snapshot, length_snapshot, size_snapshot, quantity, inventory_source, created_at
      ) VALUES (?, 'old', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      exchangeId, oldItemId, cleanText(oldItem.product_name_snapshot), cleanText(oldItem.gender_snapshot) || null,
      cleanText(oldItem.color_snapshot) || null, cleanText(oldItem.material_snapshot) || null,
      cleanText(oldItem.length_snapshot) || null, cleanText(oldItem.size_snapshot) || null, oldQuantity,
      oldReturnSource === 'none' ? null : oldReturnSource, timestamp,
    ),
""",
"""      `INSERT INTO exchange_items (
        exchange_id, role, order_item_id, product_name_snapshot, gender_snapshot, color_snapshot,
        material_snapshot, length_snapshot, size_snapshot, quantity, inventory_source,
        physical_tracking, physical_received_at, created_at
      ) VALUES (?, 'old', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      exchangeId, oldItemId, cleanText(oldItem.product_name_snapshot), cleanText(oldItem.gender_snapshot) || null,
      cleanText(oldItem.color_snapshot) || null, cleanText(oldItem.material_snapshot) || null,
      cleanText(oldItem.length_snapshot) || null, cleanText(oldItem.size_snapshot) || null, oldQuantity,
      oldReturnSource === 'none' ? null : oldReturnSource,
      oldPhysicalTracking ? 1 : 0, oldPhysicalTracking && oldPhysicalState !== 'pending' ? timestamp : null, timestamp,
    ),
""",
'exchange old item physical fields')

path.write_text(text)
print('returns-exchanges physical receipt creation semantics patched')
