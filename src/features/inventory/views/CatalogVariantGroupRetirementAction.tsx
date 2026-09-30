import { useState } from 'react'

type Preview = {
  ok?: boolean
  message?: string
  activeVariantCount?: number
  physicalQuantity?: number
  stockReservedQuantity?: number
  activeReservationQuantity?: number
  historicalOrderItemCount?: number
  openOrderItemCount?: number
  activeWorkshopTaskCount?: number
  activeStocktake?: boolean
  pendingLifecycle?: boolean
}

type Props = {
  executionId: number
  category: string
  gender: string
  genderLabel?: string
  color: string
  colorLabel?: string
  disabled?: boolean
  onRetired?: () => void | boolean | Promise<void | boolean>
}

async function readResult(response: Response) {
  const text = await response.text()
  if (!text) return { ok: response.ok } as Preview
  try {
    return JSON.parse(text) as Preview
  } catch {
    return { ok: response.ok, message: response.ok ? '' : 'Сервер вернул неполный ответ. Обновите каталог и повторите проверку.' }
  }
}

export function CatalogVariantGroupRetirementAction({
  executionId,
  category,
  gender,
  genderLabel,
  color,
  colorLabel,
  disabled = false,
  onRetired,
}: Props) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [checking, setChecking] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const query = new URLSearchParams({ category, gender, color }).toString()
  const endpointBase = `/api/catalog/executions/${encodeURIComponent(String(executionId))}/variant-groups`

  const blockers = preview ? [
    Number(preview.physicalQuantity || 0) !== 0 ? `есть физический остаток: ${Number(preview.physicalQuantity || 0)} шт.` : '',
    Number(preview.stockReservedQuantity || 0) !== 0 || Number(preview.activeReservationQuantity || 0) !== 0
      ? `есть действующий резерв: ${Math.max(Math.abs(Number(preview.stockReservedQuantity || 0)), Math.abs(Number(preview.activeReservationQuantity || 0)))} шт.`
      : '',
    Number(preview.openOrderItemCount || 0) > 0 ? 'есть активный неотправленный заказ' : '',
    Number(preview.activeWorkshopTaskCount || 0) > 0 ? 'есть незавершённая задача Цеха' : '',
    preview.pendingLifecycle ? 'есть незавершённая приёмка или возврат' : '',
    preview.activeStocktake ? 'позиция участвует в текущей ревизии' : '',
  ].filter(Boolean) : []

  const open = async () => {
    if (!executionId || disabled || checking || deleting) return
    setChecking(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${endpointBase}/retirement-preview?${query}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const result = await readResult(response)
      if (!response.ok || result.ok === false) {
        setError(result.message || 'Не удалось проверить локальное удаление. Обновите каталог и попробуйте ещё раз.')
        return
      }
      if (!Number(result.activeVariantCount || 0)) {
        setNotice('Эта группа уже не находится в рабочем каталоге.')
        return
      }
      setPreview(result)
    } catch {
      setError('Не удалось проверить локальное удаление. Проверьте соединение и повторите.')
    } finally {
      setChecking(false)
    }
  }

  const confirm = async () => {
    if (!preview || deleting || blockers.length) return
    setDeleting(true)
    setError('')
    try {
      const response = await fetch(`${endpointBase}/retire`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, gender, color }),
      })
      const result = await readResult(response)
      if (!response.ok || result.ok === false) {
        setError(result.message || 'Группа не удалена. Обновите данные и проверьте связанные операции.')
        return
      }
      setPreview(null)
      setNotice('Группа удалена из рабочего каталога. История отдельных позиций сохранена.')
      const refreshed = await onRetired?.()
      if (refreshed === false) {
        setNotice('Группа удалена, но список не обновился. Нажмите «Обновить»; повторять удаление не нужно.')
      }
    } catch {
      setError('Не удалось подтвердить результат. Обновите Каталог перед любым повтором — операция могла уже завершиться.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <span className="catalog-local-retirement-action">
        <button
          className="secondary compact catalog-local-retirement-button"
          type="button"
          disabled={disabled || checking || deleting}
          onClick={() => void open()}
          title="Удалить только эту группу пола и цвета внутри текущего исполнения"
        >
          {checking ? 'Проверяю…' : deleting ? 'Удаляю…' : 'Удалить группу'}
        </button>
        {notice ? <small className="catalog-retirement-notice">{notice}</small> : null}
        {error && !preview ? <small className="catalog-retirement-error" role="alert">{error}</small> : null}
      </span>

      {preview ? (
        <div className="modal-backdrop catalog-retirement-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !deleting) setPreview(null)
        }}>
          <section className="modal-card catalog-retirement-modal" role="dialog" aria-modal="true" aria-labelledby="catalog-local-retirement-title">
            <div className="catalog-retirement-head">
              <span className="card-label">Локальное удаление</span>
              <h3 id="catalog-local-retirement-title">Удалить только эту группу?</h3>
              <p>
                <strong>{colorLabel || color || 'Цвет не указан'} · {genderLabel || gender || 'Пол не указан'}</strong> исчезнет только из текущего исполнения. Другие цвета, пол и исполнения не изменятся.
              </p>
            </div>

            <div className="catalog-retirement-summary">
              <div>
                <strong>{Number(preview.activeVariantCount || 0)}</strong>
                <span>позиций</span>
              </div>
              <div>
                <strong>{Number(preview.physicalQuantity || 0)}</strong>
                <span>физически</span>
              </div>
              <div>
                <strong>{Number(preview.activeReservationQuantity || 0)}</strong>
                <span>в резерве</span>
              </div>
            </div>

            <div className="catalog-retirement-explanation">
              <strong>Что произойдёт</strong>
              <p>Все размеры/возрасты только этой комбинации цвета и пола будут выведены из рабочего каталога одной операцией.</p>
              <p>История заказов и движений останется привязана к старым SKU. Складские остатки и резервы не переносятся и не переписываются.</p>
              {Number(preview.historicalOrderItemCount || 0) > 0
                ? <p>В истории заказов найдено позиций: {Number(preview.historicalOrderItemCount || 0)}.</p>
                : null}
              {blockers.length ? (
                <div className="catalog-retirement-modal-error" role="alert">
                  Удаление сейчас заблокировано: {blockers.join('; ')}.
                </div>
              ) : (
                <p>Связей, мешающих безопасному удалению, не найдено.</p>
              )}
            </div>

            {error ? <div className="catalog-retirement-modal-error" role="alert">{error}</div> : null}

            <div className="modal-actions">
              <button className="danger" type="button" disabled={deleting || blockers.length > 0} onClick={() => void confirm()}>
                {deleting ? 'Удаляю…' : 'Удалить группу'}
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
