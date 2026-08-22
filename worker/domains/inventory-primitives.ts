// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { cleanText, normalizeSourceType, toInt } from '../core/text.ts'
import type { SourceType } from '../core/types.ts'

export type InventoryPhysicalCheckInput = {
  checkKey?: string | null;
  source: SourceType;
  productId: number;
  variantId: number;
  expectedQuantity: number;
  countedQuantity: number;
  reservedQuantity: number;
  checkType: string;
  referenceType?: string | null;
  referenceId?: string | null;
  checkedBy?: string | null;
  checkedAt: string;
};


export function inventoryPhysicalCheckStatement(db: D1Database, input: InventoryPhysicalCheckInput) {
  return db.prepare(
    `INSERT OR IGNORE INTO inventory_stock_checks (
       check_key, inventory_source, product_id, variant_id,
       expected_quantity, counted_quantity, difference_quantity, reserved_quantity,
       check_type, reference_type, reference_id, checked_by, checked_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    cleanText(input.checkKey) || null,
    normalizeSourceType(input.source),
    Math.max(0, toInt(input.productId, 0)) || null,
    Math.max(0, toInt(input.variantId, 0)),
    toInt(input.expectedQuantity, 0),
    Math.max(0, toInt(input.countedQuantity, 0)),
    Math.max(0, toInt(input.countedQuantity, 0)) - toInt(input.expectedQuantity, 0),
    Math.max(0, toInt(input.reservedQuantity, 0)),
    cleanText(input.checkType) || 'quick_stocktake',
    cleanText(input.referenceType) || null,
    cleanText(input.referenceId) || null,
    cleanText(input.checkedBy) || null,
    input.checkedAt,
    input.checkedAt,
  );
}
