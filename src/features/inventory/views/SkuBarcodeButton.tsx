import { useEffect, useState } from 'react'
import { encodeCode128B } from '../../../../shared/barcode-code128.ts'
import './skuBarcodeLabel.css'

type SkuBarcodeRecord = {
  ok: boolean
  barcode?: string
  productName?: string
  gender?: string
  color?: string
  material?: string
  length?: string
  size?: string
  active?: boolean
  physicalUnit?: boolean
  message?: string
}

function clean(value: unknown): string {
  return String(value || '').trim()
}

function htmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function Code128Svg({ code }: { code: string }) {
  const barcode = encodeCode128B(code)
  return <svg className="sku-barcode-graphic" viewBox={'0 0 ' + barcode.width + ' 64'}
    preserveAspectRatio="none" role="img" aria-label={'Code 128: ' + code}>
    <rect x={0} y={0} width={barcode.width} height={64} fill="white"/>
    {barcode.bars.map((bar, index) => (
      <rect key={index} x={bar.x} y={3} width={bar.width} height={58} fill="#111"/>
    ))}
  </svg>
}

function printableBarcodeSvg(code: string): string {
  const encoded = encodeCode128B(code)
  const bars = encoded.bars.map(bar => '<rect x="' + bar.x + '" y="3" width="' +
    bar.width + '" height="58" fill="#111"/>').join('')
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + encoded.width +
    ' 64" preserveAspectRatio="none" aria-label="Code 128" class="bars">' +
    '<rect width="' + encoded.width + '" height="64" fill="#fff"/>' + bars + '</svg>'
}

function printSkuLabel(record: SkuBarcodeRecord, printWindow: Window): boolean {
  if (!record.barcode || !record.active) return false
  const title = htmlEscape(clean(record.productName))
  const description = [record.color, record.size, record.gender].map(clean).filter(Boolean).join(' · ')
  const execution = [record.material, record.length].map(clean).filter(x => x && x !== 'СТАНДАРТ').join(' · ')
  const markup = '<!doctype html><html lang="ru"><head><meta charset="utf-8"/>' +
    '<title>Общий код варианта</title><style>' +
    '@page{size:58mm 35mm;margin:0}' +
    'body{margin:0;font-family:Arial,sans-serif;color:#111;background:#fff}' +
    '.label{box-sizing:border-box;width:58mm;height:35mm;padding:2mm;overflow:hidden;display:flex;flex-direction:column;gap:1mm}' +
    '.title{font-weight:700;font-size:10pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.details{font-size:8pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.bars{width:100%;height:14mm;display:block}' +
    '.code{text-align:center;font-size:9pt;font-weight:700;letter-spacing:.4px}' +
    '.note{text-align:center;font-size:6.5pt}' +
    '.controls{margin:12px;font:14px Arial,sans-serif}' +
    '@media print{.controls{display:none}}' +
    '</style></head><body><div class="label"><div class="title">' + title + '</div>' +
    '<div class="details">' + htmlEscape(description) + '</div>' +
    (execution ? '<div class="details">' + htmlEscape(execution) + '</div>' : '') +
    printableBarcodeSvg(record.barcode) +
    '<div class="code">' + htmlEscape(record.barcode) + '</div>' +
    '<div class="note">Общий код · не индивидуальная вещь</div></div>' +
    '<div class="controls"><button type="button" onclick="window.print()">Печать этикетки</button>' +
    ' <span>Макет 58 × 35 мм. В настройках печати выберите масштаб 100%.</span></div></body></html>'
  printWindow.document.open()
  printWindow.document.write(markup)
  printWindow.document.close()
  printWindow.focus()
  return true
}

export function SkuBarcodeButton({ variantId, compact = false }: { variantId: number; compact?: boolean }) {
  const [record, setRecord] = useState<SkuBarcodeRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!record) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRecord(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [record])

  const open = async () => {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/barcodes/sku/' + encodeURIComponent(String(variantId)), {
        credentials: 'same-origin', cache: 'no-store',
      })
      const result = await response.json() as SkuBarcodeRecord
      if (!response.ok || !result.ok) throw new Error(result.message || 'Не удалось загрузить штрихкод.')
      if (!result.active || !result.barcode || result.physicalUnit !== false) {
        throw new Error('Эту позицию нельзя маркировать: она неактивна или изменена.')
      }
      setRecord(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка загрузки штрихкода.')
    } finally {
      setLoading(false)
    }
  }

  const printVerified = async (label: SkuBarcodeRecord) => {
    if (printing || !label.active || !label.barcode) return
    const printWindow = window.open('', '_blank', 'width=620,height=460')
    if (!printWindow) {
      setError('Браузер заблокировал окно печати. Разрешите всплывающие окна для Orders-app.')
      return
    }
    setPrinting(true)
    setError('')
    try {
      const response = await fetch('/api/barcodes/sku/' + encodeURIComponent(String(variantId)), {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
      })
      const fresh = await response.json() as SkuBarcodeRecord
      if (!response.ok || !fresh.ok || !fresh.active || fresh.physicalUnit !== false ||
          !fresh.barcode || fresh.barcode !== label.barcode) {
        throw new Error('Позиция изменилась или больше неактивна. Печать отменена: обновите каталог.')
      }
      if (printWindow.closed) return
      if (!printSkuLabel(fresh, printWindow)) throw new Error('Не удалось подготовить этикетку.')
    } catch (cause) {
      if (!printWindow.closed) printWindow.close()
      setError(cause instanceof Error ? cause.message : 'Не удалось проверить SKU перед печатью.')
    } finally {
      setPrinting(false)
    }
  }

  return <div className="sku-barcode-action">
    <button type="button" className="secondary compact sku-barcode-trigger" title="Общий код для поиска варианта или маркировки полки; не индивидуальная вещь"
      disabled={loading} onClick={() => void open()}>
      {loading ? 'Проверяю…' : compact ? 'Код варианта' : 'Этикетка варианта'}
    </button>
    {error ? <span role="alert" className="sku-barcode-error">{error}</span> : null}
    {record?.barcode ? (
      <div className="sku-barcode-backdrop" role="presentation" onMouseDown={event => {
        if (event.target === event.currentTarget) setRecord(null)
      }}>
        <section className="sku-barcode-dialog" role="dialog" aria-modal="true" aria-label="Этикетка варианта">
          <div className="sku-barcode-dialog-head">
            <h3>Общий код варианта</h3>
            <button type="button" className="secondary compact" onClick={() => setRecord(null)}>Закрыть</button>
          </div>
          <div className="sku-barcode-label-preview">
            <strong>{record.productName}</strong>
            <small>{[record.color, record.size, record.gender].filter(Boolean).join(' · ')}</small>
            <Code128Svg code={record.barcode}/>
            <strong className="sku-barcode-code">{record.barcode}</strong>
          </div>
          <p className="sku-barcode-explanation">Этот код одинаков у всех изделий с такими характеристиками.
            Печатайте его для полки или поиска в каталоге, но не как индивидуальную этикетку вещи.
            Печать не изменяет количество на складе или резервы.</p>
          {error ? <p role="alert" className="sku-barcode-error">{error}</p> : null}
          <div className="sku-barcode-dialog-actions">
            <button type="button" className="primary" disabled={printing} onClick={() => void printVerified(record)}>
              {printing ? 'Проверяю актуальность…' : 'Печатать общий код · 58 × 35 мм'}
            </button>
          </div>
        </section>
      </div>
    ) : null}
  </div>
}
