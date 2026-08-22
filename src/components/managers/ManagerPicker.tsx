import { useEffect, useMemo, useRef, useState } from 'react'
import type { ManagerPickerProps } from '../../app/types'
import { formatDateShort, normalizeSearchText } from '../../app/utils'
import { resolveManagerDisplayColor } from './manager-colors'

export function ManagerPicker({ valueId, valueName, options, placeholder = 'Выберите менеджера', disabled, onChange }: ManagerPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const selected = options.find((option) => option.id === valueId) || null

  useEffect(() => {
    if (!open) return undefined
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [open])

  const filtered = useMemo(() => {
    const q = normalizeSearchText(query)
    const rows = q
      ? options.filter((option) => normalizeSearchText(`${option.name} ${option.hiredAt || ''}`).includes(q))
      : options
    return rows.slice(0, 80)
  }, [options, query])

  return (
    <div className="manager-picker" ref={rootRef}>
      <button
        type="button"
        className={`manager-picker-trigger ${open ? 'is-open' : ''}`}
        disabled={disabled}
        onClick={() => { setOpen((value) => !value); setQuery('') }}
      >
        {selected ? <span className="manager-color-dot" style={{ backgroundColor: resolveManagerDisplayColor(selected.colorKey, selected.id) }} /> : <span className="manager-color-dot is-empty" />}
        <span className={selected || valueName ? '' : 'muted'}>{selected?.name || valueName || placeholder}</span>
        <span className="manager-picker-caret">⌄</span>
      </button>
      {open ? (
        <div className="manager-picker-menu">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск сотрудника"
            onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}
          />
          <button type="button" className="manager-picker-option is-clear" onClick={() => { onChange(null); setOpen(false) }}>
            <span className="manager-color-dot is-empty" />
            <span>Не выбран</span>
          </button>
          <div className="manager-picker-options">
            {filtered.map((option) => (
              <button
                key={`manager-picker-${option.id}`}
                type="button"
                className={`manager-picker-option ${option.id === valueId ? 'is-selected' : ''}`}
                onClick={() => { onChange(option); setOpen(false); setQuery('') }}
              >
                <span className="manager-color-dot" style={{ backgroundColor: resolveManagerDisplayColor(option.colorKey, option.id) }} />
                <span className="manager-picker-option-copy">
                  <strong>{option.name}</strong>
                  {option.hiredAt ? <small>с {formatDateShort(option.hiredAt)}</small> : null}
                </span>
              </button>
            ))}
            {!filtered.length ? <div className="smart-picker-empty">Сотрудник не найден.</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
