import { useEffect, useRef, useState, type FormEvent } from 'react'
import './action-confirmation.css'

type Props = {
  title: string
  initialValue: string
  onDecision: (value: string | null) => void
}

export function ActionTextPromptModal({ title, initialValue, onDecision }: Props) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const approveRef = useRef<HTMLButtonElement | null>(null)
  const valid = value.trim().length > 0

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()
    inputRef.current?.select()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onDecision(null)
        return
      }
      if (event.key !== 'Tab') return
      const first = inputRef.current
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
  }, [onDecision])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (valid) onDecision(value.trim())
  }

  return (
    <div className="action-confirmation-backdrop" role="presentation">
      <form className="action-confirmation-dialog" role="dialog" aria-modal="true"
        aria-labelledby="action-text-prompt-title" aria-describedby="action-text-prompt-help"
        onSubmit={submit}>
        <p className="action-confirmation-eyebrow">Причина операции</p>
        <h2 id="action-text-prompt-title">{title}</h2>
        <label className="action-confirmation-input-label" htmlFor="action-text-prompt-input">
          Укажите причину
        </label>
        <textarea id="action-text-prompt-input" ref={inputRef} rows={3}
          className="action-confirmation-text-input" value={value}
          required onChange={(event) => setValue(event.target.value)} />
        <p id="action-text-prompt-help" className="action-confirmation-hint">
          Причина сохранится в истории операции. Если не хотите продолжать, выберите «Отмена».
        </p>
        <div className="action-confirmation-buttons">
          <button type="button" className="secondary" onClick={() => onDecision(null)}>Отмена</button>
          <button type="submit" ref={approveRef} className="primary" disabled={!valid}>Продолжить</button>
        </div>
      </form>
    </div>
  )
}
