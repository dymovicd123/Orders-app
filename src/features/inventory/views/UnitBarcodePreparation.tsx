import { useEffect, useRef, useState } from 'react'
import { encodeCode128B } from '../../../../shared/barcode-code128.ts'
import './unitBarcodePreparation.css'

type Location = {
  source: 'warehouse' | 'boutique'
  physicalQuantity: number
  prepared: number
  available: number
  discrepancy: boolean
}
type BatchSummary = {
  batchId: string
  createdAt: string
  source: 'warehouse' | 'boutique'
  quantity: number
  canReprint: boolean
  canCancel: boolean
}
type Preview = { ok: boolean; maximumPerBatch: number; locations: Location[]; recentBatches: BatchSummary[]; message?: string }
type Batch = {
  ok: boolean
  batchId: string
  variantId: number
  source: 'warehouse' | 'boutique'
  quantity: number
  labels: Array<{ token: string; unitId: string }>
  duplicate?: boolean
  message?: string
}
const sourceName = (value: string) => value === 'boutique' ? 'Бутик' : 'Склад'
const escaped = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function printableSvg(token: string) {
  const barcode = encodeCode128B(token)
  return '<svg class="bars" viewBox="0 0 ' + barcode.width + ' 64" preserveAspectRatio="none" ' +
    'xmlns="http://www.w3.org/2000/svg"><rect width="' + barcode.width +
    '" height="64" fill="#fff"/>' + barcode.bars.map(bar =>
      '<rect x="' + bar.x + '" y="3" width="' + bar.width + '" height="58" fill="#111"/>'
    ).join('') + '</svg>'
}

function renderBatch(windowToPrint: Window, batch: Batch, productName: string, variantLabel: string) {
  const labels = batch.labels.map((entry, index) =>
    '<section class="label"><div class="title">' + escaped(productName) + '</div>' +
    '<div class="details">' + escaped(variantLabel) + '</div>' +
    printableSvg(entry.token) +
    '<div class="code">' + escaped(entry.token) + '</div>' +
    '<div class="note">Индивидуальная метка ' + (index + 1) + '/' + batch.quantity +
    ' · ' + sourceName(batch.source) + '</div></section>'
  ).join('')
  const html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"/>' +
    '<title>Индивидуальные этикетки</title><style>' +
    '@page{size:58mm 35mm;margin:0}html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,sans-serif}' +
    '.label{width:58mm;height:35mm;box-sizing:border-box;padding:2mm;overflow:hidden;display:flex;flex-direction:column;gap:1mm;break-after:page;page-break-after:always}' +
    '.label:last-of-type{break-after:auto;page-break-after:auto}' +
    '.title{font-weight:700;font-size:9pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.details{font-size:7pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.bars{width:100%;height:13mm;display:block}.code{font-size:8pt;font-weight:bold;text-align:center;letter-spacing:.2px}' +
    '.note{font-size:6pt;text-align:center}' +
    '.controls{padding:12px;font-size:14px}.controls p{max-width:550px}' +
    '@media print{.controls{display:none}}' +
    '</style></head><body>' + labels +
    '<div class="controls"><button onclick="window.print()">Печать ' + batch.quantity +
    ' этикеток</button><p>Размер 58 × 35 мм, масштаб 100%. Каждая этикетка — отдельная страница. ' +
    'Этикетки ещё не означают приёмку, выдачу или подтверждение физического остатка.</p></div></body></html>'
  windowToPrint.document.open()
  windowToPrint.document.write(html)
  windowToPrint.document.close()
  windowToPrint.focus()
}

async function readJson<T extends { ok?: boolean; message?: string }>(response: Response): Promise<T> {
  const data = await response.json() as T
  if (!response.ok || data.ok !== true) throw new Error(data.message || 'Не удалось выполнить действие.')
  return data
}

