import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const write = (rel, content) => {
  const target = path.join(root, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}
const check = (condition, message) => { if (!condition) throw new Error(message) }
const replaceOnce = (text, before, after, label) => {
  const first = text.indexOf(before)
  check(first >= 0, `W8.2 missing exact marker: ${label}`)
  check(text.indexOf(before, first + before.length) < 0, `W8.2 marker is not unique: ${label}`)
  return text.slice(0, first) + after + text.slice(first + before.length)
}
const replaceRegexOnce = (text, regex, after, label) => {
  const matches = [...text.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`))]
  check(matches.length === 1, `W8.2 regex marker ${label} matched ${matches.length} times`)
  return text.replace(regex, after)
}
const gitBlobSha = (text) => {
  const body = Buffer.from(text, 'utf8')
  const header = Buffer.from(`blob ${body.length}\0`, 'utf8')
  return crypto.createHash('sha1').update(header).update(body).digest('hex')
}

const overviewRel = 'src/features/inventory/views/renderInventoryOverviewPanel.tsx'
const inventoryRel = 'src/features/sections/InventorySection.tsx'
const overviewBaselineRel = 'scripts/fixtures/renderInventoryOverviewPanel-w8-1-baseline.tsx'
const inventoryBaselineRel = 'scripts/fixtures/InventorySection-w8-1-baseline.tsx'
const w8LayerRel = 'scripts/test-step1906b-frontend-modularization-w8-layer.mjs'
const w82LayerRel = 'scripts/test-step1906b-frontend-modularization-w8-2-layer.mjs'
const manifestRel = 'scripts/w8-2-stock-workspace-frontend-manifest.json'

let overview = read(overviewRel)
let inventory = read(inventoryRel)
const overviewBefore = overview
const inventoryBefore = inventory

check(overview.includes("import '../../../styles/w8-1-stock-overview.css'"), 'W8.1 overview baseline missing')
check(inventory.includes('const simpleStockGroups = useMemo(() => {'), 'simpleStockGroups baseline missing')
write(overviewBaselineRel, overviewBefore)
write(inventoryBaselineRel, inventoryBefore)

// 1) Search must reveal a found product even when the normal availability filter would hide it.
// Keep all query/category-matched rows attached to each product so product totals remain truthful.
inventory = replaceRegexOnce(
  inventory,
  /  const simpleStockGroups = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[inventoryStocktakeGroups, simpleStockSource, simpleStockAvailabilityFilter, simpleStockCategory, inventoryQuery\]\)\n/,
`  const simpleStockGroups = useMemo(() => {
    const result: any[] = []
    const hasExplicitStockSearch = Boolean(inventoryQuery.trim())
    for (const product of inventoryStocktakeGroups || []) {
      const productRows = product.rows || []
      const allRows = simpleStockCategory === 'all'
        ? productRows
        : productRows.filter((row: any) => (row.category || 'adult') === simpleStockCategory)
      const visibleRows = hasExplicitStockSearch ? allRows : allRows.filter((row: any) => {
        const free = simpleStockQuantity(row)
        const reserved = simpleStockReserved(row)
        const physical = simpleStockPhysical(row)
        if (simpleStockAvailabilityFilter === 'all') return physical !== 0 || reserved !== 0
        if (simpleStockAvailabilityFilter === 'free') return free > 0
        if (simpleStockAvailabilityFilter === 'reserved') return reserved > 0
        return free < 0 || physical < 0
      })
      if (!visibleRows.length) continue
      result.push({
        ...product,
        rows: visibleRows,
        allRows,
        availabilityFilterApplied: !hasExplicitStockSearch,
      })
    }
    return result
  }, [inventoryStocktakeGroups, simpleStockSource, simpleStockAvailabilityFilter, simpleStockCategory, inventoryQuery])
`,
  'simpleStockGroups search override',
)

// 2) The neutral SKU card now becomes a primary entry point, so protect reservation detail from stale responses.
inventory = replaceOnce(
  inventory,
  '  const historyRequestRef = useRef(0)\n  const [simpleStockOpenProductKey, setSimpleStockOpenProductKey] = useState(\'\')',
  '  const historyRequestRef = useRef(0)\n  const simpleStockReservationsRequestRef = useRef(0)\n  const [simpleStockOpenProductKey, setSimpleStockOpenProductKey] = useState(\'\')',
  'reservation request ref',
)
inventory = replaceRegexOnce(
  inventory,
  /  async function openSimpleStockRowsDetail\(rows: any\[\], options: \{ aggregate\?: boolean; label\?: string; source\?: 'warehouse' \| 'boutique' \} = \{\}\) \{[\s\S]*?\n  \}\n\n  const formatHistoryMoment/,
`  async function openSimpleStockRowsDetail(rows: any[], options: { aggregate?: boolean; label?: string; source?: 'warehouse' | 'boutique' } = {}) {
    if (!rows?.length) return
    const requestId = ++simpleStockReservationsRequestRef.current
    const detailSource = options.source || simpleStockSource
    const physical = rows.reduce((sum, row) => sum + (detailSource === 'warehouse' ? Number(row.warehouseQuantity || 0) : Number(row.boutiqueQuantity || 0)), 0)
    const reserved = rows.reduce((sum, row) => sum + (detailSource === 'warehouse' ? Number(row.warehouseReserved || 0) : Number(row.boutiqueReserved || 0)), 0)
    const free = rows.reduce((sum, row) => sum + (detailSource === 'warehouse' ? Number(row.warehouseAvailable ?? (Number(row.warehouseQuantity || 0) - Number(row.warehouseReserved || 0))) : Number(row.boutiqueAvailable ?? (Number(row.boutiqueQuantity || 0) - Number(row.boutiqueReserved || 0)))), 0)
    const row = rows[0]
    const variantIds = Array.from(new Set(rows.map((entry) => Number(entry.variantId || 0)).filter(Boolean)))
    const aggregate = Boolean(options.aggregate || variantIds.length !== 1)
    const detail = {
      source: detailSource,
      productId: Number(row.productId || 0),
      variantId: aggregate ? 0 : Number(variantIds[0] || 0),
      productName: row.productName,
      category: row.category,
      gender: aggregate ? '' : row.gender,
      material: aggregate ? '' : row.material,
      length: aggregate ? '' : row.length,
      size: aggregate ? '' : row.size,
      color: aggregate ? '' : row.color,
      physical,
      reserved,
      free,
      aggregate,
      label: options.label || '',
      hasDataIssue: rows.length > 1 && !aggregate,
      microCheck: false,
    }
    setSimpleStockDetail(detail)
    setQuickStocktakeOpen(false)
    setQuickStocktakeValues({})
    setQuickStocktakeNotice('')
    setSimpleStockReservations([])
    if (reserved <= 0 || (!detail.variantId && !detail.productId)) {
      setSimpleStockReservationsBusy(false)
      return
    }
    setSimpleStockReservationsBusy(true)
    try {
      const data = await loadInventoryReservations(detailSource, detail.variantId, aggregate ? detail.productId : 0)
      if (requestId !== simpleStockReservationsRequestRef.current) return
      setSimpleStockReservations(Array.isArray(data?.reservations) ? data.reservations : [])
    } catch {
      if (requestId !== simpleStockReservationsRequestRef.current) return
      setSimpleStockReservations([])
    } finally {
      if (requestId === simpleStockReservationsRequestRef.current) setSimpleStockReservationsBusy(false)
    }
  }

  const formatHistoryMoment`,
  'reservation latest-request-wins',
)

// 3) Overview becomes a coherent workspace instead of a new hierarchy inserted into an old screen.
overview = replaceOnce(
  overview,
  "import '../../../styles/w8-1-stock-overview.css'",
  "import '../../../styles/w8-1-stock-overview.css'\nimport '../../../styles/w8-2-stock-workspace.css'",
  'W8.2 CSS import',
)
overview = overview.replace('Обычно его можно закончить за пару минут.', 'Обычно её можно закончить за пару минут.')
overview = replaceRegexOnce(
  overview,
  /  const openConcreteStockCheck = \(row: any, label: string\) => \{[\s\S]*?\n  \}\n\n  const microCheckDetailRow/,
`  const openConcreteStockDetail = (row: any, label: string) => {
    void openSimpleStockRowsDetail([row], { source: simpleStockSource, label })
  }

  const microCheckDetailRow`,
  'neutral exact-SKU opener',
)

overview = replaceRegexOnce(
  overview,
  /  const visibleVariantCount = simpleStockGroups\.reduce\([\s\S]*?\n\n  return \(/,
`  const hasExplicitStockSearch = Boolean(inventoryQuery.trim())
  const visibleVariantCount = simpleStockGroups.reduce((sum: number, group: any) => sum + Number((group.rows || []).length), 0)
  const resultScopeLabel = hasExplicitStockSearch
    ? `Поиск: «${inventoryQuery.trim()}» · фильтр наличия не скрывает найденные позиции`
    : simpleStockAvailabilityFilter === 'free'
      ? 'Только позиции со свободным остатком'
      : simpleStockAvailabilityFilter === 'reserved'
        ? 'Только позиции в заказах'
        : simpleStockAvailabilityFilter === 'attention'
          ? 'Только позиции, требующие сверки'
          : 'Все позиции с остатком'
  const summaryScopeLabel = hasExplicitStockSearch
    ? 'Итог по найденным позициям'
    : simpleStockCategory === 'child'
      ? 'Итог по детским товарам'
      : simpleStockCategory === 'adult'
        ? 'Итог по взрослым товарам'
        : 'Итог по всей точке'
  const routineCountActive = Boolean((ctx as any).cycleCountData?.source === simpleStockSource || (ctx as any).cycleCountNotice)

  return (`,
  'overview scope labels',
)

overview = replaceOnce(
  overview,
  '                    <div className="inventory-calm-summary" aria-label="Краткая сводка остатков">',
  `                    <div className="inventory-stock-summary-context"><strong>${'${sourceLabel(simpleStockSource)}'}</strong><span>${'${summaryScopeLabel}'}</span></div>\n                    <div className="inventory-calm-summary" aria-label="Краткая сводка остатков">`,
  'summary scope context',
)
overview = replaceOnce(
  overview,
  '\n                    {renderRoutineCycleCountCue(ctx)}\n    \n                    <div className="inventory-calm-filters">',
  '\n                    <div className={`inventory-calm-filters ${hasExplicitStockSearch ? \'is-search-override\' : \'\'}`}>',
  'demote routine check and decorate filters',
)
overview = replaceOnce(
  overview,
  '                    </div>\n    \n                    {simpleStockAvailabilityFilter === \'all\' && !inventoryQuery.trim() ? <p className="inventory-calm-note">',
  `                    </div>\n                    ${'{hasExplicitStockSearch ? <p className="inventory-stock-filter-override">Поиск показывает найденные позиции независимо от фильтра наличия. После очистки поиска снова действует выбранный фильтр.</p> : null}'}\n    \n                    ${'{simpleStockAvailabilityFilter === \'all\' && !inventoryQuery.trim() ? <p className="inventory-calm-note">'}`,
  'search filter explanation',
)

// Honest product totals: always show the whole query/category-matched product, while detail rows may be availability-filtered.
overview = replaceOnce(
  overview,
  '                        const rows = group.rows || []\n                        const isOpen = simpleStockOpenProductKey === group.key\n                        const free = rows.reduce((sum: number, row: any) => sum + simpleStockQuantity(row), 0)\n                        const physical = rows.reduce((sum: number, row: any) => sum + simpleStockPhysical(row), 0)\n                        const reserved = rows.reduce((sum: number, row: any) => sum + simpleStockReserved(row), 0)\n                        const single = rows.length === 1\n                        const singleRow = single ? rows[0] : null',
  `                        const rows = group.rows || []\n                        const productRows = group.allRows || rows\n                        const isOpen = simpleStockOpenProductKey === group.key\n                        const free = productRows.reduce((sum: number, row: any) => sum + simpleStockQuantity(row), 0)\n                        const physical = productRows.reduce((sum: number, row: any) => sum + simpleStockPhysical(row), 0)\n                        const reserved = productRows.reduce((sum: number, row: any) => sum + simpleStockReserved(row), 0)\n                        const single = productRows.length === 1\n                        const singleRow = single ? productRows[0] : null\n                        const hiddenByAvailability = Math.max(0, productRows.length - rows.length)\n                        const hierarchy = single ? [] : buildStockBrowseHierarchy(rows, (row: any) => row.category || 'adult')`,
  'truthful product totals',
)
overview = replaceOnce(
  overview,
  '<article className={`inventory-calm-product ${needsAttention ? \'needs-attention\' : \'\'}`} key={`calm-stock-${group.key}`}>',
  '<article className={`inventory-calm-product ${needsAttention ? \'needs-attention\' : \'\'} ${isOpen ? \'is-open\' : \'\'}`} key={`calm-stock-${group.key}`}>',
  'sticky open product class',
)
overview = replaceOnce(
  overview,
  "{single ? <span>{[singlePrimary, singleSecondary].filter(Boolean).join(' · ')}</span> : <span>{rows.length} {w8Plural(rows.length, 'позиция', 'позиции', 'позиций')} в текущей выборке</span>}",
  "{single ? <span>{[singlePrimary, singleSecondary].filter(Boolean).join(' · ')}</span> : <span>{productRows.length} {w8Plural(productRows.length, 'позиция', 'позиции', 'позиций')}{hiddenByAvailability ? ` · показано ${rows.length}` : ''}</span>}",
  'product row scope wording',
)
overview = replaceOnce(
  overview,
  'onClick={() => void openSimpleStockRowsDetail(rows, { aggregate: !single, label: singlePrimary })}',
  'onClick={() => void openSimpleStockRowsDetail(productRows, { aggregate: !single, label: singlePrimary })}',
  'aggregate reservation detail truth',
)
overview = replaceOnce(
  overview,
  '<button className="secondary compact inventory-calm-detail-button warehouse-w3-micro-check-open" type="button" onClick={() => openConcreteStockCheck(singleRow, singlePrimary)}>Проверить</button>',
  '<button className="secondary compact inventory-calm-detail-button warehouse-w3-micro-check-entry" type="button" onClick={() => openConcreteStockDetail(singleRow, singlePrimary)}>Открыть позицию</button>',
  'single SKU neutral action',
)
overview = replaceOnce(
  overview,
  '>{isOpen ? \'Скрыть позиции\' : `Показать позиции (${rows.length})`}</button>',
  '>{isOpen ? \'Скрыть позиции\' : `Показать позиции (${rows.length}${hiddenByAvailability ? ` из ${productRows.length}` : \'\'})`}</button>',
  'multi-SKU shown count',
)
overview = replaceOnce(
  overview,
  '{buildStockBrowseHierarchy(rows, (row: any) => row.category || \'adult\').map((execution: any) => {',
  '{hierarchy.map((execution: any) => {',
  'reuse hierarchy once',
)
overview = replaceOnce(
  overview,
  '                                    <section className="inventory-stock-execution" key={`stock-execution-${group.key}-${execution.key}`}>',
  '                                    <section className={`inventory-stock-execution ${hierarchy.length === 1 && execution.label === \'Основное исполнение\' ? \'is-simple-execution\' : \'\'}`} key={`stock-execution-${group.key}-${execution.key}`}>',
  'adaptive execution wrapper',
)
overview = replaceOnce(
  overview,
  '                                            <section className="inventory-stock-color" key={`stock-color-${group.key}-${execution.key}-${colorGroup.key}`}>\n                                              <div className="inventory-stock-color-head">\n                                                <div><strong>{colorGroup.label}</strong><span>{colorGroup.rows.length} {w8Plural(colorGroup.rows.length, \'позиция\', \'позиции\', \'позиций\')}</span></div>\n                                                <div className={colorFree < 0 || colorPhysical < 0 ? \'needs-attention\' : \'\'}>\n                                                  <strong>{colorPhysical < 0 ? \'Сверить\' : colorFree < 0 ? `−${formatMoney(Math.abs(colorFree))}` : formatMoney(colorFree)}</strong>\n                                                  <span>свободно · на месте {formatMoney(colorPhysical)}{colorReserved > 0 ? ` · в заказах ${formatMoney(colorReserved)}` : \'\'}</span>\n                                                </div>\n                                              </div>',
  '                                            <details className={`inventory-stock-color ${execution.colors.length === 1 ? \'is-only\' : \'\'}`} key={`stock-color-${group.key}-${execution.key}-${colorGroup.key}`} open={execution.colors.length <= 3 || hasExplicitStockSearch}>\n                                              <summary className="inventory-stock-color-head">\n                                                <div><strong>{colorGroup.label}</strong><span>{colorGroup.rows.length} {w8Plural(colorGroup.rows.length, \'позиция\', \'позиции\', \'позиций\')}</span></div>\n                                                <div className={colorFree < 0 || colorPhysical < 0 ? \'needs-attention\' : \'\'}>\n                                                  <strong>{colorPhysical < 0 ? \'Сверить\' : colorFree < 0 ? `−${formatMoney(Math.abs(colorFree))}` : formatMoney(colorFree)}</strong>\n                                                  <span>свободно · на месте {formatMoney(colorPhysical)}{colorReserved > 0 ? ` · в заказах ${formatMoney(colorReserved)}` : \'\'}</span>\n                                                </div>\n                                              </summary>',
  'collapsible color groups',
)
overview = replaceOnce(
  overview,
  '                                              </div>\n                                            </section>\n                                          )',
  '                                              </div>\n                                            </details>\n                                          )',
  'close color details',
)
overview = replaceOnce(
  overview,
  'className={`inventory-stock-size-tile warehouse-w3-micro-check-open ${rowFree < 0 || rowPhysical < 0 ? \'needs-attention\' : \'\'} ${rowFree > 0 ? \'has-free\' : \'is-zero-free\'}`}',
  'className={`inventory-stock-size-tile warehouse-w3-micro-check-entry ${rowFree < 0 || rowPhysical < 0 ? \'needs-attention\' : \'\'} ${rowFree > 0 ? \'has-free\' : \'is-zero-free\'}`}',
  'SKU detail entry marker',
)
overview = replaceOnce(
  overview,
  '. Открыть проверку.`}\n                                                            onClick={() => openConcreteStockCheck(row, primary)}',
  '. Открыть позицию.`}\n                                                            onClick={() => openConcreteStockDetail(row, primary)}',
  'neutral size tile action',
)
overview = replaceOnce(
  overview,
  '<div className="empty-state inventory-calm-empty">По выбранному фильтру ничего нет. Измените фильтр или найдите товар по названию.</div>',
  '<div className="empty-state inventory-calm-empty">{hasExplicitStockSearch ? \'Поиск ничего не нашёл. Проверьте название, цвет, материал или размер.\' : \'По выбранному фильтру ничего нет. Измените фильтр или найдите товар по названию.\'}</div>',
  'search-aware empty state',
)

// Explicitly start the quick check from the neutral SKU card; keep the existing one-tap/CAS-safe check surface intact.
overview = replaceRegexOnce(
  overview,
  /                            \{!simpleStockDetail\.aggregate \? \(\n                              <section className="inventory-exact-count">[\s\S]*?                            \) : null\}/,
`                            {!simpleStockDetail.aggregate ? (
                              <section className="inventory-exact-count warehouse-w3-micro-check-entry">
                                <div>
                                  <strong>Сверить количество</strong>
                                  <div className="inventory-exact-count-note">Если хотите проверить учёт, сначала пересчитайте эту конкретную позицию физически. Само открытие карточки ничего не меняет.</div>
                                </div>
                                <button className="secondary warehouse-w3-micro-check-start" type="button" onClick={() => {
                                  setSimpleStockDetail((current: any) => current ? { ...current, microCheck: true } : current)
                                  setQuickStocktakeOpen(true)
                                  setQuickStocktakeValues({})
                                  setQuickStocktakeNotice('')
                                }}>Сверить количество</button>
                              </section>
                            ) : null}`,
  'explicit quick-check start',
)

// Routine maintenance remains available but no longer pushes the primary browse list below the fold.
overview = replaceOnce(
  overview,
  '                    </div>\n    \n                    {simpleStockDetail ? (',
  `                    </div>\n\n                    <details className="inventory-stock-routine-disclosure" open=${'{routineCountActive}'}>\n                      <summary><div><strong>Короткая проверка</strong><span>Добровольная сверка нескольких позиций, когда есть пара минут.</span></div><b>${'{routineCountActive ? \'Продолжить\' : \'Открыть\'}'}</b></summary>\n                      <div className="inventory-stock-routine-body">${'{renderRoutineCycleCountCue(ctx)}'}</div>\n                    </details>\n    \n                    ${'{simpleStockDetail ? ('}`,
  'routine check after browse list',
)

write(overviewRel, overview)
write(inventoryRel, inventory)

const css = `/* W8.2 — finish the daily stock workspace without changing inventory truth. */
.inventory-calm-head { padding-bottom: 9px; }
.inventory-calm-head p { max-width: 700px; }
.inventory-calm-toolbar { padding-bottom: 9px; }
.inventory-calm-search { min-height: 42px; }

.inventory-stock-summary-context {
  margin: 0 20px 5px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: #7b8797;
  font-size: 11px;
}
.inventory-stock-summary-context strong { color: #475569; font-size: 12px; }
.inventory-calm-summary { margin-bottom: 9px; gap: 6px; }
.inventory-calm-summary > div,
.inventory-calm-summary > details { padding: 9px 11px; }
.inventory-calm-summary strong { font-size: 19px; }
.inventory-calm-summary small { font-size: 10px; }
.inventory-calm-summary details p { font-size: 11px; }

.inventory-calm-filters { padding-bottom: 7px; }
.inventory-calm-filters.is-search-override > button:not(.is-active) { opacity: .72; }
.inventory-stock-filter-override {
  margin: -1px 20px 9px;
  padding: 7px 10px;
  border-radius: 9px;
  background: #f7f9fc;
  color: #66758a;
  font-size: 11px;
}
.inventory-stock-result-meta { margin-top: 1px; }

.inventory-calm-list { gap: 7px; }
.inventory-calm-product.is-open { overflow: visible; }
.inventory-calm-product.is-open > .inventory-calm-product-main {
  position: sticky;
  top: 8px;
  z-index: 7;
  background: rgba(255,255,255,.97);
  border-bottom: 1px solid #e6ebf1;
  box-shadow: 0 5px 13px rgba(15,23,42,.05);
  backdrop-filter: blur(7px);
}
.inventory-calm-product-name span { font-size: 11px; }
.inventory-calm-detail-button { min-width: 126px; }

.inventory-stock-hierarchy { background: #f8fafc; gap: 8px; }
.inventory-stock-execution { border-radius: 12px; }
.inventory-stock-execution.is-simple-execution {
  border-color: transparent;
  background: transparent;
  overflow: visible;
}
.inventory-stock-execution.is-simple-execution > .inventory-stock-execution-head { display: none; }
.inventory-stock-execution.is-simple-execution > .inventory-stock-color-list { border: 1px solid #dfe7f0; border-radius: 12px; background: #fff; overflow: hidden; }
.inventory-stock-execution-head > div:first-child > span { font-size: 10px; }
.inventory-stock-execution-head > div:first-child > strong { font-size: 15px; }
.inventory-stock-execution-head > div:first-child > small { font-size: 11px; }
.inventory-stock-execution-numbers > span { font-size: 11px; }
.inventory-stock-execution-numbers > small { font-size: 10px; }

.inventory-stock-color { border-top: 1px solid #edf1f5; }
.inventory-stock-color:first-child { border-top: 0; }
.inventory-stock-color > summary { list-style: none; cursor: pointer; }
.inventory-stock-color > summary::-webkit-details-marker { display: none; }
.inventory-stock-color > summary::after {
  content: '⌄';
  flex: 0 0 auto;
  margin-left: 4px;
  color: #8a96a6;
  font-size: 13px;
  transition: transform .14s ease;
}
.inventory-stock-color[open] > summary::after { transform: rotate(180deg); }
.inventory-stock-color.is-only > summary::after { visibility: hidden; }
.inventory-stock-color-head { min-height: 42px; padding-block: 9px; }
.inventory-stock-color-head > div:first-child strong { font-size: 14px; }
.inventory-stock-color-head > div:first-child span { font-size: 10px; }
.inventory-stock-color-head > div:last-child span { font-size: 10px; }
.inventory-stock-color:not([open]) > summary { background: #fbfcfe; }
.inventory-stock-color:not([open]) > .inventory-stock-subgroups { display: none; }

.inventory-stock-subgroup-label strong { font-size: 11px; }
.inventory-stock-subgroup-label span { font-size: 10px; }
.inventory-stock-size-grid { grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 7px; }
.inventory-stock-size-tile { min-height: 76px; padding: 10px 11px; }
.inventory-stock-size-value { font-size: 18px; }
.inventory-stock-size-free { font-size: 15px; }
.inventory-stock-size-free small { font-size: 9px; }
.inventory-stock-size-meta { font-size: 10px; line-height: 1.3; }

.inventory-stock-routine-disclosure {
  margin: 11px 20px 18px;
  border: 1px solid #e3e9f1;
  border-radius: 12px;
  background: #fafbfd;
  overflow: hidden;
}
.inventory-stock-routine-disclosure > summary {
  list-style: none;
  min-height: 48px;
  padding: 9px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
}
.inventory-stock-routine-disclosure > summary::-webkit-details-marker { display: none; }
.inventory-stock-routine-disclosure > summary > div { display: grid; gap: 2px; }
.inventory-stock-routine-disclosure > summary strong { color: #334155; font-size: 12px; }
.inventory-stock-routine-disclosure > summary span { color: #7b8797; font-size: 10px; }
.inventory-stock-routine-disclosure > summary b { color: #52657e; font-size: 11px; }
.inventory-stock-routine-body { border-top: 1px solid #e8edf3; padding: 8px; background: #fff; }
.inventory-stock-routine-body .inventory-cycle-count-card { margin: 0; box-shadow: none; }

.inventory-calm-detail .warehouse-w3-micro-check-entry { margin-top: 15px; }
.inventory-calm-detail .warehouse-w3-micro-check-start { align-self: flex-start; }

@media (max-width: 900px) {
  .inventory-calm-summary { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .inventory-calm-summary > details { grid-column: 1 / -1; }
  .inventory-stock-size-grid { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); }
}

@media (max-width: 720px) {
  .inventory-stock-summary-context,
  .inventory-stock-filter-override,
  .inventory-stock-routine-disclosure { margin-inline: 12px; }
  .inventory-calm-product.is-open > .inventory-calm-product-main { position: static; box-shadow: none; backdrop-filter: none; }
  .inventory-stock-color-head { align-items: flex-start; }
  .inventory-stock-color-head > div:last-child { flex-wrap: wrap; justify-content: flex-end; text-align: right; }
  .inventory-stock-size-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .inventory-stock-size-meta { white-space: normal; }
}

@media (max-width: 460px) {
  .inventory-calm-summary > div { padding: 8px; }
  .inventory-calm-summary strong { font-size: 17px; }
  .inventory-calm-summary span { font-size: 10px; }
  .inventory-calm-summary small { font-size: 9px; }
  .inventory-stock-size-grid { gap: 6px; }
  .inventory-stock-size-tile { min-height: 82px; padding: 9px; }
  .inventory-stock-size-value { font-size: 19px; }
  .inventory-stock-size-free { font-size: 14px; }
  .inventory-stock-size-meta { font-size: 9.5px; }
}
`
write('src/styles/w8-2-stock-workspace.css', css)

// W3 remains authoritative, but "open SKU" is now neutral and the count starts explicitly from inside the card.
write('scripts/test-w3-1b-stock-micro-check.mjs', `import fs from 'node:fs'\n\nconst read = (path) => fs.readFileSync(path, 'utf8')\nconst check = (condition, message) => { if (!condition) throw new Error(message) }\nconst overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')\nconst attention = read('src/features/inventory/useInventoryAttentionActions.ts')\nconst app = read('src/App.tsx')\nconst inventorySection = read('src/features/sections/InventorySection.tsx')\nconst preservation = read('scripts/test-step1906b-frontend-modularization.mjs')\nconst manifest = JSON.parse(read('scripts/w3-1b-stock-micro-check-frontend-manifest.json'))\n\ncheck(overview.includes('const openConcreteStockDetail =') && overview.includes('openSimpleStockRowsDetail([row]'), 'exact SKU must open the neutral detail card')\ncheck(overview.includes('microCheck: false'), 'opening an SKU must not silently enter count mode')\ncheck((overview.match(/warehouse-w3-micro-check-entry/g) || []).length >= 2, 'single and multi-SKU paths must expose the explicit count entry')\ncheck(overview.includes('warehouse-w3-micro-check-start') && overview.includes('microCheck: true'), 'neutral SKU detail lost the explicit quick-check start')\ncheck(overview.includes('data-w3-micro-check="true"'), 'micro-check surface missing')\ncheck(overview.includes('Это добровольная сверка этой конкретной позиции. Открытие ничего не меняет'), 'voluntary/non-mutating copy missing')\ncheck(overview.includes('Да, на месте \\${simpleStockDetail.physical}'), 'one-click same-quantity confirmation missing')\ncheck(overview.includes('Нет, другое количество'), 'alternate factual quantity path missing')\ncheck(overview.includes('simpleStockDetail.physical < 0') && overview.includes('подтвердить его одним нажатием нельзя'), 'negative system quantity must require an explicit fact')\ncheck(overview.includes('Подробнее о позиции') && overview.includes('openSimpleStockRowsDetail([microCheckDetailRow(simpleStockDetail)]'), 'full detail must remain available after a quick check')\n\ncheck(attention.includes('async function applyQuickStocktake(countedOverride?: number)'), 'quick stocktake does not accept exact one-click override')\ncheck(attention.includes("countedOverride === undefined ? (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') : String(countedOverride)"), 'one-click override does not share the existing CAS-protected write path')\ncheck(attention.includes('expectedQuantity: simpleStockDetail.physical'), 'CAS expected quantity guard disappeared')\n\nconst invalidatorStart = app.indexOf('function invalidateInventoryStockCaches(includeCatalogReview = false)')\nconst invalidatorEnd = app.indexOf('async function loadCatalogData(force = false)', invalidatorStart)\ncheck(invalidatorStart >= 0 && invalidatorEnd > invalidatorStart, 'W3.1A invalidation boundary missing')\nconst invalidator = app.slice(invalidatorStart, invalidatorEnd)\ncheck(invalidator.includes('warehouseAttentionSummaryCache = null') && !invalidator.includes('loadWarehouseAttention('), 'W3.1A Attention invalidation regressed')\ncheck(!app.includes('if (postSaveShortages.length) void loadWarehouseAttention()'), 'order save unsolicited Attention read returned')\n\ncheck(manifest.version === 1 && manifest.revision === 'w3-1b-stock-micro-check', 'W3.1B frontend manifest invalid')\ncheck(Boolean(manifest.frontend?.panelReturnChanges?.renderInventoryOverviewPanel), 'W3.1B overview preservation delta missing')\ncheck(preservation.includes('w3StockMicroCheckPath') && preservation.includes('W3.1B stock micro-check panel baseline hash mismatch'), '1906B preservation chain is not aware of W3.1B')\n\ncheck(inventorySection.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')\ncheck(inventorySection.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'frozen Arrival add-position action changed')\n\nconsole.log('W3.1B STOCK MICRO-CHECK PASSED — SKU browsing is neutral; explicit one-tap/mismatch counting stays voluntary, exact and CAS-protected')\n`)

write('scripts/test-w8-1-stock-overview-completion.mjs', `import fs from 'node:fs'\nimport path from 'node:path'\n\nconst root = process.cwd()\nconst read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')\nconst check = (ok, message) => { if (!ok) throw new Error(message) }\n\ntry {\n  const pkg = JSON.parse(read('package.json'))\n  const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')\n  const css = read('src/styles/w8-1-stock-overview.css')\n  const inventory = read('src/features/sections/InventorySection.tsx')\n  const arrivalStart = inventory.indexOf('<div className="inventory-arrival-legacy-workspace">')\n  const arrivalButton = '<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'\n\n  check(String(pkg.scripts?.['release:check'] || '').includes('test-w8-1-stock-overview-completion.mjs'), 'W8.1 regression is not chained into release:check')\n  check(overview.includes("import '../../../styles/w8-1-stock-overview.css'"), 'W8.1 visual layer is not owned by Overview')\n  check(overview.includes('data-w8-stock-hierarchy="execution-color-size"'), 'Execution -> color -> size hierarchy missing')\n  for (const marker of ['Основное исполнение', 'inventory-stock-execution', 'inventory-stock-color', 'inventory-stock-size-grid', 'inventory-stock-size-tile']) {\n    check(overview.includes(marker), \\`W8.1 Overview marker missing: \\${marker}\\`)\n  }\n  check(overview.includes('inventory-stock-size-value') && overview.includes("subgroup.category === 'child' ? '— возраст' : '— размер'"), 'Size/age is not the primary tile discriminator')\n  check(overview.includes('inventory-stock-size-free') && overview.includes('inventory-stock-size-meta'), 'Exact SKU tile lost free/physical/reserved hierarchy')\n  check(overview.includes('data-variant-id={row.variantId}') && overview.includes('openConcreteStockDetail(row, primary)'), 'Exact SKU identity/detail path disappeared from stock tile')\n  check(overview.includes('warehouse-w3-micro-check-start') && overview.includes('Да, на месте \\${simpleStockDetail.physical}'), 'W8.1 exact safe check is no longer reachable from the SKU detail')\n  check(overview.includes('inventory-stock-result-meta'), 'Filtered-result scope is not explicit')\n  check(overview.includes('Да, на месте {row.physical}') && overview.includes('Нет, другое количество'), 'Routine one-tap confirmation changed')\n  check(overview.includes('needsIndependentCount') && overview.includes('Сначала посчитайте физически'), 'Blind-first risky count changed')\n  check(!overview.includes('loadInventoryData(') && !overview.includes('loadInventoryCycleCounts('), 'Overview introduced a new inventory/cycle read path')\n  check(!overview.includes('saveInventoryMovement') && !overview.includes('quickInventoryStocktake'), 'Overview introduced a new direct write path')\n  check(css.includes('grid-template-columns: repeat(3, minmax(0, 1fr))') && css.includes('min-height: 78px'), 'Phone size tiles are not large/readable enough')\n  check(css.includes('.inventory-stock-size-tile.needs-attention') && css.includes('.inventory-stock-size-tile.has-free'), 'Stock tile states are not visually differentiated')\n  check(arrivalStart >= 0 && inventory.indexOf(arrivalButton, arrivalStart) > arrivalStart, 'Frozen Arrival structure changed')\n\n  console.log('W8.1 STOCK OVERVIEW COMPLETION PASSED — exact stock truth and execution/color/size browsing remain preserved under later workspace polish')\n} catch (error) {\n  console.error(\\`W8.1 STOCK OVERVIEW COMPLETION FAILED: \\${error?.message || error}\\`)\n  process.exit(1)\n}\n`)

write('scripts/test-w8-2-stock-workspace-finish.mjs', `import fs from 'node:fs'\nimport path from 'node:path'\n\nconst root = process.cwd()\nconst read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')\nconst check = (ok, message) => { if (!ok) throw new Error(message) }\n\ntry {\n  const pkg = JSON.parse(read('package.json'))\n  const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')\n  const inventory = read('src/features/sections/InventorySection.tsx')\n  const css = read('src/styles/w8-2-stock-workspace.css')\n\n  check(String(pkg.scripts?.['release:check'] || '').includes('test-w8-2-stock-workspace-finish.mjs'), 'W8.2 regression is not chained into release:check')\n  check(overview.includes("import '../../../styles/w8-2-stock-workspace.css'"), 'W8.2 CSS is not owned by Overview')\n  check(inventory.includes('const hasExplicitStockSearch = Boolean(inventoryQuery.trim())'), 'explicit stock search override missing')\n  check(inventory.includes('const visibleRows = hasExplicitStockSearch ? allRows : allRows.filter'), 'availability filter still hides explicit search results')\n  check(inventory.includes('allRows,') && inventory.includes('availabilityFilterApplied: !hasExplicitStockSearch'), 'product truth scope is not carried into Overview')\n  check(overview.includes('filter availability does not hide') || overview.includes('фильтр наличия не скрывает найденные позиции'), 'search/filter truth is not explained')\n  check(overview.includes('const productRows = group.allRows || rows') && overview.includes('hiddenByAvailability'), 'product totals still pretend filtered rows are the whole product')\n  check(overview.includes('Открыть позицию') && overview.includes('openConcreteStockDetail'), 'SKU tile is not a neutral detail entry')\n  check(overview.includes('microCheck: false') || inventory.includes('microCheck: false'), 'opening a detail still silently starts a check')\n  check(overview.includes('warehouse-w3-micro-check-start') && overview.includes('microCheck: true'), 'explicit quick-check action is missing from neutral SKU card')\n  check(overview.indexOf('inventory-stock-routine-disclosure') > overview.indexOf('inventory-calm-list'), 'routine check still precedes the primary stock list')\n  check(overview.includes('is-simple-execution') && overview.includes('execution.colors.length <= 3 || hasExplicitStockSearch'), 'large products are not adaptively compact/collapsible')\n  check(overview.includes("${'${isOpen ? \'is-open\' : \'\'}'}"), 'open product sticky context marker missing')\n  check(inventory.includes('simpleStockReservationsRequestRef') && inventory.includes('requestId !== simpleStockReservationsRequestRef.current'), 'reservation detail is not latest-request-wins safe')\n  check(css.includes('.inventory-calm-product.is-open > .inventory-calm-product-main') && css.includes('position: sticky'), 'desktop product context is not sticky')\n  check(css.includes('.inventory-stock-color:not([open]) > .inventory-stock-subgroups') && css.includes('display: none'), 'collapsed colors do not actually reduce long product pages')\n  check(css.includes('.inventory-stock-size-value { font-size: 18px') && css.includes('.inventory-stock-size-meta { font-size: 10px'), 'size/meta readability was not improved')\n  check(!overview.includes('saveInventoryMovement') && !overview.includes('quickInventoryStocktake'), 'W8.2 introduced a direct mutation path into presentation')\n  check(inventory.includes('<div className="inventory-arrival-legacy-workspace">'), 'Arrival workspace changed')\n\n  console.log('W8.2 STOCK WORKSPACE FINISH PASSED — search is honest, product totals are truthful, SKU browsing is neutral, large products stay navigable and reservation detail is race-safe')\n} catch (error) {\n  console.error(\\`W8.2 STOCK WORKSPACE FINISH FAILED: \\${error?.message || error}\\`)\n  process.exit(1)\n}\n`)

// Add W8.2 to cumulative release gate.
const pkg = JSON.parse(read('package.json'))
const release = String(pkg.scripts?.['release:check'] || '')
check(release.includes('test-w8-1-stock-overview-completion.mjs'), 'W8.1 release gate marker missing')
if (!release.includes('test-w8-2-stock-workspace-finish.mjs')) {
  pkg.scripts['release:check'] = `${release} && node scripts/test-w8-2-stock-workspace-finish.mjs`
}
write('package.json', `${JSON.stringify(pkg, null, 2)}\n`)

// Exact W8.2 preservation layer over the W8.1 baseline.
const manifest = {
  version: 1,
  revision: 'w8-2-stock-workspace-finish',
  files: {
    [overviewRel]: { beforeGitBlob: gitBlobSha(overviewBefore), afterGitBlob: gitBlobSha(overview) },
    [inventoryRel]: { beforeGitBlob: gitBlobSha(inventoryBefore), afterGitBlob: gitBlobSha(inventory) },
  },
}
write(manifestRel, `${JSON.stringify(manifest, null, 2)}\n`)
write(w82LayerRel, `import fs from 'node:fs'\nimport path from 'node:path'\nimport crypto from 'node:crypto'\nimport { spawnSync } from 'node:child_process'\n\nconst root = process.cwd()\nconst overviewPath = path.join(root, '${overviewRel}')\nconst inventoryPath = path.join(root, '${inventoryRel}')\nconst baselineOverviewPath = path.join(root, '${overviewBaselineRel}')\nconst baselineInventoryPath = path.join(root, '${inventoryBaselineRel}')\nconst priorLayerPath = path.join(root, '${w8LayerRel}')\nconst manifestPath = path.join(root, '${manifestRel}')\nconst fail = (message) => { throw new Error(message) }\nconst check = (condition, message) => { if (!condition) fail(message) }\nconst gitBlobSha = (text) => { const body = Buffer.from(text, 'utf8'); const header = Buffer.from(\\`blob \\${body.length}\\0\\`, 'utf8'); return crypto.createHash('sha1').update(header).update(body).digest('hex') }\n\ntry {\n  for (const required of [overviewPath, inventoryPath, baselineOverviewPath, baselineInventoryPath, priorLayerPath, manifestPath]) check(fs.existsSync(required), \\`W8.2 frontend structural file missing: \\${path.relative(root, required)}\\`)\n  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))\n  const expectedFiles = ['${overviewRel}', '${inventoryRel}']\n  check(manifest?.version === 1 && manifest?.revision === 'w8-2-stock-workspace-finish', 'W8.2 frontend manifest invalid')\n  check(JSON.stringify(Object.keys(manifest.files || {})) === JSON.stringify(expectedFiles), 'W8.2 frontend file allow-list widened unexpectedly')\n  const currentOverview = fs.readFileSync(overviewPath, 'utf8')\n  const currentInventory = fs.readFileSync(inventoryPath, 'utf8')\n  const baselineOverview = fs.readFileSync(baselineOverviewPath, 'utf8')\n  const baselineInventory = fs.readFileSync(baselineInventoryPath, 'utf8')\n  check(gitBlobSha(baselineOverview) === manifest.files[expectedFiles[0]].beforeGitBlob, 'W8.2 frozen Overview is not exact W8.1 baseline')\n  check(gitBlobSha(baselineInventory) === manifest.files[expectedFiles[1]].beforeGitBlob, 'W8.2 frozen InventorySection is not exact W8.1 baseline')\n  check(gitBlobSha(currentOverview) === manifest.files[expectedFiles[0]].afterGitBlob, 'W8.2 Overview changed beyond exact manifest')\n  check(gitBlobSha(currentInventory) === manifest.files[expectedFiles[1]].afterGitBlob, 'W8.2 InventorySection changed beyond exact manifest')\n  check(currentOverview.includes('openConcreteStockDetail') && currentOverview.includes('inventory-stock-routine-disclosure'), 'W8.2 Overview markers missing')\n  check(currentInventory.includes('simpleStockReservationsRequestRef') && currentInventory.includes('hasExplicitStockSearch'), 'W8.2 controller markers missing')\n\n  fs.writeFileSync(overviewPath, baselineOverview)\n  fs.writeFileSync(inventoryPath, baselineInventory)\n  let result\n  try {\n    result = spawnSync(process.execPath, [priorLayerPath], { cwd: root, stdio: 'inherit', shell: false, windowsHide: true })\n  } finally {\n    fs.writeFileSync(overviewPath, currentOverview)\n    fs.writeFileSync(inventoryPath, currentInventory)\n  }\n  if (result?.error) fail(\\`W8.1 preservation layer could not run under W8.2 baseline: \\${result.error.message}\\`)\n  check(result?.status === 0, \\`W8.1 preservation layer failed with code \\${result?.status}\\`)\n  check(fs.readFileSync(overviewPath, 'utf8') === currentOverview && fs.readFileSync(inventoryPath, 'utf8') === currentInventory, 'W8.2 structural gate failed to restore current files')\n  console.log('W8.2 FRONTEND STRUCTURAL LAYER PASSED — W8.1 baseline preserved; exact stock-workspace + reservation-race delta accepted')\n} catch (error) {\n  console.error(\\`W8.2 FRONTEND STRUCTURAL LAYER FAILED: \\${error?.message || error}\\`)\n  process.exit(1)\n}\n`)

let structuralIndex = read('scripts/test-step1906b-frontend-modularization.mjs')
structuralIndex = replaceOnce(
  structuralIndex,
  "// w8StockOverviewPath — W8.1 stock overview completion preservation layer\nawait import('./test-step1906b-frontend-modularization-w8-layer.mjs')",
  "// w8StockOverviewPath — W8.1 stock overview completion preservation layer\n// w8StockWorkspaceFinishPath — W8.2 stock workspace finish preservation layer\nawait import('./test-step1906b-frontend-modularization-w8-2-layer.mjs')",
  '1906B W8.2 chain',
)
write('scripts/test-step1906b-frontend-modularization.mjs', structuralIndex)

const continuation = `# W8.2 — Stock workspace finish — 2026-09-06\n\n## Scope\n\nW8.2 finishes the daily \\`Остатки\\` workspace around the W8.1 execution/color/size hierarchy. It does not change Warehouse business truth.\n\n- explicit search takes precedence over the normal availability filter so an existing SKU cannot appear missing merely because it has zero free stock or is fully reserved;\n- product header totals use the whole query/category-matched product while the disclosure states when only a subset of positions is shown by the availability filter;\n- SKU click is neutral information first; counting starts only after the explicit \\`Сверить количество\\` action and reuses the existing CAS-protected quick-check path;\n- routine short checks move below the primary browse list and stay optional;\n- one ordinary \\`Основное исполнение\\` no longer adds a heavy empty hierarchy level; large color sets are collapsible, and expanded desktop products keep sticky context;\n- the reservation detail read is latest-request-wins so a slow response for a previously opened SKU cannot overwrite a newer SKU card.\n\n## Safety boundaries\n\nNo migration. No Production D1 mutation/read for deployment. No Worker/API or Physical/Reserved/Available arithmetic change. Catalog, Arrival and Branch2 remain untouched. No pricing implementation.\n\n## Next\n\nContinue W8 across the remaining daily Warehouse surfaces (Operations, Check/Stocktake, History, Attention/recovery) without reopening closed business semantics unless a concrete defect is proven. After W8 is closed, W9 is a full Warehouse audit/discussion pass: cross-workflow truth, UX, hidden defects, performance/D1 cost, mobile/desktop behavior and unresolved product decisions should be reviewed together before another broad change wave.\n`
write('docs/continuation/W8_2_STOCK_WORKSPACE_FINISH_20260906.md', continuation)

let currentContext = read('docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md')
const checkpoint = `## Checkpoint 2026-09-06 — W8.2 \\`Остатки\\` workspace finish\n\nW8.2 continues W8.1 instead of declaring \\`Остатки\\` complete prematurely. Explicit search now reveals all matching SKU rows regardless of the normal availability filter; product-level totals stay truthful when the filter hides some variants; exact SKU opening is neutral and the physical check is a separate explicit action; routine short checks no longer precede the main stock list; large products collapse color groups and keep better context; reservation-detail loading is latest-request-wins. Business truth and D1 mutation paths remain unchanged.\n\nAfter the remaining W8 interface passes are finished, W9 is reserved for a full Warehouse audit and discussion before another broad implementation wave.\n\n---\n\n`
check(currentContext.includes('## Checkpoint 2026-09-06 — W8.1'), 'Warehouse context W8.1 checkpoint missing')
currentContext = currentContext.replace('## Checkpoint 2026-09-06 — W8.1', `${checkpoint}## Checkpoint 2026-09-06 — W8.1`)
write('docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md', currentContext)

console.log('W8.2 apply complete')
console.log(`Overview ${gitBlobSha(overviewBefore)} -> ${gitBlobSha(overview)}`)
console.log(`InventorySection ${gitBlobSha(inventoryBefore)} -> ${gitBlobSha(inventory)}`)
