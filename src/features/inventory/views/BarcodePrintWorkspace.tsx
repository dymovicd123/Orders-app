import { useEffect, useMemo, useState } from 'react'
import type { CatalogResponse, CatalogVariantRecord, InventoryResponse } from '../../../app/types'
import { skuBarcodeForVariantId } from '../../../../shared/barcode-sku.ts'
import { encodeCode128B } from '../../../../shared/barcode-code128.ts'
import { paginateBarcodeLabels, MAX_BARCODE_PRINT_LABELS, A4_LABELS_PER_PAGE, type BarcodePrintMode } from './barcodePrintPages'
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

const MAX_LABELS = MAX_BARCODE_PRINT_LABELS

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
  const paths = encoded.bars.map(bar =>
    'M' + bar.x + ',3h' + bar.width + 'v58h-' + bar.width + 'z').join('')
  return '<svg viewBox="0 0 ' + encoded.width + ' 64" preserveAspectRatio="none" ' +
    'xmlns="http://www.w3.org/2000/svg" class="bars" aria-label="Штрихкод">' +
    '<rect width="' + encoded.width + '" height="64" fill="#fff"/>' +
    '<path d="' + paths + '" fill="#111"/></svg>'
}

function renderPrintSheet(target: Window, items: VerifiedPrintItem[], mode: BarcodePrintMode): void {
  const count = items.reduce((sum, item) => sum + item.quantity, 0)
  const labelMarkup = items.flatMap(item => Array.from({ length: item.quantity }, () => {
    const identity = [item.variant.color, item.variant.gender,
      item.variant.sizeLabel ? 'Размер ' + item.variant.sizeLabel : ''].filter(Boolean).join(' · ')
    const extra = [visibleAttribute(item.variant.material), visibleAttribute(item.variant.length)]
      .filter(Boolean).join(' · ')
    return '<article class="label"><strong class="product">' + escapeHtml(item.productName) +
      '</strong><div class="identity">' + escapeHtml(identity) + '</div>' +
      (extra ? '<div class="identity">' + escapeHtml(extra) + '</div>' : '') +
      drawBars(item.barcode) + '<div class="code">' + escapeHtml(item.barcode) +
      '</div></article>'
  }))
  const pages = paginateBarcodeLabels(labelMarkup, mode)
  const sheets = pages.map((page, index) =>
    '<section class="sheet" aria-label="Лист ' + (index + 1) + '">' + page.join('') + '</section>').join('')
  const isA4 = mode === 'a4'
  const pageCss = isA4
    ? '@page{size:A4;margin:0}'
    : '@page{size:58mm 35mm;margin:0}'
  const sheetCss = isA4
    ? '.sheet{width:210mm;height:297mm;padding:14mm 15mm;display:grid;' +
      'grid-template-columns:repeat(3,58mm);grid-template-rows:repeat(7,35mm);' +
      'gap:3mm;align-content:start;justify-content:start}'
    : '.sheet{width:58mm;height:35mm;padding:0;display:block}'
  const hint = isA4
    ? count + ' этикеток · ' + pages.length + ' листов A4 · ' + A4_LABELS_PER_PAGE + ' этикетка на полном листе. ' +
      'В печати выберите бумагу A4, масштаб 100%, без полей.'
    : count + ' этикеток · ' + count + ' отдельных этикеток 58 × 35 мм. ' +
      'Выберите принтер этикеток и в его настройках размер 58 × 35 мм, масштаб 100%.'
  const html = '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
    '<title>Этикетки · ' + count + ' шт.</title><style>' +
    pageCss + '*{box-sizing:border-box}' +
    'body{margin:0;background:#e9edf2;color:#101418;font-family:Arial,sans-serif}' +
    '.controls{position:sticky;top:0;background:white;padding:14px 18px;' +
    'display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-bottom:1px solid #ddd;z-index:1}' +
    '.controls button{padding:10px 18px;border:0;border-radius:7px;background:#183c60;color:white;cursor:pointer}' +
    '.controls p{margin:0;font-size:13px;line-height:1.4}' +
    '.pages{display:flex;flex-direction:column;align-items:flex-start;gap:14px;padding:18px}' +
    '.sheet{background:white;box-shadow:0 2px 8px rgba(10,20,30,.12)}' + sheetCss +
    '.label{width:58mm;height:35mm;background:white;padding:1.8mm 2mm;overflow:hidden;' +
    'display:flex;flex-direction:column;align-items:stretch;gap:.7mm;' +
    'outline:1px dashed #e5e7eb;outline-offset:-1px;break-inside:avoid}' +
    '.product{font-size:8.5pt;line-height:1.08;max-height:7mm;overflow:hidden;overflow-wrap:anywhere}' +
    '.identity{font-size:7pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.bars{display:block;min-height:10mm;flex:1;width:100%}' +
    '.code{font-size:8pt;font-weight:bold;text-align:center;letter-spacing:.3px}' +
    '@media print{body{background:white}.controls{display:none}' +
    '.pages{display:block;padding:0}.sheet{box-shadow:none;break-after:page;page-break-after:always}' +
    '.sheet:last-child{break-after:auto;page-break-after:auto}' +
    '.label{outline:none}}' +
    '</style></head><body><div class="controls">' +
    '<button type="button" onclick="window.print()">Печатать / Сохранить в PDF</button>' +
    '<p>' + hint + '</p></div><main class="pages">' + sheets + '</main></body></html>'
  target.document.open()
  target.document.write(html)
  target.document.close()
  target.focus()
}

