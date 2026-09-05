from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:140]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# -----------------------------------------------------------------------------
# Operations renderer: task-first navigation + calm transfer picker.
# Arrival workspace itself is never rewritten.
# -----------------------------------------------------------------------------
render = 'src/features/inventory/views/renderInventoryMovementPanel.tsx'
replace_once(
    render,
    "import { refineMovementPickerContext } from '../movementPickerB2B'\nimport '../../../styles/192b2b-movement-picker.css'",
    "import { partitionTransferVariantRows, refineMovementPickerContext } from '../movementPickerB2B'\nimport '../../../styles/192b2b-movement-picker.css'\nimport '../../../styles/w4-human-operations.css'",
)
replace_once(render, "\nimport type { InventoryDraft } from '../../../app/types'\n", "\n")
replace_once(
    render,
    """  } = movementCtx\n\n  return (""",
    """  } = movementCtx\n\n  const transferPartition = partitionTransferVariantRows(\n    inventoryDraft.movementType === 'transfer' ? operationVisibleRows : [],\n    selectedOperationDraftItems.map(({ item }: any) => item?.variantId).filter(Boolean),\n    Boolean(String(inventoryExistingVariantSearch || '').trim()),\n  )\n  const renderedOperationRows = inventoryDraft.movementType === 'transfer' ? transferPartition.primary : operationVisibleRows\n\n  return (""",
)
replace_once(
    render,
    '<p>Сначала выберите действие. Дальше останутся только поля, которые нужны именно для него.</p>',
    '<p>Обычная работа здесь — переместить реальный товар между складом и бутиком. Редкие действия убраны ниже.</p>',
)
old_modes = """                    <div className=\"inventory-operation-mode-tabs\" role=\"tablist\" aria-label=\"Тип складской операции\">\n                      {([\n                        ['arrival', 'Приход'],\n                        ['writeoff', 'Списание'],\n                        ['transfer', 'Перемещение'],\n                        ['manual_set', 'Корректировка'],\n                      ] as Array<[InventoryDraft['movementType'], string]>).map(([mode, title]) => (\n                        <button\n                          key={mode}\n                          type=\"button\"\n                          className={inventoryDraft.movementType === mode ? 'is-active' : ''}\n                          disabled={inventoryMovementBusy}\n                          onClick={() => selectInventoryOperationMode(mode)}\n                        >\n                          {title}\n                        </button>\n                      ))}\n                    </div>"""
new_modes = """                    <div className=\"inventory-operation-entry-actions\">\n                      <button\n                        type=\"button\"\n                        className={`inventory-operation-main-action ${inventoryDraft.movementType === 'transfer' ? 'is-active' : ''}`}\n                        disabled={inventoryMovementBusy}\n                        onClick={() => selectInventoryOperationMode('transfer')}\n                      >\n                        <span>\n                          <strong>Переместить товар</strong>\n                          <small>Склад ↔ Бутик · основной сценарий</small>\n                        </span>\n                        <b>Открыть</b>\n                      </button>\n                      <details className=\"inventory-operation-more-actions\">\n                        <summary>Другие действия</summary>\n                        <div className=\"inventory-operation-secondary-actions\" role=\"group\" aria-label=\"Другие складские действия\">\n                          {[\n                            ['arrival', 'Приход'],\n                            ['writeoff', 'Списание'],\n                            ['manual_set', 'Исправить количество'],\n                          ].map(([mode, title]) => (\n                            <button\n                              key={mode}\n                              type=\"button\"\n                              className={inventoryDraft.movementType === mode ? 'is-active' : ''}\n                              disabled={inventoryMovementBusy}\n                              onClick={() => selectInventoryOperationMode(mode)}\n                            >\n                              {title}\n                            </button>\n                          ))}\n                        </div>\n                      </details>\n                    </div>"""
replace_once(render, old_modes, new_modes)
replace_once(
    render,
    '<small className="inventory-transfer-direction-hint">Фиксируется фактическое перемещение. Резервы заказов остаются в своей точке.</small>',
    '<small className="inventory-transfer-direction-hint">Выберите, откуда и куда вы реально перенесли товар. Заказы система не перепишет.</small>',
)
replace_once(render, 'selectedInventoryOperationGroup.rows.length > 10', 'selectedInventoryOperationGroup.rows.length > 6')
replace_once(render, '<span>Быстро найти вариант</span>', '<span>Цвет, размер или материал</span>')
replace_once(
    render,
    """                                        {inventoryDraft.movementType === 'transfer' ? (\n                                          <>\n                                            <th>На месте</th>\n                                            <th>Свободно</th>\n                                            <th>{sourceLabel(inventoryDraft.targetSource)}</th>\n                                          </>\n                                        ) : (""",
    """                                        {inventoryDraft.movementType === 'transfer' ? (\n                                          <th>По системе</th>\n                                        ) : (""",
)
replace_once(render, '{operationVisibleRows.map((row: any) => {', '{renderedOperationRows.map((row: any) => {')
replace_once(
    render,
    """                                            {inventoryDraft.movementType === 'transfer' ? (\n                                              <>\n                                                <td><strong>{currentQuantity}</strong><small>{reservedQuantity ? `${reservedQuantity} в заказах` : ''}</small></td>\n                                                <td><strong className={freeQuantity < 0 ? 'text-danger' : ''}>{freeQuantity}</strong></td>\n                                                <td><strong>{destinationQuantity}</strong></td>\n                                              </>\n                                            ) : (""",
    """                                            {inventoryDraft.movementType === 'transfer' ? (\n                                              <td>\n                                                <span className={`inventory-transfer-system-state ${currentQuantity < 0 ? 'is-negative' : currentQuantity === 0 ? 'is-zero' : ''}`}>\n                                                  <strong>{currentQuantity}</strong>\n                                                  {reservedQuantity ? <small>{reservedQuantity} в заказах · доступно {freeQuantity}</small> : <small>в этой точке</small>}\n                                                </span>\n                                              </td>\n                                            ) : (""",
)
replace_once(
    render,
    '<span>По учёту на месте {currentQuantity}. Если физически есть больше:</span>',
    '<span>По системе здесь {currentQuantity}. Чтобы провести это перемещение без путаницы, посчитайте только этот вариант в этой точке. Полную ревизию делать не нужно.</span>',
)
replace_once(render, '<em>Фактически на месте</em>', '<em>Сколько здесь сейчас</em>')
replace_once(
    render,
    """                                                <span className={shortageAfter > 0 ? 'inventory-transfer-after has-shortage' : 'inventory-transfer-after'}>\n                                                  <b>{transferFreeAfter}</b> свободно · <b>{destinationQuantity + operationQuantity}</b> на месте назначения\n                                                  {shortageAfter > 0 ? <small>После перемещения не хватит {shortageAfter} шт. для заказов. Перемещение не блокируется, резервы сохраняются.</small> : null}\n                                                </span>""",
    """                                                <span className={shortageAfter > 0 ? 'inventory-transfer-after has-shortage' : 'inventory-transfer-after'}>\n                                                  <b>{afterPhysical}</b> останется здесь · <b>{destinationQuantity + operationQuantity}</b> будет в «{sourceLabel(inventoryDraft.targetSource)}»\n                                                  {shortageAfter > 0 ? <small>После перемещения для заказов не хватит {shortageAfter} шт. Само физическое перемещение не блокируется.</small> : null}\n                                                </span>""",
)
replace_once(
    render,
    "<tr><td colSpan={inventoryDraft.movementType === 'transfer' ? 6 : inventoryDraft.movementType === 'writeoff' ? 5 : 4} className=\"empty-state\">Подходящих вариантов нет.</td></tr>",
    "<tr><td colSpan={inventoryDraft.movementType === 'transfer' ? 4 : inventoryDraft.movementType === 'writeoff' ? 5 : 4} className=\"empty-state\">Подходящих вариантов нет.</td></tr>",
)
old_table_close = """                                  </table>\n                                </div>\n                              </>"""
new_table_close = """                                  </table>\n                                </div>\n                                {inventoryDraft.movementType === 'transfer' && transferPartition.extra.length ? (\n                                  <details className=\"inventory-transfer-extra-variants\">\n                                    <summary>\n                                      <strong>Ещё {transferPartition.extra.length} вариантов</strong>\n                                      <small>Не пропали — просто убраны из первого экрана</small>\n                                    </summary>\n                                    <div className=\"inventory-transfer-extra-list\">\n                                      {transferPartition.extra.map((row: any) => {\n                                        const signature = [row.gender, row.color, row.size, row.material, row.length].filter(Boolean).join(' ')\n                                        const unusual = transferPartition.unusualIds.has(String(row.variantId || ''))\n                                        const quantity = Number(row.quantity || 0)\n                                        return (\n                                          <button\n                                            key={`transfer-extra-${row.variantId}`}\n                                            type=\"button\"\n                                            className={`inventory-transfer-extra-row ${unusual ? 'is-unusual' : ''}`}\n                                            onClick={() => setInventoryExistingVariantSearch(signature || String(row.variantId || ''))}\n                                          >\n                                            <span>\n                                              <strong>{inventoryOperationRowPrimary(row)}</strong>\n                                              <small>{inventoryOperationRowSecondary(row) || 'Обычный вариант'}</small>\n                                            </span>\n                                            <span className=\"inventory-transfer-extra-stock\">{quantity > 0 ? `На месте ${quantity}` : `По системе ${quantity}`}</span>\n                                            {unusual ? <span className=\"inventory-transfer-extra-note\">похожее или старое значение</span> : null}\n                                          </button>\n                                        )\n                                      })}\n                                    </div>\n                                  </details>\n                                ) : null}\n                              </>"""
replace_once(render, old_table_close, new_table_close)
replace_once(
    render,
    '<span>После выбора сразу появятся все существующие варианты этой точки. Характеристики вручную собирать не нужно.</span>',
    '<span>Сначала покажем несколько самых вероятных вариантов. Нулевые, отрицательные и старые варианты остаются доступны через поиск и «Ещё варианты».</span>',
)

