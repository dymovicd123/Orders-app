from pathlib import Path

activity_path = Path('worker/domains/activity.ts')
domain_path = Path('worker/domains/returns-exchanges.ts')
activity = activity_path.read_text()
domain = domain_path.read_text()

def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 anchor, found {count}')
    return text.replace(old, new, 1)

activity = replace_once(
    activity,
    """            ri.restocked AS return_item_restocked, lifecycle.status AS return_item_lifecycle_status,
            lifecycle.pending_reason AS return_item_pending_reason
""",
    """            ri.restocked AS return_item_restocked,
            ri.physical_tracking AS return_item_physical_tracking,
            ri.physical_received_at AS return_item_physical_received_at,
            lifecycle.status AS return_item_lifecycle_status,
            lifecycle.pending_reason AS return_item_pending_reason
""",
    'return history select physical fields',
)

activity = replace_once(
    activity,
    """      inventorySource: cleanText(row.return_item_inventory_source) || null, restocked: Boolean(toInt(row.return_item_restocked, 0)),
      lifecycleStatus: cleanText(row.return_item_lifecycle_status) || null, pendingReason: cleanText(row.return_item_pending_reason) || null,
""",
    """      inventorySource: cleanText(row.return_item_inventory_source) || null, restocked: Boolean(toInt(row.return_item_restocked, 0)),
      physicalTracking: Boolean(toInt(row.return_item_physical_tracking, 0)),
      physicalReceivedAt: cleanText(row.return_item_physical_received_at) || null,
      lifecycleStatus: cleanText(row.return_item_lifecycle_status) || null, pendingReason: cleanText(row.return_item_pending_reason) || null,
""",
    'return history map physical fields',
)

domain = replace_once(
    domain,
    """       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.inventory_source ELSE e.old_return_source END AS old_inventory_source,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.product_name_snapshot ELSE new_item.product_name_snapshot END AS new_product_name,
""",
    """       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.inventory_source ELSE e.old_return_source END AS old_inventory_source,
       old_snapshot.physical_tracking AS old_physical_tracking,
       old_snapshot.physical_received_at AS old_physical_received_at,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.product_name_snapshot ELSE new_item.product_name_snapshot END AS new_product_name,
""",
    'exchange history select physical fields',
)

domain = replace_once(
    domain,
    """      oldGender: row.old_gender_snapshot || '', oldColor: row.old_color_snapshot || '', oldMaterial: row.old_material_snapshot || '', oldLength: row.old_length_snapshot || '', oldSize: row.old_size_snapshot || '', oldReturnSource: row.old_inventory_source || row.old_return_source || 'none',
      newItemId: row.new_order_item_id, newProductName: row.new_product_name || '—', newQuantity: row.new_item_quantity || 0,
""",
    """      oldGender: row.old_gender_snapshot || '', oldColor: row.old_color_snapshot || '', oldMaterial: row.old_material_snapshot || '', oldLength: row.old_length_snapshot || '', oldSize: row.old_size_snapshot || '', oldReturnSource: row.old_inventory_source || row.old_return_source || 'none',
      oldPhysicalTracking: Boolean(toInt(row.old_physical_tracking, 0)), oldPhysicalReceivedAt: cleanText(row.old_physical_received_at) || null,
      newItemId: row.new_order_item_id, newProductName: row.new_product_name || '—', newQuantity: row.new_item_quantity || 0,
""",
    'exchange history map physical fields',
)

activity_path.write_text(activity)
domain_path.write_text(domain)
print('return/exchange history physical truth patched')
