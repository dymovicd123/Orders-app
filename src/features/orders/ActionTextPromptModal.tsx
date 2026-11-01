import { useEffect, useRef, useState } from 'react'
import './ActionConfirmationModal.css'

type Props = {
  message: string | null
  defaultValue: string
  onDecision: (value: string | null) => void
}

/** One explicit text fact before an exceptional administrative action.
 * Unlike window.prompt this does not halt Chromium/Work and Escape is safe.
 */
export function ActionTextPromptModal({ message, defaultValue, onDecision }: Props) {
  const [draft, setDraft] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (!message) return
    setDraft(defaultValue)
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    requestAnimationFrame(() => inputRef.current?.focus())
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onDecision(null) }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (previous?.isConnected) previous.focus()
    }
  }, [message, defaultValue, onDecision])
  if (!message) return null
  const value = draft.trim()
  return (
    <div className="modal-backdrop work-action-confirm-backdrop" role="presentation"
      onMouseDown={event=>{if(event.target===event.currentTarget)onDecision(null)}}>
      <section className="modal-card work-action-confirm" role="dialog" aria-modal="true"
        aria-labelledby="work-action-text-title" aria-describedby="work-action-text-detail">
        <span className="work-action-confirm-kicker">Административное действие</span>
        <h3 id="work-action-text-title">{message}</h3>
        <p id="work-action-text-detail">Укажите основание. Отмена ничего не меняет в системе.</p>
        <label className="work-action-confirm-detail">
          <span>Причина (обязательно)</span>
          <input ref={inputRef} type="text" value={draft} maxLength={600}
            onChange={event=>setDraft(event.target.value)} />
        </label>
        <div className="modal-actions work-action-confirm-actions">
          <button className="secondary" type="button" onClick={()=>onDecision(null)}>Отмена — ничего не менять</button>
          <button className="primary" type="button" disabled={!value} onClick={()=>onDecision(value)}>Продолжить</button>
        </div>
      </section>
    </div>
  )
}