# Default opening of Operations should be the ordinary task, not Arrival.
replace_once(
    'src/App.tsx',
    """  const [inventoryDraft, setInventoryDraft] = useState<InventoryDraft>({\n    source: 'warehouse',\n    targetSource: 'boutique',\n    movementType: 'arrival',""",
    """  const [inventoryDraft, setInventoryDraft] = useState<InventoryDraft>({\n    source: 'warehouse',\n    targetSource: 'boutique',\n    movementType: 'transfer',""",
)

# -----------------------------------------------------------------------------
# Extend the exact frontend preservation chain with the W4 movement renderer.
# The workflow generates the exact before/after hash manifest after applying W4.
# -----------------------------------------------------------------------------
preserve = 'scripts/test-step1906b-frontend-modularization.mjs'
replace_once(
    preserve,
    "const w3NaturalRecoveryPath = path.join(root, 'scripts/w3-2-natural-recovery-frontend-manifest.json')\nconst fail = (message) => { throw new Error(message) }",
    "const w3NaturalRecoveryPath = path.join(root, 'scripts/w3-2-natural-recovery-frontend-manifest.json')\nconst w4HumanOperationsPath = path.join(root, 'scripts/w4-human-operations-frontend-manifest.json')\nconst fail = (message) => { throw new Error(message) }",
)
replace_once(
    preserve,
    "  const w3NaturalRecovery = fs.existsSync(w3NaturalRecoveryPath) ? JSON.parse(fs.readFileSync(w3NaturalRecoveryPath, 'utf8')) : null\n  if (operationalAutonomyR2)",
    "  const w3NaturalRecovery = fs.existsSync(w3NaturalRecoveryPath) ? JSON.parse(fs.readFileSync(w3NaturalRecoveryPath, 'utf8')) : null\n  const w4HumanOperations = fs.existsSync(w4HumanOperationsPath) ? JSON.parse(fs.readFileSync(w4HumanOperationsPath, 'utf8')) : null\n  if (operationalAutonomyR2)",
)
replace_once(
    preserve,
    "  if (w3NaturalRecovery) check(w3NaturalRecovery.version === 1 && w3NaturalRecovery.revision === 'w3-2-natural-recovery', 'W3.2 natural recovery frontend manifest invalid')\n  check(manifest?.version === 1",
    "  if (w3NaturalRecovery) check(w3NaturalRecovery.version === 1 && w3NaturalRecovery.revision === 'w3-2-natural-recovery', 'W3.2 natural recovery frontend manifest invalid')\n  if (w4HumanOperations) check(w4HumanOperations.version === 1 && w4HumanOperations.revision === 'w4-human-operations', 'W4 human operations frontend manifest invalid')\n  check(manifest?.version === 1",
)
replace_once(
    preserve,
    """    const w3MicroPanelChange = w3StockMicroCheck?.frontend?.panelReturnChanges?.[panel.func]\n    if (w3MicroPanelChange) {\n      check(w3MicroPanelChange.before === expectedPanelHash, `${panel.func}: W3.1B stock micro-check panel baseline hash mismatch`)\n      expectedPanelHash = w3MicroPanelChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B delta`)""",
    """    const w3MicroPanelChange = w3StockMicroCheck?.frontend?.panelReturnChanges?.[panel.func]\n    if (w3MicroPanelChange) {\n      check(w3MicroPanelChange.before === expectedPanelHash, `${panel.func}: W3.1B stock micro-check panel baseline hash mismatch`)\n      expectedPanelHash = w3MicroPanelChange.after\n    }\n    const w4PanelChange = w4HumanOperations?.frontend?.panelReturnChanges?.[panel.func]\n    if (w4PanelChange) {\n      check(w4PanelChange.before === expectedPanelHash, `${panel.func}: W4 human operations panel baseline hash mismatch`)\n      expectedPanelHash = w4PanelChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B/W4 delta`)""",
)
replace_once(
    preserve,
    "${w3NaturalRecovery ? ', exact W3.2 natural-recovery Attention delta accepted' : ''}`)",
    "${w3NaturalRecovery ? ', exact W3.2 natural-recovery Attention delta accepted' : ''}${w4HumanOperations ? ', exact W4 human Operations movement delta accepted' : ''}`)",
)

