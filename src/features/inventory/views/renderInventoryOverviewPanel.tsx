import type { InventoryRenderContext } from './types'
import '../../../styles/w8-1-stock-overview.css'

type PanelContext = Pick<InventoryRenderContext,
  | 'SmartPickerInput'
  | 'applyQuickStocktake'
  | 'cycleCountBusy'
  | 'cycleCountData'
  | 'cycleCountLoading'
  | 'cycleCountNotice'
  | 'cycleCountValues'
  | 'formatMoney'
  | 'inventoryPanelStyle'
  | 'inventoryPickerOptions'
  | 'inventoryQuery'
  | 'isAdmin'
  | 'openInventoryPanel'
  | 'openOrderFromFinance'
  | 'openSimpleStockHistory'
  | 'openSimpleStockRowsDetail'
  | 'productCategoryLabel'
  | 'quickStocktakeBusy'
  | 'quickStocktakeNotice'
  | 'quickStocktakeOpen'
  | 'quickStocktakeValues'
  | 'refreshCycleCountSuggestions'
  | 'refreshInventoryModule'
  | 'setInventoryQuery'
  | 'setQuickStocktakeNotice'
  | 'setQuickStocktakeOpen'
  | 'setQuickStocktakeValues'
  | 'setCycleCountValues'
  | 'setSimpleStockAvailabilityFilter'
  | 'setSimpleStockCategory'
  | 'setSimpleStockDetail'
  | 'setSimpleStockOpenProductKey'
  | 'setSimpleStockSource'
  | 'simpleStockAvailabilityFilter'
  | 'simpleStockCategory'
  | 'simpleStockDetail'
  | 'simpleStockGroups'
  | 'simpleStockOpenProductKey'
  | 'simpleStockPhysical'
  | 'simpleStockQuantity'
  | 'simpleStockReservations'
  | 'simpleStockReservationsBusy'
  | 'simpleStockReserved'
  | 'simpleStockSource'
  | 'simpleStockStats'
  | 'sourceLabel'
  | 'submitRoutineCycleCount'
>

