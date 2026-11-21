import { useEffect, useRef, useState } from 'react'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import type { InventoryStocktakeSession } from '../../../../shared/api-contracts.ts'
import { StocktakeCameraScanGate } from '../stocktakeCameraScanGate'
import './stocktakeBarcodeScanner.css'

export type StocktakeScanResponse = {
  ok: boolean
  duplicate?: boolean
  scanType?: 'sku' | 'unit'
  variantId?: number
  itemId?: number
  productName?: string
  countedQuantity?: number
  addedItem?: InventoryStocktakeSession['items'][number]
  message?: string
}

type ScanAttempt = { code: string; requestId: string; origin: 'camera' | 'usb' | 'manual' }
const VALID_BARCODE = /^OC(?:S|U)1-[0-9A-Z-]+$/

export function StocktakeBarcodeScanner({
  sessionId, disabled, onScanned, onPendingChange,
}: {
  sessionId: string
  source: 'warehouse' | 'boutique'
  disabled: boolean
  onScanned: (result: StocktakeScanResponse) => Promise<void> | void
  onPendingChange?: (pending: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraStopRef = useRef<(() => void) | null>(null)
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null)
  const gateRef = useRef(new StocktakeCameraScanGate())
  const queueRef = useRef<ScanAttempt[]>([])
  const busyRef = useRef(false)
  const activeRef = useRef(true)
  const disabledRef = useRef(disabled)
  const onScannedRef = useRef(onScanned)
  const onPendingRef = useRef(onPendingChange)
  const processRef = useRef<(code: string, origin: ScanAttempt['origin']) => void>(() => {})
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [cameraStarting, setCameraStarting] = useState(false)
  const [cameraFeedback, setCameraFeedback] = useState('')
  const [cameraZoom, setCameraZoom] = useState(1)
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [total, setTotal] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  disabledRef.current = disabled
  onScannedRef.current = onScanned
  onPendingRef.current = onPendingChange

  useEffect(() => {
    activeRef.current = true
    gateRef.current.reset()
    queueRef.current = []
    setCameraOpen(false)
    setCode('')
    setTotal(null)
    setNotice('')
    setError('')
    fetch('/api/inventory/stocktakes/' + encodeURIComponent(sessionId) + '/scans', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
    }).then(async response => {
      const result = await response.json() as { ok: boolean; total?: number; message?: string }
      if (!response.ok || !result.ok) throw new Error(result.message || 'Быстрый подсчёт недоступен.')
      if (activeRef.current) setTotal(Number(result.total || 0))
    }).catch(cause => {
      if (activeRef.current) setError(cause instanceof Error ? cause.message : 'Не удалось проверить историю сканов.')
    })
    return () => {
      activeRef.current = false
      queueRef.current = []
      onPendingRef.current?.(false)
    }
  }, [sessionId])

  async function drainQueue() {
    if (busyRef.current || disabledRef.current) return
    busyRef.current = true
    onPendingRef.current?.(true)
    if (activeRef.current) setBusy(true)
    try {
      while (queueRef.current.length && !disabledRef.current && activeRef.current) {
        const attempt = queueRef.current.shift()!
        try {
          const send = async () => {
            const response = await fetch('/api/inventory/stocktakes/' + encodeURIComponent(sessionId) + '/scans', {
              method: 'POST', credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: attempt.code, requestId: attempt.requestId }),
            })
            const result = await response.json() as StocktakeScanResponse & { message?: string }
            if (!response.ok || !result.ok) throw new Error(result.message || 'Штрихкод не удалось учесть.')
            return result
          }
          let result: StocktakeScanResponse
          try {
            result = await send()
          } catch (firstError) {
            // A lost HTTP response is safe to retry because the SAME event ID is
            // reused: the database unique key cannot count it a second time.
            if (firstError instanceof TypeError) result = await send()
            else throw firstError
          }
          if (!activeRef.current) break
          if (result.duplicate) {
            // A network retry may return a saved new item after the first HTTP
            // response was lost. Reconcile UI without incrementing scan total.
            if (result.addedItem) await onScannedRef.current(result)
            setNotice('Повторный запрос или уже учтённая индивидуальная вещь. +0.')
          } else {
            await onScannedRef.current(result)
            setTotal(count => (count ?? 0) + 1)
            setNotice((result.productName || 'Товар') +
              ' · +1 · фактически ' + (result.countedQuantity ?? '—') + ' шт. Сканер готов к следующей вещи.')
            if (attempt.origin === 'camera' && typeof navigator.vibrate === 'function') navigator.vibrate(40)
          }
          setError('')
        } catch (cause) {
          if (activeRef.current) {
            setError(cause instanceof Error ? cause.message : 'Ошибка сканирования. Не добавлено.')
            setNotice('')
          }
        }
      }
    } finally {
      busyRef.current = false
      if (queueRef.current.length === 0) onPendingRef.current?.(false)
      if (activeRef.current) setBusy(false)
      if (queueRef.current.length && !disabledRef.current && activeRef.current) void drainQueue()
    }
  }

  function enqueue(raw: string, origin: ScanAttempt['origin']) {
    const value = raw.trim().toUpperCase()
    if (disabledRef.current) {
      setError('Дождитесь сохранения введённого количества, затем повторите скан.')
      return
    }
    if (!VALID_BARCODE.test(value)) {
      setError('Это не штрихкод Orders-app. Нужен OCS1 или OCU1.')
      return
    }
    if (queueRef.current.length >= 24) {
      setError('Очередь сканов заполнена. Дождитесь обработки уже считанных товаров.')
      return
    }
    queueRef.current.push({ code: value, requestId: crypto.randomUUID(), origin })
    setCode('')
    setError('')
    void drainQueue()
  }
  processRef.current = enqueue

  useEffect(() => {
    if (!disabled) void drainQueue()
  }, [disabled])

  useEffect(() => {
    // A USB HID scanner types into the focused input. Focus once on desktop;
    // do not summon the phone's virtual keyboard or steal focus from count edits.
    if (window.matchMedia('(pointer:fine)').matches) {
      inputRef.current?.focus({ preventScroll: true })
    }
  }, [sessionId])

  useEffect(() => {
    if (!cameraOpen || disabled) return
    let cancelled = false
    gateRef.current.reset()
    setCameraStarting(true)
    setCameraError('')
    setCameraFeedback('Камера работает в режиме непрерывного подсчёта. Наведите на Code128; другой код учтётся автоматически.')
    setZoomRange(null)
    setTorchSupported(false)
    setTorchOn(false)
    cameraTrackRef.current = null
    const run = async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw new Error('Камера недоступна: откройте систему по HTTPS и разрешите доступ.')
        }
        const { BrowserMultiFormatOneDReader } = await import('@zxing/browser')
        if (cancelled || !videoRef.current) return
        const hints = new Map<DecodeHintType, unknown>([
          [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]],
        ])
        const reader = new BrowserMultiFormatOneDReader(hints, {
          delayBetweenScanAttempts: 120,
          delayBetweenScanSuccess: 160,
        })
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
          videoRef.current,
          (result) => {
            if (cancelled) return
            const now = performance.now()
            if (!result) {
              gateRef.current.missing(now)
              return
            }
            const found = result.getText().trim().toUpperCase()
            if (!VALID_BARCODE.test(found)) {
              gateRef.current.missing(now)
              return
            }
            if (!gateRef.current.detected(found, now)) return
            processRef.current(found, 'camera')
            setCameraFeedback('Код считан: ' + found +
              '. Уберите этикетку из кадра и наведите следующую. Камера остаётся активной.')
          },
        )
        if (cancelled) controls.stop()
        else {
          cameraStopRef.current = () => controls.stop()
          const stream = videoRef.current?.srcObject
          if (stream instanceof MediaStream) {
            const track = stream.getVideoTracks()[0]
            if (track) {
              cameraTrackRef.current = track
              const caps = track.getCapabilities?.() as MediaTrackCapabilities & {
                zoom?: { min: number; max: number; step?: number };
                torch?: boolean;
                focusMode?: string[]
              }
              const zoom = caps?.zoom
              if (zoom && Number.isFinite(zoom.min) && Number.isFinite(zoom.max)
                && zoom.max > zoom.min) {
                setZoomRange({ min: zoom.min, max: zoom.max, step: Math.max(zoom.step || 0.1, 0.1) })
                setCameraZoom(Number((track.getSettings() as MediaTrackSettings & { zoom?: number }).zoom || zoom.min))
              }
              setTorchSupported(Boolean(caps?.torch))
              if (caps?.focusMode?.includes('continuous')) {
                void track.applyConstraints({
                  advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
                }).catch(() => {})
              }
            }
          }
        }
      } catch (cause) {
        if (!cancelled) {
          const reason = cause instanceof Error ? cause.name : ''
          setCameraError(reason === 'NotAllowedError'
            ? 'Доступ к камере запрещён. Разрешите его в браузере или используйте USB/ручной ввод.'
            : reason === 'NotFoundError'
              ? 'На устройстве не найдена камера.'
              : cause instanceof Error ? cause.message : 'Не удалось открыть камеру.')
        }
      } finally {
        if (!cancelled) setCameraStarting(false)
      }
    }
    void run()
    const video = videoRef.current
    return () => {
      cancelled = true
      cameraStopRef.current?.()
      cameraStopRef.current = null
      cameraTrackRef.current = null
      const stream = video?.srcObject
      if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop())
    }
  }, [cameraOpen, disabled, sessionId])

  async function setCameraTrackOption(option: 'zoom' | 'torch', value: number | boolean) {
    const track = cameraTrackRef.current
    if (!track || track.readyState !== 'live') return
    try {
      await track.applyConstraints({
        advanced: [{ [option]: value } as MediaTrackConstraintSet],
      })
      if (option === 'zoom') setCameraZoom(Number(value))
      else setTorchOn(Boolean(value))
      setCameraError('')
    } catch {
      setCameraError(option === 'torch'
        ? 'Фонарик недоступен на этой камере.'
        : 'Камера не поддерживает выбранное увеличение.')
    }
  }

  function submitInput(raw: string) {
    enqueue(raw,'usb')
    if (inputRef.current) inputRef.current.value = ''
  }

  return <section className="stocktake-barcode-scanner" aria-label="Непрерывный подсчёт по общим и индивидуальным штрихкодам">
    <div className="stocktake-barcode-title">
      <div>
        <strong>Быстрый подсчёт штрихкодами</strong>
        <span>Каждый отдельный скан общего SKU добавляет +1. Индивидуальная метка одной вещи повторно не засчитывается.</span>
      </div>
      <span className="stocktake-barcode-total">{total === null ? 'Подключаю…' : 'Сканов: ' + total}</span>
    </div>
    <form onSubmit={event => { event.preventDefault(); submitInput(inputRef.current?.value || code) }}
      className="stocktake-barcode-form">
      <input ref={inputRef} type="text" autoComplete="off" spellCheck={false}
        aria-label="Код SKU или индивидуальной метки — USB-сканер или ручной ввод"
        placeholder="Поднесите USB-сканер или введите код"
        value={code} onChange={event => setCode(event.target.value)}
        onKeyDown={event => {
          if ((event.key === 'Enter' || event.key === 'Tab') && !event.nativeEvent.isComposing &&
              VALID_BARCODE.test(event.currentTarget.value.trim().toUpperCase())) {
            event.preventDefault()
            submitInput(event.currentTarget.value)
          }
        }}
        disabled={disabled}/>
      <button type="submit" className="secondary compact" disabled={disabled || !code.trim()}>
        Учесть код
      </button>
      <button type="button" className="secondary compact stocktake-camera-toggle"
        disabled={disabled} aria-expanded={cameraOpen}
        onClick={() => { setCameraError(''); setCameraOpen(open => !open) }}>
        {cameraOpen ? 'Закрыть камеру' : 'Непрерывная камера'}
      </button>
    </form>
    {cameraOpen ? <div className="stocktake-camera-panel" role="region" aria-label="Непрерывное сканирование камеры">
      <div className="stocktake-camera-head"><strong>Камера активна · +1 за вещь</strong>
        <button className="secondary compact" type="button" onClick={() => setCameraOpen(false)}>Закрыть</button></div>
      <div className="stocktake-camera-preview">
        <video ref={videoRef} playsInline autoPlay muted aria-label="Изображение камеры"
          onLoadedMetadata={() => {
            const video = videoRef.current
            if (video?.videoWidth && video?.videoHeight)
              setCameraFeedback('Камера ' + video.videoWidth + ' × ' + video.videoHeight + '. Наведите на этикетку.')
          }}/>
        <div className="stocktake-camera-guide" aria-hidden="true"/>
      </div>
      {cameraStarting ? <small role="status">Запускаю камеру…</small> : null}
      <div className="stocktake-camera-feedback" role="status">{cameraFeedback}</div>
      <div className="stocktake-camera-hint">
        После скана уберите этикетку из кадра. Повторное чтение того же кода будет принято только после устойчивого отсутствия этикетки; для одинаковых вещей можно вручную разрешить следующий скан.
      </div>
      <div className="stocktake-camera-controls">
        <button className="secondary compact" type="button" disabled={disabled || busy}
          onClick={() => {
            gateRef.current.nextPhysicalItem()
            setCameraFeedback('Следующая вещь: уберите предыдущую этикетку и наведите новую. Один код = +1.')
          }}>
          Следующая вещь с таким же кодом
        </button>
        {zoomRange ? <label>Увеличение {cameraZoom.toFixed(1)}×
          <input type="range" min={zoomRange.min} max={zoomRange.max} step={zoomRange.step}
            value={cameraZoom} onChange={event=>void setCameraTrackOption('zoom',Number(event.target.value))}
            aria-label="Оптическое увеличение камеры"/>
        </label> : null}
        {torchSupported ? <button className="secondary compact" type="button"
          onClick={()=>void setCameraTrackOption('torch',!torchOn)}>
          {torchOn ? 'Выключить фонарик' : 'Включить фонарик'}
        </button> : null}
      </div>
      {busy ? <small>Обрабатываю сканы…</small> : null}
      {notice ? <div className="stocktake-barcode-notice" role="status">{notice}</div> : null}
      {error ? <div className="stocktake-barcode-error" role="alert">{error}</div> : null}
      {cameraError ? <div className="stocktake-barcode-error" role="alert">{cameraError}</div> : null}
    </div> : null}

    <small>Полное фактическое количество любого товара можно исправить вручную после сканирования — например, добавить вещи без этикеток. Не нужно сканировать их отдельно.</small>
    {disabled ? <small>Пока сохраняется ручной ввод, новые сканы приостановлены.</small> : null}
    {busy && !cameraOpen ? <small>Обрабатываю сканы…</small> : null}
    {!cameraOpen && notice ? <div className="stocktake-barcode-notice" role="status">{notice}</div> : null}
    {!cameraOpen && error ? <div className="stocktake-barcode-error" role="alert">{error}</div> : null}
  </section>
}
