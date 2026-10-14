import { useState } from 'react'

type RetirementKind = 'execution' | 'product'

type RetirementPreview = {
  ok?: boolean
  message?: string
  active?: boolean
  activeVariantCount?: number
  physicalQuantity?: number
  stockReservedQuantity?: number
  activeReservationQuantity?: number
  historicalOrderItemCount?: number
  openOrderItemCount?: number
  activeStocktake?: boolean
  pendingLifecycle?: boolean
}

type Props = {
  kind: RetirementKind
  entityId: number
  entityLabel: string
  buttonLabel: string
  className?: string
  disabled?: boolean
  onRetired?: () => void | boolean | Promise<void | boolean>
}

async function readResult(response: Response) {
  const text = await response.text()
  if (!text) return { ok: response.ok } as RetirementPreview
  try {
    return JSON.parse(text) as RetirementPreview
  } catch {
    return { ok: response.ok, message: response.ok ? '' : 'Не удалось получить ответ сервера. Обновите страницу и попробуйте ещё раз.' }
  }
}

const countText = (value: number, one: string, few: string, many: string) => {
  const absolute = Math.abs(value)
  const lastTwo = absolute % 100
  const last = absolute % 10
  if (lastTwo >= 11 && lastTwo <= 19) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

export function CatalogRetirementAction({
  kind,
  entityId,
  entityLabel,
  buttonLabel,
  className = 'danger compact',
  disabled = false,
  onRetired,
}: Props) {
  const [preview, setPreview] = useState<RetirementPreview | null>(null)
  const [checking, setChecking] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const endpointBase = kind === 'execution'
    ? `/api/catalog/executions/${encodeURIComponent(String(entityId))}`
    : `/api/catalog/products/${encodeURIComponent(String(entityId))}`

  const open = async () => {
    if (!entityId || disabled || checking || deleting) return
    setChecking(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${endpointBase}/retirement-preview`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const result = await readResult(response)
      if (!response.ok || result.ok === false) {
        setError(result.message || 'Не удалось проверить удаление. Обновите страницу и попробуйте ещё раз.')
        return
      }
      if (result.activeStocktake) {
        setError('Сейчас по этой позиции идёт ревизия. Завершите или отмените её, затем попробуйте снова.')
        return
      }
      if (result.pendingLifecycle) {
        setError('Сейчас по этой позиции не завершена приёмка или возврат. Сначала закончите эту операцию.')
        return
      }
      setPreview(result)
    } catch {
      setError('Не удалось проверить удаление. Проверьте соединение и попробуйте ещё раз.')
    } finally {
      setChecking(false)
    }
  }

  const confirm = async () => {
    if (!preview || deleting) return
    setDeleting(true)
    setError('')
    try {
      const requestId = `catalog-${kind}-retire-${entityId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const response = await fetch(`${endpointBase}/retire`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      })
      const result = await readResult(response)
      if (!response.ok || result.ok === false) {
        setError(result.message || 'Не удалось удалить. Обновите страницу и попробуйте ещё раз.')
        return
      }
      setPreview(null)
      setNotice(kind === 'execution' ? 'Исполнение удалено.' : 'Товар удалён.')
      const refreshed = await onRetired?.()
      if (refreshed === false) {
        setNotice('Удалено. Если строка ещё видна, нажмите «Обновить» — повторно удалять не нужно.')
      }
    } catch {
      setError('Не удалось подтвердить результат. Обновите страницу перед повторной попыткой.')
    } finally {
      setDeleting(false)
    }
  }

  const positions = Number(preview?.activeVariantCount || 0)
  const physical = Number(preview?.physicalQuantity || 0)
  const reserved = Number(preview?.activeReservationQuantity || 0)
  const openOrders = Number(preview?.openOrderItemCount || 0)
  const history = Number(preview?.historicalOrderItemCount || 0)

  return (
    <>
      <span className="catalog-retirement-action">
        <button className={className} type="button" disabled={disabled || checking || deleting} onClick={() => void open()}>
          {checking ? 'Проверяю…' : deleting ? 'Удаляю…' : buttonLabel}
        </button>
        {notice ? <small className="catalog-retirement-notice">{notice}</small> : null}
        {error && !preview ? <small className="catalog-retirement-error" role="alert">{error}</small> : null}
      </span>

      {preview ? (
        <div className="modal-backdrop catalog-retirement-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !deleting) setPreview(null)
        }}>
          <section className="modal-card catalog-retirement-modal" role="dialog" aria-modal="true" aria-labelledby="catalog-retirement-title">
            <div className="catalog-retirement-head">
              <span className="card-label">Подтверждение</span>
              <h3 id="catalog-retirement-title">{kind === 'execution' ? 'Удалить исполнение?' : 'Удалить товар?'}</h3>
              <p>
                <strong>{entityLabel}</strong> исчезнет из рабочего каталога и склада.
              </p>
            </div>

            <div className="catalog-retirement-summary">
              <div>
                <strong>{positions}</strong>
                <span>{countText(positions, 'позиция', 'позиции', 'позиций')}</span>
              </div>
              <div>
                <strong>{physical}</strong>
                <span>{physical === 1 ? 'штука в остатке' : 'штук в остатке'}</span>
              </div>
              <div>
                <strong>{reserved}</strong>
                <span>{reserved === 1 ? 'штука в резерве' : 'штук в резерве'}</span>
              </div>
            </div>

            <div className="catalog-retirement-explanation">
              <strong>Что произойдёт</strong>
              <p>
                {physical > 0 || reserved > 0
                  ? 'Текущие остатки и резервы этой позиции будут сняты с рабочего склада.'
                  : 'Рабочих остатков и резервов по этой позиции сейчас нет.'}
              </p>
              <p>
                Старые заказы и движения сохранятся в истории.
                {openOrders > 0 ? ` В открытых заказах останется ${openOrders} ${countText(openOrders, 'позиция', 'позиции', 'позиций')}, но склад они больше менять не будут.` : ''}
              </p>
              {history > 0 ? <p>Связано с историей заказов: {history} {countText(history, 'позиция', 'позиции', 'позиций')}.</p> : null}
              <p>{kind === 'execution'
                ? 'Если такое исполнение понадобится снова, администратор сможет добавить его заново как новую рабочую позицию.'
                : 'Если товар понадобится снова, администратор сможет добавить его обратно без восстановления старых остатков.'}</p>
            </div>

            {error ? <div className="catalog-retirement-modal-error" role="alert">{error}</div> : null}

            <div className="modal-actions">
              <button className="danger" type="button" disabled={deleting} onClick={() => void confirm()}>
                {deleting ? 'Удаляю…' : buttonLabel}
              </button>
              <button className="secondary" type="button" disabled={deleting} onClick={() => { setPreview(null); setError('') }}>
                Отмена
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
