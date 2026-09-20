import './StockResolutionConfirmModal.css'

export type StockResolutionPrompt = {
  title: string
  intro: string
  actionLabel: string
  cancelLabel?: string
  question?: string
  trackedLabel?: string
  neededLabel?: string
  items: Array<{ productName: string; tracked: number; needed: number }>
  note?: string
}

type Props = {
  prompt: StockResolutionPrompt | null
  onDecision: (confirmed: boolean) => void
}

export function StockResolutionConfirmModal({ prompt, onDecision }: Props) {
  if (!prompt) return null
  return (
    <div className="modal-backdrop stock-resolution-backdrop" role="presentation">
      <section className="modal-card stock-resolution-modal" role="dialog" aria-modal="true" aria-labelledby="stock-resolution-title">
        <div className="stock-resolution-head">
          <div>
            <div className="card-label">Нужно подтверждение</div>
            <h3 id="stock-resolution-title">{prompt.title}</h3>
            <p>{prompt.intro}</p>
          </div>
        </div>
        <div className="stock-resolution-items">
          {prompt.items.map((item, index) => (
            <div className="stock-resolution-item" key={`${item.productName}:${index}`}>
              <strong>{item.productName}</strong>
              <span>{prompt.trackedLabel || 'По учёту'}: <b>{item.tracked} шт.</b></span>
              <span>{prompt.neededLabel || 'В этой операции'}: <b>{item.needed} шт.</b></span>
            </div>
          ))}
        </div>
        <div className="stock-resolution-question">
          <strong>{prompt.question || 'Эти вещи прямо сейчас физически у вас?'}</strong>
          <p>{prompt.note || 'Подтверждение относится только к этой операции и не заменяет пересчёт всего остатка.'}</p>
        </div>
        <div className="modal-actions">
          <button type="button" className="primary" onClick={() => onDecision(true)}>{prompt.actionLabel}</button>
          <button type="button" className="secondary" onClick={() => onDecision(false)}>{prompt.cancelLabel || 'Нет, остановить'}</button>
        </div>
      </section>
    </div>
  )
}
