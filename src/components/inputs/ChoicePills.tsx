import type { ChoicePillsProps } from '../../app/types'
import { normalizeSuggestion } from '../../app/utils'

export function ChoicePills({ value, options, onChange, className }: ChoicePillsProps) {
  return (
    <div className={`choice-pills ${className || ''}`.trim()}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`choice-pill ${normalizeSuggestion(value) === normalizeSuggestion(option.value) ? 'is-active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
