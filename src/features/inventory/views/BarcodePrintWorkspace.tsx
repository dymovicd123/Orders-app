import { useEffect, useMemo, useState } from 'react'
import type { CatalogResponse, CatalogVariantRecord, InventoryResponse } from '../../../app/types'
import { skuBarcodeForVariantId } from '../../../../shared/barcode-sku.ts'
import { encodeCode128B } from '../../../../shared/barcode-code128.ts'
import './barcodePrintWorkspace.css'

type Source = 'warehouse' | 'boutique'
type StockSnapshots = Record<Source, InventoryResponse | null>
type Props = {
  catalog: CatalogResponse | null
  stock: StockSnapshots
  onReload: () => Promise<{ catalog: CatalogResponse; warehouse: InventoryResponse; boutique: InventoryResponse } | null>
}

type PrintItem = { variant: CatalogVariantRecord; quantity: number }
type VerifiedPrintItem = PrintItem & { barcode: string; productName: string }

const MAX_LABELS = 300

const textOf = (value: unknown) => String(value ?? '').trim()
const visibleAttribute = (value: unknown) => {
  const raw = textOf(value)
  return raw && raw !== 'СТАНДАРТ' ? raw : ''
}
const stockNumber = (value: unknown) => Math.max(0, Number(value) || 0)
const displayLabel = (variant: CatalogVariantRecord) =>
  [variant.color || 'Без цвета', variant.gender, visibleAttribute(variant.material),
    visibleAttribute(variant.length), variant.sizeLabel ? 'Размер ' + variant.sizeLabel : 'Без размера']
    .filter(Boolean).join(' · ')
const normalized = (value: string) => value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim()
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function drawBars(code: string): string {
  const encoded = encodeCode128B(code)
  const bars = encoded.bars.map(bar =>
    '<rect x="' + bar.x + '" y="3" width="' + bar.width + '" height="58" fill="#111"/>').join('')
  return '<svg viewBox="0 0 ' + encoded.width + ' 64" preserveAspectRatio="none" ' +
    'xmlns="http://www.w3.org/2000/svg" class="bars" aria-label="Штрихкод">' +
    '<rect width="' + encoded.width + '" height="64" fill="#fff"/>' + bars + '</svg>'
}

function renderPrintSheet(target: Window, items: VerifiedPrintItem[]): void {
  const count = items.reduce((sum, item) => sum + item.quantity, 0)
  const labels = items.flatMap(item => Array.from({ length: item.quantity }, () => {
    const identity = [item.variant.color, item.variant.gender,
      item.variant.sizeLabel ? 'Размер ' + item.variant.sizeLabel : ''].filter(Boolean).join(' · ')
    const extra = [visibleAttribute(item.variant.material), visibleAttribute(item.variant.length)]
      .filter(Boolean).join(' · ')
    return '<article class="label"><strong class="product">' + escapeHtml(item.productName) +
      '</strong><div class="identity">' + escapeHtml(identity) + '</div>' +
      (extra ? '<div class="identity">' + escapeHtml(extra) + '</div>' : '') +
      drawBars(item.barcode) + '<div class="code">' + escapeHtml(item.barcode) +
      '</div><div class="hint">Общий код варианта</div></article>'
  })).join('')
  const page = '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
    '<title>Этикетки · ' + count + ' шт.</title><style>' +
    '@page{size:58mm 35mm;margin:0}*{box-sizing:border-box}' +
    'body{margin:0;background:#f1f3f6;color:#101418;font-family:Arial,sans-serif}' +
    '.controls{position:sticky;top:0;background:white;padding:14px 18px;' +
    'display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-bottom:1px solid #ddd}' +
    '.controls button{padding:10px 18px;border:0;border-radius:7px;background:#183c60;color:white;cursor:pointer}' +
    '.controls p{margin:0;font-size:13px;line-height:1.4}' +
    '.labels{display:flex;gap:12px;flex-wrap:wrap;padding:18px;align-items:flex-start}' +
    '.label{width:58mm;height:35mm;background:white;padding:1.8mm 2mm;overflow:hidden;' +
    'display:flex;flex-direction:column;align-items:stretch;gap:.7mm;page-break-inside:avoid}' +
    '.product{font-size:9pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.identity{font-size:7pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.bars{display:block;min-height:0;flex:1;width:100%}' +
    '.code{font-size:8pt;font-weight:bold;text-align:center;letter-spacing:.3px}' +
    '.hint{font-size:6pt;text-align:center}' +
    '@media print{body{background:white}.controls{display:none}.labels{display:block;padding:0}' +
    '.label{break-after:page;page-break-after:always}.label:last-child{break-after:auto;page-break-after:auto}}' +
    '</style></head><body><div class="controls"><button onclick="window.print()">Печатать / Сохранить в PDF</button>' +
    '<p>' + count + ' этикеток · размер 58 × 35 мм · масштаб печати 100%. ' +
    'Все копии одного варианта имеют одинаковый штрихкод.</p></div>' +
    '<main class="labels">' + labels + '</main></body></html>'
  target.document.open()
  target.document.write(page)
  target.document.close()
  target.focus()
}

