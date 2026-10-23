import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import './inventory-demand-statistics.css'

type DemandRow = {
  product: string; color: string; size: string; material: string; length: string
  gender: string; category: string; source: string
  sold: number; returned: number; net: number; pricedQuantity: number
  knownRevenue: number; priceDiscrepancyQuantity: number
  minPrice: number | null; maxPrice: number | null
}
type DemandResponse = { ok: boolean; message?: string; note?: string; truncated?: boolean; rows?: DemandRow[] }
type OrderLine = {
  itemId: number; orderId: number; externalId: string; shippedAt: string; sold: number
  returned: number; net: number; unitPrice: number | null; priceDiscrepancy: boolean; orderTotal: number
}
type OrdersResponse = { ok: boolean; message?: string; orders?: OrderLine[]; hasMore?: boolean }
type Dimension = 'product' | 'color' | 'size' | 'material' | 'length' | 'gender' | 'variant'
type Metric = 'net' | 'sold' | 'knownRevenue' | 'returned'
type Aggregate = {
  label: string; sold: number; returned: number; net: number; pricedQuantity: number
  knownRevenue: number; priceDiscrepancyQuantity: number; minPrice: number | null; maxPrice: number | null
}
const dimensions: { value: Dimension; label: string }[] = [
  { value: 'product', label: 'Модели' }, { value: 'color', label: 'Цвета' },
  { value: 'size', label: 'Размеры' }, { value: 'material', label: 'Материалы' },
  { value: 'length', label: 'Длина' }, { value: 'gender', label: 'Пол' },
  { value: 'variant', label: 'Сочетания' },
]
const formatCount = (n: number) => new Intl.NumberFormat('ru-RU').format(n)
const money = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' ₸'
const percent = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 100) + '%' : '—'
function dateLocal(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}
function currentMonth() { return dateLocal(new Date()).slice(0, 7) }
function monthRange(value: string) {
  const [year, month] = value.split('-').map(Number)
  return { start: dateLocal(new Date(year, month - 1, 1)), end: dateLocal(new Date(year, month, 0)) }
}
function shiftMonth(value: string, delta: number) {
  const [y, m] = value.split('-').map(Number)
  return dateLocal(new Date(y, m - 1 + delta, 1)).slice(0, 7)
}
function variantLabel(row: DemandRow) {
  return [row.product, row.material !== 'Не указан' ? row.material : '',
    row.color !== 'Не указан' ? row.color : '', row.size !== 'Не указан' ? row.size : '',
    row.length !== 'Не указана' ? row.length : ''].filter(Boolean).join(' · ')
}
function keyByDimension(row: DemandRow, dimension: Dimension) {
  return dimension === 'variant' ? variantLabel(row) : row[dimension]
}
function combine(rows: DemandRow[], key: (row: DemandRow) => string): Aggregate[] {
  const map = new Map<string, Aggregate>()
  for (const row of rows) {
    const label = key(row)
    const item = map.get(label) || {
      label, sold: 0, returned: 0, net: 0, pricedQuantity: 0,
      knownRevenue: 0, priceDiscrepancyQuantity: 0, minPrice: null, maxPrice: null,
    }
    item.sold += row.sold; item.returned += row.returned; item.net += row.net
    item.pricedQuantity += row.pricedQuantity; item.knownRevenue += row.knownRevenue
    item.priceDiscrepancyQuantity += row.priceDiscrepancyQuantity
    if (row.minPrice !== null) item.minPrice = item.minPrice === null ? row.minPrice : Math.min(item.minPrice, row.minPrice)
    if (row.maxPrice !== null) item.maxPrice = item.maxPrice === null ? row.maxPrice : Math.max(item.maxPrice, row.maxPrice)
    map.set(label, item)
  }
  return [...map.values()]
}
function rank(list: Aggregate[], metric: Metric) {
  return [...list].sort((a, b) => b[metric] - a[metric] || a.label.localeCompare(b.label, 'ru'))
}
function priceCoverage(row: Aggregate) {
  if (!row.pricedQuantity) return 'Цена неизвестна'
  if (row.pricedQuantity < row.net) return 'Цены ' + formatCount(row.pricedQuantity) + ' из ' + formatCount(row.net) + ' шт.'
  return row.minPrice !== null && row.maxPrice !== null && row.minPrice !== row.maxPrice
    ? 'Диапазон ' + money(row.minPrice) + ' — ' + money(row.maxPrice)
    : 'Цена сохранена'
}
function aggregateMetric(row: Aggregate, metric: Metric) {
  return metric === 'knownRevenue' ? money(row.knownRevenue) : formatCount(row[metric]) + ' шт.'
}
const sourceNames: Record<string, string> = { warehouse: 'Склад', boutique: 'Бутик', workshop: 'Цех' }
const filtersForOrders = ['product', 'color', 'size', 'material', 'length', 'gender', 'category', 'source'] as const