# -----------------------------------------------------------------------------
# Focused regression + release chain + continuation context.
# -----------------------------------------------------------------------------
pkg = Path('package.json')
pkg_text = pkg.read_text(encoding='utf-8')
old_tail = "node scripts/test-w3-1b-stock-micro-check.mjs && node scripts/test-w3-2-natural-recovery.mjs\""
new_tail = "node scripts/test-w3-1b-stock-micro-check.mjs && node scripts/test-w3-2-natural-recovery.mjs && node scripts/test-w4-human-operations.mjs\""
if pkg_text.count(old_tail) != 1:
    raise SystemExit('package.json: W3.2 release tail not found exactly once')
pkg.write_text(pkg_text.replace(old_tail, new_tail, 1), encoding='utf-8')

Path('scripts/test-w4-human-operations.mjs').write_text(r'''import fs from 'node:fs'

const read = (p) => fs.readFileSync(p, 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }
const app = read('src/App.tsx')
const panel = read('src/features/inventory/views/renderInventoryMovementPanel.tsx')
const picker = read('src/features/inventory/movementPickerB2B.ts')
const section = read('src/features/sections/InventorySection.tsx')
const css = read('src/styles/w4-human-operations.css')
const preservation = read('scripts/test-step1906b-frontend-modularization.mjs')
const manifest = JSON.parse(read('scripts/w4-human-operations-frontend-manifest.json'))

check(app.includes("movementType: 'transfer',"), 'Operations no longer opens on the ordinary transfer task')
check(panel.includes('inventory-operation-main-action') && panel.includes('Переместить товар'), 'transfer is not the obvious primary Operations action')
check(panel.includes('<summary>Другие действия</summary>'), 'rare Operations actions are not progressively disclosed')
for (const label of ['Приход', 'Списание', 'Исправить количество']) check(panel.includes(`'${label}'`), `secondary action missing: ${label}`)
check(panel.includes('selectedInventoryOperationGroup.rows.length > 6'), 'large variant sets are not collapsed early enough')
check(panel.includes('Ещё {transferPartition.extra.length} вариантов'), 'overflow variants are not retained behind a calm disclosure')
check(panel.includes('Нулевые, отрицательные и старые варианты остаются доступны'), 'zero/negative variant discoverability promise missing')
check(panel.includes('По системе здесь {currentQuantity}. Чтобы провести это перемещение без путаницы'), 'zero/negative transfer recovery is not explained in human terms')
check(panel.includes('Сколько здесь сейчас'), 'physical reconciliation input is not human-labelled')
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

console.log('W4 HUMAN OPERATIONS PASSED — transfer is task-first, variant noise is bounded, zero/negative variants stay discoverable, and Arrival stays frozen')
''', encoding='utf-8')

