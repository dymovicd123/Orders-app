import fs from 'node:fs'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const read = (p) => fs.readFileSync(p, 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }
const app = read('src/App.tsx')
const panel = read('src/features/inventory/views/renderInventoryMovementPanel.tsx')
const picker = read('src/features/inventory/movementPickerB2B.ts')
const section = read('src/features/sections/InventorySection.tsx')
const css = read('src/styles/w4-human-operations.css')
const preservation = read('scripts/test-step1906b-frontend-modularization.mjs')
const manifest = JSON.parse(read('scripts/w4-human-operations-frontend-manifest.json'))
const matrixWorkspace = read('src/features/inventory/useInventoryMatrixWorkspace.ts')
check(app.includes('useInventoryMatrixWorkspace({'), 'App does not delegate the stock matrix editor to the typed workspace')
check(matrixWorkspace.includes('function setInventoryMatrixCell(')
  && matrixWorkspace.includes('inventoryMatrixCellMap.get(key)')
  && matrixWorkspace.includes('expectedQuantity: existingCell?.current ?? 0'),
  'Warehouse matrix lost the original per-cell stock and expected-quantity contract')
check(matrixWorkspace.includes("inventoryDraft.movementType === 'manual_set'")
  && matrixWorkspace.includes('inventoryMatrixBatchGroups')
  && matrixWorkspace.includes('inventoryMatrixCurrentGroupItems'),
  'Matrix grouping or absolute-count semantics were dropped during structural extraction')
const matrixCompiled = await build({
  entryPoints: ['src/features/inventory/useInventoryMatrixWorkspace.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
})
const { inventoryMatrixGroupKey } = await import('data:text/javascript;base64,' + Buffer.from(matrixCompiled.outputFiles[0].text).toString('base64'))
const group = { productId: '42', productName: 'ШАПАН', category: 'adult', gender: 'МУЖ', material: 'БАРХАТ', length: 'УКОРОЧЕННЫЙ' }
assert.equal(inventoryMatrixGroupKey(group), inventoryMatrixGroupKey({ ...group, productName: 'ДРУГОЕ НАИМЕНОВАНИЕ' }),
  'A known catalog product must group by immutable product ID, not its name')
assert.notEqual(inventoryMatrixGroupKey(group), inventoryMatrixGroupKey({ ...group, material: 'ХЛОПОК' }),
  'Different executions must never merge into one inventory matrix group')
assert.notEqual(inventoryMatrixGroupKey(group), inventoryMatrixGroupKey({ ...group, gender: 'ЖЕН' }),
  'Different genders must remain distinct matrix groups')
assert.equal(inventoryMatrixGroupKey({ ...group, productId: '', productName: ' ШАПАН ' }),
  inventoryMatrixGroupKey({ ...group, productId: '', productName: 'ШАПАН' }),
  'Free-input product names must normalize before grouping')


check(app.includes("movementType: 'transfer',"), 'Operations no longer opens on the ordinary transfer task')
check(panel.includes('inventory-operation-main-action') && panel.includes('Переместить товар'), 'transfer is not the obvious primary Operations action')
check(panel.includes('<summary>Другие действия</summary>'), 'rare Operations actions are not progressively disclosed')
for (const label of ['Приход', 'Списание', 'Исправить количество']) check(panel.includes(`'${label}'`), `secondary action missing: ${label}`)
check(panel.includes('selectedInventoryOperationGroup.rows.length > 6'), 'large variant sets are not collapsed early enough')
check(panel.includes('Ещё {transferPartition.extra.length} вариантов'), 'overflow variants are not retained behind a calm disclosure')
check(panel.includes('Нулевые, отрицательные и старые варианты остаются доступны'), 'zero/negative variant discoverability promise missing')
check(app.includes("result.code === 'stock_resolution_required'") && app.includes('await askStockResolution({') && app.includes('Подтверждение относится только к этой операции и не заменяет ревизию.'), 'zero/negative transfer recovery is not explained through the bounded possession resolver')
check(!panel.includes('Сколько здесь сейчас') && !panel.includes('Фактически на месте'), 'Operations still asks for a fake full physical count during transfer/writeoff')
check(!panel.includes('<th>Свободно</th>') && !panel.includes('<th>{sourceLabel(inventoryDraft.targetSource)}</th>'), 'transfer table still exposes the old six-column cognitive load')
check(panel.includes('<th>По системе</th>'), 'compact transfer system-state column missing')
check(panel.includes("import '../../../styles/w4-human-operations.css'"), 'W4 Operations stylesheet is not scoped from the renderer')

check(picker.includes('export const TRANSFER_PRIMARY_ROW_LIMIT = 6'), 'W4 primary variant limit missing')
check(picker.includes('export function partitionTransferVariantRows'), 'W4 variant partition helper missing')
check(picker.includes('const extra = ranked.filter'), 'overflow variants are being discarded instead of retained')
check(!picker.includes('sourceZeroRows]).slice'), 'old transfer truncation can still silently hide zero rows')
check(picker.includes('hasMessyFormatting') && picker.includes('variantSimilarityKey'), 'visual-noise heuristics missing')
check(!picker.includes('numberValue(row?.quantity) <= 0) unusualIds'), 'zero/negative stock must never itself mark a variant as garbage')

check(css.includes('.inventory-transfer-extra-variants') && css.includes('@media (max-width: 760px)'), 'W4 variant disclosure/mobile styles missing')
check(section.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')
check(section.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'frozen Arrival add-position action changed')

check(manifest.version === 1 && manifest.revision === 'w4-human-operations', 'W4 frontend preservation manifest invalid')
check(manifest.frontend?.panelReturnChanges?.renderInventoryMovementPanel?.before, 'W4 movement before hash missing')
check(manifest.frontend?.panelReturnChanges?.renderInventoryMovementPanel?.after, 'W4 movement after hash missing')
check(preservation.includes('w4HumanOperationsPath') && preservation.includes('W4 human operations panel baseline hash mismatch'), '1906B preservation gate is not chained through W4')

console.log('W4 HUMAN OPERATIONS PASSED — transfer is task-first, shortage recovery uses bounded possession confirmation, variant noise is bounded, and Arrival stays frozen')