export function InventoryDemandStatistics({ active }: { active: boolean }) {
  const [month, setMonth] = useState(currentMonth)
  const [custom, setCustom] = useState(false)
  const [customStart, setCustomStart] = useState(() => monthRange(currentMonth()).start)
  const [customEnd, setCustomEnd] = useState(() => dateLocal(new Date()))
  const [period, setPeriod] = useState(() => monthRange(currentMonth()))
  const [source, setSource] = useState('all')
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [dimension, setDimension] = useState<Dimension>('product')
  const [metric, setMetric] = useState<Metric>('net')
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)
  const [variant, setVariant] = useState<DemandRow | null>(null)
  const [data, setData] = useState<DemandResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [orderLines, setOrderLines] = useState<OrderLine[]>([])
  const [orderBusy, setOrderBusy] = useState(false)
  const [orderError, setOrderError] = useState('')
  const [orderPage, setOrderPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)

  function clearDrilldown() {
    setSelectedGroup(null); setSelectedProduct(null); setVariant(null)
    setOrderPage(0); setOrderLines([]); setHasMore(false)
  }
  function backInDemand() {
    if (variant) {
      setVariant(null); setOrderPage(0); setOrderLines([]); setHasMore(false)
    } else if (selectedProduct !== null && dimension !== 'product' && models.length > 1) {
      setSelectedProduct(null)
    } else clearDrilldown()
  }
  function chooseMonth(value: string) {
    setMonth(value); setCustom(false); setPeriod(monthRange(value)); clearDrilldown()
  }
  function applyCustom() {
    if (customStart && customEnd && customStart <= customEnd) {
      setPeriod({ start: customStart, end: customEnd }); clearDrilldown()
    } else setError('Проверьте выбранные даты.')
  }

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    setBusy(true); setError(''); setData(null)
    const params = new URLSearchParams({ start: period.start, end: period.end })
    void fetch('/api/reports/warehouse-demand?' + params, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const payload = await response.json() as DemandResponse
        if (!response.ok || !payload.ok) throw Error(payload.message || 'Не удалось загрузить отчёт.')
        return payload
      }).then(setData).catch(err => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить отчёт.')
      }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [active, period.start, period.end, refresh])

  const filtered = useMemo(() => (data?.rows || []).filter(row =>
    (source === 'all' || row.source === source) &&
    (category === 'all' || row.category === category) &&
    (!search.trim() || [row.product, row.color, row.size, row.material].some(value =>
      value.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru'))))
  ), [data, source, category, search])

  const totals = useMemo(() => combine(filtered, () => 'Все')[0] || {
    label: 'Все', sold: 0, returned: 0, net: 0, pricedQuantity: 0, knownRevenue: 0,
    priceDiscrepancyQuantity: 0, minPrice: null, maxPrice: null,
  }, [filtered])
  const ranking = useMemo(() => rank(combine(filtered, row => keyByDimension(row, dimension)), metric), [filtered, dimension, metric])
  const groupRows = useMemo(() => selectedGroup === null ? [] :
    filtered.filter(row => keyByDimension(row, dimension) === selectedGroup), [filtered, dimension, selectedGroup])
  const models = useMemo(() => rank(combine(groupRows, row => row.product), 'net'), [groupRows])
  // Opening a model already identifies its product. For any other characteristic,
  // skip the model picker too when only a single model contributed to the group.
  const openedProduct = selectedGroup === null ? null
    : dimension === 'product' ? selectedGroup
      : (selectedProduct ?? (models.length === 1 ? models[0].label : null))
  const variants = useMemo(() => openedProduct === null ? [] :
    groupRows.filter(row => row.product === openedProduct)
      .sort((a, b) => b.net - a.net || a.size.localeCompare(b.size, 'ru')),
    [groupRows, openedProduct])
  const selectedGroupSummary = ranking.find(row => row.label === selectedGroup)
  const selectedModelSummary = models.find(row => row.label === openedProduct)
  const selectedVariantKey = variant ? filtersForOrders.map(key => variant[key]).join('\u001f') : ''

  useEffect(() => {
    if (!active || !variant) return
    const controller = new AbortController()
    const params = new URLSearchParams({ start: period.start, end: period.end, mode: 'orders', offset: String(orderPage * 50) })
    for (const field of filtersForOrders) params.set(field, variant[field])
    setOrderBusy(true); setOrderError('')
    if (orderPage === 0) setOrderLines([])
    void fetch('/api/reports/warehouse-demand?' + params, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const payload = await response.json() as OrdersResponse
        if (!response.ok || !payload.ok) throw Error(payload.message || 'Не удалось загрузить заказы.')
        return payload
      }).then(payload => {
        if (controller.signal.aborted) return
        setOrderLines(current => orderPage ? [...current, ...(payload.orders || [])] : (payload.orders || []))
        setHasMore(Boolean(payload.hasMore))
      }).catch(err => {
        if (!controller.signal.aborted) setOrderError(err instanceof Error ? err.message : 'Не удалось загрузить заказы.')
      }).finally(() => { if (!controller.signal.aborted) setOrderBusy(false) })
    return () => controller.abort()
  }, [active, selectedVariantKey, orderPage, period.start, period.end])

  function csvExport() {
    const headers = ['Группа', 'Выдано', 'Возврат', 'Чистые продажи', 'Сумма по ценам позиций', 'Средняя цена', 'Кол-во с ценой']
    const quote = (value: string | number) => '"' + String(value).replace(/"/g, '""') + '"'
    const rows = ranking.map(row => [row.label, row.sold, row.returned, row.net, row.knownRevenue,
      row.pricedQuantity ? (row.knownRevenue / row.pricedQuantity).toFixed(2) : '', row.pricedQuantity])
    const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(quote).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'spros-' + dimension + '-' + period.start + '.csv'; link.click()
    URL.revokeObjectURL(url)
  }

  const max = Math.max(1, ...ranking.map(row => row[metric]))
  return (
    <section className="inventory-demand" aria-label="Статистика спроса">
      <header className="inventory-demand-head">
        <div>
          <span className="inventory-demand-eyebrow">АНАЛИТИКА ПРОДАЖ</span>
          <h2>Что покупают чаще всего</h2>
          <p>Популярность моделей, цветов, размеров и цен на основании отправленных заказов — без ненадёжных остатков.</p>
        </div>
        <button type="button" className="secondary" onClick={() => setRefresh(value => value + 1)} disabled={busy}>Обновить</button>
      </header>

      <div className="inventory-demand-period">
        <div className="inventory-demand-period-actions">
          <button type="button" className={!custom && month === currentMonth() ? 'is-active' : ''} onClick={() => chooseMonth(currentMonth())}>Этот месяц</button>
          <button type="button" className={!custom && month === shiftMonth(currentMonth(), -1) ? 'is-active' : ''} onClick={() => chooseMonth(shiftMonth(currentMonth(), -1))}>Прошлый месяц</button>
          <button type="button" className={custom ? 'is-active' : ''} onClick={() => { if (custom) { setCustom(false); setPeriod(monthRange(month)); clearDrilldown() } else setCustom(true) }}>Свой период</button>
        </div>
        {!custom ? <label className="inventory-demand-month">Месяц <input type="month" value={month} onChange={e => { if (e.target.value) chooseMonth(e.target.value) }} /></label> : (
          <form className="inventory-demand-dates" onSubmit={event => { event.preventDefault(); applyCustom() }}>
            <label>От <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} /></label>
            <label>До <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} /></label>
            <button type="submit">Показать</button>
          </form>
        )}
        <div className="inventory-demand-period-label">Данные: {period.start} — {period.end}</div>
      </div>

      <div className="inventory-demand-filters">
        <label>Место продажи <select value={source} onChange={e => { setSource(e.target.value); clearDrilldown() }}>
          <option value="all">Все источники</option><option value="warehouse">Склад</option><option value="boutique">Бутик</option><option value="workshop">Цех</option>
        </select></label>
        <label>Категория <select value={category} onChange={e => { setCategory(e.target.value); clearDrilldown() }}>
          <option value="all">Все категории</option><option value="adult">Взрослые</option><option value="child">Детские</option><option value="unknown">Не указана</option>
        </select></label>
        <label className="inventory-demand-search">Поиск по модели или характеристике
          <input type="search" value={search} onChange={e => { setSearch(e.target.value); clearDrilldown() }} placeholder="Например: кардиган, шерсть, 52…" />
        </label>
      </div>

      {busy ? <div className="inventory-demand-notice" role="status">Загружаем статистику продаж…</div> : null}
      {error ? <div className="inventory-demand-notice" role="alert">{error}</div> : null}
      {data?.truncated ? <div className="inventory-demand-notice" role="alert">В периоде слишком много вариантов для корректного полного рейтинга. Выберите более короткий период.</div> : null}

      {data && !data.truncated && !busy ? <>
        <div className="inventory-demand-summary">
          <div><small>Выдано</small><strong>{formatCount(totals.sold)} шт.</strong></div>
          <div><small>Возвращено</small><strong>{formatCount(totals.returned)} шт.</strong></div>
          <div><small>Чистые продажи</small><strong>{formatCount(totals.net)} шт.</strong></div>
          <div><small>Сумма по ценам позиций</small><strong>{totals.pricedQuantity ? money(totals.knownRevenue) : 'Нет данных'}</strong></div>
          <div><small>Средняя цена продажи</small><strong>{totals.pricedQuantity ? money(totals.knownRevenue / totals.pricedQuantity) : 'Нет данных'}</strong></div>
        </div>

        <div className="inventory-demand-quality">
          <div><strong>Цены сохранены для {formatCount(totals.pricedQuantity)} из {formatCount(totals.net)} шт. ({percent(totals.pricedQuantity, totals.net)}).</strong>
            {' '}{totals.pricedQuantity < totals.net ? 'Стоимость продаж может быть неполной: неизвестные цены не считаем нулевыми.' : 'Цена каждой учтённой единицы доступна.'}
            {totals.priceDiscrepancyQuantity > 0 ? ' Для ' + formatCount(totals.priceDiscrepancyQuantity) + ' шт. цена позиции не совпадает со старой суммой строки — проверьте заказ.' : ''}
          </div>
          <details><summary>Как считаются показатели</summary>
            <p>Количество — по отправленным заказам и их текущим товарным позициям, возвраты — до конца выбранного периода. Обмены, внесённые позднее, могут менять статистику прошлого месяца: это пока не неизменяемый журнал продаж.</p>
            <p>Сумма = известная сохранённая цена позиции × чистое количество. Это не поступления денег, не прибыль и не общая стоимость заказов. В старых заказах без записанной цены покажем номер заказа и его полную сумму, но не присвоим её одной позиции, если там несколько товаров.</p>
          </details>
        </div>


        {selectedGroup === null ? <>
          <div className="inventory-demand-rank-head">
            <div><h3>Популярность по характеристикам</h3><p>Выберите строку, чтобы изучить конкретные проданные варианты.</p></div>
            <label>Ранжировать по <select value={metric} onChange={e => setMetric(e.target.value as Metric)}>
              <option value="net">Чистые продажи</option><option value="sold">Выдано</option>
              <option value="knownRevenue">Сумма по известным ценам</option><option value="returned">Возвраты</option>
            </select></label>
          </div>
          <div className="inventory-demand-tabs" aria-label="Популярность">
            {dimensions.map(item => <button type="button" key={item.value}
              className={dimension === item.value ? 'is-active' : ''}
              aria-pressed={dimension === item.value}
              onClick={() => { setDimension(item.value); clearDrilldown() }}>{item.label}</button>)}
          </div>

          {!ranking.length ? <div className="inventory-demand-notice">По выбранным фильтрам отправленных позиций не найдено.</div> : (
            <div className="inventory-demand-list">
              <div className="inventory-demand-list-toolbar"><span>По популярности</span><button type="button" className="ghost compact" onClick={csvExport}>Экспорт CSV</button></div>
              {ranking.slice(0, 100).map((row, index) => <button type="button" key={row.label}
                className="inventory-demand-item"
                onClick={() => { setSelectedGroup(row.label); setSelectedProduct(null); setVariant(null); setOrderPage(0); setOrderLines([]) }}>
                <span className="inventory-demand-rank-number">{index + 1}</span>
                <span className="inventory-demand-item-primary">
                  <strong>{row.label}</strong>
                  <span className="inventory-demand-bar"><span style={{ '--progress': (Math.max(0, row[metric]) / max * 100) + '%' } as CSSProperties} /></span>
                  <small>{priceCoverage(row)}</small>
                </span>
                <span className="inventory-demand-item-stats">
                  <strong>{aggregateMetric(row, metric)}</strong>
                  <small>Продано {formatCount(row.sold)} · возврат {formatCount(row.returned)} · {percent(row.net, totals.net)} чистых продаж</small>
                  <small>{row.pricedQuantity ? 'Сумма ' + money(row.knownRevenue) + ' · средняя ' + money(row.knownRevenue / row.pricedQuantity) : 'Денежные показатели неизвестны'}</small>
                </span>
                <span className="inventory-demand-chevron" aria-hidden="true">›</span>
              </button>)}
              {ranking.length > 100 ? <p className="inventory-demand-muted">Показаны 100 наиболее значимых групп из {ranking.length}. Уточните фильтры для остальных.</p> : null}
            </div>
          )}
        </> : (
          <section className="inventory-demand-detail" aria-label="Детализация статистики" id="inventory-demand-detail">
            <nav className="inventory-demand-breadcrumbs" aria-label="Путь по статистике">
              <button type="button" onClick={clearDrilldown}>← К рейтингу</button>
              <span aria-hidden="true">/</span>
              <span>{dimensions.find(item => item.value === dimension)?.label}</span>
              <span aria-hidden="true">/</span>
              <strong>{selectedGroup}</strong>
              {openedProduct && dimension !== 'product' && <><span aria-hidden="true">/</span><span>{openedProduct}</span></>}
              {variant && <><span aria-hidden="true">/</span><span>{variant.color} · {variant.size}</span></>}
            </nav>

            {variant ? (
              <div className="inventory-demand-detail-content">
                <div className="inventory-demand-detail-heading">
                  <div>
                    <span className="inventory-demand-eyebrow">ПОЗИЦИИ ЗАКАЗОВ</span>
                    <h3>{variant.product} · {variant.color} · {variant.size}</h3>
                    <p>Фактические позиции заказов, сохранённые цены и возвраты для выбранного варианта.</p>
                  </div>
                  <button type="button" className="secondary" onClick={backInDemand}>← К вариантам</button>
                </div>
                {orderError ? <div className="inventory-demand-notice" role="alert">{orderError}</div> : null}
                {orderBusy && !orderLines.length ? <div className="inventory-demand-notice" role="status">Загружаем позиции заказов…</div> : null}
                <div className="inventory-demand-orders">
                  {orderLines.map(line => <div className="inventory-demand-order" key={line.itemId}>
                    <div><strong>{line.externalId || 'Заказ #' + line.orderId}</strong><small>Отправка: {line.shippedAt}</small></div>
                    <div><strong>{line.net} шт.</strong><small>{line.sold} выдано / {line.returned} возврат</small></div>
                    <div><strong>{line.unitPrice === null ? 'Цена не записана' : money(line.unitPrice) + ' / шт.'}</strong>
                      <small>{line.unitPrice === null ? 'Всего по заказу: ' + money(line.orderTotal) + ' (не цена этой позиции)' : 'Сумма позиции: ' + money(line.net * line.unitPrice)}</small>
                      {line.priceDiscrepancy ? <small className="inventory-demand-warning">Сумма строки отличается от цены × количества</small> : null}
                    </div>
                  </div>)}
                  {hasMore ? <button type="button" className="secondary" disabled={orderBusy} onClick={() => setOrderPage(page => page + 1)}>Показать ещё 50 позиций</button> : null}
                  {orderBusy && orderLines.length ? <p className="inventory-demand-muted">Загружаем ещё…</p> : null}
                </div>
              </div>
            ) : (
              <div className="inventory-demand-detail-content">
                <div className="inventory-demand-detail-heading">
                  <div>
                    <span className="inventory-demand-eyebrow">ДЕТАЛИ ПРОДАЖ</span>
                    <h3>{openedProduct ?? selectedGroup}</h3>
                    <p>{openedProduct === null ? 'Модели, которые сформировали спрос на эту характеристику.' : 'Все проданные варианты, их количество, сумма и средняя цена.'}</p>
                  </div>
                  <button type="button" className="secondary" onClick={backInDemand}>
                    ← {selectedProduct !== null && dimension !== 'product' && models.length > 1 ? 'К моделям' : 'К рейтингу'}
                  </button>
                </div>
                {selectedGroupSummary && <div className="inventory-demand-context-metrics">
                  <span><b>{formatCount(selectedGroupSummary.net)} шт.</b> чистых продаж</span>
                  <span><b>{formatCount(selectedGroupSummary.sold)}</b> выдано</span>
                  <span><b>{formatCount(selectedGroupSummary.returned)}</b> возвратов</span>
                  <span><b>{selectedGroupSummary.pricedQuantity ? money(selectedGroupSummary.knownRevenue) : '—'}</b> сумма продаж*</span>
                </div>}
                {openedProduct === null ? (
                  <div className="inventory-demand-model-list">
                    <div className="inventory-demand-section-title"><h4>Модели с этой характеристикой</h4><p>Откройте модель, чтобы увидеть её варианты.</p></div>
                    {models.map(model => <button type="button" key={model.label} onClick={() => { setSelectedProduct(model.label); setVariant(null); setOrderPage(0) }}>
                      <span><strong>{model.label}</strong><small>{formatCount(model.sold)} выдано · {formatCount(model.returned)} возвратов</small></span>
                      <span><strong>{formatCount(model.net)} шт.</strong><small>{model.pricedQuantity ? money(model.knownRevenue / model.pricedQuantity) + ' средняя цена' : 'Цена неизвестна'}</small></span>
                      <span aria-hidden="true">›</span>
                    </button>)}
                  </div>
                ) : (
                  <div className="inventory-demand-variants">
                    <div className="inventory-demand-section-title">
                      <h4>Проданные варианты{dimension !== 'product' ? ': ' + openedProduct : ''}</h4>
                      <p>Выберите вариант, чтобы посмотреть исходные позиции заказов.</p>
                      {selectedModelSummary && dimension !== 'product' && <p>Модель: {formatCount(selectedModelSummary.net)} шт. чистых продаж.</p>}
                    </div>
                    <div className="inventory-demand-variant-list">
                      <div className="inventory-demand-variant-head" aria-hidden="true">
                        <span>Цвет, размер и другие признаки</span><span>Продано</span><span>Сумма*</span><span>Средняя цена*</span><span></span>
                      </div>
                      {variants.map(row => <button type="button"
                        key={[row.product,row.color,row.size,row.material,row.length,row.gender,row.category,row.source].join('|')}
                        onClick={() => { setVariant(row); setOrderLines([]); setOrderPage(0); setHasMore(false) }}>
                        <span className="inventory-demand-variant-name">
                          <strong>{row.color} · {row.size}</strong>
                          <small>{row.material} · {row.length} · {row.gender} · {sourceNames[row.source] || row.source}</small>
                        </span>
                        <span><strong>{formatCount(row.net)} шт.</strong><small>{formatCount(row.returned)} возвратов</small></span>
                        <span>{row.pricedQuantity ? money(row.knownRevenue) : '—'}</span>
                        <span>{row.pricedQuantity ? money(row.knownRevenue / row.pricedQuantity) : '—'}</span>
                        <span className="inventory-demand-chevron" aria-hidden="true">›</span>
                      </button>)}
                    </div>
                    <small className="inventory-demand-footnote">* Сумма и средняя цена рассчитаны только по позициям с известной ценой.</small>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </> : null}
    </section>
  )
}
