import { useEffect, useRef, useState } from 'react'
import { resolveOperationBarcode, type OperationBarcodeLookup } from '../operationBarcodeSelection'
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
  sessionId, source, disabled, onScanned, onSkuFound,
}: {
  sessionId: string
  source: 'warehouse' | 'boutique'
  disabled: boolean
  onScanned: (variantId: number) => Promise<void>
  onSkuFound: (variantId: number) => string | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const capturedRef = useRef(false)
  const cameraStopRef = useRef<(() => void) | null>(null)
  const busyRef = useRef(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [cameraStarting, setCameraStarting] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [total, setTotal] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setCameraOpen(false)
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

  useEffect(() => {
    if (!cameraOpen || disabled) return
    let cancelled = false
    capturedRef.current = false
    setCameraStarting(true)
    setCameraError('')
    const run = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
          throw new Error('Камера доступна только в современном браузере по HTTPS.')
        }
        const { BrowserMultiFormatOneDReader } = await import('@zxing/browser')
        if (cancelled || !videoRef.current) return
        const reader = new BrowserMultiFormatOneDReader()
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } }, audio: false },
          videoRef.current,
          (result) => {
            if (cancelled || capturedRef.current || !result) return
            const scanned = result.getText().trim().toUpperCase()
            if (!/^OC[SU]1-[0-9A-Z-]+$/.test(scanned)) return
            capturedRef.current = true
            setCode(scanned)
            setNotice('Код считан: ' + scanned + '. Нажмите «Найти / учесть», чтобы подтвердить действие.')
            setCameraOpen(false)
          },
        )
        if (cancelled) controls.stop()
        else cameraStopRef.current = () => controls.stop()
      } catch (cause) {
        if (!cancelled) {
          const reason = cause instanceof Error ? cause.name : ''
          setCameraError(reason === 'NotAllowedError'
            ? 'Нет разрешения на камеру. Разрешите доступ в браузере или введите код вручную.'
            : reason === 'NotFoundError'
              ? 'На устройстве не найдена камера. Используйте поле ручного ввода.'
              : cause instanceof Error ? cause.message : 'Не удалось открыть камеру. Введите код вручную.')
        }
      } finally {
        if (!cancelled) setCameraStarting(false)
      }
    }
    void run()
    return () => {
      cancelled = true
      cameraStopRef.current?.()
      cameraStopRef.current = null
      const stream = videoRef.current?.srcObject
      if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop())
    }
  }, [cameraOpen, disabled])

  async function scan() {
    const typed = code.trim()
    if (busyRef.current || disabled || !typed) return
    busyRef.current = true
    setCameraOpen(false)
    setBusy(true)
    setError('')
    setNotice('')
    let focusScanner = true
    try {
      if (typed.toUpperCase().startsWith('OCS1')) {
        // Shared SKU is only a navigator. Unlike a physical unit label it must
        // never call the stocktake POST endpoint or add one to counted_quantity.
        const response = await fetch('/api/barcodes/lookup?code=' + encodeURIComponent(typed.trim().toUpperCase()), {
          method: 'GET', credentials: 'same-origin', cache: 'no-store',
        })
        const result = await response.json() as OperationBarcodeLookup
        if (!response.ok) throw new Error(result.message || 'Не удалось найти SKU.')
        const match = resolveOperationBarcode(typed, result, source)
        if (match.kind !== 'sku') throw new Error('Для поиска варианта требуется общий SKU.')
        const selected = onSkuFound(match.variantId)
        if (!selected) throw new Error('Этот вариант не входит в текущую проверку. Выберите товар вручную или добавьте его через «Найденная позиция».')
        setNotice('Найден ' + selected + '. Перейдите к полю и введите весь фактический остаток, включая вещи без этикеток. Поиск ничего не прибавляет.')
        focusScanner = false
        return
      }
      if (total === null) throw new Error('Подсчёт индивидуальных меток пока недоступен. Дождитесь загрузки.')
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
      if (focusScanner) inputRef.current?.focus()
    }
  }

  return <section className="stocktake-barcode-scanner" aria-label="Поиск SKU и подсчёт по индивидуальным штрихкодам">
    <div className="stocktake-barcode-title">
      <div>
        <strong>Штрихкоды при проверке</strong>
        <span>Общий SKU — открыть вариант без изменения количества. Индивидуальный код вещи — учесть +1.</span>
      </div>
      <span className="stocktake-barcode-total">{total === null ? 'Проверяю…' : `Сканов: ${total}`}</span>
    </div>
    <form onSubmit={event => { event.preventDefault(); void scan() }} className="stocktake-barcode-form">
      <input ref={inputRef} type="text" autoComplete="off" spellCheck={false}
        aria-label="Штрихкод SKU или индивидуальная метка"
        placeholder="Общий SKU или индивидуальная метка"
        value={code} onChange={event => setCode(event.target.value)}
        disabled={busy || disabled}/>
      <button type="submit" className="secondary compact"
        disabled={busy || disabled || !code.trim()}>
        {busy ? 'Проверяю…' : 'Найти / учесть'}
      </button>
      <button type="button" className="secondary compact stocktake-camera-toggle"
        disabled={busy || disabled} aria-expanded={cameraOpen}
        onClick={() => { setCameraError(''); setNotice(''); setCameraOpen(current => !current) }}>
        {cameraOpen ? 'Закрыть камеру' : 'Сканировать камерой'}
      </button>
    </form>
    {cameraOpen ? <div className="stocktake-camera-panel" role="region" aria-label="Камера для сканирования штрихкода">
      <video ref={videoRef} playsInline autoPlay muted aria-label="Изображение камеры"/>
      <div className="stocktake-camera-hint">Наведите заднюю камеру на полосы этикетки Code 128. После распознавания проверьте код и подтвердите действие кнопкой «Найти / учесть».</div>
      {cameraStarting ? <small>Открываю камеру…</small> : null}
      {cameraError ? <div className="stocktake-barcode-error" role="alert">{cameraError}</div> : null}
    </div> : null}
    {disabled ? <small>Сначала дождитесь сохранения введённых вручную значений.</small> : null}
    <small>Общий SKU только открывает нужную ячейку: введите итоговое фактическое число, не прибавляйте 1 за скан. Индивидуальные метки засчитываются поштучно, повторно не учитываются. Одну вещь нельзя считать дважды — вручную и индивидуальным сканом.</small>
    {notice ? <div className="stocktake-barcode-notice" role="status">{notice}</div> : null}
    {error ? <div className="stocktake-barcode-error" role="alert">{error}</div> : null}
  </section>
}
