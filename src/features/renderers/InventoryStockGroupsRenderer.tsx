// @ts-nocheck -- extracted view renderer; controller remains typed in App.tsx.

type RendererContext = Record<string, any>

export function InventoryStockGroupsRenderer(source: InventorySourceKey, groups: InventoryStockGroup[], ctx: RendererContext) {
  const {
    expandedInventoryGroups,
    getInventoryRowCategory,
    hasInventoryQuickFilters,
    inventorySearchTokens,
    isAdmin,
    productCategoryLabel,
    sourceLabel,
    startInventoryTransferFromStockRow,
    toggleInventoryGroup,
  } = ctx

    if (!groups.length) {
      return <div className="empty-state">По текущему поиску и фильтрам остатков нет.</div>
    }

    return groups.map((group) => {
      const hasProblems = group.negativeCount > 0 || group.zeroCount > 0
      const expanded = expandedInventoryGroups[group.key] ?? Boolean(inventorySearchTokens.length || hasInventoryQuickFilters || hasProblems)
      const sourceName = sourceLabel(source)
      const groupCategorySummary = group.category === 'child' ? 'Детский' : 'Взрослый'
      const groupMeta = [
        group.genders.length ? `Пол: ${group.genders.slice(0, 3).join(', ')}` : '',
        group.colors.length ? `Цвета: ${group.colors.slice(0, 4).join(', ')}` : '',
        group.sizes.length ? `Размеры: ${group.sizes.slice(0, 6).join(', ')}` : '',
      ].filter(Boolean).join(' · ')

      return (
        <article
          className={`inventory-product-group ${hasProblems ? 'has-problems' : ''} ${group.totalQuantity < 0 ? 'is-negative' : group.totalQuantity === 0 ? 'is-zero' : ''}`}
          key={group.key}
        >
          <button className="inventory-product-group-head" type="button" onClick={() => toggleInventoryGroup(group.key)}>
            <div>
              <strong>{group.displayName}</strong>
              <span><b className={`category-inline-badge ${group.category === 'child' ? 'is-child' : 'is-adult'}`}>{groupCategorySummary}</b>{groupMeta ? ` · ${groupMeta}` : ` · ${sourceName}`}</span>
            </div>
            <div className="inventory-product-group-stats">
              <span className="soft-badge">{group.variantCount} вар.</span>
              {group.negativeCount ? <span className="soft-badge danger-soft">минус: {group.negativeCount}</span> : null}
              {group.zeroCount ? <span className="soft-badge warning-soft">ноль: {group.zeroCount}</span> : null}
              <strong>{group.totalQuantity}</strong>
              <span>{expanded ? 'Свернуть' : 'Варианты'}</span>
            </div>
          </button>

          {expanded ? (
            <div className="inventory-variant-table-shell">
              <table className="data-table inventory-variant-table">
                <thead>
                  <tr>
                    <th>Вариант</th>
                    <th>Тип</th>
                    <th>Пол</th>
                    <th>Материал</th>
                    <th>Длина</th>
                    <th>Размер / возраст</th>
                    <th>Остаток</th>
                    <th>Последнее</th>
                    {isAdmin ? <th className="inventory-transfer-quick-head">Действие</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => {
                    const quantity = Number(row.quantity || 0)
                    return (
                      <tr className={quantity < 0 ? 'is-negative-row' : quantity === 0 ? 'is-zero-row' : ''} key={`${source}-${row.id}`}>
                        <td><strong>{row.color || 'Без цвета'}</strong></td>
                        <td><b className={`category-inline-badge ${getInventoryRowCategory(row) === 'child' ? 'is-child' : 'is-adult'}`}>{productCategoryLabel(getInventoryRowCategory(row))}</b></td>
                        <td>{row.gender || '—'}</td>
                        <td>{row.material || '—'}</td>
                        <td>{row.length || '—'}</td>
                        <td>{row.size || '—'}</td>
                        <td><strong className={quantity < 0 ? 'text-danger' : quantity === 0 ? 'text-warning' : 'text-success'}>{quantity}</strong></td>
                        <td>{row.lastAction || '—'}{row.lastSourceRef ? ` · ${row.lastSourceRef}` : ''}</td>
                        {isAdmin ? <td className="inventory-transfer-quick-cell">{quantity > 0 && row.variantId ? <button type="button" className="secondary compact" onClick={() => startInventoryTransferFromStockRow(source, row)}>Переместить</button> : <span>—</span>}</td> : null}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>
      )
    })
  
}
