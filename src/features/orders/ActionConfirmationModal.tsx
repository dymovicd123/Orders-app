import { useEffect, useRef } from 'react'
import './ActionConfirmationModal.css'

type Props = {
  message: string | null
  onDecision: (confirmed: boolean) => void
}

/** An accessible, non-blocking replacement for browser confirm().
 * The original domain-specific text is preserved verbatim, including order,
 * SKU, quantities, money, source, and stock/revision side effects.
 */
export function ActionConfirmationModal({ message, onDecision }: Props) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!message) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onDecision(false)
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      if (previous?.isConnected) previous.focus()
    }
  }, [message, onDecision])
  if (!message) return null
  const parts = message.trim().split(/\n\s*\n|\n/g).map(x=>x.trim()).filter(Boolean)
  const heading = parts[0] || 'Подтвердите действие'
  const title = heading.length > 130 ? 'Подтвердите действие' : heading
  const descriptions = heading.length > 130 ? parts : parts.slice(1)
  return (
    <div className="modal-backdrop work-action-confirm-backdrop" role="presentation"
      onMouseDown={event=>{if(event.target===event.currentTarget)onDecision(false)}}>
      <section className="modal-card work-action-confirm" role="alertdialog" aria-modal="true"
        aria-labelledby="work-action-confirm-title" aria-describedby="work-action-confirm-detail">
        <div className="work-action-confirm-kicker">Подтверждение операции</div>
        <h3 id="work-action-confirm-title">{title}</h3>
        <div id="work-action-confirm-detail" className="work-action-confirm-detail">
          {descriptions.map((line,index)=><p key={index}>{line}</p>)}
          {!descriptions.length ? <p>Изменения будут выполнены только после вашего подтверждения.</p> : null}
        </div>
        <div className="work-action-confirm-warning">
          Проверьте заказ, товар, количество и последствия. «Отмена» ничего не изменит.
        </div>
        <div className="modal-actions work-action-confirm-actions">
          <button ref={cancelRef} className="secondary" type="button" onClick={()=>onDecision(false)}>
            Отмена — ничего не менять
          </button>
          <button className="primary" type="button" onClick={()=>onDecision(true)}>
            Да, выполнить действие
          </button>
        </div>
      </section>
    </div>
  )
}
