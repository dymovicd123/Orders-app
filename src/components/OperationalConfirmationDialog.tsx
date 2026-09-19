import './OperationalConfirmationDialog.css'

export type OperationalConfirmationPrompt = {
  title: string
  intro?: string
  rows?: Array<{ name: string; primary: string; secondary?: string }>
  note?: string
  confirmLabel: string
  cancelLabel?: string
}

export function OperationalConfirmationDialog({
  prompt,
  onDecision,
}: {
  prompt: OperationalConfirmationPrompt | null
  onDecision: (confirmed: boolean) => void
}) {
  if (!prompt) return null
  return (
    <div className="operation-confirm-backdrop" role="presentation">
      <section className="operation-confirm-card" role="dialog" aria-modal="true" aria-labelledby="operation-confirm-title">
        <div className="operation-confirm-head">
          <div>
            <div className="operation-confirm-kicker">Нужно подтверждение</div>
            <h3 id="operation-confirm-title">{prompt.title}</h3>
            {prompt.intro ? <p>{prompt.intro}</p> : null}
          </div>
        </div>
        {prompt.rows?.length ? (
          <div className="operation-confirm-rows">
            {prompt.rows.map((row, index) => (
              <div className="operation-confirm-row" key={`${row.name}-${index}`}>
                <strong>{row.name}</strong>
                <span>{row.primary}</span>
                {row.secondary ? <small>{row.secondary}</small> : null}
              </div>
            ))}
          </div>
        ) : null}
        {prompt.note ? <div className="operation-confirm-note">{prompt.note}</div> : null}
        <div className="operation-confirm-actions">
          <button type="button" className="secondary" onClick={() => onDecision(false)}>{prompt.cancelLabel || 'Нет, отменить'}</button>
          <button type="button" className="primary" onClick={() => onDecision(true)}>{prompt.confirmLabel}</button>
        </div>
      </section>
    </div>
  )
}