export function UnitBarcodePreparation({
  variantId, productName, variantLabel, initialSource, initialQuantity = 1,
  buttonLabel = 'Маркировать вещи',
}: {
  variantId: number
  productName: string
  variantLabel: string
  initialSource?: 'warehouse' | 'boutique'
  initialQuantity?: number
  buttonLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [source, setSource] = useState<'warehouse' | 'boutique'>(initialSource || 'warehouse')
  const [quantity, setQuantity] = useState(Math.max(1, Math.min(20, Math.floor(initialQuantity))))
  const [batch, setBatch] = useState<Batch | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [confirmCancelId, setConfirmCancelId] = useState('')
  const [error, setError] = useState('')
  const [copiedCode, setCopiedCode] = useState('')
  const [copyError, setCopyError] = useState('')
  const requestIdRef = useRef('')
  const requestRef = useRef(0)

  const reload = async () => {
    const current = ++requestRef.current
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/barcodes/units/preview?variantId=' + encodeURIComponent(String(variantId)), {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
      })
      const data = await readJson<Preview>(response)
      if (requestRef.current === current) {
        setPreview(data)
        if (!initialSource && !data.locations.some(row => row.source === source && row.available > 0)) {
          setSource(data.locations.find(row => row.available > 0)?.source || 'warehouse')
        }
      }
    } catch (cause) {
      if (requestRef.current === current) setError(cause instanceof Error ? cause.message : 'Ошибка загрузки')
    } finally {
      if (requestRef.current === current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    void reload()
    return () => { requestRef.current++ }
  }, [open, variantId])

  useEffect(() => {
    if (!open) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving && !printing && !cancelling) setOpen(false)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [open, saving, printing, cancelling])

  const location = preview?.locations.find(row => row.source === source)
  const available = location?.available ?? 0
  const canPrepare = Boolean(preview && available >= quantity && quantity > 0 &&
    quantity <= (preview?.maximumPerBatch || 20) && !location?.discrepancy)

  const copyTestCode = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token)
      setCopiedCode(token)
      setCopyError('')
    } catch {
      setCopyError('Не удалось скопировать автоматически. Выделите код и скопируйте его вручную.')
    }
  }

  const create = async () => {
    if (!canPrepare || saving || cancelling) return
    const requestId = requestIdRef.current || crypto.randomUUID()
    requestIdRef.current = requestId
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/barcodes/units/batches', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId, source, quantity, requestId }),
      })
      const result = await readJson<Batch>(response)
      setBatch(result)
      requestIdRef.current = ''
      void reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка создания этикеток')
    } finally {
      setSaving(false)
    }
  }

  const loadExisting = async (batchId: string) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/barcodes/units/batches/' + encodeURIComponent(batchId), {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
      })
      setBatch(await readJson<Batch>(response))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть партию')
    } finally {
      setLoading(false)
    }
  }

  const cancelBatch = async (batchId: string) => {
    if (cancelling || saving || printing) return
    setCancelling(true)
    setError('')
    try {
      const response = await fetch('/api/barcodes/units/batches/' + encodeURIComponent(batchId) + '/cancel', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      })
      await readJson<{ ok: boolean }>(response)
      if (batch?.batchId === batchId) setBatch(null)
      setConfirmCancelId('')
      requestIdRef.current = ''
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось аннулировать партию')
    } finally {
      setCancelling(false)
    }
  }

  const print = async () => {
    if (!batch || printing) return
    const printWindow = window.open('', '_blank', 'width=680,height=530')
    if (!printWindow) {
      setError('Разрешите всплывающие окна для Orders-app, чтобы открыть печать.')
      return
    }
    setPrinting(true)
    setError('')
    try {
      const response = await fetch('/api/barcodes/units/batches/' + encodeURIComponent(batch.batchId), {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
      })
      const latest = await readJson<Batch>(response)
      if (latest.variantId !== variantId || latest.quantity !== batch.quantity ||
          latest.labels.map(x => x.token).join('|') !== batch.labels.map(x => x.token).join('|')) {
        throw new Error('Партия изменилась. Печать отменена.')
      }
      if (!printWindow.closed) renderBatch(printWindow, latest, productName, variantLabel)
    } catch (cause) {
      if (!printWindow.closed) printWindow.close()
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть печать')
    } finally {
      setPrinting(false)
    }
  }

  return <div className="unit-barcode-entry">
    <button className="secondary compact" type="button" onClick={() => {
      setBatch(null)
      setConfirmCancelId('')
      setOpen(true)
    }}>{buttonLabel}</button>
    {open ? <div className="unit-barcode-overlay" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget && !saving && !printing && !cancelling) setOpen(false)
    }}>
      <section className="unit-barcode-modal" role="dialog" aria-modal="true"
        aria-label="Индивидуальные этикетки вещей">
        <div className="unit-barcode-head">
          <div>
            <h3>Маркировать вещи</h3>
            <p>{productName} · {variantLabel}</p>
          </div>
          <button type="button" className="secondary compact" disabled={saving || printing || cancelling}
            onClick={() => setOpen(false)}>Закрыть</button>
        </div>
        <p className="unit-barcode-note">Для каждой физической вещи создаётся отдельный код.
          Это подготовка этикеток, а не новый приход. Количество на складе не изменится.
          Сами этикетки не подтверждают физическое наличие или выполнение складской операции.</p>
        <div className="unit-barcode-fields">
          <label>
            <span>Где находятся вещи</span>
            <select value={source} onChange={event => {
              setSource(event.target.value as 'warehouse' | 'boutique')
              requestIdRef.current = ''
            }} disabled={saving}>
              <option value="warehouse">Склад</option>
              <option value="boutique">Бутик</option>
            </select>
          </label>
          <label>
            <span>Количество этикеток</span>
            <input type="number" min={1} max={Math.min(20, available)} value={quantity}
              disabled={saving} onChange={event => {
                setQuantity(Number(event.target.value))
                requestIdRef.current = ''
              }}/>
          </label>
        </div>
        <p className="unit-barcode-capacity" role="status">
          {loading && !preview ? 'Проверяю остатки…' : location
            ? `${sourceName(source)}: по системе ${location.physicalQuantity} шт. · уже подготовлено ${location.prepared} · можно подготовить ещё ${available}`
            : 'Выберите точку хранения.'}
        </p>
        {location?.discrepancy ? <p className="unit-barcode-error" role="alert">
          Подготовленных этикеток больше текущего остатка. Нужна сверка до продолжения.
        </p> : null}
        {error ? <p className="unit-barcode-error" role="alert">{error}</p> : null}
        <div className="unit-barcode-action-row">
          <button className="primary compact" type="button"
            disabled={!canPrepare || saving || loading || cancelling} onClick={() => void create()}>
            {saving ? 'Сохраняю…' : `Подготовить ${quantity} ${quantity === 1 ? 'этикетку' : 'этикетки'}`}
          </button>
          <button className="secondary compact" type="button" disabled={loading || saving || cancelling}
            onClick={() => void reload()}>Обновить остатки</button>
        </div>
        {batch ? <div className="unit-barcode-success" role="status">
          <strong>Партия из {batch.quantity} этикеток подготовлена</strong>
          <span>Коды сохранены. Повторно печатайте только для тех же самых вещей, если первая этикетка испорчена. Не наклеивайте одинаковый код на разные изделия.</span>
          <button type="button" className="primary compact" disabled={printing}
            onClick={() => void print()}>{printing ? 'Проверяю…' : 'Печать этикеток · 58 × 35 мм'}</button>
          <details className="unit-barcode-test">
            <summary>Проверить без сканера и принтера</summary>
            <p>Скопируйте индивидуальный код и вставьте его в поле «Найти по штрихкоду».
              Нажмите Enter — это имитирует ввод USB-сканера. Для проверки печатного макета
              нажмите «Печать этикеток» и выберите в браузере «Сохранить в PDF».</p>
            <p>Это проверка поиска и макета. Не подтверждайте списание, перемещение
              или ревизию реальных вещей только ради теста. Если этикетки создавались только для проверки и не использовались на товарах, аннулируйте партию после проверки.</p>
            <div className="unit-barcode-test-codes">
              {batch.labels.map(entry => <div className="unit-barcode-test-code" key={entry.unitId}>
                <code>{entry.token}</code>
                <button type="button" className="secondary compact"
                  onClick={() => void copyTestCode(entry.token)}>
                  {copiedCode === entry.token ? 'Скопировано' : 'Копировать'}
                </button>
              </div>)}
            </div>
            {copyError ? <p className="unit-barcode-error" role="alert">{copyError}</p> : null}
          </details>
        </div> : null}
        {preview?.recentBatches.length ? <div className="unit-barcode-recent">
          <strong>Недавние партии · повторная печать</strong>
          {preview.recentBatches.map(row => <div key={row.batchId} className="unit-barcode-recent-item"><div className="unit-barcode-recent-row">
            <span>{sourceName(row.source)} · {row.quantity} шт · {new Date(row.createdAt).toLocaleDateString('ru-RU')}</span>
            <div className="unit-barcode-recent-actions">
              <button type="button" className="secondary compact"
                disabled={!row.canReprint || loading || saving || cancelling}
                onClick={() => void loadExisting(row.batchId)}>
                {row.canReprint ? 'Повторить печать' : 'Недействительна'}
              </button>
              {row.canCancel ? <button type="button" className="secondary compact"
                disabled={cancelling || saving || printing} onClick={() => setConfirmCancelId(row.batchId)}>
                Аннулировать
              </button> : null}
            </div>
          </div>
          {confirmCancelId === row.batchId ? <div key={row.batchId + '-confirm'} className="unit-barcode-cancel-warning" role="alert">
            <span>Все {row.quantity} кодов станут недействительными. Если этикетки уже наклеены, их необходимо снять.</span>
            <button className="danger compact" type="button" disabled={cancelling}
              onClick={() => void cancelBatch(row.batchId)}>
              {cancelling ? 'Аннулирую…' : 'Подтвердить аннулирование'}
            </button>
            <button className="secondary compact" type="button" disabled={cancelling}
              onClick={() => setConfirmCancelId('')}>Отмена</button>
          </div> : null}</div>)}
        </div> : null}
      </section>
    </div> : null}
  </div>
}
