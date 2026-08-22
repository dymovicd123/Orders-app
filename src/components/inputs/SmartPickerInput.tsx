import { useEffect, useMemo, useState } from 'react'
import type { SmartPickerInputProps } from '../../app/types'
import { normalizeSearchText, rankSmartPickerOption } from '../../app/utils'

export function SmartPickerInput({
  value,
  options,
  placeholder,
  onChange,
  onPick,
  ariaLabel,
  disabled,
  className,
}: SmartPickerInputProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const [typedSearch, setTypedSearch] = useState(false)

  useEffect(() => {
    if (!open || !typedSearch) setQuery(value)
    if (!open) setTypedSearch(false)
  }, [open, typedSearch, value])

  const filteredOptions = useMemo(() => {
    const search = typedSearch ? normalizeSearchText(query) : ''
    const searchTokens = search.split(/\s+/).filter(Boolean)
    const current = normalizeSearchText(value)
    const uniqueOptions: string[] = []
    const seen = new Set<string>()

    for (const option of options) {
      const key = normalizeSearchText(option)
      if (!key || seen.has(key)) continue
      seen.add(key)
      uniqueOptions.push(option)
    }

    const next = search
      ? uniqueOptions
        .map((option, index) => ({ option, index, rank: rankSmartPickerOption(option, search, searchTokens) }))
        .sort((left, right) => {
          if (left.rank.matched !== right.rank.matched) return left.rank.matched ? -1 : 1
          if (left.rank.score !== right.rank.score) return left.rank.score - right.rank.score
          if (left.rank.position !== right.rank.position) return left.rank.position - right.rank.position
          return left.index - right.index
        })
        .map((entry) => entry.option)
      : uniqueOptions

    if (current && !next.some((option) => normalizeSearchText(option) === current)) next.unshift(value)
    return next.slice(0, 80)
  }, [options, query, typedSearch, value])

  return (
    <div className={`smart-picker ${className || ''}`.trim()}>
      <div className="smart-picker-shell">
        <input
          aria-label={ariaLabel}
          disabled={disabled}
          value={query}
          placeholder={placeholder}
          onFocus={() => {
            setQuery(value)
            setTypedSearch(false)
            setOpen(true)
          }}
          onChange={(event) => {
            const nextValue = event.target.value
            setQuery(nextValue)
            setTypedSearch(true)
            onChange(nextValue)
            setOpen(true)
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        />
        {value ? (
          <button
            type="button"
            className="smart-picker-clear"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery('')
              setTypedSearch(true)
              onChange('')
              onPick?.('')
              setOpen(true)
            }}
            aria-label="Очистить поле"
            title="Очистить"
          >
            ×
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="smart-picker-menu" role="listbox">
          {filteredOptions.length ? filteredOptions.map((option) => (
            <button
              key={`${option}-${placeholder || 'smart-picker'}`}
              type="button"
              className={`smart-picker-option ${normalizeSearchText(option) === normalizeSearchText(value) ? 'is-selected' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setQuery(option)
                setTypedSearch(false)
                onChange(option)
                onPick?.(option)
                setOpen(false)
              }}
            >
              {option}
            </button>
          )) : (
            <div className="smart-picker-empty">Совпадений нет. Можно ввести своё значение.</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
