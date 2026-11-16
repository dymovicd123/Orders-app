import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const groups = readFileSync('src/features/inventory/views/catalogPolishExecutionGroups.tsx', 'utf8')
const button = readFileSync('src/features/inventory/views/SkuBarcodeButton.tsx', 'utf8')
const lookup = readFileSync('src/features/inventory/views/SkuBarcodeLookup.tsx', 'utf8')
const styles = readFileSync('src/features/inventory/views/skuBarcodeLabel.css', 'utf8')
const server = readFileSync('worker/domains/barcode-sku.ts', 'utf8')
const identity = readFileSync('shared/barcode-sku.ts', 'utf8')

assert(groups.includes('className="catalog-size-entry"'), 'SKU action is not visible beside each exact size')
assert(groups.includes('<SkuBarcodeButton variantId={Number(variant.id)} compact />'), 'wrong SKU used by tile shortcut')
assert(groups.includes('className="catalog-sku-head-actions"'), 'barcode action must be at top of detail card')
assert(styles.includes('.catalog-size-entry .sku-barcode-trigger'), 'size shortcut lacks compact styles')
assert(styles.includes('@media(max-width:460px)'), 'mobile layout missing')

assert(button.includes('compact ? \'Этикетка SKU\' : \'Штрихкод SKU\''), 'SKU-level label must be explicit')
assert(button.includes('fresh.barcode !== label.barcode'), 'print must reject stale / changed code')
assert(button.includes('!fresh.active'), 'retired SKU must fail closed before printing')
assert(button.includes('fresh.physicalUnit !== false'), 'SKU label must not impersonate a physical item')
assert(button.includes("method: 'GET'"), 'print revalidation must use read-only API')
assert(button.indexOf("window.open('', '_blank'", button.indexOf('const printVerified')) < button.indexOf('await fetch(', button.indexOf('const printVerified')), 'print popup must open before async check')
assert(button.includes('if (!printWindow.closed) printWindow.close()'), 'failed validation must close popup')
assert(button.includes("event.key === 'Escape'"), 'preview must support Escape')

assert(lookup.includes('if (data.active) {\n          onLocate(data)'), 'valid scan must open exact item without extra click')
assert(lookup.includes('inputRef.current?.select()'), 'scanner should be ready for next code')
assert(lookup.includes('result.active ? <button'), 'retired SKU must not have an open action')
assert(server.includes("status: active ? 'active' : 'retired'"), 'retired identity must remain addressable')
assert(!server.includes('UPDATE inventory_stock') && !server.includes('INSERT INTO inventory_stock'), 'scan must never mutate stock')
assert(identity.includes("const PREFIX = 'OCS1'"), 'SKU identity namespace changed unexpectedly')

console.log('BARCODE WORKFLOW UX PASS: quick access, exact scan, stale-print protection, no D1 mutations')
