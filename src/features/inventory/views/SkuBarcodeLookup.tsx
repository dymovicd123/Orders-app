import { useRef, useState } from 'react'
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
  barcodeType?: 'sku' | 'unit'
  source?: string
  verified?: boolean
  message?: string
}

export function SkuBarcodeLookup({ onLocate }: { onLocate: (value: SkuLookupRecord) => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SkuLookupRecord | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef(0)

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
      if (!response.ok || !data.ok) throw new Error(data.message || 'Штрихкод не найден.')
      if (generation === requestRef.current) {
        setResult(data)
        if (data.active) {
          onLocate(data)
          inputRef.current?.select()
        }
      }
    } catch (cause) {
      if (generation === requestRef.current) {
        setError(cause instanceof Error ? cause.message : 'Ошибка чтения штрихкода.')
        inputRef.current?.select()
      }
    } finally {
      if (generation === requestRef.current) setBusy(false)
    }
  }

  return <section className="sku-lookup" aria-label="Поиск варианта по штрихкоду">
    <form onSubmit={event => { event.preventDefault(); void lookup() }}>
      <label htmlFor="catalog-sku-barcode-scan">Найти по штрихкоду</label>
      <div className="sku-lookup-row">
        <input id="catalog-sku-barcode-scan" ref={inputRef} type="text"
          autoComplete="off" spellCheck={false} placeholder="Сканируйте общий или индивидуальный код"
          value={code} onChange={event => {
            requestRef.current++
            setBusy(false)
            setCode(event.target.value)
            setResult(null)
            setError('')
          }}/>
        <button className="secondary compact" type="submit" disabled={busy || !code.trim()}>
          {busy ? 'Ищу…' : 'Найти'}
        </button>
      </div>
    </form>
    {error ? <p className="sku-lookup-error" role="alert">{error}</p> : null}
    {result ? <div className="sku-lookup-result" role="status">
      <strong>{result.productName}</strong>
      <span>{[result.color, result.size, result.gender, result.material, result.length]
        .filter(value => value && value !== 'СТАНДАРТ').join(' · ')}</span>
      <small>{result.barcodeType === 'unit'
        ? result.status === 'revoked' ? 'Индивидуальная метка аннулирована'
          : result.status === 'prepared' ? 'Индивидуальная метка подготовлена · наличие не подтверждено'
          : result.active ? 'Индивидуальная метка найдена' : 'Метка недействительна'
        : result.active ? 'Общий код · карточка варианта открыта' : 'Вариант удалён из рабочего каталога'}</small>
      {result.barcodeType === 'unit' && result.message ? <small>{result.message}</small> : null}
      {result.active ? <button className="secondary compact" type="button" onClick={() => {
        onLocate(result)
        inputRef.current?.focus()
        inputRef.current?.select()
      }}>Показать ещё раз</button> : null}
      <small>{result.barcodeType === 'unit'
          ? 'Индивидуальный код не проводит приход, перемещение или выдачу.'
          : 'Это код варианта, а не доказательство физического наличия вещи.'}</small>
    </div> : null}
  </section>
}