export function BarcodePrintWorkspace({ catalog, stock, onReload }: Props) {
  const [search, setSearch] = useState('')
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null)
  const [onlyStocked, setOnlyStocked] = useState(true)
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [refreshing, setRefreshing] = useState(true)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = async () => {
    setRefreshing(true)
    setError('')
    setLoadError('')
    try {
      if (!await onReload()) throw new Error('Не удалось загрузить актуальные товары и остатки.')
      setNotice('Остатки склада и бутика обновлены.')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Не удалось обновить остатки.'
      setLoadError(message)
      setError(message)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const ready = Boolean(!refreshing && !loadError && catalog?.ok && stock.warehouse?.ok && stock.boutique?.ok)
  const balances = useMemo(() => {
    const values = new Map<number, { warehouse: number; boutique: number }>()
    const repeated = new Set<number>()
    const seen = new Set<string>()
    for (const source of ['warehouse', 'boutique'] as const) {
      for (const row of stock[source]?.items || []) {
        const id = Number(row.variantId)
        if (!Number.isSafeInteger(id) || id <= 0) continue
        const value = values.get(id) || { warehouse: 0, boutique: 0 }
        const key = source + ':' + id
        if (seen.has(key)) repeated.add(id)
        seen.add(key)
        value[source] += stockNumber(row.quantity)
        values.set(id, value)
      }
    }
    return { values, repeated }
  }, [stock.warehouse, stock.boutique])

  const activeVariants = useMemo(() => {
    const activeProducts = new Set((catalog?.products || []).filter(product => product.isActive).map(product => product.id))
    return (catalog?.variants || []).filter(variant => variant.isActive && activeProducts.has(variant.productId))
  }, [catalog])

  const byProduct = useMemo(() => {
    const result = new Map<number, CatalogVariantRecord[]>()
    for (const variant of activeVariants) {
      const list = result.get(variant.productId) || []
      list.push(variant)
      result.set(variant.productId, list)
    }
    for (const list of result.values()) {
      list.sort((a, b) => displayLabel(a).localeCompare(displayLabel(b), 'ru', { numeric: true }))
    }
    return result
  }, [activeVariants])

  const productRows = useMemo(() => (catalog?.products || [])
    .filter(product => product.isActive && (byProduct.get(product.id)?.length || 0) > 0)
    .map(product => ({
      product, variants: byProduct.get(product.id) || [],
      stockTotal: (byProduct.get(product.id) || []).reduce((sum, variant) => {
        const entry = balances.values.get(variant.id)
        return sum + (entry?.warehouse || 0) + (entry?.boutique || 0)
      }, 0),
    }))
    .sort((a, b) => a.product.name.localeCompare(b.product.name, 'ru')),
  [catalog, byProduct, balances])

  const products = productRows.filter(row => {
    if (onlyStocked && row.stockTotal <= 0) return false
    const words = normalized(search).split(/\s+/).filter(Boolean)
    if (!words.length) return true
    return row.variants.some(variant => {
      const searchable = normalized(row.product.name + ' ' + displayLabel(variant))
      return words.every(word => searchable.includes(word))
    })
  })

  const selected = products.find(row => row.product.id === selectedProductId) || products[0] || null
  const visibleVariants = (selected?.variants || []).filter(variant => {
    const words = normalized(search).split(/\s+/).filter(Boolean)
    if (words.length && !words.every(word => normalized(selected?.product.name || '').includes(word)) &&
      !words.every(word => normalized((selected?.product.name || '') + ' ' + displayLabel(variant)).includes(word))) return false
    if (!onlyStocked) return true
    const amount = balances.values.get(variant.id)
    return (amount?.warehouse || 0) + (amount?.boutique || 0) > 0 || (counts[variant.id] || 0) > 0
  })

  const selectedPrint: PrintItem[] = activeVariants
    .filter(variant => Number(counts[variant.id] || 0) > 0)
    .map(variant => ({ variant, quantity: counts[variant.id] }))
  const totalLabels = selectedPrint.reduce((sum, item) => sum + item.quantity, 0)
  const excess = selectedPrint.filter(item => {
    const balance = balances.values.get(item.variant.id)
    return item.quantity > (balance?.warehouse || 0) + (balance?.boutique || 0)
  })
  const invalidStock = selectedPrint.some(item => balances.repeated.has(item.variant.id))
  const canPrint = ready && !printing && totalLabels > 0 && totalLabels <= MAX_LABELS &&
    !invalidStock && excess.length === 0

  const print = async () => {
    if (!canPrint) return
    const target = window.open('', '_blank', 'width=780,height=650')
    if (!target) {
      setError('Браузер заблокировал печать. Разрешите всплывающие окна для Orders-app.')
      return
    }
    setPrinting(true)
    setError('')
    setNotice('')
    try {
      const current = await onReload()
      if (!current) throw new Error('Не удалось обновить остатки перед печатью. Попробуйте ещё раз.')
      const verified: VerifiedPrintItem[] = []
      for (const item of selectedPrint) {
        const latestVariant = current.catalog.variants.find(variant => variant.id === item.variant.id)
        const latestProduct = current.catalog.products.find(product => product.id === item.variant.productId)
        if (!latestVariant?.isActive || !latestProduct?.isActive ||
          displayLabel(latestVariant) !== displayLabel(item.variant)) {
          throw new Error('Характеристики товара изменились. Список обновлён — проверьте выбор перед печатью.')
        }
        const physical = (['warehouse', 'boutique'] as const).reduce((sum, source) => {
          const matches = current[source].items.filter(row => row.variantId === item.variant.id)
          if (matches.length > 1) throw new Error('Для варианта обнаружены повторные строки остатка. Печать остановлена.')
          return sum + stockNumber(matches[0]?.quantity)
        }, 0)
        if (item.quantity > physical) {
          throw new Error('Остаток изменился. Для одного из вариантов нужно уменьшить количество этикеток.')
        }
        const result = await fetch('/api/barcodes/sku/' + encodeURIComponent(String(item.variant.id)), {
          method: 'GET', credentials: 'same-origin', cache: 'no-store',
        })
        const record = await result.json() as {
          ok?: boolean; active?: boolean; physicalUnit?: boolean; barcode?: string
          variantId?: number; productName?: string; color?: string; gender?: string
          material?: string; length?: string; size?: string; message?: string
        }
        if (!result.ok || !record.ok || !record.active || record.physicalUnit !== false ||
          record.variantId !== item.variant.id ||
          !record.barcode || record.barcode !== skuBarcodeForVariantId(item.variant.id) ||
          textOf(record.color) !== textOf(item.variant.color) || textOf(record.gender) !== textOf(item.variant.gender) ||
          textOf(record.material) !== textOf(item.variant.material) || textOf(record.length) !== textOf(item.variant.length) ||
          textOf(record.size) !== textOf(item.variant.sizeLabel)) {
          throw new Error('Один из вариантов изменён или удалён. Обновите список перед печатью.')
        }
        verified.push({ ...item, barcode: record.barcode, productName: record.productName || item.variant.productName })
      }
      if (!target.closed) {
        renderPrintSheet(target, verified)
        setNotice('Макет открыт в новой вкладке. Нажмите «Печатать / Сохранить в PDF».')
      }
    } catch (cause) {
      if (!target.closed) target.close()
      setError(cause instanceof Error ? cause.message : 'Не удалось проверить коды перед печатью.')
    } finally {
      setPrinting(false)
    }
  }

  const updateCount = (id: number, value: string) => {
    const number = Number(value)
    if (value && (!Number.isInteger(number) || number < 0 || number > MAX_LABELS)) return
    setCounts(old => ({ ...old, [id]: value === '' ? 0 : number }))
    setError('')
    setNotice('')
  }

  return <section className="barcode-workspace" aria-label="Штрихкоды товаров">
    <div className="barcode-page-head">
      <div><h3>Штрихкоды</h3><p>Найдите модель, выберите варианты и укажите количество этикеток.</p></div>
      <button type="button" className="secondary compact" onClick={() => void refresh()} disabled={refreshing || printing}>
        {refreshing ? 'Обновляю…' : 'Обновить остатки'}
      </button>
    </div>
    <div className="barcode-workflow-hint">
      <strong>Как распечатать</strong>
      <span>1. Найдите товар</span><span>2. Введите количество рядом с нужными размерами</span>
      <span>3. Нажмите «Открыть печать» внизу</span>
    </div>
    <p className="barcode-workflow-note">
      Показано физическое количество по системе, включая зарезервированные вещи.
      Один вариант имеет один общий код — даже если печатаете несколько копий.
      Печать не изменяет остатки.
    </p>
    {error ? <p className="barcode-workspace-error" role="alert">{error}</p> : null}
    {refreshing ? <p className="barcode-workspace-status" role="status">Загружаю актуальный каталог и остатки обеих точек…</p> : null}
    {!refreshing && !ready && !error ?
      <p className="barcode-workspace-error" role="alert">Не все данные загрузились. Нажмите «Обновить остатки». Печать недоступна.</p> : null}
    {ready && <>
      <div className="barcode-workspace-layout">
        <div className="barcode-models">
          <label className="barcode-model-search"><span>Поиск товара</span>
            <input value={search} onChange={event => setSearch(event.target.value)}
              type="search" placeholder="Название, цвет или размер…" autoComplete="off"/>
          </label>
          <label className="barcode-only-stock">
            <input type="checkbox" checked={onlyStocked} onChange={event => setOnlyStocked(event.target.checked)}/>
            Только товары с остатком
          </label>
          <div className="barcode-models-count">{products.length} моделей найдено</div>
          <div className="barcode-model-list" role="list" aria-label="Модели товаров">
            {products.map(row => <button type="button" key={row.product.id} role="listitem"
              className={'barcode-model-button' + (selected?.product.id === row.product.id ? ' is-active' : '')}
              onClick={() => setSelectedProductId(row.product.id)}>
              <strong>{row.product.name}</strong>
              <span>{row.variants.length} вариантов · всего {row.stockTotal} шт.</span>
            </button>)}
            {!products.length ? <p className="barcode-workspace-empty">
              Ничего не найдено. Измените запрос или отключите фильтр остатков.
            </p> : null}
          </div>
        </div>
        <div className="barcode-variants">
          {selected ? <>
            <div className="barcode-variants-head">
              <div><span className="barcode-section-kicker">Выбранная модель</span>
                <h4>{selected.product.name}</h4>
                <p>Введите, сколько копий этикетки нужно напечатать для каждого варианта.</p>
              </div>
            </div>
            <div className="barcode-variant-table-head" aria-hidden="true">
              <span>Цвет, размер и исполнение</span><span>Физический остаток</span><span>Этикеток</span>
            </div>
            <div className="barcode-variant-list">
              {visibleVariants.map(variant => {
                const balance = balances.values.get(variant.id) || { warehouse: 0, boutique: 0 }
                const physical = balance.warehouse + balance.boutique
                return <div className="barcode-variant-row" key={variant.id}>
                  <div className="barcode-variant-name">
                    <strong>{variant.color || 'Без цвета'} · {variant.sizeLabel || 'Без размера'}</strong>
                    <small>{[variant.gender, visibleAttribute(variant.material), visibleAttribute(variant.length)]
                      .filter(Boolean).join(' · ') || 'Основное исполнение'}</small>
                  </div>
                  <div className="barcode-variant-stocks">
                    <span>Склад <strong>{balance.warehouse}</strong></span>
                    <span>Бутик <strong>{balance.boutique}</strong></span>
                    <small>Всего {physical} шт.</small>
                  </div>
                  <label className="barcode-variant-input">
                    <span className="sr-only">Этикеток для {selected.product.name} · {displayLabel(variant)}</span>
                    <input type="number" min="0" max={MAX_LABELS} step="1"
                      inputMode="numeric" value={counts[variant.id] || 0}
                      onChange={event => updateCount(variant.id, event.target.value)} disabled={printing}
                      aria-label={'Количество этикеток: ' + selected.product.name + ' · ' + displayLabel(variant)}/>
                    <small>копий</small>
                  </label>
                </div>
              })}
              {!visibleVariants.length ? <p className="barcode-workspace-empty">Для модели нет вариантов с остатком.</p> : null}
            </div>
          </> : <div className="barcode-variant-welcome">
            <strong>Выберите товар слева</strong><p>Здесь появятся его варианты и остатки по двум точкам.</p>
          </div>}
        </div>
      </div>
      <div className="barcode-print-footer">
        <div className="barcode-print-summary">
          <strong>{totalLabels ? totalLabels + ' этикеток' : 'Пока ничего не выбрано'}</strong>
          <span>{selectedPrint.length} вариантов · формат 58 × 35 мм</span>
          {invalidStock ? <small className="barcode-print-warning">Обнаружены повторные строки остатка. Печать заблокирована до сверки.</small> : null}
          {excess.length ? <small className="barcode-print-warning">
            Количество этикеток превышает остаток для {excess.length} вариантов. Уменьшите количество.
          </small> : null}
          {totalLabels > MAX_LABELS ? <small className="barcode-print-warning">За один раз можно напечатать до {MAX_LABELS} этикеток.</small> : null}
        </div>
        <div className="barcode-print-actions">
          {totalLabels > 0 ? <button type="button" className="secondary compact"
            onClick={() => { setCounts({}); setNotice('Выбор очищен.') }} disabled={printing}>Очистить выбор</button> : null}
          <button type="button" className="primary barcode-print-main-action" disabled={!canPrint}
            onClick={() => void print()}>{printing ? 'Проверяю коды…' : 'Открыть печать'}</button>
        </div>
      </div>
      {notice ? <p className="barcode-workspace-status" role="status">{notice}</p> : null}
    </>}
  </section>
}
