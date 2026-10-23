import type { ReactNode } from 'react'

/**
 * The exact selectable-product row and size/count cell used by the real stocktake.
 * Movement operations reuse these, rather than inventing their own picker or matrix.
 * Stocktake keeps ownership of its autosave, conflict handling and original session.
 */
export function StocktakeProductChoice({
  checked, onToggle, name, description,
}: { checked: boolean; onToggle: () => void; name: string; description: string }) {
  return <label className={`stocktake-selective-product ${checked ? 'is-selected' : ''}`}>
    <input type="checkbox" checked={checked} onChange={onToggle} />
    <span><strong>{name}</strong><small>{description}</small></span>
  </label>
}

export function StocktakeSizeCountCell({
  cellId, size, currentQuantity, value, onChange, onClear,
  disabled = false, stateClass = '', ariaLabel, onKeyDown, onBlur, children,
}: {
  cellId: string | number; size: string; currentQuantity: number; value: string;
  onChange: (value: string) => void; onClear: () => void;
  disabled?: boolean; stateClass?: string; ariaLabel: string;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void; children?: ReactNode;
}) {
  return <label className={`stocktake-size-cell ${value !== '' ? 'is-filled' : ''} ${stateClass}`}>
    <span className="stocktake-size-label">{size || '—'}
      <small className="stocktake-size-system">По системе: {currentQuantity}</small>
    </span>
    <input data-stocktake-count-input="1" data-stocktake-item-id={cellId}
      aria-label={ariaLabel} type="number" min="0" step="1" inputMode="numeric"
      value={value} disabled={disabled} onChange={event => onChange(event.target.value)}
      onKeyDown={onKeyDown} onBlur={onBlur} placeholder="—" />
    {value !== '' && <button className="stocktake-size-clear" type="button"
      aria-label="Очистить значение" title="Вернуть поле в состояние «без изменений»"
      onClick={event => { event.preventDefault(); onClear() }}>×</button>}
    {children}
  </label>
}