Path('docs/continuation/W4_HUMAN_OPERATIONS_20260905.md').write_text(r'''# W4 — Human Warehouse Operations

Date: 2026-09-05
Base Production: `5aed87218c328a7d55e90b9e3f0bab5252b54b6b` (W3.2)

## Product goal

`Операции` should read like a physical task, not like a movement database editor. The ordinary task is moving a real item between Warehouse and Boutique. Rare actions remain available but secondary.

## Implemented

- Operations opens on `Перемещение` by default.
- `Переместить товар` is the obvious primary action.
- Arrival, write-off and exact quantity correction are under `Другие действия`.
- Arrival workspace markup itself is unchanged/frozen.
- Transfer product choice still starts with product search, then variants.
- Only six likely variants are shown initially; search expands direct matches.
- Remaining variants are preserved under `Ещё варианты`, never discarded.
- Zero and negative system quantities are not filtered or labelled as garbage merely because of quantity.
- Formatting duplicates / visually suspicious near-duplicates are ranked lower and can be shown with a mild `похожее или старое значение` note; they are never merged or mutated automatically.
- Transfer table is reduced from six columns to four: variant, system state, quantity to move, human consequence.
- If requested movement exceeds system physical quantity, the existing safety rule remains: the person must explicitly count that exact variant in that location. Copy explains that this is a local check, not a full stocktake.
- No automatic interpretation of “I am holding one” as “the full physical count is one”.
- Reservation shortages remain non-blocking for the physical move; the consequence is shown in human language.

## Deliberate non-changes

- No D1 migration.
- No Production D1 read/write for diagnosis.
- No backend inventory arithmetic change.
- No automatic catalog merge/cleanup.
- No Branch2 change.
- No Arrival UI redesign.
- Write-off and exact correction retain their accepted business/runtime paths; W4 only makes them secondary in navigation.

## Adjacent audit targets

Focused/cumulative checks cover transfer picker behavior, manager-safe Operations, frozen Arrival, W3 recovery, order/handover/return/exchange invariants, DB safety and build. W6 remains responsible for true catalog cleanup; W4 only prevents catalog noise from dominating daily movement work.

## Next

Use Production feedback to tune the first-screen variant limit and wording. If the picker still feels heavy, W4.1 can switch the six primary variants from compact table rows to touch-friendly cards without changing movement semantics.
''', encoding='utf-8')

print('W4 human Operations patch applied')