export function BarcodePrintWorkspace({ catalog, stock, onReload }: Props) {
  const [search, setSearch] = useState('')
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null)
  const [onlyStocked, setOnlyStocked] = useState(true)
  const [variantQuery, setVariantQuery] = useState('')
  const [colorFilter, setColorFilter] = useState('')
  const [sizeFilter, setSizeFilter] = useState('')
  const [openedColors, setOpenedColors] = useState<Record<string, boolean>>({})
  const [quantityDrafts, setQuantityDrafts] = useState<Record<number, string>>({})
  const [printMode, setPrintMode] = useState<BarcodePrintMode>('a4')
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
    return words.every(word => normalized(row.product.name).includes(word))
  })

  const selected = products.find(row => row.product.id === selectedProductId) || products[0] || null
  const choices = selected?.variants || []
  const availableColors = [...new Set(choices.map(variant => variant.color || 'Без цвета'))]
    .sort((a, b) => a.localeCompare(b, 'ru'))
  const availableSizes = [...new Set(choices.map(variant => variant.sizeLabel || 'Без размера'))]
    .sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
  const visibleVariants = choices.filter(variant => {
    if (colorFilter && colorFilter !== (variant.color || 'Без цвета')) return false
    if (sizeFilter && sizeFilter !== (variant.sizeLabel || 'Без размера')) return false
    const words = normalized(variantQuery).split(/\s+/).filter(Boolean)
    if (!words.every(word => normalized(displayLabel(variant)).includes(word))) return false
    if (!onlyStocked) return true
    const amount = balances.values.get(variant.id)
    return (amount?.warehouse || 0) + (amount?.boutique || 0) > 0 || (counts[variant.id] || 0) > 0
  })
  const colorGroups = [...new Set(visibleVariants.map(variant => variant.color || 'Без цвета'))].map(color => {
    const variants = visibleVariants.filter(variant => (variant.color || 'Без цвета') === color)
    const physical = variants.reduce((sum, variant) => {
      const value = balances.values.get(variant.id)
      return sum + (value?.warehouse || 0) + (value?.boutique || 0)
    }, 0)
    const marked = variants.filter(variant => (counts[variant.id] || 0) > 0).length
    return { color, variants, physical, marked, key: String(selected?.product.id || '') + ':' + color }
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
  const canPrint = ready && !printing && totalLabels > 0 && totalLabels <= MAX_LABELS

  const print = async () => {
    if (!canPrint) return
    const target = window.open('', '_blank', 'width=780,height=650')
    if (!target) {
      setError('Браузер заблокировал печать. Разрешите всплывающие окна для Orders-app.')
      return
    }
    target.document.body.innerHTML = '<p style="font:14px Arial,sans-serif;padding:18px">Проверяю варианты перед печатью…</p>'
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
        renderPrintSheet(target, verified, printMode)
        setNotice('Макет открыт в новой вкладке. Нажмите «Печатать / Сохранить в PDF».')
      }
    } catch (cause) {
      if (!target.closed) target.close()
      setError(cause instanceof Error ? cause.message : 'Не удалось проверить коды перед печатью.')
    } finally {
      setPrinting(false)
    }
  }

  const updateCount = (id: number, raw: string) => {
    if (!/^\d*$/.test(raw)) return
    const text = raw.replace(/^0+(?=\d)/, '')
    const amount = text ? Number(text) : 0
    if (!Number.isSafeInteger(amount) || amount > MAX_LABELS) return
    setQuantityDrafts(current => ({ ...current, [id]: text }))
    setCounts(current => ({ ...current, [id]: amount }))
    setError('')
    setNotice('')
  }
  const finishCount = (id: number) => {
    setQuantityDrafts(current => {
      if (!Object.prototype.hasOwnProperty.call(current, id)) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  }
  const chooseProduct = (id: number) => {
    setSelectedProductId(id)
    setVariantQuery('')
    setColorFilter('')
    setSizeFilter('')
  }
  const useVisibleStock = () => {
    setCounts(current => {
      const next = { ...current }
      for (const variant of visibleVariants) {
        const value = balances.values.get(variant.id)
        next[variant.id] = (value?.warehouse || 0) + (value?.boutique || 0)
      }
      return next
    })
    setQuantityDrafts(current => {
      const next = { ...current }
      for (const variant of visibleVariants) delete next[variant.id]
      return next
    })
  }

  return <section className="barcode-workspace" aria-label="Штрихкоды товаров">
    <div className="barcode-page-head">
      <div><h3>Штрихкоды</h3><p>Найдите модель, выберите варианты и укажите количество этикеток.</p></div>
      <button type="button" className="secondary compact" onClick={() => void refresh()} disabled={refreshing || printing}>
        {refreshing ? 'Обновляю…' : 'Обновить остатки'}
      </button>
    </div>
    <p className="barcode-workflow-note">
      Модель → цвет и размер → количество → печать. Остатки служат ориентиром,
      а не ограничением печати. Все копии одного варианта имеют одинаковый код.
    </p>
    {error ? <p className="barcode-workspace-error" role="alert">{error}</p> : null}
    {refreshing ? <p className="barcode-workspace-status" role="status">Загружаю актуальный каталог и остатки обеих точек…</p> : null}
    {!refreshing && !ready && !error ?
      <p className="barcode-workspace-error" role="alert">Не все данные загрузились. Нажмите «Обновить остатки». Печать недоступна.</p> : null}
    {ready && <>
      <div className="barcode-workspace-layout">
        <div className="barcode-models">
          <label className="barcode-model-search"><span>Поиск товара</span>
            <input value={search} onChange={event => {
                setSearch(event.target.value)
                setSelectedProductId(null)
                setColorFilter('')
                setSizeFilter('')
                setVariantQuery('')
              }}
              type="search" placeholder="Название модели…" autoComplete="off"/>
          </label>
          <label className="barcode-only-stock">
            <input type="checkbox" checked={onlyStocked} onChange={event => setOnlyStocked(event.target.checked)}/>
            Только товары с остатком
          </label>
          <div className="barcode-models-count">{products.length} моделей найдено</div>
          <div className="barcode-model-list" role="list" aria-label="Модели товаров">
            {products.map(row => <button type="button" key={row.product.id} role="listitem"
              className={'barcode-model-button' + (selected?.product.id === row.product.id ? ' is-active' : '')}
              onClick={() => chooseProduct(row.product.id)}>
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
            <div className="barcode-variants-head barcode-compact-head">
              <div><span className="barcode-section-kicker">Модель</span>
                <h4>{selected.product.name}</h4>
                <p>{choices.length} вариантов · физический остаток: {selected.stockTotal} шт.</p>
              </div>
            </div>
            <div className="barcode-variant-filters">
              <label className="barcode-variant-filter">
                <span>Цвет</span>
                <select value={colorFilter} onChange={event => setColorFilter(event.target.value)}>
                  <option value="">Все цвета</option>
                  {availableColors.map(color => <option value={color} key={color}>{color}</option>)}
                </select>
              </label>
              <label className="barcode-variant-filter">
                <span>Размер</span>
                <select value={sizeFilter} onChange={event => setSizeFilter(event.target.value)}>
                  <option value="">Все размеры</option>
                  {availableSizes.map(size => <option value={size} key={size}>{size}</option>)}
                </select>
              </label>
              <label className="barcode-variant-filter barcode-variant-filter-search">
                <span>Уточнить исполнение</span>
                <input type="search" autoComplete="off" value={variantQuery}
                  placeholder="Пол, материал, длина…"
                  onChange={event => setVariantQuery(event.target.value)}/>
              </label>
            </div>
            <div className="barcode-variant-tools">
              <span>Показано {visibleVariants.length} из {choices.length} вариантов</span>
              <button className="secondary compact" type="button" disabled={!visibleVariants.length || printing}
                onClick={useVisibleStock} title="Подставить физический остаток для показанных вариантов; потом любое число можно изменить">
                Заполнить количество по остатку
              </button>
            </div>
            <div className="barcode-color-groups">
              {colorGroups.map((group, index) => {
                const expanded = openedColors[group.key] ??
                  (Boolean(colorFilter || sizeFilter || variantQuery.trim()) || index === 0)
                return <section key={group.key} className="barcode-color-group">
                  <button type="button" className="barcode-color-heading"
                    aria-expanded={expanded} onClick={() => {
                      setOpenedColors(current => ({ ...current, [group.key]: !expanded }))
                    }}>
                    <span className="barcode-color-chevron" aria-hidden="true">{expanded ? '⌄' : '›'}</span>
                    <strong>{group.color}</strong>
                    <small>{group.variants.length} вар. · в наличии {group.physical} шт.</small>
                    {group.marked > 0 ? <span className="barcode-color-selected">Выбрано {group.marked}</span> : null}
                  </button>
                  {expanded ? <div className="barcode-color-items">
                    {group.variants.map(variant => {
                      const balance = balances.values.get(variant.id) || { warehouse: 0, boutique: 0 }
                      const physical = balance.warehouse + balance.boutique
                      const other = [variant.gender, visibleAttribute(variant.material),
                        visibleAttribute(variant.length)].filter(Boolean).join(' · ')
                      return <div className={'barcode-variant-row' + ((counts[variant.id] || 0) ? ' has-selection' : '')}
                        key={variant.id}>
                        <div className="barcode-variant-name">
                          <strong>{variant.sizeLabel ? 'Размер ' + variant.sizeLabel : 'Без размера'}</strong>
                          {other ? <small title={other}>{other}</small> : null}
                        </div>
                        <div className="barcode-variant-stocks">
                          <span><small>Склад</small> <strong>{balance.warehouse}</strong></span>
                          <span><small>Бутик</small> <strong>{balance.boutique}</strong></span>
                          <small>Всего {physical} шт.</small>
                        </div>
                        <label className="barcode-variant-input">
                          <span className="barcode-count-label">Этикеток</span>
                          <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="0"
                            autoComplete="off" value={quantityDrafts[variant.id] ??
                              (counts[variant.id] ? String(counts[variant.id]) : '')}
                            onFocus={event => event.currentTarget.select()}
                            onChange={event => updateCount(variant.id, event.target.value)}
                            onBlur={() => finishCount(variant.id)} disabled={printing}
                            aria-label={'Количество этикеток: ' + selected.product.name + ' · ' + displayLabel(variant)}/>
                        </label>
                      </div>
                    })}
                  </div> : null}
                </section>
              })}
              {!visibleVariants.length ? <p className="barcode-workspace-empty">
                Нет подходящих вариантов. Уберите фильтр цвета, размера или снимите ограничение по остатку.
              </p> : null}
            </div>
          </> : <div className="barcode-variant-welcome">
            <strong>Выберите товар слева</strong><p>Здесь появятся его варианты и остатки по двум точкам.</p>
          </div>}
        </div>
      </div>
      <div className="barcode-print-footer">
        <div className="barcode-print-summary">
          <strong>{totalLabels ? totalLabels + ' этикеток' : 'Пока ничего не выбрано'}</strong>
          <span>{selectedPrint.length} вариантов · до {MAX_LABELS} этикеток за раз</span>
          {selectedPrint.length ? <details className="barcode-selected-details">
            <summary>Что будет напечатано</summary>
            <ul>{selectedPrint.map(item => <li key={item.variant.id}>
              <span>{item.variant.productName} · {displayLabel(item.variant)}</span>
              <strong>{item.quantity} шт.</strong>
            </li>)}</ul>
          </details> : null}
          {invalidStock ? <small className="barcode-print-notice">
            У некоторых вариантов повторяются строки остатков. Печать кода допустима, но количество стоит уточнить.
          </small> : null}
          {excess.length ? <small className="barcode-print-notice">
            Для {excess.length} вариантов копий больше, чем числится на складе.
            Печатать можно: это не приход и не изменение остатков.
          </small> : null}
          {totalLabels > MAX_LABELS ? <small className="barcode-print-warning">За один раз можно напечатать до {MAX_LABELS} этикеток.</small> : null}
        </div>
        <div className="barcode-print-actions">
          <fieldset className="barcode-print-modes" disabled={printing}>
            <legend>Как будете печатать?</legend>
            <label className={printMode === 'a4' ? 'is-selected' : ''}>
              <input type="radio" name="barcode-paper-mode" checked={printMode === 'a4'}
                onChange={() => setPrintMode('a4')}/>
              <span><strong>A4</strong><small>До 21 этикетки на листе</small></span>
            </label>
            <label className={printMode === 'thermal' ? 'is-selected' : ''}>
              <input type="radio" name="barcode-paper-mode" checked={printMode === 'thermal'}
                onChange={() => setPrintMode('thermal')}/>
              <span><strong>Принтер этикеток</strong><small>Лента 58 × 35 мм</small></span>
            </label>
          </fieldset>
          {totalLabels > 0 ? <button type="button" className="secondary compact"
            onClick={() => { setCounts({}); setQuantityDrafts({}); setNotice('Выбор очищен.') }} disabled={printing}>Очистить выбор</button> : null}
          <button type="button" className="primary barcode-print-main-action" disabled={!canPrint}
            onClick={() => void print()}>{printing ? 'Проверяю коды…' : 'Открыть печать'}</button>
        </div>
      </div>
      {notice ? <p className="barcode-workspace-status" role="status">{notice}</p> : null}
    </>}
  </section>
}
