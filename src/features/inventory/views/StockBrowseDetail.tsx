import { buildStockBrowseLayout, stockRowHasBalance, type StockBrowseRow } from '../stockBrowseLayout'

type StockRow = StockBrowseRow & { productId?: number }
type ProductGroup = { key: string; productName: string; allRows?: StockRow[]; rows?: StockRow[] }
type Props = {
  group: ProductGroup
  sourceLabel: string
  physical: (row: StockRow) => number
  reserved: (row: StockRow) => number
  free: (row: StockRow) => number
  onOpenVariant: (row: StockRow) => void
  onOpenHistory: (row: StockRow) => void
}
const number = (value: number) => Number.isFinite(value) ? value.toLocaleString('ru-RU') : '—'

export function StockBrowseDetail({ group, sourceLabel, physical, reserved, free, onOpenVariant, onOpenHistory }: Props) {
  const rows = group.allRows || group.rows || []
  const total = (read: (row: StockRow) => number) => rows.reduce((sum, row) => sum + read(row), 0)
  const executionGroups = buildStockBrowseLayout(rows)
  const nonEmpty = (row: StockRow) => stockRowHasBalance(physical(row), reserved(row), free(row))
  const empty = rows.filter(row => !nonEmpty(row))
  const visible = rows.filter(nonEmpty)
  const child = (row: StockRow) => row.category === 'child'

  return <section className="stock-v13-detail" aria-label={`Остатки модели ${group.productName}`}>
    <header className="stock-v13-detail-header">
      <div className="stock-v13-title">
        <span>Остатки · {sourceLabel}</span>
        <h3>{group.productName}</h3>
        <p>{rows.length} вариантов · {visible.length} с наличием или резервом</p>
      </div>
      <div className="stock-v13-product-balances" aria-label="Итоги модели по выбранной точке">
        <div><span>На месте</span><strong>{number(total(physical))}</strong></div>
        <div><span>Резерв</span><strong>{number(total(reserved))}</strong></div>
        <div className={total(free) < 0 ? 'is-shortage' : 'is-free'}><span>Свободно</span><strong>{number(total(free))}</strong></div>
      </div>
    </header>

    <div className="stock-v13-execution-list">
      {executionGroups.map(execution => {
        const colors = execution.colors
          .map(color => ({ ...color, rows: color.rows.filter(nonEmpty) }))
          .filter(color => color.rows.length)
        if (!colors.length) return null
        return <section className="stock-v13-execution" key={execution.key}>
          <div className="stock-v13-execution-title">
            <strong>{execution.title}</strong>
            <span>{colors.reduce((sum, color) => sum + color.rows.length, 0)} поз.</span>
          </div>
          <div className="stock-v13-colors">
            {colors.map(color => <div key={color.key} className="stock-v13-color">
              <div className="stock-v13-color-head"><strong>{color.color}</strong><small>{color.rows.length} {color.rows.length === 1 ? 'размер' : 'размеров'}</small></div>
              <div className="stock-v13-size-grid">
                {color.rows.map(row => {
                  const p = physical(row), r = reserved(row), f = free(row)
                  const shortage = f < 0 || p < 0
                  return <div className={`stock-v13-size-card ${shortage ? 'is-shortage' : ''}`} key={`variant-${row.variantId}`}>
                    <button className="stock-v13-size-main" type="button" onClick={() => onOpenVariant(row)} aria-label={`${group.productName}, ${color.color}, размер ${row.size || 'не указан'}, на месте ${p}, резерв ${r}, свободно ${f}. Открыть подробности`}>
                      <span className="stock-v13-size-label">{child(row) ? 'Возраст' : 'Размер'} <strong>{row.size || '—'}</strong></span>
                      <span className="stock-v13-size-values">
                        <span><small>На месте</small><b>{number(p)}</b></span>
                        <span><small>Резерв</small><b>{number(r)}</b></span>
                        <span className="stock-v13-size-free"><small>Свободно</small><b>{number(f)}</b></span>
                      </span>
                    </button>
                    <button type="button" className="stock-v13-history" onClick={() => onOpenHistory(row)}>История <span aria-hidden="true">→</span></button>
                  </div>
                })}
              </div>
            </div>)}
          </div>
        </section>
      })}
      {!visible.length ? <div className="stock-v13-no-active">
        <strong>На этой точке нет учтённых остатков и резервов</strong>
        <span>Вы можете открыть нулевые варианты ниже, чтобы найти нужный размер и посмотреть его историю.</span>
      </div> : null}
    </div>
    {empty.length ? <details key={group.key} className="stock-v13-zero-disclosure">
      <summary>Нулевые варианты <strong>{empty.length}</strong> <span aria-hidden="true">⌄</span></summary>
      <p>Эти размеры пока не имеют учтённого наличия и резерва в точке «{sourceLabel}». Нажмите вариант для подробностей.</p>
      <div className="stock-v13-zero-grid">
        {executionGroups.flatMap(execution => execution.colors.flatMap(color => color.rows
          .filter(row => !nonEmpty(row))
          .map(row => <button key={`empty-${row.variantId}`} type="button" onClick={() => onOpenVariant(row)}>
            <strong>{row.size || '—'}</strong>
            <span>{color.color}</span>
            <small>{execution.title}</small>
          </button>)
        ))}
      </div>
    </details> : null}
  </section>
}
