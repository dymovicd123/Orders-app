import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import './inventory-demand-statistics.css'

type DemandRow = {
  product: string; color: string; size: string; material: string; length: string
  gender: string; category: string; source: string
  sold: number; returned: number; net: number; pricedQuantity: number; knownRevenue: number; ordersCount: number
}
type DemandResponse = { ok: boolean; message?: string; note?: string; truncated?: boolean; rows?: DemandRow[] }
type Dimension = 'product' | 'color' | 'size' | 'material' | 'length' | 'gender'
type Metric = 'net' | 'sold' | 'knownRevenue'
const dimensions: { value: Dimension; label: string }[] = [
  { value: 'product', label: 'Модели' }, { value: 'color', label: 'Цвета' },
  { value: 'size', label: 'Размеры' }, { value: 'material', label: 'Материалы' },
  { value: 'length', label: 'Длина' }, { value: 'gender', label: 'Пол' },
]
const money = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' ₸'
const number = (n: number) => new Intl.NumberFormat('ru-RU').format(n)
function dateLocal(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}
function firstMonthDay() { const d = new Date(); return dateLocal(new Date(d.getFullYear(), d.getMonth(), 1)) }
type RankedRow = { label: string; sold: number; returned: number; net: number; pricedQuantity: number; knownRevenue: number; orders: number }
export function InventoryDemandStatistics({ active }: { active: boolean }) {
  const [start, setStart] = useState(firstMonthDay)
  const [end, setEnd] = useState(() => dateLocal(new Date()))
  const [period, setPeriod] = useState({ start, end })
  const [source, setSource] = useState('all')
  const [category, setCategory] = useState('all')
  const [product, setProduct] = useState('')
  const [dimension, setDimension] = useState<Dimension>('product')
  const [metric, setMetric] = useState<Metric>('net')
  const [data, setData] = useState<DemandResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (!active) return
    if (!period.start || !period.end || period.start > period.end) { setError('Укажите корректный период.'); return }
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setData(null)
    void fetch('/api/reports/warehouse-demand?start=' + encodeURIComponent(period.start) + '&end=' + encodeURIComponent(period.end),
      { credentials: 'same-origin', signal: controller.signal })
      .then(async response => {
        const payload = await response.json() as DemandResponse
        if (!response.ok || !payload.ok) throw Error(payload.message || 'Не удалось загрузить отчёт.')
        return payload
      }).then(setData).catch(err => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить отчёт.')
      }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [active, period.start, period.end, refresh])

  const filtered = useMemo(() => (data?.rows || []).filter(row =>
    (source === 'all' || row.source === source) &&
    (category === 'all' || row.category === category) &&
    (!product.trim() || row.product.toLocaleLowerCase('ru').includes(product.trim().toLocaleLowerCase('ru')))
  ), [data, source, category, product])

  const totals = useMemo(() => filtered.reduce((sum, row) => ({
    sold: sum.sold + row.sold, returned: sum.returned + row.returned,
    net: sum.net + row.net, pricedQuantity: sum.pricedQuantity + row.pricedQuantity,
    knownRevenue: sum.knownRevenue + row.knownRevenue,
  }), { sold: 0, returned: 0, net: 0, pricedQuantity: 0, knownRevenue: 0 }), [filtered])

  const ranking = useMemo(() => {
    const map = new Map<string, RankedRow>()
    for (const row of filtered) {
      const label = row[dimension] || 'Не указан'
      const item = map.get(label) || { label, sold: 0, returned: 0, net: 0, pricedQuantity: 0, knownRevenue: 0, orders: 0 }
      item.sold += row.sold
      item.returned += row.returned
      item.net += row.net
      item.pricedQuantity += row.pricedQuantity
      item.knownRevenue += row.knownRevenue
      // Orders counts across groups are not unique: do not show the sum as a distinct-order metric.
      map.set(label, item)
    }
    return [...map.values()].sort((a, b) => b[metric] - a[metric] || a.label.localeCompare(b.label, 'ru'))
  }, [filtered, dimension, metric])
  const max = Math.max(1, ...ranking.map(row => row[metric]))
  const coverage = totals.net ? Math.round(totals.pricedQuantity / totals.net * 100) : 0
  return (
    <section className="inventory-demand" aria-label="Статистика спроса">
      <div className="inventory-demand-head">
        <div><h2>Статистика спроса</h2><p>Что покупают чаще всего: модели, цвета, размеры и фактические цены. Без расчётов по остаткам склада.</p></div>
        <button type="button" className="secondary" onClick={() => setRefresh(value => value + 1)} disabled={loading}>Обновить</button>
      </div>
      <form className="inventory-demand-filters" onSubmit={e => { e.preventDefault(); setPeriod({ start, end }) }}>
        <label>От <input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label>До <input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
        <button type="submit" disabled={loading}>Показать</button>
        <label>Источник <select value={source} onChange={e => setSource(e.target.value)}>
          <option value="all">Все источники</option><option value="warehouse">Склад</option>
          <option value="boutique">Бутик</option><option value="workshop">Цех</option>
        </select></label>
        <label>Категория <select value={category} onChange={e => setCategory(e.target.value)}>
          <option value="all">Все категории</option><option value="adult">Взрослые</option>
          <option value="child">Детские</option><option value="unknown">Не указана</option>
        </select></label>
        <label className="inventory-demand-search">Модель <input type="search" value={product} onChange={e => setProduct(e.target.value)} placeholder="Все товары" /></label>
      </form>
      {loading ? <div className="mini-panel" role="status">Загружаем продажи…</div> : null}
      {error ? <div className="mini-panel" role="alert">{error}</div> : null}
      {data?.truncated ? <div className="mini-panel" role="alert">Период содержит слишком много сочетаний товаров. Сократите период: неполные рейтинги намеренно не показываются.</div> : null}
      {data && !data.truncated && !loading ? <>
        <div className="inventory-demand-summary">
          <div><small>Выдано</small><strong>{number(totals.sold)} шт.</strong></div>
          <div><small>Возвращено</small><strong>{number(totals.returned)} шт.</strong></div>
          <div><small>Чистое количество</small><strong>{number(totals.net)} шт.</strong></div>
          <div><small>Сумма по известным ценам</small><strong>{money(totals.knownRevenue)}</strong></div>
          <div><small>Средняя известная цена</small><strong>{totals.pricedQuantity ? money(totals.knownRevenue / totals.pricedQuantity) : 'Нет данных'}</strong></div>
        </div>
        <p className="inventory-demand-caveat">
          Цены известны для {number(totals.pricedQuantity)} из {number(totals.net)} шт. ({coverage}%).
          {coverage < 100 ? ' Денежные суммы неполные: неизвестную цену не заменяем нулём.' : ''}
          {' '}Отчёт использует отправленные заказы по дате отправки; обмены отражают текущий состав заказа, возвраты — до конца периода. Это статистика продаж, не учёт запасов.
        </p>
        <div className="inventory-demand-rank-head">
          <div className="inventory-demand-tabs" aria-label="Популярность по характеристикам">
            {dimensions.map(x => <button type="button" key={x.value} className={dimension === x.value ? 'is-active' : ''} onClick={() => setDimension(x.value)}>{x.label}</button>)}
          </div>
          <label>Сортировка <select value={metric} onChange={e => setMetric(e.target.value as Metric)}>
            <option value="net">Чистые продажи</option><option value="sold">Выдано</option>
            <option value="knownRevenue">Сумма известных цен</option>
          </select></label>
        </div>
        {!ranking.length ? <div className="mini-panel">За выбранный период подтверждённых отправленных позиций не найдено.</div> : (
          <div className="inventory-demand-ranking">
            <div className="inventory-demand-table-head"><span>Характеристика</span><span>Выдано / возврат</span><span>Чистые продажи</span><span>Сумма*</span><span>Средняя цена*</span></div>
            {ranking.slice(0, 100).map(row => <div key={row.label} className="inventory-demand-rank">
              <div className="inventory-demand-name"><strong>{row.label}</strong><div className="inventory-demand-track"><div style={{ '--bar-width': Math.max(0, row[metric]) / max * 100 + '%' } as CSSProperties} /></div></div>
              <span>{number(row.sold)} / {number(row.returned)}</span>
              <strong>{number(row.net)} шт.</strong>
              <span>{row.pricedQuantity ? money(row.knownRevenue) : '—'}</span>
              <span>{row.pricedQuantity ? money(row.knownRevenue / row.pricedQuantity) : '—'}</span>
            </div>)}
            {ranking.length > 100 ? <p>Показаны первые 100 из {ranking.length} групп. Уточните фильтры для остальных.</p> : null}
            <p className="inventory-demand-caveat">* Только позиции с достоверно сохранённой ценой строки. Не общая сумма всех заказов и не прибыль.</p>
          </div>
        )}
      </> : null}
    </section>
  )
}
