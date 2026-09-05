from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one occurrence, found {count}: {old[:140]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


def append_once(path: str, marker: str, block: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if marker in text:
        raise SystemExit(f'{path}: marker already present: {marker}')
    p.write_text(text.rstrip() + '\n' + block.rstrip() + '\n', encoding='utf-8')


# 1) Concrete stock micro-check opens entirely from already loaded stock rows.
overview = 'src/features/inventory/views/renderInventoryOverviewPanel.tsx'
replace_once(
    overview,
    """    simpleStockStats,\n    sourceLabel\n  } = ctx\n\n  return (""",
    """    simpleStockStats,\n    sourceLabel\n  } = ctx\n\n  const openConcreteStockCheck = (row: any, label: string) => {\n    const physical = simpleStockPhysical(row)\n    const reserved = simpleStockReserved(row)\n    setSimpleStockDetail({\n      source: simpleStockSource, productId: Number(row.productId || 0), variantId: Number(row.variantId || 0), productName: row.productName || 'Товар',\n      category: row.category || 'adult', gender: row.gender || '', material: row.material || 'СТАНДАРТ', length: row.length || 'СТАНДАРТ', size: row.size || '', color: row.color || '',\n      physical, reserved, free: simpleStockQuantity(row), aggregate: false, label, hasDataIssue: false, microCheck: true,\n    })\n    setQuickStocktakeOpen(true)\n    setQuickStocktakeValues({})\n    setQuickStocktakeNotice('')\n  }\n\n  const microCheckDetailRow = (detail: any) => ({\n    productId: detail.productId, variantId: detail.variantId, productName: detail.productName, category: detail.category, gender: detail.gender, material: detail.material, length: detail.length, size: detail.size, color: detail.color,\n    warehouseQuantity: detail.source === 'warehouse' ? detail.physical : 0, warehouseReserved: detail.source === 'warehouse' ? detail.reserved : 0, warehouseAvailable: detail.source === 'warehouse' ? detail.free : 0,\n    boutiqueQuantity: detail.source === 'boutique' ? detail.physical : 0, boutiqueReserved: detail.source === 'boutique' ? detail.reserved : 0, boutiqueAvailable: detail.source === 'boutique' ? detail.free : 0,\n  })\n\n  return (""",
)

replace_once(
    overview,
    """<button className=\"secondary compact inventory-calm-detail-button\" type=\"button\" onClick={() => void openSimpleStockRowsDetail(rows, { label: singlePrimary })}>Подробнее</button>""",
    """<button className=\"secondary compact inventory-calm-detail-button warehouse-w3-micro-check-open\" type=\"button\" onClick={() => openConcreteStockCheck(singleRow, singlePrimary)}>Проверить</button>""",
)
replace_once(
    overview,
    """<button className=\"ghost compact\" type=\"button\" onClick={() => void openSimpleStockRowsDetail([row], { label: primary })}>Подробнее</button>""",
    """<button className=\"ghost compact warehouse-w3-micro-check-open\" type=\"button\" onClick={() => openConcreteStockCheck(row, primary)}>Проверить</button>""",
)

old_drawer = """                          {simpleStockDetail.physical < 0 ? <div className=\"inventory-calm-warning\"><strong>Учёт ниже нуля — нужна сверка</strong><span>Отрицательное число не доказывает, что забыли приход. Проверьте фактическое количество и источник товара; система исправит учёт по реальному факту.</span></div> : simpleStockDetail.free < 0 ? <div className=\"inventory-calm-warning\"><strong>Товара не хватает для текущих заказов</strong><span>Нужно ещё {Math.abs(simpleStockDetail.free)} шт. либо требуется сверка фактического количества.</span></div> : null}\n                          <section className=\"inventory-calm-reservations\">\n                            <div className=\"inventory-calm-reservations-head\"><strong>{simpleStockDetail.reserved > 0 ? 'Товар отложен для этих заказов' : 'Товар сейчас не зарезервирован'}</strong>{simpleStockDetail.reserved > 0 ? <span>Всего: {simpleStockDetail.reserved} шт.</span> : null}</div>\n                            {simpleStockReservationsBusy ? <div className=\"empty-state compact-empty\">Загружаю заказы…</div> : simpleStockDetail.reserved > 0 && !simpleStockReservations.length ? <div className=\"empty-state compact-empty\">Не удалось получить список заказов. Обновите остатки и попробуйте ещё раз.</div> : simpleStockReservations.map((reservation: any) => (\n                              <div className=\"inventory-calm-reservation\" key={`reservation-${reservation.id}`}>\n                                <div className=\"inventory-calm-reservation-main\">\n                                  <strong>Заказ {reservation.externalOrderId || reservation.orderId}</strong>\n                                  {simpleStockDetail.aggregate ? <span>{[reservation.color, reservation.size, reservation.material && reservation.material !== 'СТАНДАРТ' ? reservation.material : '', reservation.length && reservation.length !== 'СТАНДАРТ' ? reservation.length : ''].filter(Boolean).join(' · ')}</span> : null}\n                                  <small>{[reservation.customerName || reservation.customerPhone, reservation.managerName, reservation.orderDate].filter(Boolean).join(' · ')}</small>\n                                </div>\n                                <b>{reservation.quantity} шт.</b>\n                                <button className=\"secondary compact\" type=\"button\" onClick={() => { setSimpleStockDetail(null); void openOrderFromFinance({ orderId: reservation.orderId, externalId: reservation.externalOrderId, orderDate: reservation.orderDate }) }}>Открыть заказ</button>\n                              </div>\n                            ))}\n                          </section>\n                          {!simpleStockDetail.aggregate ? (\n                            <section className=\"inventory-exact-count\">\n                              <div>\n                                <strong>Сверить количество</strong>\n                                <div className=\"inventory-exact-count-note\">Введите, сколько таких вещей физически находится здесь сейчас. Считайте и свободные, и уже отложенные под заказы.</div>\n                              </div>\n                              {quickStocktakeOpen ? (\n                                <div className=\"inventory-exact-count-row\">\n                                  <label>\n                                    <span>На месте сейчас</span>\n                                    <input\n                                      type=\"number\"\n                                      min=\"0\"\n                                      step=\"1\"\n                                      inputMode=\"numeric\"\n                                      value={quickStocktakeValues[String(simpleStockDetail.variantId)] ?? ''}\n                                      onChange={(event) => setQuickStocktakeValues({ [String(simpleStockDetail.variantId)]: event.target.value === '' ? '' : String(Math.max(0, Math.trunc(Number(event.target.value || 0)))) })}\n                                      placeholder={String(simpleStockDetail.physical)}\n                                    />\n                                  </label>\n                                  <button className=\"primary\" type=\"button\" disabled={quickStocktakeBusy || (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') === ''} onClick={() => void applyQuickStocktake()}>{quickStocktakeBusy ? 'Сохраняю…' : 'Сохранить факт'}</button>\n                                  <button className=\"ghost\" type=\"button\" disabled={quickStocktakeBusy} onClick={() => { setQuickStocktakeOpen(false); setQuickStocktakeValues({}); setQuickStocktakeNotice('') }}>Отмена</button>\n                                </div>\n                              ) : <button className=\"secondary\" type=\"button\" onClick={() => { setQuickStocktakeOpen(true); setQuickStocktakeValues({}); setQuickStocktakeNotice('') }}>Сверить количество</button>}\n                              {quickStocktakeNotice ? <p className=\"inventory-quick-stocktake-notice\">{quickStocktakeNotice}</p> : null}\n                            </section>\n                          ) : null}\n                          {isAdmin ? <div className=\"inventory-calm-detail-actions\">{simpleStockDetail.aggregate ? <span className=\"inventory-quick-stocktake-hint\">Для сверки откройте конкретный вариант товара.</span> : null}{!simpleStockDetail.aggregate ? <button className=\"secondary\" type=\"button\" onClick={() => openSimpleStockHistory(simpleStockDetail)}>История позиции</button> : null}</div> : null}"""

new_drawer = """                          {simpleStockDetail.microCheck ? (\n                            <section className=\"inventory-exact-count warehouse-w3-micro-check\" data-w3-micro-check=\"true\">\n                              <div><strong>Быстрая проверка</strong><div className=\"inventory-exact-count-note\">Это добровольная сверка этой конкретной позиции. Открытие ничего не меняет — сохранится только подтверждённый вами факт.</div></div>\n                              {simpleStockDetail.physical >= 0 ? (\n                                <div className=\"inventory-routine-cycle-actions\">\n                                  <button className=\"primary compact inventory-routine-cycle-confirm\" type=\"button\" disabled={quickStocktakeBusy} onClick={() => void applyQuickStocktake(Number(simpleStockDetail.physical || 0))}>{quickStocktakeBusy ? 'Сохраняю…' : `Да, на месте ${simpleStockDetail.physical}`}</button>\n                                  <details className=\"inventory-routine-cycle-other\"><summary className=\"inventory-routine-cycle-other-button\">Нет, другое количество</summary><div className=\"inventory-routine-cycle-edit\"><input aria-label={`Фактическое количество ${simpleStockDetail.productName}`} type=\"number\" min=\"0\" step=\"1\" inputMode=\"numeric\" value={quickStocktakeValues[String(simpleStockDetail.variantId)] ?? ''} onChange={(event) => setQuickStocktakeValues({ [String(simpleStockDetail.variantId)]: event.target.value === '' ? '' : String(Math.max(0, Math.trunc(Number(event.target.value || 0)))) })} /><button className=\"primary compact\" type=\"button\" disabled={quickStocktakeBusy || (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') === ''} onClick={() => void applyQuickStocktake()}>{quickStocktakeBusy ? 'Сохраняю…' : 'Сохранить факт'}</button></div></details>\n                                </div>\n                              ) : (\n                                <div className=\"inventory-routine-cycle-edit is-independent\"><input aria-label={`Фактическое количество ${simpleStockDetail.productName}`} type=\"number\" min=\"0\" step=\"1\" inputMode=\"numeric\" placeholder=\"Факт\" value={quickStocktakeValues[String(simpleStockDetail.variantId)] ?? ''} onChange={(event) => setQuickStocktakeValues({ [String(simpleStockDetail.variantId)]: event.target.value === '' ? '' : String(Math.max(0, Math.trunc(Number(event.target.value || 0)))) })} /><button className=\"primary compact\" type=\"button\" disabled={quickStocktakeBusy || (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') === ''} onClick={() => void applyQuickStocktake()}>{quickStocktakeBusy ? 'Сохраняю…' : 'Сохранить факт'}</button></div>\n                              )}\n                              {simpleStockDetail.physical < 0 ? <div className=\"inventory-exact-count-note\">Системное количество ниже нуля, поэтому подтвердить его одним нажатием нельзя — укажите реальный факт.</div> : null}\n                              {quickStocktakeNotice ? <p className=\"inventory-quick-stocktake-notice\">{quickStocktakeNotice}</p> : null}\n                              <div className=\"inventory-calm-detail-actions\"><button className=\"secondary\" type=\"button\" onClick={() => void openSimpleStockRowsDetail([microCheckDetailRow(simpleStockDetail)], { source: simpleStockDetail.source, label: simpleStockDetail.label })}>Подробнее о позиции</button></div>\n                            </section>\n                          ) : (<>\n                            {simpleStockDetail.physical < 0 ? <div className=\"inventory-calm-warning\"><strong>Учёт ниже нуля — нужна сверка</strong><span>Отрицательное число не доказывает, что забыли приход. Проверьте фактическое количество и источник товара; система исправит учёт по реальному факту.</span></div> : simpleStockDetail.free < 0 ? <div className=\"inventory-calm-warning\"><strong>Товара не хватает для текущих заказов</strong><span>Нужно ещё {Math.abs(simpleStockDetail.free)} шт. либо требуется сверка фактического количества.</span></div> : null}\n                            <section className=\"inventory-calm-reservations\">\n                              <div className=\"inventory-calm-reservations-head\"><strong>{simpleStockDetail.reserved > 0 ? 'Товар отложен для этих заказов' : 'Товар сейчас не зарезервирован'}</strong>{simpleStockDetail.reserved > 0 ? <span>Всего: {simpleStockDetail.reserved} шт.</span> : null}</div>\n                              {simpleStockReservationsBusy ? <div className=\"empty-state compact-empty\">Загружаю заказы…</div> : simpleStockDetail.reserved > 0 && !simpleStockReservations.length ? <div className=\"empty-state compact-empty\">Не удалось получить список заказов. Обновите остатки и попробуйте ещё раз.</div> : simpleStockReservations.map((reservation: any) => (\n                                <div className=\"inventory-calm-reservation\" key={`reservation-${reservation.id}`}>\n                                  <div className=\"inventory-calm-reservation-main\">\n                                    <strong>Заказ {reservation.externalOrderId || reservation.orderId}</strong>\n                                    {simpleStockDetail.aggregate ? <span>{[reservation.color, reservation.size, reservation.material && reservation.material !== 'СТАНДАРТ' ? reservation.material : '', reservation.length && reservation.length !== 'СТАНДАРТ' ? reservation.length : ''].filter(Boolean).join(' · ')}</span> : null}\n                                    <small>{[reservation.customerName || reservation.customerPhone, reservation.managerName, reservation.orderDate].filter(Boolean).join(' · ')}</small>\n                                  </div>\n                                  <b>{reservation.quantity} шт.</b>\n                                  <button className=\"secondary compact\" type=\"button\" onClick={() => { setSimpleStockDetail(null); void openOrderFromFinance({ orderId: reservation.orderId, externalId: reservation.externalOrderId, orderDate: reservation.orderDate }) }}>Открыть заказ</button>\n                                </div>\n                              ))}\n                            </section>\n                            {!simpleStockDetail.aggregate ? (\n                              <section className=\"inventory-exact-count\">\n                                <div>\n                                  <strong>Сверить количество</strong>\n                                  <div className=\"inventory-exact-count-note\">Введите, сколько таких вещей физически находится здесь сейчас. Считайте и свободные, и уже отложенные под заказы.</div>\n                                </div>\n                                {quickStocktakeOpen ? (\n                                  <div className=\"inventory-exact-count-row\">\n                                    <label>\n                                      <span>На месте сейчас</span>\n                                      <input\n                                        type=\"number\"\n                                        min=\"0\"\n                                        step=\"1\"\n                                        inputMode=\"numeric\"\n                                        value={quickStocktakeValues[String(simpleStockDetail.variantId)] ?? ''}\n                                        onChange={(event) => setQuickStocktakeValues({ [String(simpleStockDetail.variantId)]: event.target.value === '' ? '' : String(Math.max(0, Math.trunc(Number(event.target.value || 0)))) })}\n                                        placeholder={String(simpleStockDetail.physical)}\n                                      />\n                                    </label>\n                                    <button className=\"primary\" type=\"button\" disabled={quickStocktakeBusy || (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') === ''} onClick={() => void applyQuickStocktake()}>{quickStocktakeBusy ? 'Сохраняю…' : 'Сохранить факт'}</button>\n                                    <button className=\"ghost\" type=\"button\" disabled={quickStocktakeBusy} onClick={() => { setQuickStocktakeOpen(false); setQuickStocktakeValues({}); setQuickStocktakeNotice('') }}>Отмена</button>\n                                  </div>\n                                ) : <button className=\"secondary\" type=\"button\" onClick={() => { setQuickStocktakeOpen(true); setQuickStocktakeValues({}); setQuickStocktakeNotice('') }}>Сверить количество</button>}\n                                {quickStocktakeNotice ? <p className=\"inventory-quick-stocktake-notice\">{quickStocktakeNotice}</p> : null}\n                              </section>\n                            ) : null}\n                            {isAdmin ? <div className=\"inventory-calm-detail-actions\">{simpleStockDetail.aggregate ? <span className=\"inventory-quick-stocktake-hint\">Для сверки откройте конкретный вариант товара.</span> : null}{!simpleStockDetail.aggregate ? <button className=\"secondary\" type=\"button\" onClick={() => openSimpleStockHistory(simpleStockDetail)}>История позиции</button> : null}</div> : null}\n                          </>)}"""
replace_once(overview, old_drawer, new_drawer)

# 2) One-click confirmation reuses the existing CAS-protected quick-stocktake write path.
attention = 'src/features/inventory/useInventoryAttentionActions.ts'
replace_once(attention, '  async function applyQuickStocktake() {', '  async function applyQuickStocktake(countedOverride?: number) {')
replace_once(
    attention,
    "    const raw = quickStocktakeValues[String(simpleStockDetail.variantId)] ?? ''",
    "    const raw = countedOverride === undefined ? (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') : String(countedOverride)",
)

# 3) Preserve exact frontend lineage by chaining a new W3.1B panel delta after W3.1A.
preservation = 'scripts/test-step1906b-frontend-modularization.mjs'
replace_once(
    preservation,
    "const w3WarehouseReliabilityPath = path.join(root, 'scripts/w3-1a-warehouse-reliability-frontend-manifest.json')\nconst fail = (message) => { throw new Error(message) }",
    "const w3WarehouseReliabilityPath = path.join(root, 'scripts/w3-1a-warehouse-reliability-frontend-manifest.json')\nconst w3StockMicroCheckPath = path.join(root, 'scripts/w3-1b-stock-micro-check-frontend-manifest.json')\nconst fail = (message) => { throw new Error(message) }",
)
replace_once(
    preservation,
    "  const w3WarehouseReliability = fs.existsSync(w3WarehouseReliabilityPath) ? JSON.parse(fs.readFileSync(w3WarehouseReliabilityPath, 'utf8')) : null\n  if (operationalAutonomyR2)",
    "  const w3WarehouseReliability = fs.existsSync(w3WarehouseReliabilityPath) ? JSON.parse(fs.readFileSync(w3WarehouseReliabilityPath, 'utf8')) : null\n  const w3StockMicroCheck = fs.existsSync(w3StockMicroCheckPath) ? JSON.parse(fs.readFileSync(w3StockMicroCheckPath, 'utf8')) : null\n  if (operationalAutonomyR2)",
)
replace_once(
    preservation,
    "  if (w3WarehouseReliability) check(w3WarehouseReliability.version === 1 && w3WarehouseReliability.revision === 'w3-1a-warehouse-reliability', 'W3.1A Warehouse reliability frontend manifest invalid')\n  check(manifest?.version === 1",
    "  if (w3WarehouseReliability) check(w3WarehouseReliability.version === 1 && w3WarehouseReliability.revision === 'w3-1a-warehouse-reliability', 'W3.1A Warehouse reliability frontend manifest invalid')\n  if (w3StockMicroCheck) check(w3StockMicroCheck.version === 1 && w3StockMicroCheck.revision === 'w3-1b-stock-micro-check', 'W3.1B stock micro-check frontend manifest invalid')\n  check(manifest?.version === 1",
)
replace_once(
    preservation,
    """    const w3PanelChange = w3WarehouseReliability?.frontend?.panelReturnChanges?.[panel.func]\n    if (w3PanelChange) {\n      check(w3PanelChange.before === expectedPanelHash, `${panel.func}: W3.1A Warehouse reliability panel baseline hash mismatch`)\n      expectedPanelHash = w3PanelChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A delta`)""",
    """    const w3PanelChange = w3WarehouseReliability?.frontend?.panelReturnChanges?.[panel.func]\n    if (w3PanelChange) {\n      check(w3PanelChange.before === expectedPanelHash, `${panel.func}: W3.1A Warehouse reliability panel baseline hash mismatch`)\n      expectedPanelHash = w3PanelChange.after\n    }\n    const w3MicroPanelChange = w3StockMicroCheck?.frontend?.panelReturnChanges?.[panel.func]\n    if (w3MicroPanelChange) {\n      check(w3MicroPanelChange.before === expectedPanelHash, `${panel.func}: W3.1B stock micro-check panel baseline hash mismatch`)\n      expectedPanelHash = w3MicroPanelChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B delta`)""",
)
replace_once(
    preservation,
    "${w3WarehouseReliability ? ', exact W3.1A Warehouse reliability frontend delta accepted' : ''}`)",
    "${w3WarehouseReliability ? ', exact W3.1A Warehouse reliability frontend delta accepted' : ''}${w3StockMicroCheck ? ', exact W3.1B stock micro-check frontend delta accepted' : ''}`)",
)

# 4) Focused regression joins the cumulative release gate.
package = Path('package.json')
package_text = package.read_text(encoding='utf-8')
old_tail = "node scripts/test-w3-1a-warehouse-reliability.mjs\""
new_tail = "node scripts/test-w3-1a-warehouse-reliability.mjs && node scripts/test-w3-1b-stock-micro-check.mjs\""
if package_text.count(old_tail) != 1:
    raise SystemExit('package.json: W3.1A release tail not found exactly once')
package.write_text(package_text.replace(old_tail, new_tail, 1), encoding='utf-8')

Path('scripts/test-w3-1b-stock-micro-check.mjs').write_text(r'''import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
const attention = read('src/features/inventory/useInventoryAttentionActions.ts')
const app = read('src/App.tsx')
const inventorySection = read('src/features/sections/InventorySection.tsx')
const preservation = read('scripts/test-step1906b-frontend-modularization.mjs')
const manifest = JSON.parse(read('scripts/w3-1b-stock-micro-check-frontend-manifest.json'))

const between = (text, start, end) => {
  const from = text.indexOf(start)
  check(from >= 0, `Missing start: ${start}`)
  const to = text.indexOf(end, from + start.length)
  check(to > from, `Missing end after: ${start}`)
  return text.slice(from, to)
}

const opener = between(overview, 'const openConcreteStockCheck =', 'const microCheckDetailRow =')
check(opener.includes('simpleStockPhysical(row)') && opener.includes('simpleStockReserved(row)') && opener.includes('simpleStockQuantity(row)'), 'micro-check must use the already-loaded stock row')
check(opener.includes('microCheck: true'), 'micro-check detail mode marker missing')
for (const forbidden of ['loadInventory', 'loadWarehouseAttention', 'loadInventoryReservations', 'refreshCycleCountSuggestions', 'fetch(', '/api/']) {
  check(!opener.includes(forbidden), `opening a micro-check must not perform a read: ${forbidden}`)
}
check((overview.match(/>Проверить<\/button>/g) || []).length >= 2, 'concrete stock rows must expose the voluntary Проверить action')
check(overview.includes('data-w3-micro-check="true"'), 'micro-check surface missing')
check(overview.includes('Это добровольная сверка этой конкретной позиции. Открытие ничего не меняет'), 'voluntary/non-mutating copy missing')
check(overview.includes('Да, на месте ${simpleStockDetail.physical}'), 'one-click same-quantity confirmation missing')
check(overview.includes('Нет, другое количество'), 'alternate factual quantity path missing')
check(overview.includes('simpleStockDetail.physical < 0') && overview.includes('подтвердить его одним нажатием нельзя'), 'negative system quantity must require an explicit fact')
check(overview.includes('Подробнее о позиции') && overview.includes('openSimpleStockRowsDetail([microCheckDetailRow(simpleStockDetail)]'), 'full detail must remain available as an explicit second action')

check(attention.includes('async function applyQuickStocktake(countedOverride?: number)'), 'quick stocktake does not accept exact one-click override')
check(attention.includes("countedOverride === undefined ? (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') : String(countedOverride)"), 'one-click override does not share the existing CAS-protected write path')
check(attention.includes('expectedQuantity: simpleStockDetail.physical'), 'CAS expected quantity guard disappeared')

// W3.1A demand-driven Attention invalidation remains intact outside the explicitly completed check flow.
const invalidator = between(app, 'function invalidateInventoryStockCaches(includeCatalogReview = false)', 'async function loadCatalogData(force = false)')
check(invalidator.includes('warehouseAttentionSummaryCache = null') && !invalidator.includes('loadWarehouseAttention('), 'W3.1A Attention invalidation regressed')
check(!app.includes('if (postSaveShortages.length) void loadWarehouseAttention()'), 'order save unsolicited Attention read returned')

check(manifest.version === 1 && manifest.revision === 'w3-1b-stock-micro-check', 'W3.1B frontend manifest invalid')
check(Boolean(manifest.frontend?.panelReturnChanges?.renderInventoryOverviewPanel), 'W3.1B overview preservation delta missing')
check(preservation.includes('w3StockMicroCheckPath') && preservation.includes('W3.1B stock micro-check panel baseline hash mismatch'), '1906B preservation chain is not aware of W3.1B')

// Frozen Arrival UI remains untouched.
check(inventorySection.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')
check(inventorySection.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'frozen Arrival add-position action changed')

console.log('W3.1B STOCK MICRO-CHECK PASSED — concrete checks open from loaded stock, confirmation is voluntary/CAS-protected, and full detail remains explicit')
''', encoding='utf-8')

Path('docs/continuation/W3_1B_STOCK_MICRO_CHECK_20260905.md').write_text(r'''# W3.1B — Voluntary concrete stock micro-check

Date: 2026-09-05
Code base: W3.1A Production tree (`W3.1A: restore Warehouse operational reliability`)

## Goal

Let an ordinary Warehouse employee verify one concrete stock position directly from `Остатки` without first loading the recommendation engine, Warehouse Attention, reservations, catalog data, or any other extra D1 read merely to display the check.

## Human flow

- A concrete single position or expanded variant exposes `Проверить` instead of forcing `Подробнее` first.
- Opening `Проверить` uses the row already present in the stock snapshot; it performs no network/API read and no mutation.
- Normal non-negative system quantity offers:
  - `Да, на месте N` — one-click confirmation through the existing CAS-protected quick stocktake endpoint;
  - `Нет, другое количество` — explicit factual count.
- If the system physical quantity is below zero, one-click confirmation is intentionally unavailable; the employee must enter the real non-negative physical fact.
- `Подробнее о позиции` remains available as a deliberate second action. Only then can the normal detail flow load reservation/order context if needed.

## Technical changes

- `renderInventoryOverviewPanel.tsx`
  - builds the micro-check detail from the already-loaded stock row;
  - does not call inventory/Attention/reservation loaders when the check opens;
  - keeps the normal full detail drawer unchanged behind `Подробнее о позиции`;
  - no React hook/lifecycle added to the renderer.
- `useInventoryAttentionActions.ts`
  - `applyQuickStocktake` accepts an optional exact counted quantity for the one-click same-count confirmation;
  - the write still uses the existing `expectedQuantity` compare-and-set guard and existing quick-stocktake endpoint.
- `scripts/w3-1b-stock-micro-check-frontend-manifest.json`
  - records the exact accepted `renderInventoryOverviewPanel` return delta after W3.1A.
- `scripts/test-w3-1b-stock-micro-check.mjs`
  - protects no-read opening, voluntary copy, same/different paths, negative-quantity safety, explicit full-detail escalation, CAS semantics, W3.1A Attention invalidation, and frozen Arrival markers.

## Invariants / exclusions

- No D1 migration.
- No Production D1 data mutation during deploy/validation.
- No change to reservation arithmetic or physical write-off rules.
- No new automatic/mandatory count requirement.
- No background recommendation read is introduced.
- Arrival UI remains frozen.
- Branch2 is untouched.
- Existing `Короткая проверка` recommendations remain available and independent.
- Full position detail/reservation loading remains explicit rather than being preloaded for the micro-check.

## Next

Continue W3 with recovery/inbox behavior after this first concrete micro-check is accepted; do not expand the micro-check into a mandatory stocktake workflow.
''', encoding='utf-8')

print('W3.1B patch applied')
