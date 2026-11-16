import { useEffect, useRef, useState } from 'react'
import './skuBarcodeLabel.css'

export type SkuLookupRecord = {
  ok: boolean
  variantId: number
  productId: number
  productName: string
  barcode: string
  active: boolean
  color?: string
  gender?: string
  material?: string
  length?: string
  size?: string
  status?: string
}

export function SkuBarcodeLookup({ onLocate }: { onLocate: (value: SkuLookupRecord) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SkuLookupRecord | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

  const lookup = async () => {
    const typed = code.trim()
    if (!typed || busy) return
    const generation = ++requestRef.current
    setBusy(true)
    setResult(null)
    setError('')
    try {
      const response = await fetch('/api/barcodes/lookup?code=' + encodeURIComponent(typed), {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
      })
      const data = await response.json() as SkuLookupRecord & { message?: string }
      if (!response.ok || !data.ok) throw new Error(data.message || 'Не удалось найти штрихкод.')
      if (generation === requestRef.current) setResult(data)
    } catch (cause) {
      if (generation === requestRef.current) {
        setError(cause instanceof Error ? cause.message : 'Ошибка чтения штрихкода.')
      }
    } finally {
      if (generation === requestRef.current) setBusy(false)
    }
  }

  const close = () => {
    requestRef.current++
    setExpanded(false)
    setBusy(false)
    setResult(null)
    setError('')
    setCode('')
  }

  return <div className="sku-lookup">
    <button type="button" className="secondary compact"
      aria-expanded={expanded} onClick={() => expanded ? close() : setExpanded(true)}>
      {expanded ? 'Закрыть сканер' : 'Сканировать SKU'}
    </button>
    {expanded ? <section className="sku-lookup-panel" aria-label="Поиск по штрихкоду SKU">
      <form onSubmit={event => { event.preventDefault(); void lookup() }}>
        <label htmlFor="catalog-sku-barcode-scan">Штрихкод SKU</label>
        <div className="sku-lookup-row">
          <input id="catalog-sku-barcode-scan" ref={inputRef} type="text"
            autoComplete="off" spellCheck={false} placeholder="Сканируйте код или введите вручную"
            value={code} onChange={event => {
              requestRef.current++
              setBusy(false)
              setCode(event.target.value)
              setResult(null)
              setError('')
            }}/>
          <button className="primary compact" type="submit" disabled={busy || !code.trim()}>
            {busy ? 'Ищу…' : 'Найти'}
          </button>
        </div>
      </form>
      {error ? <p className="sku-lookup-error" role="alert">{error}</p> : null}
      {result ? <div className="sku-lookup-result" role="status">
        <strong>{result.productName}</strong>
        <span>{[result.color, result.size, result.gender, result.material, result.length]
          .filter(value => value && value !== 'СТАНДАРТ').join(' · ')}</span>
        <small>{result.barcode} · {result.active ? 'Действующий SKU' : 'Удалён из рабочего каталога'}</small>
        {result.active ? <button className="secondary compact" type="button" onClick={() => {
          onLocate(result)
          close()
        }}>Показать в каталоге</button> : null}
        <small>Это код варианта, а не доказательство физического наличия вещи.</small>
      </div> : null}
    </section> : null}
  </div>
}
