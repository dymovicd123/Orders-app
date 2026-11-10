import { useEffect, useRef } from 'react'
import './action-confirmation.css'

type Props = {
  message: string | null
  onDecision: (confirmed: boolean) => void
}

export function ActionConfirmationModal({ message, onDecision }: Props) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const approveRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!message) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onDecision(false)
      }
      if (event.key !== 'Tab') return
      const first = cancelRef.current
      const last = approveRef.current
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [message, onDecision])

  if (!message) return null

  const details = message.split(/\n+/).map(part => part.trim()).filter(Boolean)

  return (
    <div className="action-confirmation-backdrop" role="presentation">
      <section className="action-confirmation-dialog" role="alertdialog" aria-modal="true"
        aria-labelledby="action-confirmation-title" aria-describedby="action-confirmation-details">
        <p className="action-confirmation-eyebrow">Подтверждение операции</p>
        <h2 id="action-confirmation-title">Проверьте действие</h2>
        <div className="action-confirmation-details" id="action-confirmation-details">
          {details.map((line, index) => <p key={index}>{line}</p>)}
        </div>
        <p className="action-confirmation-hint">Если данные или последствия указаны неверно, выберите «Отмена».</p>
        <div className="action-confirmation-buttons">
          <button type="button" className="secondary" ref={cancelRef} onClick={() => onDecision(false)}>
            Отмена
          </button>
          <button type="button" className="primary" ref={approveRef} onClick={() => onDecision(true)}>
            Подтвердить действие
          </button>
        </div>
      </section>
    </div>
  )
}