const w8Text = (value: unknown) => String(value || '').trim()
const w8Key = (value: unknown) => w8Text(value).toLocaleUpperCase('ru-RU') || 'СТАНДАРТ'
const w8Plural = (value: number, one: string, few: string, many: string) => {
  const absolute = Math.abs(value)
  const lastTwo = absolute % 100
  const last = absolute % 10
  if (lastTwo >= 11 && lastTwo <= 19) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

function buildStockBrowseHierarchy(rows: any[], getCategory: (row: any) => string) {
  const executions = new Map<string, any>()
  for (const row of rows) {
    const material = w8Text(row.material) || 'СТАНДАРТ'
    const length = w8Text(row.length) || 'СТАНДАРТ'
    const executionKey = `${w8Key(material)}¦${w8Key(length)}`
    const executionLabel = w8Key(material) === 'СТАНДАРТ' && w8Key(length) === 'СТАНДАРТ'
      ? 'Основное исполнение'
      : [material !== 'СТАНДАРТ' ? material : '', length !== 'СТАНДАРТ' ? length : ''].filter(Boolean).join(' · ') || 'Основное исполнение'
    if (!executions.has(executionKey)) executions.set(executionKey, { key: executionKey, label: executionLabel, rows: [], colors: new Map<string, any>() })
    const execution = executions.get(executionKey)!
    execution.rows.push(row)

    const color = w8Text(row.color) || 'Цвет не указан'
    const colorKey = w8Key(color)
    if (!execution.colors.has(colorKey)) execution.colors.set(colorKey, { key: colorKey, label: color, rows: [], subgroups: new Map<string, any>() })
    const colorGroup = execution.colors.get(colorKey)!
    colorGroup.rows.push(row)

    const category = getCategory(row) || 'adult'
    const gender = w8Text(row.gender) || 'Пол не указан'
    const subgroupKey = `${category}¦${w8Key(gender)}`
    if (!colorGroup.subgroups.has(subgroupKey)) colorGroup.subgroups.set(subgroupKey, { key: subgroupKey, category, gender, rows: [] })
    colorGroup.subgroups.get(subgroupKey)!.rows.push(row)
  }

  return Array.from(executions.values()).map((execution: any) => ({
    ...execution,
    colors: Array.from(execution.colors.values()).map((color: any) => ({
      ...color,
      subgroups: Array.from(color.subgroups.values()).map((subgroup: any) => ({
        ...subgroup,
        rows: [...subgroup.rows].sort((a: any, b: any) => w8Text(a.size).localeCompare(w8Text(b.size), 'ru', { numeric: true })),
      })).sort((a: any, b: any) => a.category.localeCompare(b.category) || a.gender.localeCompare(b.gender, 'ru')),
    })).sort((a: any, b: any) => a.label.localeCompare(b.label, 'ru', { numeric: true })),
  })).sort((a: any, b: any) => (a.label === 'Основное исполнение' ? -1 : b.label === 'Основное исполнение' ? 1 : a.label.localeCompare(b.label, 'ru', { numeric: true })))
}

function renderRoutineCycleCountCue(ctx: PanelContext) {
  const { cycleCountBusy, cycleCountData, cycleCountLoading, cycleCountNotice, cycleCountValues, openInventoryPanel, refreshCycleCountSuggestions, setCycleCountValues, simpleStockSource, submitRoutineCycleCount } = ctx as any
  const current = cycleCountData?.source === simpleStockSource ? cycleCountData : null
  if (!current && !cycleCountLoading && !cycleCountNotice) return (
    <section className="inventory-cycle-count-card is-calm warehouse-w2-quick-check" data-smart-daily-stock="routine">
      <div className="inventory-cycle-count-head">
        <div><span className="stocktake-step-kicker">Короткая проверка</span><strong>Проверьте несколько вещей</strong><small>Когда есть пара минут, система подберёт до пяти позиций. Обычно его можно закончить за пару минут.</small></div>
        <button className="secondary compact inventory-routine-cycle-refresh" type="button" onClick={() => void refreshCycleCountSuggestions(simpleStockSource, false, 5)}>Начать</button>
      </div>
    </section>
  )
  if (current?.blockedByStocktake) return (
    <section className="inventory-cycle-count-card is-calm" data-smart-daily-stock="routine">
      <div className="inventory-cycle-count-state"><div><strong>Здесь уже идёт полная проверка</strong><span>Сначала продолжите или отмените её — отдельная короткая проверка не должна менять остаток параллельно.</span></div><button className="secondary compact" type="button" onClick={() => openInventoryPanel('stocktake')}>Открыть проверку</button></div>
    </section>
  )
  const rows = (current?.items || []).slice(0, 5)
  if (!rows.length) return cycleCountNotice ? <div className="inventory-cycle-count-notice" data-smart-daily-stock="routine">{cycleCountNotice}</div> : null
  return (
    <section className="inventory-cycle-count-card is-calm" data-smart-daily-stock="routine">
      <div className="inventory-cycle-count-head"><div><span className="stocktake-step-kicker">Короткая проверка</span><strong>Проверьте несколько вещей</strong><small>Небольшой пересчёт без открытия большой ревизии; обычно его можно закончить за пару минут.</small></div><button className="secondary compact inventory-routine-cycle-refresh" type="button" disabled={cycleCountBusy || cycleCountLoading} onClick={() => void refreshCycleCountSuggestions(simpleStockSource, false, 5)}>{cycleCountLoading ? 'Обновляю…' : 'Показать другие товары'}</button></div>
      <div className="inventory-cycle-count-list">
        {rows.map((row: any) => {
          const value = cycleCountValues[String(row.variantId)] ?? ''
          const attrs = [row.material !== 'СТАНДАРТ' ? row.material : '', row.length !== 'СТАНДАРТ' ? row.length : '', row.gender, row.color, row.size].filter(Boolean).join(' · ')
          const needsIndependentCount = Number(row.free || 0) < 0 || Number(row.lastDifference || 0) !== 0
          return <div className={`inventory-cycle-count-row is-routine ${needsIndependentCount ? 'needs-attention' : ''}`} key={`routine-cycle-${row.variantId}`}>
            <div className="inventory-cycle-count-name"><strong>{row.productName}</strong><span>{attrs || 'Стандартная комбинация'}</span><small className={needsIndependentCount ? 'is-warning' : undefined}>{needsIndependentCount ? 'Сначала посчитайте физически — системное число специально не подсказываем.' : ((row.reasons || [])[0] || 'Полезно подтвердить физический остаток')}</small></div>
            {needsIndependentCount ? <div className="inventory-cycle-count-system is-blind"><span>Сначала посчитайте физически</span>{Number(row.reserved || 0) ? <span><strong>{row.reserved}</strong> в заказах</span> : null}</div> : <div className="inventory-cycle-count-system"><span>По системе: <strong>{row.physical}</strong> на месте</span>{Number(row.reserved || 0) ? <span><strong>{row.reserved}</strong> в заказах</span> : null}</div>}
            <div className="inventory-routine-cycle-actions">{needsIndependentCount ? <div className="inventory-routine-cycle-edit is-independent"><input autoFocus={false} aria-label={`Фактическое количество ${row.productName}`} type="number" min="0" step="1" inputMode="numeric" value={value} placeholder="Факт" onChange={(event) => { const raw = event.target.value; if (raw === '') return setCycleCountValues((state: any) => ({ ...state, [String(row.variantId)]: '' })); const parsed = Number(raw); if (Number.isFinite(parsed)) setCycleCountValues((state: any) => ({ ...state, [String(row.variantId)]: String(Math.max(0, Math.trunc(parsed))) })) }} /><button className="primary compact" type="button" disabled={cycleCountBusy || value === ''} onClick={() => void submitRoutineCycleCount(row, Number(value))}>Сохранить факт</button></div> : <><button className="primary compact inventory-routine-cycle-confirm" type="button" disabled={cycleCountBusy} onClick={() => void submitRoutineCycleCount(row, Number(row.physical || 0))}>Да, на месте {row.physical}</button><details className="inventory-routine-cycle-other"><summary className="inventory-routine-cycle-other-button">Нет, другое количество</summary><div className="inventory-routine-cycle-edit"><input aria-label={`Фактическое количество ${row.productName}`} type="number" min="0" step="1" inputMode="numeric" value={value} onChange={(event) => { const raw = event.target.value; if (raw === '') return setCycleCountValues((state: any) => ({ ...state, [String(row.variantId)]: '' })); const parsed = Number(raw); if (Number.isFinite(parsed)) setCycleCountValues((state: any) => ({ ...state, [String(row.variantId)]: String(Math.max(0, Math.trunc(parsed))) })) }} /><button className="primary compact" type="button" disabled={cycleCountBusy || value === ''} onClick={() => void submitRoutineCycleCount(row, Number(value))}>Сохранить</button></div></details></>}
            </div>
          </div>
        })}
      </div>
      {cycleCountNotice ? <div className="inventory-cycle-count-notice">{cycleCountNotice}</div> : null}
    </section>
  )
}

export function renderInventoryOverviewPanel(ctx: PanelContext) {
  const {
    SmartPickerInput,
    applyQuickStocktake,
    formatMoney,
    inventoryPanelStyle,
    inventoryPickerOptions,
    inventoryQuery,
    openOrderFromFinance,
    openSimpleStockHistory,
    openSimpleStockRowsDetail,
    productCategoryLabel,
    quickStocktakeBusy,
    quickStocktakeNotice,
    quickStocktakeOpen,
    quickStocktakeValues,
    refreshInventoryModule,
    setInventoryQuery,
    setQuickStocktakeNotice,
    setQuickStocktakeOpen,
    setQuickStocktakeValues,
    setSimpleStockAvailabilityFilter,
    setSimpleStockCategory,
    setSimpleStockDetail,
    setSimpleStockOpenProductKey,
    setSimpleStockSource,
    simpleStockAvailabilityFilter,
    simpleStockCategory,
    simpleStockDetail,
    simpleStockGroups,
    simpleStockOpenProductKey,
    simpleStockPhysical,
    simpleStockQuantity,
    simpleStockReservations,
    simpleStockReservationsBusy,
    simpleStockReserved,
    simpleStockSource,
    simpleStockStats,
    sourceLabel
  } = ctx

  const openConcreteStockCheck = (row: any, label: string) => {
    const physical = simpleStockPhysical(row)
    const reserved = simpleStockReserved(row)
    setSimpleStockDetail({
      source: simpleStockSource, productId: Number(row.productId || 0), variantId: Number(row.variantId || 0), productName: row.productName || 'Товар',
      category: row.category || 'adult', gender: row.gender || '', material: row.material || 'СТАНДАРТ', length: row.length || 'СТАНДАРТ', size: row.size || '', color: row.color || '',
      physical, reserved, free: simpleStockQuantity(row), aggregate: false, label, hasDataIssue: false, microCheck: true,
    })
    setQuickStocktakeOpen(true)
    setQuickStocktakeValues({})
    setQuickStocktakeNotice('')
  }

  const microCheckDetailRow = (detail: any) => ({
    productId: detail.productId, variantId: detail.variantId, productName: detail.productName, category: detail.category, gender: detail.gender, material: detail.material, length: detail.length, size: detail.size, color: detail.color,
    warehouseQuantity: detail.source === 'warehouse' ? detail.physical : 0, warehouseReserved: detail.source === 'warehouse' ? detail.reserved : 0, warehouseAvailable: detail.source === 'warehouse' ? detail.free : 0,
    boutiqueQuantity: detail.source === 'boutique' ? detail.physical : 0, boutiqueReserved: detail.source === 'boutique' ? detail.reserved : 0, boutiqueAvailable: detail.source === 'boutique' ? detail.free : 0,
  })

  const visibleVariantCount = simpleStockGroups.reduce((sum: number, group: any) => sum + Number((group.rows || []).length), 0)
  const resultScopeLabel = inventoryQuery.trim()
    ? `Поиск: «${inventoryQuery.trim()}»`
    : simpleStockAvailabilityFilter === 'free'
      ? 'Только позиции со свободным остатком'
      : simpleStockAvailabilityFilter === 'reserved'
        ? 'Только позиции в заказах'
        : simpleStockAvailabilityFilter === 'attention'
          ? 'Только позиции, требующие сверки'
          : 'Все позиции с остатком'

  return (
    <div className="inventory-overview-panel inventory-calm-stock" style={inventoryPanelStyle('overview')}>
                    <div className="inventory-calm-head">
                      <div>
                        <h3>Остатки</h3>
                        <p>Смотрите прежде всего на «Свободно» — это количество, которое можно использовать для нового заказа.</p>
                      </div>
                      <button className="secondary compact" type="button" onClick={() => void refreshInventoryModule(true)}>Обновить</button>
                    </div>
    
                    <div className="inventory-calm-toolbar">
                      <div className="inventory-calm-search">
                        <SmartPickerInput
                          value={inventoryQuery}
                          options={inventoryPickerOptions.products}
                          placeholder="Найти товар"
                          onChange={setInventoryQuery}
                          ariaLabel="Поиск товара"
                        />
                        {inventoryQuery ? <button className="secondary compact" type="button" onClick={() => setInventoryQuery('')}>Очистить</button> : null}
                      </div>
                      <div className="inventory-calm-source" aria-label="Точка остатков">
                        {[
                          { value: 'warehouse' as const, label: 'Склад' },
                          { value: 'boutique' as const, label: 'Бутик' },
                        ].map((entry) => (
                          <button key={entry.value} type="button" className={simpleStockSource === entry.value ? 'is-active' : ''} onClick={() => setSimpleStockSource(entry.value)}>{entry.label}</button>
                        ))}
                      </div>
                    </div>
    
                    <div className="inventory-calm-summary" aria-label="Краткая сводка остатков">
                      <div className="is-primary"><span>Свободно</span><strong>{formatMoney(simpleStockSource === 'warehouse' ? simpleStockStats.warehouse : simpleStockStats.boutique)}</strong><small>можно использовать сейчас</small></div>
                      <div><span>На месте</span><strong>{formatMoney(simpleStockSource === 'warehouse' ? simpleStockStats.warehousePhysical : simpleStockStats.boutiquePhysical)}</strong><small>должно находиться в точке</small></div>
                      <div><span>В заказах</span><strong>{formatMoney(simpleStockSource === 'warehouse' ? simpleStockStats.warehouseReserved : simpleStockStats.boutiqueReserved)}</strong><small>уже отложено клиентам</small></div>
                      <details>
                        <summary>Что означают эти числа?</summary>
                        <p><b>На месте</b> включает и свободные вещи, и ещё не отправленные заказы. <b>В заказах</b> — уже обещанное клиентам. <b>Свободно</b> = на месте минус в заказах.</p>
                      </details>
                    </div>

                    {renderRoutineCycleCountCue(ctx)}
    
                    <div className="inventory-calm-filters">
                      {[
                        { value: 'free', label: `Есть свободные (${simpleStockStats.freeVariants})` },
                        { value: 'reserved', label: `В заказах (${simpleStockStats.reservedVariants})` },
                        { value: 'attention', label: `Требуют внимания (${simpleStockStats.attentionVariants})` },
                        { value: 'all', label: 'Все с остатком' },
                      ].map((entry) => (
                        <button key={entry.value} type="button" className={simpleStockAvailabilityFilter === entry.value ? 'is-active' : ''} onClick={() => setSimpleStockAvailabilityFilter(entry.value as any)}>{entry.label}</button>
                      ))}
                      <details className="inventory-calm-extra-filter">
                        <summary>Тип товара</summary>
                        <div>
                          {[
                            { value: 'all' as const, label: 'Все' },
                            { value: 'adult' as const, label: 'Взрослые' },
                            { value: 'child' as const, label: 'Детские' },
                          ].map((entry) => (
                            <button key={entry.value} type="button" className={simpleStockCategory === entry.value ? 'is-active' : ''} onClick={() => setSimpleStockCategory(entry.value)}>{entry.label}</button>
                          ))}
                        </div>
                      </details>
                    </div>
    
                    {simpleStockAvailabilityFilter === 'all' && !inventoryQuery.trim() ? <p className="inventory-calm-note">Пустые позиции каталога здесь не выводятся. Чтобы проверить товар с нулевым остатком, найдите его через поиск.</p> : null}
    

                    <div className="inventory-stock-result-meta" aria-live="polite">
                      <div>
                        <strong>{simpleStockGroups.length} {w8Plural(simpleStockGroups.length, 'товар', 'товара', 'товаров')}</strong>
                        <span>{visibleVariantCount} {w8Plural(visibleVariantCount, 'позиция', 'позиции', 'позиций')} в текущей выборке</span>
                      </div>
                      <small>{resultScopeLabel}</small>
                    </div>
    
                    <div className="inventory-calm-list">
                      {simpleStockGroups.length ? simpleStockGroups.map((group: any) => {
                        const rows = group.rows || []
                        const isOpen = simpleStockOpenProductKey === group.key
                        const free = rows.reduce((sum: number, row: any) => sum + simpleStockQuantity(row), 0)
                        const physical = rows.reduce((sum: number, row: any) => sum + simpleStockPhysical(row), 0)
                        const reserved = rows.reduce((sum: number, row: any) => sum + simpleStockReserved(row), 0)
                        const single = rows.length === 1
                        const singleRow = single ? rows[0] : null
                        const needsAttention = free < 0 || physical < 0
                        const singlePrimary = singleRow ? [singleRow.color, singleRow.size].filter(Boolean).join(' · ') || 'Стандартный вариант' : ''
                        const singleSecondary = singleRow ? [productCategoryLabel(singleRow.category), singleRow.gender, singleRow.material && singleRow.material !== 'СТАНДАРТ' ? singleRow.material : '', singleRow.length && singleRow.length !== 'СТАНДАРТ' ? singleRow.length : ''].filter(Boolean).join(' · ') : ''
                        return (
                          <article className={`inventory-calm-product ${needsAttention ? 'needs-attention' : ''}`} key={`calm-stock-${group.key}`}>
                            <div className="inventory-calm-product-main">
                              <div className="inventory-calm-product-name">
                                <strong>{group.productName}</strong>
                                {single ? <span>{[singlePrimary, singleSecondary].filter(Boolean).join(' · ')}</span> : <span>{rows.length} {w8Plural(rows.length, 'позиция', 'позиции', 'позиций')} в текущей выборке</span>}
                              </div>
                              <div className="inventory-calm-product-free">
                                {physical < 0 ? <><strong>Нужна сверка</strong><span>учёт ниже нуля</span></> : free < 0 ? <><strong>Не хватает {formatMoney(Math.abs(free))}</strong><span>для принятых заказов</span></> : <><strong>{formatMoney(free)}</strong><span>свободно</span></>}
                              </div>
                              <div className="inventory-calm-product-secondary">
                                <span>На месте <b>{formatMoney(physical)}</b></span>
                                {reserved > 0 ? (
                                  <button type="button" className="inventory-reservation-link" onClick={() => void openSimpleStockRowsDetail(rows, { aggregate: !single, label: singlePrimary })}>{formatMoney(reserved)} в заказах →</button>
                                ) : <span>В заказах <b>0</b></span>}
                              </div>
                              {single ? (
                                <button className="secondary compact inventory-calm-detail-button warehouse-w3-micro-check-open" type="button" onClick={() => openConcreteStockCheck(singleRow, singlePrimary)}>Проверить</button>
                              ) : (
                                <button className="secondary compact inventory-calm-detail-button" type="button" aria-expanded={isOpen} onClick={() => setSimpleStockOpenProductKey((current) => current === group.key ? '' : group.key)}>{isOpen ? 'Скрыть позиции' : `Показать позиции (${rows.length})`}</button>
                              )}
                            </div>
    
                            {!single && isOpen ? (
                              <div className="inventory-stock-hierarchy" data-w8-stock-hierarchy="execution-color-size">
                                {buildStockBrowseHierarchy(rows, (row: any) => row.category || 'adult').map((execution: any) => {
                                  const executionFree = execution.rows.reduce((sum: number, row: any) => sum + simpleStockQuantity(row), 0)
                                  const executionPhysical = execution.rows.reduce((sum: number, row: any) => sum + simpleStockPhysical(row), 0)
                                  const executionReserved = execution.rows.reduce((sum: number, row: any) => sum + simpleStockReserved(row), 0)
                                  const executionSizeCount = new Set(execution.rows.map((row: any) => w8Text(row.size)).filter(Boolean)).size
                                  return (
                                    <section className="inventory-stock-execution" key={`stock-execution-${group.key}-${execution.key}`}>
                                      <div className="inventory-stock-execution-head">
                                        <div>
                                          <span>Исполнение</span>
                                          <strong>{execution.label}</strong>
                                          <small>{execution.colors.length} {w8Plural(execution.colors.length, 'цвет', 'цвета', 'цветов')} · {executionSizeCount} {w8Plural(executionSizeCount, 'размер/возраст', 'размера/возраста', 'размеров/возрастов')}</small>
                                        </div>
                                        <div className={`inventory-stock-execution-numbers ${executionFree < 0 || executionPhysical < 0 ? 'needs-attention' : ''}`}>
                                          <strong>{executionPhysical < 0 ? 'Сверить' : executionFree < 0 ? `−${formatMoney(Math.abs(executionFree))}` : formatMoney(executionFree)}</strong>
                                          <span>{executionPhysical < 0 ? 'учёт ниже нуля' : executionFree < 0 ? 'не хватает' : 'свободно'}</span>
                                          <small>На месте {formatMoney(executionPhysical)}{executionReserved > 0 ? ` · В заказах ${formatMoney(executionReserved)}` : ''}</small>
                                        </div>
                                      </div>
                                      <div className="inventory-stock-color-list">
                                        {execution.colors.map((colorGroup: any) => {
                                          const colorFree = colorGroup.rows.reduce((sum: number, row: any) => sum + simpleStockQuantity(row), 0)
                                          const colorPhysical = colorGroup.rows.reduce((sum: number, row: any) => sum + simpleStockPhysical(row), 0)
                                          const colorReserved = colorGroup.rows.reduce((sum: number, row: any) => sum + simpleStockReserved(row), 0)
                                          return (
                                            <section className="inventory-stock-color" key={`stock-color-${group.key}-${execution.key}-${colorGroup.key}`}>
                                              <div className="inventory-stock-color-head">
                                                <div><strong>{colorGroup.label}</strong><span>{colorGroup.rows.length} {w8Plural(colorGroup.rows.length, 'позиция', 'позиции', 'позиций')}</span></div>
                                                <div className={colorFree < 0 || colorPhysical < 0 ? 'needs-attention' : ''}>
                                                  <strong>{colorPhysical < 0 ? 'Сверить' : colorFree < 0 ? `−${formatMoney(Math.abs(colorFree))}` : formatMoney(colorFree)}</strong>
                                                  <span>свободно · на месте {formatMoney(colorPhysical)}{colorReserved > 0 ? ` · в заказах ${formatMoney(colorReserved)}` : ''}</span>
                                                </div>
                                              </div>
                                              <div className="inventory-stock-subgroups">
                                                {colorGroup.subgroups.map((subgroup: any) => (
                                                  <div className="inventory-stock-subgroup" key={`stock-subgroup-${group.key}-${execution.key}-${colorGroup.key}-${subgroup.key}`}>
                                                    <div className="inventory-stock-subgroup-label">
                                                      <strong>{subgroup.gender}</strong>
                                                      <span>{productCategoryLabel(subgroup.category)} · {subgroup.category === 'child' ? 'возраст' : 'размер'}</span>
                                                    </div>
                                                    <div className="inventory-stock-size-grid">
                                                      {subgroup.rows.map((row: any) => {
                                                        const rowFree = simpleStockQuantity(row)
                                                        const rowPhysical = simpleStockPhysical(row)
                                                        const rowReserved = simpleStockReserved(row)
                                                        const sizeLabel = w8Text(row.size) || (subgroup.category === 'child' ? '— возраст' : '— размер')
                                                        const primary = [colorGroup.label, w8Text(row.size)].filter(Boolean).join(' · ') || 'Стандартный вариант'
                                                        return (
                                                          <button
                                                            className={`inventory-stock-size-tile warehouse-w3-micro-check-open ${rowFree < 0 || rowPhysical < 0 ? 'needs-attention' : ''} ${rowFree > 0 ? 'has-free' : 'is-zero-free'}`}
                                                            key={`stock-size-${row.key}`}
                                                            type="button"
                                                            data-variant-id={row.variantId}
                                                            aria-label={`${group.productName}, ${colorGroup.label}, ${subgroup.category === 'child' ? 'возраст' : 'размер'} ${sizeLabel}: свободно ${rowFree}, на месте ${rowPhysical}${rowReserved > 0 ? `, в заказах ${rowReserved}` : ''}. Открыть проверку.`}
                                                            onClick={() => openConcreteStockCheck(row, primary)}
                                                          >
                                                            <span className="inventory-stock-size-value">{sizeLabel}</span>
                                                            <span className="inventory-stock-size-free">{rowPhysical < 0 ? 'Сверить' : rowFree < 0 ? `−${formatMoney(Math.abs(rowFree))}` : formatMoney(rowFree)} <small>свободно</small></span>
                                                            <span className="inventory-stock-size-meta">На месте {formatMoney(rowPhysical)}{rowReserved > 0 ? ` · В заказах ${formatMoney(rowReserved)}` : ''}</span>
                                                          </button>
                                                        )
                                                      })}
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            </section>
                                          )
                                        })}
                                      </div>
                                    </section>
                                  )
                                })}
                              </div>
                            ) : null}
                          </article>
                        )
                      }) : (
                        <div className="empty-state inventory-calm-empty">По выбранному фильтру ничего нет. Измените фильтр или найдите товар по названию.</div>
                      )}
                    </div>
    
                    {simpleStockDetail ? (
                      <div className="inventory-calm-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSimpleStockDetail(null) }}>
                        <aside className="inventory-calm-detail" role="dialog" aria-modal="true" aria-label="Остаток товара">
                          <div className="inventory-calm-detail-head">
                            <div><span>{sourceLabel(simpleStockDetail.source)}</span><h3>{simpleStockDetail.productName}</h3><p>{simpleStockDetail.aggregate ? 'Все варианты товара' : [simpleStockDetail.label, productCategoryLabel(simpleStockDetail.category), simpleStockDetail.gender, simpleStockDetail.material && simpleStockDetail.material !== 'СТАНДАРТ' ? simpleStockDetail.material : '', simpleStockDetail.length && simpleStockDetail.length !== 'СТАНДАРТ' ? simpleStockDetail.length : ''].filter(Boolean).join(' · ')}</p></div>
                            <button className="ghost compact" type="button" onClick={() => setSimpleStockDetail(null)}>Закрыть</button>
                          </div>
                          <div className="inventory-calm-detail-numbers">
                            <div className="is-primary"><span>Свободно</span><strong>{simpleStockDetail.free < 0 ? `−${Math.abs(simpleStockDetail.free)}` : simpleStockDetail.free}</strong></div>
                            <div><span>На месте</span><strong>{simpleStockDetail.physical}</strong></div>
                            <div><span>В заказах</span><strong>{simpleStockDetail.reserved}</strong></div>
                          </div>
                          {simpleStockDetail.microCheck ? (
                            <section className="inventory-exact-count warehouse-w3-micro-check" data-w3-micro-check="true">
                              <div><strong>Быстрая проверка</strong><div className="inventory-exact-count-note">Это добровольная сверка этой конкретной позиции. Открытие ничего не меняет — сохранится только подтверждённый вами факт.</div></div>
                              {simpleStockDetail.physical >= 0 ? (
                                <div className="inventory-routine-cycle-actions">
                                  <button className="primary compact inventory-routine-cycle-confirm" type="button" disabled={quickStocktakeBusy} onClick={() => void applyQuickStocktake(Number(simpleStockDetail.physical || 0))}>{quickStocktakeBusy ? 'Сохраняю…' : `Да, на месте ${simpleStockDetail.physical}`}</button>
                                  <details className="inventory-routine-cycle-other"><summary className="inventory-routine-cycle-other-button">Нет, другое количество</summary><div className="inventory-routine-cycle-edit"><input aria-label={`Фактическое количество ${simpleStockDetail.productName}`} type="number" min="0" step="1" inputMode="numeric" value={quickStocktakeValues[String(simpleStockDetail.variantId)] ?? ''} onChange={(event) => setQuickStocktakeValues({ [String(simpleStockDetail.variantId)]: event.target.value === '' ? '' : String(Math.max(0, Math.trunc(Number(event.target.value || 0)))) })} /><button className="primary compact" type="button" disabled={quickStocktakeBusy || (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') === ''} onClick={() => void applyQuickStocktake()}>{quickStocktakeBusy ? 'Сохраняю…' : 'Сохранить факт'}</button></div></details>
                                </div>
                              ) : (
                                <div className="inventory-routine-cycle-edit is-independent"><input aria-label={`Фактическое количество ${simpleStockDetail.productName}`} type="number" min="0" step="1" inputMode="numeric" placeholder="Факт" value={quickStocktakeValues[String(simpleStockDetail.variantId)] ?? ''} onChange={(event) => setQuickStocktakeValues({ [String(simpleStockDetail.variantId)]: event.target.value === '' ? '' : String(Math.max(0, Math.trunc(Number(event.target.value || 0)))) })} /><button className="primary compact" type="button" disabled={quickStocktakeBusy || (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') === ''} onClick={() => void applyQuickStocktake()}>{quickStocktakeBusy ? 'Сохраняю…' : 'Сохранить факт'}</button></div>
                              )}
                              {simpleStockDetail.physical < 0 ? <div className="inventory-exact-count-note">Системное количество ниже нуля, поэтому подтвердить его одним нажатием нельзя — укажите реальный факт.</div> : null}
                              {quickStocktakeNotice ? <p className="inventory-quick-stocktake-notice">{quickStocktakeNotice}</p> : null}
                              <div className="inventory-calm-detail-actions"><button className="secondary" type="button" onClick={() => void openSimpleStockRowsDetail([microCheckDetailRow(simpleStockDetail)], { source: simpleStockDetail.source, label: simpleStockDetail.label })}>Подробнее о позиции</button></div>
                            </section>
                          ) : (<>
                            {simpleStockDetail.physical < 0 ? <div className="inventory-calm-warning"><strong>Учёт ниже нуля — нужна сверка</strong><span>Отрицательное число не доказывает, что забыли приход. Проверьте фактическое количество и источник товара; система исправит учёт по реальному факту.</span></div> : simpleStockDetail.free < 0 ? <div className="inventory-calm-warning"><strong>Товара не хватает для текущих заказов</strong><span>Нужно ещё {Math.abs(simpleStockDetail.free)} шт. либо требуется сверка фактического количества.</span></div> : null}
                            <section className="inventory-calm-reservations">
                              <div className="inventory-calm-reservations-head"><strong>{simpleStockDetail.reserved > 0 ? 'Товар отложен для этих заказов' : 'Товар сейчас не зарезервирован'}</strong>{simpleStockDetail.reserved > 0 ? <span>Всего: {simpleStockDetail.reserved} шт.</span> : null}</div>
                              {simpleStockReservationsBusy ? <div className="empty-state compact-empty">Загружаю заказы…</div> : simpleStockDetail.reserved > 0 && !simpleStockReservations.length ? <div className="empty-state compact-empty">Не удалось получить список заказов. Обновите остатки и попробуйте ещё раз.</div> : simpleStockReservations.map((reservation: any) => (
                                <div className="inventory-calm-reservation" key={`reservation-${reservation.id}`}>
                                  <div className="inventory-calm-reservation-main">
                                    <strong>Заказ {reservation.externalOrderId || reservation.orderId}</strong>
                                    {simpleStockDetail.aggregate ? <span>{[reservation.color, reservation.size, reservation.material && reservation.material !== 'СТАНДАРТ' ? reservation.material : '', reservation.length && reservation.length !== 'СТАНДАРТ' ? reservation.length : ''].filter(Boolean).join(' · ')}</span> : null}
                                    <small>{[reservation.customerName || reservation.customerPhone, reservation.managerName, reservation.orderDate].filter(Boolean).join(' · ')}</small>
                                  </div>
                                  <b>{reservation.quantity} шт.</b>
                                  <button className="secondary compact" type="button" onClick={() => { setSimpleStockDetail(null); void openOrderFromFinance({ orderId: reservation.orderId, externalId: reservation.externalOrderId, orderDate: reservation.orderDate }) }}>Открыть заказ</button>
                                </div>
                              ))}
                            </section>
                            {!simpleStockDetail.aggregate ? (
                              <section className="inventory-exact-count">
                                <div>
                                  <strong>Сверить количество</strong>
                                  <div className="inventory-exact-count-note">Введите, сколько таких вещей физически находится здесь сейчас. Считайте и свободные, и уже отложенные под заказы.</div>
                                </div>
                                {quickStocktakeOpen ? (
                                  <div className="inventory-exact-count-row">
                                    <label>
                                      <span>На месте сейчас</span>
                                      <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        inputMode="numeric"
                                        value={quickStocktakeValues[String(simpleStockDetail.variantId)] ?? ''}
                                        onChange={(event) => setQuickStocktakeValues({ [String(simpleStockDetail.variantId)]: event.target.value === '' ? '' : String(Math.max(0, Math.trunc(Number(event.target.value || 0)))) })}
                                        placeholder={String(simpleStockDetail.physical)}
                                      />
                                    </label>
                                    <button className="primary" type="button" disabled={quickStocktakeBusy || (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') === ''} onClick={() => void applyQuickStocktake()}>{quickStocktakeBusy ? 'Сохраняю…' : 'Сохранить факт'}</button>
                                    <button className="ghost" type="button" disabled={quickStocktakeBusy} onClick={() => { setQuickStocktakeOpen(false); setQuickStocktakeValues({}); setQuickStocktakeNotice('') }}>Отмена</button>
                                  </div>
                                ) : <button className="secondary" type="button" onClick={() => { setQuickStocktakeOpen(true); setQuickStocktakeValues({}); setQuickStocktakeNotice('') }}>Сверить количество</button>}
                                {quickStocktakeNotice ? <p className="inventory-quick-stocktake-notice">{quickStocktakeNotice}</p> : null}
                              </section>
                            ) : null}
                            <div className="inventory-calm-detail-actions">{simpleStockDetail.aggregate ? <span className="inventory-quick-stocktake-hint">Для сверки откройте конкретный вариант товара.</span> : null}{!simpleStockDetail.aggregate ? <button className="secondary" type="button" onClick={() => openSimpleStockHistory(simpleStockDetail)}>История позиции</button> : null}</div>
                          </>)}
                        </aside>
                      </div>
                    ) : null}
                  </div>
  )
}
