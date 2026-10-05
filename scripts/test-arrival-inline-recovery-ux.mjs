import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (value, message) => { if (!value) throw new Error(message) }

const worker = read('worker/index.ts')
const movement = read('worker/domains/inventory-movement.ts')
const app = read('src/App.tsx')
const dialog = read('src/features/inventory/views/ArrivalRecoveryDialog.tsx')
const css = read('src/styles/192c-arrival-recovery.css')

check(movement.includes("export class ArrivalRecoveryRequiredError extends Error"), 'Arrival recovery error contract missing')
check(movement.includes("code: 'arrival_retired_product'"), 'retired-product Arrival recovery code missing')
check(movement.includes("code: 'arrival_stale_variant'"), 'stale-variant Arrival recovery code missing')
check(movement.includes("latestCompletedProductRetirementId"), 'retired-product recovery cannot locate its safe restore record')
check(movement.includes("catalog_retirement_operations"), 'retired-product recovery is not tied to Catalog retirement history')
check(movement.includes("staleArrivalById"), 'stale selected Arrival variants are not identified before retry')
check(movement.includes("productActive: toInt(row.product_active, 0) === 1"), 'stale variant does not distinguish a retired product shell')

check(worker.includes("error instanceof ArrivalRecoveryRequiredError"), 'Arrival recovery details are not returned by the inventory endpoint')
check(worker.includes("retirementId: error.retirementId || null"), 'retirement id is not exposed for inline recovery')
check(worker.includes("variantId: error.variantId || null"), 'stale variant id is not exposed for explicit retry')

check(app.includes("const [arrivalRecoveryPrompt, setArrivalRecoveryPrompt]"), 'Arrival recovery UI state missing')
check(app.includes("arrivalRecoveryContinueRef"), 'Arrival recovery does not preserve a continuation for the current form')
check(app.includes("const openArrivalRecovery ="), 'recoverable Arrival responses are not converted into an inline workflow')
check(app.includes("/api/catalog/retirements/"), 'retired product cannot be restored from the Arrival flow')
check(app.includes("sameProduct ? { ...item, variantId: '' } : item"), 'restored product retry does not drop stale historical SKU ids')
check(app.includes("prompt.variantId > 0 && Number(item.variantId || 0) === prompt.variantId"), 'stale SKU retry is not scoped to the explicitly confirmed variant')
check(app.includes("openArrivalRecovery(retried.result, nextItems)"), 'multi-conflict Arrival recovery cannot continue safely')
check(app.includes("await finishMovement(retried.result)"), 'successful recovery does not finish the same Arrival automatically')
check(app.includes("setInventoryArrivalPositions([createEmptyArrivalPosition()])"), 'Arrival form reset contract disappeared after successful save')

check(dialog.includes("Повторно вводить приход не нужно"), 'operator is not told that the current Arrival form is preserved')
check(dialog.includes("Восстановить и продолжить"), 'retired-product recovery action is not human-readable')
check(dialog.includes("Создать новую вариацию и продолжить"), 'stale-SKU recovery action is not human-readable')
check(dialog.includes("Старые остатки, резервы и удалённые SKU не оживут"), 'recovery dialog does not explain the safety boundary')
check(!dialog.includes('ID:') && !dialog.includes('requestId='), 'technical identifiers leaked into the operator-facing copy')

check(css.includes('background: #fff;'), 'Arrival recovery dialog does not keep a clean white primary surface')
check(css.includes('linear-gradient(145deg, #f4f9ff 0%, #fff 66%)'), 'Arrival recovery dialog lost its human visual hierarchy')
check(css.includes('@media (max-width: 640px)'), 'Arrival recovery dialog lacks mobile treatment')

console.log('ARRIVAL INLINE RECOVERY UX PASSED — recoverable catalog conflicts stay inside the current Arrival, preserve the form, explain the decision, and continue only after explicit admin confirmation')
