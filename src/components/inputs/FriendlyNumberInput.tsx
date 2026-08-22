import { useEffect, useRef, useState } from 'react'
import type { FriendlyNumberInputProps } from '../../app/types'

/** Numeric input that stays easy to edit even when the stored value is zero. */
export function FriendlyNumberInput({ value, onChange, onFocus, onBlur, onWheel, onKeyDown, inputMode, ...props }: FriendlyNumberInputProps) {
  const formatValue = (next: FriendlyNumberInputProps['value']) => next === null || next === undefined ? '' : String(next)
  const [draft, setDraft] = useState(() => formatValue(value))
  const focusedRef = useRef(false)
  const latestValueRef = useRef(value)

  useEffect(() => {
    latestValueRef.current = value
    if (!focusedRef.current) setDraft(formatValue(value))
  }, [value])

  const isZeroText = (text: string) => /^[-+]?0(?:[.,]0*)?$/.test(text.trim())

  return (
    <input
      {...props}
      type="number"
      inputMode={inputMode || 'decimal'}
      value={draft}
      onFocus={(event) => {
        focusedRef.current = true
        if (isZeroText(event.currentTarget.value)) setDraft('')
        onFocus?.(event)
      }}
      onKeyDown={(event) => {
        if (/^[0-9]$/.test(event.key) && isZeroText(event.currentTarget.value)) event.currentTarget.select()
        onKeyDown?.(event)
      }}
      onChange={(event) => {
        let nextValue = event.currentTarget.value
        if (isZeroText(draft) && /^[-+]?0\d/.test(nextValue)) {
          const sign = nextValue.startsWith('-') ? '-' : nextValue.startsWith('+') ? '+' : ''
          const unsigned = sign ? nextValue.slice(1) : nextValue
          nextValue = sign + unsigned.replace(/^0+(?=\d)/, '')
          event.currentTarget.value = nextValue
        }
        setDraft(nextValue)
        onChange?.(event)
      }}
      onBlur={(event) => {
        focusedRef.current = false
        setDraft(event.currentTarget.value.trim() === '' ? formatValue(latestValueRef.current) : event.currentTarget.value)
        onBlur?.(event)
      }}
      onWheel={(event) => {
        event.currentTarget.blur()
        onWheel?.(event)
      }}
    />
  )
}
