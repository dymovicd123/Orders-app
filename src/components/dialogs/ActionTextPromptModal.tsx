import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import './action-confirmation.css'

export type ActionTextPromptRequest = {
  title: string
  description: string
  label: string
  initialValue?: string
  placeholder?: string
  minLength?: number
  maxLength?: number
  confirmLabel?: string
}

export function useActionTextPrompt() {
  const [request, setRequest] = useState<ActionTextPromptRequest | null>(null)
  const resolverRef = useRef<((value: string | null) => void) | null>(null)

  const askActionText = useCallback((next: ActionTextPromptRequest): Promise<string | null> => {
    // Do not replace an unanswered request or accidentally submit a different reason.
    if (resolverRef.current) return Promise.resolve(null)
    return new Promise((resolve) => {
      resolverRef.current = resolve
      setRequest(next)
    })
  }, [])

  const answerActionText = useCallback((value: string | null) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setRequest(null)
    resolve?.(value)
  }, [])

  useEffect(() => () => {
    resolverRef.current?.(null)
    resolverRef.current = null
  }, [])

  return { request, askActionText, answerActionText }
}

export function ActionTextPromptModal({ request, onDecision }: {
  request: ActionTextPromptRequest | null
  onDecision: (value: string | null) => void
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const approveRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!request) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setValue(request.initialValue || '')
    setError('')
    inputRef.current?.focus()

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
  }, [request, onDecision])

  if (!request) return null
  const minLength = Math.max(1, request.minLength || 1)
  const trimmed = value.trim()
  const valid = trimmed.length >= minLength

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!valid) {
      setError(minLength > 1 ? `Введите не менее ${minLength} символов.` : 'Укажите причину операции.')
      inputRef.current?.focus()
      return
    }
    onDecision(trimmed)
  }

  return (
    <div className="action-confirmation-backdrop" role="presentation">
      <section className="action-confirmation-dialog" role="dialog" aria-modal="true"
        aria-labelledby="action-text-title" aria-describedby="action-text-description">
        <p className="action-confirmation-eyebrow">Подтверждение операции</p>
        <h2 id="action-text-title">{request.title}</h2>
        <p id="action-text-description" className="action-confirmation-details">{request.description}</p>
        <form onSubmit={submit}>
          <label className="action-text-label" htmlFor="action-text-reason">{request.label}</label>
          <textarea id="action-text-reason" className="action-text-input" rows={3}
            ref={inputRef} value={value} maxLength={request.maxLength || 500}
            placeholder={request.placeholder || 'Укажите причину'}
            aria-invalid={Boolean(error)} aria-describedby={error ? 'action-text-error' : undefined}
            onChange={(event) => { setValue(event.target.value); setError('') }} />
          {error ? <p id="action-text-error" className="action-text-error" role="alert">{error}</p> : null}
          <div className="action-confirmation-buttons">
            <button type="button" className="secondary" ref={cancelRef} onClick={() => onDecision(null)}>Отмена</button>
            <button type="submit" className="primary" ref={approveRef} disabled={!valid}>
              {request.confirmLabel || 'Подтвердить'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
