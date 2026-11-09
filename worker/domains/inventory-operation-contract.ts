// Warehouse arrival/transfer request identity and exact SKU input guards.
// Pure validation/normalization; inventory CAS, movement writes and stocktake gates stay in inventory-movement.ts.
import { canonicalStockPositionValue, cleanText, normalizeAudienceCategory, normalizeSourceType, toInt } from '../core/text.ts'
import type { InventoryItemInput, InventoryMovementKind, SourceType } from '../core/types.ts'
import type { CanonicalVariantSnapshot } from './catalog.ts'
import { catalogColorIdentity, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize, normalizeCatalogProductIdentityKey } from './catalog.ts'
import type { InventoryResolvedItem } from './order-core.ts'
import { normalizeInventoryItem } from './order-core.ts'

export function inventoryManualRequestFingerprint(
  inventorySource: SourceType,
  movementType: InventoryMovementKind,
  comment: string,
  items: ReturnType<typeof normalizeInventoryItem>[],
) {
  const rows = items.map((item) => ({
    productId: item.productId || 0,
    variantId: item.variantId || 0,
    productName: item.productName,
    category: item.category,
    gender: item.gender,
    color: item.color,
    material: item.material,
    length: item.length,
    size: item.size,
    quantity: item.quantity,
    expectedQuantity: item.expectedQuantity,
    observedPhysicalQuantity: item.observedPhysicalQuantity,
    ...((item as typeof item & {createMissingVariant?:boolean}).createMissingVariant ? {createMissingVariant:true} : {}),
  })).sort((a, b) => (
    a.variantId - b.variantId
    || a.productId - b.productId
    || a.productName.localeCompare(b.productName)
    || JSON.stringify(a).localeCompare(JSON.stringify(b))
  ));
  return JSON.stringify({ inventorySource, movementType, comment, items: rows });
}

export type InventoryOperationStockConfirmation = {
  source: SourceType;
  variantId: number;
  expectedQuantity: number;
  operationQuantity: number;
};

export function normalizeInventoryOperationStockConfirmations(input: unknown): InventoryOperationStockConfirmation[] {
  if (!Array.isArray(input)) return [];
  const map = new Map<string, InventoryOperationStockConfirmation>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const source = normalizeSourceType(row.source);
    const variantId = Math.max(0, toInt(row.variantId, 0));
    const expectedQuantity = Math.max(0, toInt(row.expectedQuantity, -1));
    const operationQuantity = Math.max(0, toInt(row.operationQuantity, 0));
    if (!variantId || expectedQuantity < 0 || operationQuantity <= 0) {
      throw new Error('Некорректное подтверждение физического наличия. Обновите остатки и повторите операцию.');
    }
    const key = `${source}:${variantId}`;
    const next = { source, variantId, expectedQuantity, operationQuantity };
    const existing = map.get(key);
    if (existing && (existing.expectedQuantity !== expectedQuantity || existing.operationQuantity !== operationQuantity)) {
      throw new Error('Для одной позиции переданы разные подтверждения физического наличия. Обновите остатки и повторите операцию.');
    }
    map.set(key, next);
  }
  return Array.from(map.values());
}

// The selected catalog variant must describe the garment physically received.
// Prevent stale Arrival forms from adding an item to another size/color/gender SKU.
export function arrivalFactsMatchCanonicalSku(
  raw: ReturnType<typeof normalizeInventoryItem>,
  canonical: InventoryResolvedItem,
) {
  return raw.category === canonical.category
    && normalizeCatalogCombinationGender(raw.gender) === normalizeCatalogCombinationGender(canonical.gender)
    && catalogColorIdentity(raw.color) === catalogColorIdentity(canonical.color)
    && canonicalStockPositionValue(raw.material) === canonicalStockPositionValue(canonical.material)
    && canonicalStockPositionValue(raw.length) === canonicalStockPositionValue(canonical.length)
    && normalizeCatalogCombinationSize(raw.size) === normalizeCatalogCombinationSize(canonical.size);
}

export function inventoryTransferExternalId() {
  const compact = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `TR-${compact}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}


export function inventoryTransferRequestFingerprint(
  fromSource: SourceType,
  toSource: SourceType,
  comment: string,
  rawItems: InventoryItemInput[],
) {
  const normalizeOptional = (value: unknown): number | string | null => {
    if (value === null || value === undefined || cleanText(value) === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && Number.isInteger(numeric) ? numeric : cleanText(value);
  };
  const items = rawItems
    .map((raw) => ({
      variantId: Math.max(0, toInt(raw?.variantId, 0)),
      quantity: Math.max(0, toInt(raw?.quantity, 0)),
      expectedQuantity: normalizeOptional(raw?.expectedQuantity),
      observedPhysicalQuantity: normalizeOptional(raw?.observedPhysicalQuantity),
    }))
    .filter((row) => row.quantity > 0)
    .sort((left, right) => (
      left.variantId - right.variantId
      || left.quantity - right.quantity
      || JSON.stringify(left.expectedQuantity).localeCompare(JSON.stringify(right.expectedQuantity))
      || JSON.stringify(left.observedPhysicalQuantity).localeCompare(JSON.stringify(right.observedPhysicalQuantity))
    ));
  return JSON.stringify({ fromSource, toSource, comment, items });
}

// SKU is the physical identity for future barcode-driven transfers.
// The scanner may submit variantId alone, but when a human picker also submits
// visible characteristics they must still describe that exact active variant.
// A stale selection must never silently move a different size or color.
export function transferProvidedFactsMatchCanonicalSku(
  raw: InventoryItemInput,
  canonical: CanonicalVariantSnapshot,
) {
  if (raw.productId !== undefined && raw.productId !== null && cleanText(raw.productId)
    && toInt(raw.productId, 0) !== canonical.productId) return false;
  if (raw.productName !== undefined
    && normalizeCatalogProductIdentityKey(raw.productName) !== normalizeCatalogProductIdentityKey(canonical.productName)) return false;
  if (raw.category !== undefined
    && normalizeAudienceCategory(raw.category, raw.size) !== canonical.category) return false;
  if (raw.gender !== undefined
    && normalizeCatalogCombinationGender(raw.gender) !== normalizeCatalogCombinationGender(canonical.gender)) return false;
  if (raw.color !== undefined
    && catalogColorIdentity(raw.color) !== catalogColorIdentity(canonical.color)) return false;
  if (raw.material !== undefined
    && canonicalStockPositionValue(raw.material) !== canonicalStockPositionValue(canonical.material)) return false;
  if (raw.length !== undefined
    && canonicalStockPositionValue(raw.length) !== canonicalStockPositionValue(canonical.length)) return false;
  if (raw.size !== undefined
    && normalizeCatalogCombinationSize(raw.size) !== normalizeCatalogCombinationSize(canonical.size)) return false;
  return true;
}
