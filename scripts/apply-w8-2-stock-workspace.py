from pathlib import Path
import hashlib
import json
import re

ROOT = Path.cwd()

def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding='utf-8')

def write(rel: str, content: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')

def check(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)

def replace_once(text: str, before: str, after: str, label: str) -> str:
    count = text.count(before)
    check(count == 1, f'W8.2 marker {label!r} matched {count} times')
    return text.replace(before, after, 1)

def regex_once(text: str, pattern: str, after: str, label: str) -> str:
    result, count = re.subn(pattern, after, text, count=1, flags=re.S)
    check(count == 1, f'W8.2 regex {label!r} matched {count} times')
    return result

def git_blob_sha(text: str) -> str:
    body = text.encode('utf-8')
    return hashlib.sha1(f'blob {len(body)}\0'.encode('utf-8') + body).hexdigest()

overview_rel = 'src/features/inventory/views/renderInventoryOverviewPanel.tsx'
inventory_rel = 'src/features/sections/InventorySection.tsx'
overview_baseline_rel = 'scripts/fixtures/renderInventoryOverviewPanel-w8-1-baseline.tsx'
inventory_baseline_rel = 'scripts/fixtures/InventorySection-w8-1-baseline.tsx'
w8_layer_rel = 'scripts/test-step1906b-frontend-modularization-w8-layer.mjs'
w82_layer_rel = 'scripts/test-step1906b-frontend-modularization-w8-2-layer.mjs'
manifest_rel = 'scripts/w8-2-stock-workspace-frontend-manifest.json'

overview = read(overview_rel)
inventory = read(inventory_rel)
overview_before = overview
inventory_before = inventory

check("import '../../../styles/w8-1-stock-overview.css'" in overview, 'W8.1 Overview baseline missing')
check('const simpleStockGroups = useMemo(() => {' in inventory, 'simpleStockGroups baseline missing')
write(overview_baseline_rel, overview_before)
write(inventory_baseline_rel, inventory_before)

# Search overrides the availability filter; product totals still get all rows matched by query/category.
inventory = regex_once(
    inventory,
    r"  const simpleStockGroups = useMemo\(\(\) => \{.*?\n  \}, \[inventoryStocktakeGroups, simpleStockSource, simpleStockAvailabilityFilter, simpleStockCategory, inventoryQuery\]\)\n",
    r'''  const simpleStockGroups = useMemo(() => {
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
''',
    'simpleStockGroups search override',
)

# Reservation detail will be used much more often from the neutral SKU card; make it latest-request-wins.
inventory = replace_once(
    inventory,
    "  const historyRequestRef = useRef(0)\n  const [simpleStockOpenProductKey, setSimpleStockOpenProductKey] = useState('')",
    "  const historyRequestRef = useRef(0)\n  const simpleStockReservationsRequestRef = useRef(0)\n  const [simpleStockOpenProductKey, setSimpleStockOpenProductKey] = useState('')",
    'reservation request ref',
)
inventory = regex_once(
    inventory,
    r"  async function openSimpleStockRowsDetail\(rows: any\[\], options: \{ aggregate\?: boolean; label\?: string; source\?: 'warehouse' \| 'boutique' \} = \{\}\) \{.*?\n  \}\n\n  const formatHistoryMoment",
    r'''  async function openSimpleStockRowsDetail(rows: any[], options: { aggregate?: boolean; label?: string; source?: 'warehouse' | 'boutique' } = {}) {
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

  const formatHistoryMoment''',
    'reservation latest-request-wins',
)

# W8.2 presentation layer.
overview = replace_once(
    overview,
    "import '../../../styles/w8-1-stock-overview.css'",
    "import '../../../styles/w8-1-stock-overview.css'\nimport '../../../styles/w8-2-stock-workspace.css'",
    'W8.2 CSS import',
)
overview = overview.replace('Обычно его можно закончить за пару минут.', 'Обычно её можно закончить за пару минут.')
overview = regex_once(
    overview,
    r"  const openConcreteStockCheck = \(row: any, label: string\) => \{.*?\n  \}\n\n  const microCheckDetailRow",
    r'''  const openConcreteStockDetail = (row: any, label: string) => {
    void openSimpleStockRowsDetail([row], { source: simpleStockSource, label })
  }

  const microCheckDetailRow''',
    'neutral exact-SKU opener',
)
overview = regex_once(
    overview,
    r"  const visibleVariantCount = simpleStockGroups\.reduce\(.*?\n\n  return \(",
    r'''  const hasExplicitStockSearch = Boolean(inventoryQuery.trim())
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

  return (''',
    'overview scope labels',
)
overview = replace_once(
    overview,
    '                    <div className="inventory-calm-summary" aria-label="Краткая сводка остатков">',
    '                    <div className="inventory-stock-summary-context"><strong>{sourceLabel(simpleStockSource)}</strong><span>{summaryScopeLabel}</span></div>\n                    <div className="inventory-calm-summary" aria-label="Краткая сводка остатков">',
    'summary scope context',
)
overview = replace_once(
    overview,
    '\n                    {renderRoutineCycleCountCue(ctx)}\n    \n                    <div className="inventory-calm-filters">',
    '\n                    <div className={`inventory-calm-filters ${hasExplicitStockSearch ? \'is-search-override\' : \'\'}`}>',
    'demote routine check',
)
overview = replace_once(
    overview,
    "                    </div>\n    \n                    {simpleStockAvailabilityFilter === 'all' && !inventoryQuery.trim() ? <p className=\"inventory-calm-note\">",
    "                    </div>\n                    {hasExplicitStockSearch ? <p className=\"inventory-stock-filter-override\">Поиск показывает найденные позиции независимо от фильтра наличия. После очистки поиска снова действует выбранный фильтр.</p> : null}\n    \n                    {simpleStockAvailabilityFilter === 'all' && !inventoryQuery.trim() ? <p className=\"inventory-calm-note\">",
    'search filter explanation',
)

overview = replace_once(
    overview,
    '''                        const rows = group.rows || []
                        const isOpen = simpleStockOpenProductKey === group.key
                        const free = rows.reduce((sum: number, row: any) => sum + simpleStockQuantity(row), 0)
                        const physical = rows.reduce((sum: number, row: any) => sum + simpleStockPhysical(row), 0)
                        const reserved = rows.reduce((sum: number, row: any) => sum + simpleStockReserved(row), 0)
                        const single = rows.length === 1
                        const singleRow = single ? rows[0] : null''',
    '''                        const rows = group.rows || []
                        const productRows = group.allRows || rows
                        const isOpen = simpleStockOpenProductKey === group.key
                        const free = productRows.reduce((sum: number, row: any) => sum + simpleStockQuantity(row), 0)
                        const physical = productRows.reduce((sum: number, row: any) => sum + simpleStockPhysical(row), 0)
                        const reserved = productRows.reduce((sum: number, row: any) => sum + simpleStockReserved(row), 0)
                        const single = productRows.length === 1
                        const singleRow = single ? productRows[0] : null
                        const hiddenByAvailability = Math.max(0, productRows.length - rows.length)
                        const hierarchy = single ? [] : buildStockBrowseHierarchy(rows, (row: any) => row.category || 'adult')''',
    'truthful product totals',
)
overview = replace_once(
    overview,
    "<article className={`inventory-calm-product ${needsAttention ? 'needs-attention' : ''}`} key={`calm-stock-${group.key}`}>",
    "<article className={`inventory-calm-product ${needsAttention ? 'needs-attention' : ''} ${isOpen ? 'is-open' : ''}`} key={`calm-stock-${group.key}`}>",
    'sticky open product class',
)
overview = replace_once(
    overview,
    "{single ? <span>{[singlePrimary, singleSecondary].filter(Boolean).join(' · ')}</span> : <span>{rows.length} {w8Plural(rows.length, 'позиция', 'позиции', 'позиций')} в текущей выборке</span>}",
    "{single ? <span>{[singlePrimary, singleSecondary].filter(Boolean).join(' · ')}</span> : <span>{productRows.length} {w8Plural(productRows.length, 'позиция', 'позиции', 'позиций')}{hiddenByAvailability ? ` · показано ${rows.length}` : ''}</span>}",
    'product scope wording',
)
overview = replace_once(
    overview,
    'onClick={() => void openSimpleStockRowsDetail(rows, { aggregate: !single, label: singlePrimary })}',
    'onClick={() => void openSimpleStockRowsDetail(productRows, { aggregate: !single, label: singlePrimary })}',
    'aggregate reservation detail',
)
overview = replace_once(
    overview,
    '<button className="secondary compact inventory-calm-detail-button warehouse-w3-micro-check-open" type="button" onClick={() => openConcreteStockCheck(singleRow, singlePrimary)}>Проверить</button>',
    '<button className="secondary compact inventory-calm-detail-button warehouse-w3-micro-check-entry" type="button" onClick={() => openConcreteStockDetail(singleRow, singlePrimary)}>Открыть позицию</button>',
    'single SKU neutral action',
)
overview = replace_once(
    overview,
    ">{isOpen ? 'Скрыть позиции' : `Показать позиции (${rows.length})`}</button>",
    ">{isOpen ? 'Скрыть позиции' : `Показать позиции (${rows.length}${hiddenByAvailability ? ` из ${productRows.length}` : ''})`}</button>",
    'multi SKU shown count',
)
overview = replace_once(
    overview,
    "{buildStockBrowseHierarchy(rows, (row: any) => row.category || 'adult').map((execution: any) => {",
    '{hierarchy.map((execution: any) => {',
    'reuse hierarchy',
)
overview = replace_once(
    overview,
    '<section className="inventory-stock-execution" key={`stock-execution-${group.key}-${execution.key}`}>',
    "<section className={`inventory-stock-execution ${hierarchy.length === 1 && execution.label === 'Основное исполнение' ? 'is-simple-execution' : ''}`} key={`stock-execution-${group.key}-${execution.key}`}>",
    'adaptive execution wrapper',
)
color_head_before = '''                                            <section className="inventory-stock-color" key={`stock-color-${group.key}-${execution.key}-${colorGroup.key}`}>
                                              <div className="inventory-stock-color-head">
                                                <div><strong>{colorGroup.label}</strong><span>{colorGroup.rows.length} {w8Plural(colorGroup.rows.length, 'позиция', 'позиции', 'позиций')}</span></div>
                                                <div className={colorFree < 0 || colorPhysical < 0 ? 'needs-attention' : ''}>
                                                  <strong>{colorPhysical < 0 ? 'Сверить' : colorFree < 0 ? `−${formatMoney(Math.abs(colorFree))}` : formatMoney(colorFree)}</strong>
                                                  <span>свободно · на месте {formatMoney(colorPhysical)}{colorReserved > 0 ? ` · в заказах ${formatMoney(colorReserved)}` : ''}</span>
                                                </div>
                                              </div>'''
color_head_after = '''                                            <details className={`inventory-stock-color ${execution.colors.length === 1 ? 'is-only' : ''}`} key={`stock-color-${group.key}-${execution.key}-${colorGroup.key}`} open={execution.colors.length <= 3 || hasExplicitStockSearch}>
                                              <summary className="inventory-stock-color-head">
                                                <div><strong>{colorGroup.label}</strong><span>{colorGroup.rows.length} {w8Plural(colorGroup.rows.length, 'позиция', 'позиции', 'позиций')}</span></div>
                                                <div className={colorFree < 0 || colorPhysical < 0 ? 'needs-attention' : ''}>
                                                  <strong>{colorPhysical < 0 ? 'Сверить' : colorFree < 0 ? `−${formatMoney(Math.abs(colorFree))}` : formatMoney(colorFree)}</strong>
                                                  <span>свободно · на месте {formatMoney(colorPhysical)}{colorReserved > 0 ? ` · в заказах ${formatMoney(colorReserved)}` : ''}</span>
                                                </div>
                                              </summary>'''
overview = replace_once(overview, color_head_before, color_head_after, 'collapsible color groups')
overview = replace_once(
    overview,
    '''                                              </div>
                                            </section>
                                          )''',
    '''                                              </div>
                                            </details>
                                          )''',
    'close color details',
)
overview = replace_once(
    overview,
    "className={`inventory-stock-size-tile warehouse-w3-micro-check-open ${rowFree < 0 || rowPhysical < 0 ? 'needs-attention' : ''} ${rowFree > 0 ? 'has-free' : 'is-zero-free'}`}",
    "className={`inventory-stock-size-tile warehouse-w3-micro-check-entry ${rowFree < 0 || rowPhysical < 0 ? 'needs-attention' : ''} ${rowFree > 0 ? 'has-free' : 'is-zero-free'}`}",
    'SKU detail entry marker',
)
overview = replace_once(
    overview,
    '. Открыть проверку.`}\n                                                            onClick={() => openConcreteStockCheck(row, primary)}',
    '. Открыть позицию.`}\n                                                            onClick={() => openConcreteStockDetail(row, primary)}',
    'neutral size tile action',
)
overview = replace_once(
    overview,
    '<div className="empty-state inventory-calm-empty">По выбранному фильтру ничего нет. Измените фильтр или найдите товар по названию.</div>',
    "<div className=\"empty-state inventory-calm-empty\">{hasExplicitStockSearch ? 'Поиск ничего не нашёл. Проверьте название, цвет, материал или размер.' : 'По выбранному фильтру ничего нет. Измените фильтр или найдите товар по названию.'}</div>",
    'search-aware empty state',
)

# Replace the old neutral detail's manual-input-first block with an explicit transition into the existing one-tap quick-check mode.
overview = regex_once(
    overview,
    r'''                            \{!simpleStockDetail\.aggregate \? \(\n                              <section className="inventory-exact-count">.*?                            \) : null\}''',
    r'''                            {!simpleStockDetail.aggregate ? (
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
                            ) : null}''',
    'explicit quick-check start',
)

# Put the voluntary routine maintenance after the browse list.
overview = replace_once(
    overview,
    '                    </div>\n    \n                    {simpleStockDetail ? (',
    '''                    </div>

                    <details className="inventory-stock-routine-disclosure" open={routineCountActive}>
                      <summary><div><strong>Короткая проверка</strong><span>Добровольная сверка нескольких позиций, когда есть пара минут.</span></div><b>{routineCountActive ? 'Продолжить' : 'Открыть'}</b></summary>
                      <div className="inventory-stock-routine-body">{renderRoutineCycleCountCue(ctx)}</div>
                    </details>
    
                    {simpleStockDetail ? (''',
    'routine check after browse list',
)

write(overview_rel, overview)
write(inventory_rel, inventory)

css = r'''/* W8.2 — finish the daily stock workspace without changing inventory truth. */
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
'''
write('src/styles/w8-2-stock-workspace.css', css)

w3_test = r'''import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
const attention = read('src/features/inventory/useInventoryAttentionActions.ts')
const app = read('src/App.tsx')
const inventorySection = read('src/features/sections/InventorySection.tsx')
const preservation = read('scripts/test-step1906b-frontend-modularization.mjs')
const manifest = JSON.parse(read('scripts/w3-1b-stock-micro-check-frontend-manifest.json'))

check(overview.includes('const openConcreteStockDetail =') && overview.includes('openSimpleStockRowsDetail([row]'), 'exact SKU must open the neutral detail card')
check(inventorySection.includes('microCheck: false'), 'opening an SKU must not silently enter count mode')
check((overview.match(/warehouse-w3-micro-check-entry/g) || []).length >= 2, 'single and multi-SKU paths must expose the explicit count entry')
check(overview.includes('warehouse-w3-micro-check-start') && overview.includes('microCheck: true'), 'neutral SKU detail lost the explicit quick-check start')
check(overview.includes('data-w3-micro-check="true"'), 'micro-check surface missing')
check(overview.includes('Это добровольная сверка этой конкретной позиции. Открытие ничего не меняет'), 'voluntary/non-mutating copy missing')
check(overview.includes('Да, на месте ${simpleStockDetail.physical}'), 'one-click same-quantity confirmation missing')
check(overview.includes('Нет, другое количество'), 'alternate factual quantity path missing')
check(overview.includes('simpleStockDetail.physical < 0') && overview.includes('подтвердить его одним нажатием нельзя'), 'negative system quantity must require an explicit fact')
check(overview.includes('Подробнее о позиции') && overview.includes('openSimpleStockRowsDetail([microCheckDetailRow(simpleStockDetail)]'), 'full detail must remain available after a quick check')

check(attention.includes('async function applyQuickStocktake(countedOverride?: number)'), 'quick stocktake does not accept exact one-click override')
check(attention.includes("countedOverride === undefined ? (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') : String(countedOverride)"), 'one-click override does not share the existing CAS-protected write path')
check(attention.includes('expectedQuantity: simpleStockDetail.physical'), 'CAS expected quantity guard disappeared')

const invalidatorStart = app.indexOf('function invalidateInventoryStockCaches(includeCatalogReview = false)')
const invalidatorEnd = app.indexOf('async function loadCatalogData(force = false)', invalidatorStart)
check(invalidatorStart >= 0 && invalidatorEnd > invalidatorStart, 'W3.1A invalidation boundary missing')
const invalidator = app.slice(invalidatorStart, invalidatorEnd)
check(invalidator.includes('warehouseAttentionSummaryCache = null') && !invalidator.includes('loadWarehouseAttention('), 'W3.1A Attention invalidation regressed')
check(!app.includes('if (postSaveShortages.length) void loadWarehouseAttention()'), 'order save unsolicited Attention read returned')

check(manifest.version === 1 && manifest.revision === 'w3-1b-stock-micro-check', 'W3.1B frontend manifest invalid')
check(Boolean(manifest.frontend?.panelReturnChanges?.renderInventoryOverviewPanel), 'W3.1B overview preservation delta missing')
check(preservation.includes('w3StockMicroCheckPath') && preservation.includes('W3.1B stock micro-check panel baseline hash mismatch'), '1906B preservation chain is not aware of W3.1B')
check(inventorySection.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')
check(inventorySection.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'frozen Arrival add-position action changed')

console.log('W3.1B STOCK MICRO-CHECK PASSED — SKU browsing is neutral; explicit one-tap/mismatch counting stays voluntary, exact and CAS-protected')
'''
write('scripts/test-w3-1b-stock-micro-check.mjs', w3_test)

w81_test = r'''import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  const pkg = JSON.parse(read('package.json'))
  const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
  const css = read('src/styles/w8-1-stock-overview.css')
  const inventory = read('src/features/sections/InventorySection.tsx')
  const arrivalStart = inventory.indexOf('<div className="inventory-arrival-legacy-workspace">')
  const arrivalButton = '<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'

  check(String(pkg.scripts?.['release:check'] || '').includes('test-w8-1-stock-overview-completion.mjs'), 'W8.1 regression is not chained into release:check')
  check(overview.includes("import '../../../styles/w8-1-stock-overview.css'"), 'W8.1 visual layer is not owned by Overview')
  check(overview.includes('data-w8-stock-hierarchy="execution-color-size"'), 'Execution -> color -> size hierarchy missing')
  for (const marker of ['Основное исполнение', 'inventory-stock-execution', 'inventory-stock-color', 'inventory-stock-size-grid', 'inventory-stock-size-tile']) {
    check(overview.includes(marker), `W8.1 Overview marker missing: ${marker}`)
  }
  check(overview.includes('inventory-stock-size-value') && overview.includes("subgroup.category === 'child' ? '— возраст' : '— размер'"), 'Size/age is not the primary tile discriminator')
  check(overview.includes('inventory-stock-size-free') && overview.includes('inventory-stock-size-meta'), 'Exact SKU tile lost free/physical/reserved hierarchy')
  check(overview.includes('data-variant-id={row.variantId}') && overview.includes('openConcreteStockDetail(row, primary)'), 'Exact SKU identity/detail path disappeared from stock tile')
  check(overview.includes('warehouse-w3-micro-check-start') && overview.includes('Да, на месте ${simpleStockDetail.physical}'), 'W8.1 exact safe check is no longer reachable from the SKU detail')
  check(overview.includes('inventory-stock-result-meta'), 'Filtered-result scope is not explicit')
  check(overview.includes('Да, на месте {row.physical}') && overview.includes('Нет, другое количество'), 'Routine one-tap confirmation changed')
  check(overview.includes('needsIndependentCount') && overview.includes('Сначала посчитайте физически'), 'Blind-first risky count changed')
  check(!overview.includes('loadInventoryData(') && !overview.includes('loadInventoryCycleCounts('), 'Overview introduced a new inventory/cycle read path')
  check(!overview.includes('saveInventoryMovement') && !overview.includes('quickInventoryStocktake'), 'Overview introduced a new direct write path')
  check(css.includes('grid-template-columns: repeat(3, minmax(0, 1fr))') && css.includes('min-height: 78px'), 'Phone size tiles are not large/readable enough')
  check(css.includes('.inventory-stock-size-tile.needs-attention') && css.includes('.inventory-stock-size-tile.has-free'), 'Stock tile states are not visually differentiated')
  check(arrivalStart >= 0 && inventory.indexOf(arrivalButton, arrivalStart) > arrivalStart, 'Frozen Arrival structure changed')

  console.log('W8.1 STOCK OVERVIEW COMPLETION PASSED — exact stock truth and execution/color/size browsing remain preserved under later workspace polish')
} catch (error) {
  console.error(`W8.1 STOCK OVERVIEW COMPLETION FAILED: ${error?.message || error}`)
  process.exit(1)
}
'''
write('scripts/test-w8-1-stock-overview-completion.mjs', w81_test)

w82_test = r'''import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  const pkg = JSON.parse(read('package.json'))
  const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
  const inventory = read('src/features/sections/InventorySection.tsx')
  const css = read('src/styles/w8-2-stock-workspace.css')

  check(String(pkg.scripts?.['release:check'] || '').includes('test-w8-2-stock-workspace-finish.mjs'), 'W8.2 regression is not chained into release:check')
  check(overview.includes("import '../../../styles/w8-2-stock-workspace.css'"), 'W8.2 CSS is not owned by Overview')
  check(inventory.includes('const hasExplicitStockSearch = Boolean(inventoryQuery.trim())'), 'explicit stock search override missing')
  check(inventory.includes('const visibleRows = hasExplicitStockSearch ? allRows : allRows.filter'), 'availability filter still hides explicit search results')
  check(inventory.includes('allRows,') && inventory.includes('availabilityFilterApplied: !hasExplicitStockSearch'), 'product truth scope is not carried into Overview')
  check(overview.includes('фильтр наличия не скрывает найденные позиции'), 'search/filter truth is not explained')
  check(overview.includes('const productRows = group.allRows || rows') && overview.includes('hiddenByAvailability'), 'product totals still pretend filtered rows are the whole product')
  check(overview.includes('Открыть позицию') && overview.includes('openConcreteStockDetail'), 'SKU tile is not a neutral detail entry')
  check(inventory.includes('microCheck: false'), 'opening a detail still silently starts a check')
  check(overview.includes('warehouse-w3-micro-check-start') && overview.includes('microCheck: true'), 'explicit quick-check action is missing from neutral SKU card')
  check(overview.indexOf('inventory-stock-routine-disclosure') > overview.indexOf('inventory-calm-list'), 'routine check still precedes the primary stock list')
  check(overview.includes('is-simple-execution') && overview.includes('execution.colors.length <= 3 || hasExplicitStockSearch'), 'large products are not adaptively compact/collapsible')
  check(overview.includes("${isOpen ? 'is-open' : ''}"), 'open product sticky context marker missing')
  check(inventory.includes('simpleStockReservationsRequestRef') && inventory.includes('requestId !== simpleStockReservationsRequestRef.current'), 'reservation detail is not latest-request-wins safe')
  check(css.includes('.inventory-calm-product.is-open > .inventory-calm-product-main') && css.includes('position: sticky'), 'desktop product context is not sticky')
  check(css.includes('.inventory-stock-color:not([open]) > .inventory-stock-subgroups') && css.includes('display: none'), 'collapsed colors do not actually reduce long product pages')
  check(css.includes('.inventory-stock-size-value { font-size: 18px') && css.includes('.inventory-stock-size-meta { font-size: 10px'), 'size/meta readability was not improved')
  check(!overview.includes('saveInventoryMovement') && !overview.includes('quickInventoryStocktake'), 'W8.2 introduced a direct mutation path into presentation')
  check(inventory.includes('<div className="inventory-arrival-legacy-workspace">'), 'Arrival workspace changed')

  console.log('W8.2 STOCK WORKSPACE FINISH PASSED — search is honest, product totals are truthful, SKU browsing is neutral, large products stay navigable and reservation detail is race-safe')
} catch (error) {
  console.error(`W8.2 STOCK WORKSPACE FINISH FAILED: ${error?.message || error}`)
  process.exit(1)
}
'''
write('scripts/test-w8-2-stock-workspace-finish.mjs', w82_test)

pkg = json.loads(read('package.json'))
release = str(pkg['scripts'].get('release:check', ''))
check('test-w8-1-stock-overview-completion.mjs' in release, 'W8.1 release gate marker missing')
if 'test-w8-2-stock-workspace-finish.mjs' not in release:
    pkg['scripts']['release:check'] = release + ' && node scripts/test-w8-2-stock-workspace-finish.mjs'
write('package.json', json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')

manifest = {
    'version': 1,
    'revision': 'w8-2-stock-workspace-finish',
    'files': {
        overview_rel: {'beforeGitBlob': git_blob_sha(overview_before), 'afterGitBlob': git_blob_sha(overview)},
        inventory_rel: {'beforeGitBlob': git_blob_sha(inventory_before), 'afterGitBlob': git_blob_sha(inventory)},
    },
}
write(manifest_rel, json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

w82_layer = f'''import fs from 'node:fs'\nimport path from 'node:path'\nimport crypto from 'node:crypto'\nimport {{ spawnSync }} from 'node:child_process'\n\nconst root = process.cwd()\nconst overviewPath = path.join(root, '{overview_rel}')\nconst inventoryPath = path.join(root, '{inventory_rel}')\nconst baselineOverviewPath = path.join(root, '{overview_baseline_rel}')\nconst baselineInventoryPath = path.join(root, '{inventory_baseline_rel}')\nconst priorLayerPath = path.join(root, '{w8_layer_rel}')\nconst manifestPath = path.join(root, '{manifest_rel}')\nconst fail = (message) => {{ throw new Error(message) }}\nconst check = (condition, message) => {{ if (!condition) fail(message) }}\nconst gitBlobSha = (text) => {{ const body = Buffer.from(text, 'utf8'); const header = Buffer.from(`blob ${{body.length}}\\0`, 'utf8'); return crypto.createHash('sha1').update(header).update(body).digest('hex') }}\n\ntry {{\n  for (const required of [overviewPath, inventoryPath, baselineOverviewPath, baselineInventoryPath, priorLayerPath, manifestPath]) check(fs.existsSync(required), `W8.2 frontend structural file missing: ${{path.relative(root, required)}}`)\n  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))\n  const expectedFiles = ['{overview_rel}', '{inventory_rel}']\n  check(manifest?.version === 1 && manifest?.revision === 'w8-2-stock-workspace-finish', 'W8.2 frontend manifest invalid')\n  check(JSON.stringify(Object.keys(manifest.files || {{}})) === JSON.stringify(expectedFiles), 'W8.2 frontend file allow-list widened unexpectedly')\n  const currentOverview = fs.readFileSync(overviewPath, 'utf8')\n  const currentInventory = fs.readFileSync(inventoryPath, 'utf8')\n  const baselineOverview = fs.readFileSync(baselineOverviewPath, 'utf8')\n  const baselineInventory = fs.readFileSync(baselineInventoryPath, 'utf8')\n  check(gitBlobSha(baselineOverview) === manifest.files[expectedFiles[0]].beforeGitBlob, 'W8.2 frozen Overview is not exact W8.1 baseline')\n  check(gitBlobSha(baselineInventory) === manifest.files[expectedFiles[1]].beforeGitBlob, 'W8.2 frozen InventorySection is not exact W8.1 baseline')\n  check(gitBlobSha(currentOverview) === manifest.files[expectedFiles[0]].afterGitBlob, 'W8.2 Overview changed beyond exact manifest')\n  check(gitBlobSha(currentInventory) === manifest.files[expectedFiles[1]].afterGitBlob, 'W8.2 InventorySection changed beyond exact manifest')\n  check(currentOverview.includes('openConcreteStockDetail') && currentOverview.includes('inventory-stock-routine-disclosure'), 'W8.2 Overview markers missing')\n  check(currentInventory.includes('simpleStockReservationsRequestRef') && currentInventory.includes('hasExplicitStockSearch'), 'W8.2 controller markers missing')\n\n  fs.writeFileSync(overviewPath, baselineOverview)\n  fs.writeFileSync(inventoryPath, baselineInventory)\n  let result\n  try {{\n    result = spawnSync(process.execPath, [priorLayerPath], {{ cwd: root, stdio: 'inherit', shell: false, windowsHide: true }})\n  }} finally {{\n    fs.writeFileSync(overviewPath, currentOverview)\n    fs.writeFileSync(inventoryPath, currentInventory)\n  }}\n  if (result?.error) fail(`W8.1 preservation layer could not run under W8.2 baseline: ${{result.error.message}}`)\n  check(result?.status === 0, `W8.1 preservation layer failed with code ${{result?.status}}`)\n  check(fs.readFileSync(overviewPath, 'utf8') === currentOverview && fs.readFileSync(inventoryPath, 'utf8') === currentInventory, 'W8.2 structural gate failed to restore current files')\n  console.log('W8.2 FRONTEND STRUCTURAL LAYER PASSED — W8.1 baseline preserved; exact stock-workspace + reservation-race delta accepted')\n}} catch (error) {{\n  console.error(`W8.2 FRONTEND STRUCTURAL LAYER FAILED: ${{error?.message || error}}`)\n  process.exit(1)\n}}\n'''
write(w82_layer_rel, w82_layer)

structural = read('scripts/test-step1906b-frontend-modularization.mjs')
structural = replace_once(
    structural,
    "// w8StockOverviewPath — W8.1 stock overview completion preservation layer\nawait import('./test-step1906b-frontend-modularization-w8-layer.mjs')",
    "// w8StockOverviewPath — W8.1 stock overview completion preservation layer\n// w8StockWorkspaceFinishPath — W8.2 stock workspace finish preservation layer\nawait import('./test-step1906b-frontend-modularization-w8-2-layer.mjs')",
    '1906B W8.2 chain',
)
write('scripts/test-step1906b-frontend-modularization.mjs', structural)

continuation = '''# W8.2 — Stock workspace finish — 2026-09-06

## Scope

W8.2 finishes the daily `Остатки` workspace around the W8.1 execution/color/size hierarchy. It does not change Warehouse business truth.

- explicit search takes precedence over the normal availability filter so an existing SKU cannot appear missing merely because it has zero free stock or is fully reserved;
- product header totals use the whole query/category-matched product while the disclosure states when only a subset of positions is shown by the availability filter;
- SKU click is neutral information first; counting starts only after the explicit `Сверить количество` action and reuses the existing CAS-protected quick-check path;
- routine short checks move below the primary browse list and stay optional;
- one ordinary `Основное исполнение` no longer adds a heavy empty hierarchy level; large color sets are collapsible, and expanded desktop products keep sticky context;
- reservation detail loading is latest-request-wins so a slow response for a previously opened SKU cannot overwrite a newer SKU card.

## Safety boundaries

No migration. No Production D1 mutation/read for deployment. No Worker/API or Physical/Reserved/Available arithmetic change. Catalog, Arrival and Branch2 remain untouched. No pricing implementation.

## Next

Continue W8 across the remaining daily Warehouse surfaces (`Операции`, `Проверка`, `История`, recovery inbox) without reopening closed business semantics unless a concrete defect is proven. After W8 is closed, W9 is a full Warehouse audit/discussion pass: cross-workflow truth, UX, hidden defects, performance/D1 cost, mobile/desktop behavior and unresolved product decisions should be reviewed together before another broad change wave.
'''
write('docs/continuation/W8_2_STOCK_WORKSPACE_FINISH_20260906.md', continuation)

context = read('docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md')
checkpoint = '''## Checkpoint 2026-09-06 — W8.2 `Остатки` workspace finish

W8.2 continues W8.1 instead of declaring `Остатки` complete prematurely. Explicit search now reveals all matching SKU rows regardless of the normal availability filter; product-level totals stay truthful when the filter hides some variants; exact SKU opening is neutral and the physical check is a separate explicit action; routine short checks no longer precede the main stock list; large products collapse color groups and keep better context; reservation-detail loading is latest-request-wins. Business truth and D1 mutation paths remain unchanged.

After the remaining W8 interface passes are finished, W9 is reserved for a full Warehouse audit and discussion before another broad implementation wave.

---

'''
check('## Checkpoint 2026-09-06 — W8.1' in context, 'Warehouse context W8.1 checkpoint missing')
context = context.replace('## Checkpoint 2026-09-06 — W8.1', checkpoint + '## Checkpoint 2026-09-06 — W8.1', 1)
write('docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md', context)

print('W8.2 apply complete')
print('Overview', git_blob_sha(overview_before), '->', git_blob_sha(overview))
print('InventorySection', git_blob_sha(inventory_before), '->', git_blob_sha(inventory))
