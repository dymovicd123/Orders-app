import { useEffect, useRef, useState } from 'react'
import './stocktakeBarcodeScanner.css'

type ScanResponse = {
  ok: boolean
  duplicate?: boolean
  variantId?: number
  itemId?: number
  productName?: string
  countedQuantity?: number
  message?: string
}

export function StocktakeBarcodeScanner({
  sessionId, disabled, onScanned,
}: {
  sessionId: string
  disabled: boolean
  onScanned: (variantId: number) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [total, setTotal] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setCode('')
    setNotice('')
    setError('')
    setTotal(null)
    fetch('/api/inventory/stocktakes/' + encodeURIComponent(sessionId) + '/scans', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
    }).then(async response => {
      const result = await response.json() as { ok: boolean; total?: number; message?: string }
      if (!response.ok || !result.ok) throw new Error(result.message || 'Сканирование недоступно.')
      if (alive) setTotal(Number(result.total || 0))
    }).catch(cause => {
      if (alive) setError(cause instanceof Error ? cause.message : 'Не удалось проверить сканы.')
    })
    return () => { alive = false }
  }, [sessionId])

  async function scan() {
    const typed = code.trim()
    if (busyRef.current || disabled || total === null || !typed) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/inventory/stocktakes/' + encodeURIComponent(sessionId) + '/scans', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: typed }),
      })
      const result = await response.json() as ScanResponse
      if (!response.ok || !result.ok) throw new Error(result.message || 'Вещь не удалось учесть.')
      if (result.duplicate) {
        setNotice('Повторный скан: эта вещь уже учтена в данной ревизии. +0.')
      } else {
        setTotal(current => (current ?? 0) + 1)
        setNotice(`${result.productName || 'Вещь'} · +1 · учтено ${result.countedQuantity ?? '—'} шт. Остаток изменится только после завершения ревизии.`)
        try {
          await onScanned(Number(result.variantId || 0))
        } catch {
          setError('Скан уже сохранён, но форма не обновилась. Переоткройте эту ревизию; не сканируйте вещь повторно.')
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка чтения штрихкода.')
    } finally {
      setCode('')
      setBusy(false)
      busyRef.current = false
      inputRef.current?.focus()
    }
  }

  return <section className="stocktake-barcode-scanner" aria-label="Подсчёт по индивидуальным штрихкодам">
    <div className="stocktake-barcode-title">
      <div>
        <strong>Подсчёт сканером</strong>
        <span>Индивидуальная этикетка вещи · без изменения остатков до завершения ревизии</span>
      </div>
      <span className="stocktake-barcode-total">{total === null ? 'Проверяю…' : `Сканов: ${total}`}</span>
    </div>
    <form onSubmit={event => { event.preventDefault(); void scan() }} className="stocktake-barcode-form">
      <input ref={inputRef} type="text" autoComplete="off" spellCheck={false}
        aria-label="Индивидуальный штрихкод"
        placeholder="Сканируйте индивидуальную метку"
        value={code} onChange={event => setCode(event.target.value)}
        disabled={busy || total === null}/>
      <button type="submit" className="secondary compact"
        disabled={busy || disabled || total === null || !code.trim()}>
        {busy ? 'Считаю…' : 'Учесть вещь'}
      </button>
    </form>
    {disabled ? <small>Сначала дождитесь сохранения введённых вручную значений.</small> : null}
    <small>Одинаковый код дважды не засчитывается, даже после повторного открытия ревизии. Вещи без этикеток считайте вручную. Не считайте одну вещь одновременно вручную и сканером.</small>
    {notice ? <div className="stocktake-barcode-notice" role="status">{notice}</div> : null}
    {error ? <div className="stocktake-barcode-error" role="alert">{error}</div> : null}
  </section>
}
