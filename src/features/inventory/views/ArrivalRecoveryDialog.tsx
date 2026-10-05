export type ArrivalRecoveryPrompt = {
  code: 'arrival_retired_product' | 'arrival_stale_variant'
  message: string
  productId: number
  productName: string
  retirementId: number
  variantId: number
}

type Props = {
  prompt: ArrivalRecoveryPrompt | null
  busy: boolean
  error: string
  onConfirm: () => void
  onClose: () => void
}

export function ArrivalRecoveryDialog({ prompt, busy, error, onConfirm, onClose }: Props) {
  if (!prompt) return null

  const retiredProduct = prompt.code === 'arrival_retired_product'
  const canContinue = !retiredProduct || prompt.retirementId > 0
  const title = retiredProduct ? 'Товар раньше был удалён' : 'Выбранный вариант изменился'
  const eyebrow = retiredProduct ? 'Безопасное восстановление' : 'Приход сохранён в форме'
  const primaryLabel = retiredProduct ? 'Восстановить и продолжить' : 'Создать новую вариацию и продолжить'
  const secondaryLabel = retiredProduct ? 'Пока не восстанавливать' : 'Вернуться и выбрать другой вариант'

  return (
    <div className="modal-backdrop arrival-recovery-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section className="arrival-recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="arrival-recovery-title">
        <div className="arrival-recovery-hero">
          <div className={retiredProduct ? 'arrival-recovery-icon is-restore' : 'arrival-recovery-icon is-refresh'} aria-hidden="true">
            {retiredProduct ? '↺' : '↻'}
          </div>
          <div>
            <span className="arrival-recovery-eyebrow">{eyebrow}</span>
            <h3 id="arrival-recovery-title">{title}</h3>
            <p>{prompt.message}</p>
          </div>
        </div>

        <div className="arrival-recovery-product">
          <span>Товар</span>
          <strong>{prompt.productName || 'Выбранная позиция'}</strong>
        </div>

        {retiredProduct ? (
          <div className="arrival-recovery-explain">
            <div>
              <strong>Что произойдёт</strong>
              <span>Товар вернётся в рабочий каталог, после чего система сама продолжит этот же Приход.</span>
            </div>
            <div>
              <strong>Что останется безопасным</strong>
              <span>Старые остатки, резервы и удалённые SKU не оживут. История останется отдельной.</span>
            </div>
          </div>
        ) : (
          <div className="arrival-recovery-explain">
            <div>
              <strong>Если эта вещь действительно пришла</strong>
              <span>Система создаст новую рабочую вариацию и сразу завершит текущий Приход.</span>
            </div>
            <div>
              <strong>Старая запись сохранится</strong>
              <span>Удалённый вариант останется в истории и не получит новый остаток.</span>
            </div>
          </div>
        )}

        <div className="arrival-recovery-preserved">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Повторно вводить приход не нужно</strong>
            <small>Все количества и заполненные характеристики останутся в текущей форме.</small>
          </div>
        </div>

        {!canContinue ? (
          <div className="arrival-recovery-error" role="alert">
            Автоматическое восстановление сейчас недоступно: для этого товара не найдена безопасная запись удаления. Форма Прихода сохранена — закройте окно и обновите данные каталога.
          </div>
        ) : null}
        {error ? <div className="arrival-recovery-error" role="alert">{error}</div> : null}

        <div className="arrival-recovery-actions">
          <button className="primary arrival-recovery-primary" type="button" disabled={busy || !canContinue} onClick={onConfirm}>
            {busy ? (retiredProduct ? 'Восстанавливаю и продолжаю…' : 'Создаю и продолжаю…') : primaryLabel}
          </button>
          <button className="secondary arrival-recovery-secondary" type="button" disabled={busy} onClick={onClose}>
            {secondaryLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
