from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one target, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


view = 'src/features/inventory/views/renderInventoryOverviewPanel.tsx'
replace_once(
    view,
    "{cycleCountLoading ? 'Обновляю…' : 'Другие позиции'}",
    "{cycleCountLoading ? 'Обновляю…' : 'Показать другую пачку'}",
)
replace_once(
    view,
    '<div className="inventory-cycle-count-system"><span>На месте <strong>{row.physical}</strong></span>{Number(row.reserved || 0) ? <span>В заказах <strong>{row.reserved}</strong></span> : null}</div>',
    '<div className="inventory-cycle-count-system"><span>По системе на месте: <strong>{row.physical}</strong></span>{Number(row.reserved || 0) ? <span>В заказах: <strong>{row.reserved}</strong></span> : null}</div>',
)
replace_once(
    view,
    '<div className="inventory-routine-cycle-actions"><button className="secondary compact" type="button" disabled={cycleCountBusy} onClick={() => void submitRoutineCycleCount(row, Number(row.physical || 0))}>Совпадает: {row.physical}</button><details className="inventory-routine-cycle-other"><summary>Другое количество</summary><div className="inventory-routine-cycle-edit"><input aria-label={`Фактическое количество ${row.productName}`} type="number" min="0" step="1" inputMode="numeric" value={value} onChange={(event) => { const raw = event.target.value; if (raw === \'\') return setCycleCountValues((state: any) => ({ ...state, [String(row.variantId)]: \'\' })); const parsed = Number(raw); if (Number.isFinite(parsed)) setCycleCountValues((state: any) => ({ ...state, [String(row.variantId)]: String(Math.max(0, Math.trunc(parsed))) })) }} /><button className="primary compact" type="button" disabled={cycleCountBusy || value === \'\'} onClick={() => void submitRoutineCycleCount(row, Number(value))}>Сохранить факт</button></div></details></div>',
    '<div className="inventory-routine-cycle-actions"><button className="primary compact inventory-routine-cycle-confirm" type="button" disabled={cycleCountBusy} onClick={() => void submitRoutineCycleCount(row, Number(row.physical || 0))}>Подтвердить {row.physical}</button><details className="inventory-routine-cycle-other"><summary className="inventory-routine-cycle-other-button">Указать другое количество</summary><div className="inventory-routine-cycle-edit"><input aria-label={`Фактическое количество ${row.productName}`} type="number" min="0" step="1" inputMode="numeric" value={value} onChange={(event) => { const raw = event.target.value; if (raw === \'\') return setCycleCountValues((state: any) => ({ ...state, [String(row.variantId)]: \'\' })); const parsed = Number(raw); if (Number.isFinite(parsed)) setCycleCountValues((state: any) => ({ ...state, [String(row.variantId)]: String(Math.max(0, Math.trunc(parsed))) })) }} /><button className="primary compact" type="button" disabled={cycleCountBusy || value === \'\'} onClick={() => void submitRoutineCycleCount(row, Number(value))}>Сохранить</button></div></details></div>',
)

css_path = Path('src/styles/188i-cycle-counts.css')
css = css_path.read_text(encoding='utf-8')
marker = '/* Phase 2 UX — action clarity for routine count choices. */'
if marker in css:
    raise SystemExit('CSS UX override already present')
css += '''\n\n/* Phase 2 UX — action clarity for routine count choices. */\n.inventory-routine-cycle-actions{gap:8px}\n.inventory-routine-cycle-confirm{min-width:112px}\n.inventory-routine-cycle-other>summary.inventory-routine-cycle-other-button{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:7px 11px;border:1px solid var(--line,#dbe3ee);border-radius:9px;background:var(--panel,#fff);color:var(--text,#334155);font-size:11px;font-weight:700;line-height:1.2;cursor:pointer;list-style:none;white-space:nowrap}\n.inventory-routine-cycle-other>summary.inventory-routine-cycle-other-button:hover{border-color:color-mix(in srgb,var(--accent,#2563eb) 34%,var(--line,#dbe3ee));background:color-mix(in srgb,var(--accent-soft,#eff6ff) 45%,var(--panel,#fff))}\n.inventory-routine-cycle-other[open]>summary.inventory-routine-cycle-other-button{border-color:color-mix(in srgb,var(--accent,#2563eb) 40%,var(--line,#dbe3ee));background:color-mix(in srgb,var(--accent-soft,#eff6ff) 60%,var(--panel,#fff));color:var(--accent,#2563eb)}\n@media(max-width:820px){.inventory-routine-cycle-confirm,.inventory-routine-cycle-other{flex:1 1 180px}.inventory-routine-cycle-other>summary.inventory-routine-cycle-other-button{width:100%}}\n@media(max-width:560px){.inventory-routine-cycle-confirm,.inventory-routine-cycle-other{width:100%}.inventory-routine-cycle-confirm{min-width:0}.inventory-routine-cycle-other>summary.inventory-routine-cycle-other-button{width:100%}}\n'''
css_path.write_text(css, encoding='utf-8')

test = 'scripts/test-phase2-smart-daily-stock.mjs'
replace_once(test, "check(overview.includes('Совпадает:'), 'One-tap matching action is missing')", "check(overview.includes('Подтвердить {row.physical}'), 'One-tap confirm action is missing')")
replace_once(test, "check(overview.includes('Другое количество'), 'Mismatch action is missing')", "check(overview.includes('Указать другое количество'), 'Mismatch action is missing')")
replace_once(test, "check(css.includes('.inventory-cycle-count-row.is-routine') && css.includes('@media(max-width:560px)'), 'Routine batch has no small-screen layout')", "check(css.includes('.inventory-cycle-count-row.is-routine') && css.includes('@media(max-width:560px)'), 'Routine batch has no small-screen layout')\n  check(css.includes('.inventory-routine-cycle-other>summary.inventory-routine-cycle-other-button'), 'Mismatch control is not visually button-like')\n  check(overview.includes('Показать другую пачку'), 'Batch refresh action is ambiguous')\n  check(!overview.includes('Совпадает:'), 'Old status-like confirm wording is still present')")

print('PHASE2 UX ACTION CLARITY PATCH APPLIED')
