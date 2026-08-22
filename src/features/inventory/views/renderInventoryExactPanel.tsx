import { LinkedTableScroll } from '../../../components/tables/LinkedTableScroll'
import type { InventoryRenderContext } from './types'

type PanelContext = Pick<InventoryRenderContext,
  | 'ChoicePills'
  | 'FriendlyNumberInput'
  | 'SmartPickerInput'
  | 'buildInventoryMatrix'
  | 'changeInventoryOperationSource'
  | 'createEmptyInventoryItem'
  | 'createEmptyInventoryMatrixDraft'
  | 'handleInventoryMatrixKeyDown'
  | 'inventoryDraft'
  | 'inventoryMatrix'
  | 'inventoryMatrixAxisLabel'
  | 'inventoryMatrixCellKey'
  | 'inventoryMatrixCellMap'
  | 'inventoryMatrixColors'
  | 'inventoryMatrixDraftItem'
  | 'inventoryMatrixSizes'
  | 'inventoryMatrixSummary'
  | 'inventoryMovementBusy'
  | 'inventoryOperationProductGroups'
  | 'inventoryOperationSearch'
  | 'inventoryPanelStyle'
  | 'isAdmin'
  | 'resetInventoryOperationSelection'
  | 'saveInventoryMovement'
  | 'setInventoryDraft'
  | 'setInventoryMatrix'
  | 'setInventoryMatrixCell'
  | 'setInventoryMatrixColorToAdd'
  | 'setInventoryMatrixSizeToAdd'
  | 'sourceLabel'
  | 'suggestionValues'
  | 'updateInventoryMatrixCategory'
  | 'updateInventoryMatrixGender'
  | 'updateInventoryMatrixLength'
  | 'updateInventoryMatrixMaterial'
  | 'updateInventoryMatrixProductInput'
>


export function renderInventoryExactPanel(ctx: PanelContext) {
  const {
    ChoicePills,
    FriendlyNumberInput,
    SmartPickerInput,
    buildInventoryMatrix,
    changeInventoryOperationSource,
    createEmptyInventoryItem,
    createEmptyInventoryMatrixDraft,
    handleInventoryMatrixKeyDown,
    inventoryDraft,
    inventoryMatrix,
    inventoryMatrixAxisLabel,
    inventoryMatrixCellKey,
    inventoryMatrixCellMap,
    inventoryMatrixColors,
    inventoryMatrixDraftItem,
    inventoryMatrixSizes,
    inventoryMatrixSummary,
    inventoryMovementBusy,
    inventoryOperationProductGroups,
    inventoryOperationSearch,
    inventoryPanelStyle,
    isAdmin,
    resetInventoryOperationSelection,
    saveInventoryMovement,
    setInventoryDraft,
    setInventoryMatrix,
    setInventoryMatrixCell,
    setInventoryMatrixColorToAdd,
    setInventoryMatrixSizeToAdd,
    sourceLabel,
    suggestionValues,
    updateInventoryMatrixCategory,
    updateInventoryMatrixGender,
    updateInventoryMatrixLength,
    updateInventoryMatrixMaterial,
    updateInventoryMatrixProductInput
  } = ctx

  return (
    <div className="inventory-exact-panel" style={inventoryPanelStyle('exact')}>
                    <div className="inventory-panel-headline">
                      <div>
                        <h3>Точная установка остатков</h3>
                        <p>Расширенный инструмент для администратора. Для обычной массовой сверки используйте «Ревизию», для нескольких позиций — «Склад → Движение товара → Корректировка».</p>
                      </div>
                    </div>
    
                    <div className="inventory-operation-context-row">
                      <div className="inventory-operation-source-control">
                        <span>Точка</span>
                        <div>
                          <button type="button" className={inventoryDraft.source === 'warehouse' ? 'is-active' : ''} onClick={() => changeInventoryOperationSource('warehouse')}>Склад</button>
                          <button type="button" className={inventoryDraft.source === 'boutique' ? 'is-active' : ''} onClick={() => changeInventoryOperationSource('boutique')}>Бутик</button>
                        </div>
                      </div>
                      <label className="inventory-operation-comment-field">
                        <span>Причина корректировки *</span>
                        <input value={inventoryDraft.comment} onChange={(event) => setInventoryDraft((current) => ({ ...current, comment: event.target.value }))} />
                      </label>
                    </div>
    
                    <div className="inventory-matrix-workspace inventory-exact-matrix-workspace">
                      <section className="inventory-matrix-simple-panel">
                        <div className="inventory-matrix-simple-head">
                          <div>
                            <strong>Выберите существующую группу товара</strong>
                            <span>Этот инструмент не создаёт новые варианты. Он меняет только уже существующие позиции выбранной точки.</span>
                          </div>
                          {inventoryMatrix.ready ? <span className="inventory-matrix-ready-badge">Таблица сформирована</span> : null}
                        </div>
    
                        <div className="inventory-matrix-simple-form inventory-matrix-flexible-form">
                          <div className="inventory-matrix-product-field inventory-picker-field">
                            <span>Наименование</span>
                            <SmartPickerInput
                              value={inventoryOperationSearch}
                              options={inventoryOperationProductGroups.map((group) => group.productName)}
                              onChange={updateInventoryMatrixProductInput}
                              onPick={updateInventoryMatrixProductInput}
                              ariaLabel="Товар для точной установки"
                            />
                          </div>
    
                          <div className="field-block inventory-matrix-choice-field">
                            <span>Тип</span>
                            <ChoicePills
                              value={inventoryMatrix.category}
                              onChange={(value) => updateInventoryMatrixCategory(value === 'child' ? 'child' : 'adult')}
                              options={[
                                { value: 'adult', label: 'Взрослый' },
                                { value: 'child', label: 'Детский' },
                              ]}
                            />
                          </div>
    
                          <div className="field-block inventory-matrix-choice-field">
                            <span>Пол</span>
                            <ChoicePills
                              value={inventoryMatrix.gender || ''}
                              onChange={updateInventoryMatrixGender}
                              options={[
                                { value: '', label: 'Не указан' },
                                { value: 'ЖЕН', label: 'Жен' },
                                { value: 'МУЖ', label: 'Муж' },
                                ...(inventoryMatrix.category === 'child' ? [{ value: 'ДЕТСКИЙ', label: 'Детский' }] : []),
                              ]}
                            />
                          </div>
    
                          <div className="inventory-picker-field">
                            <span>Материал</span>
                            <SmartPickerInput value={inventoryMatrix.material} options={suggestionValues.materials} onChange={updateInventoryMatrixMaterial} onPick={updateInventoryMatrixMaterial} ariaLabel="Материал" />
                          </div>
    
                          <div className="inventory-picker-field">
                            <span>Длина</span>
                            <SmartPickerInput value={inventoryMatrix.length} options={suggestionValues.lengths} onChange={updateInventoryMatrixLength} onPick={updateInventoryMatrixLength} ariaLabel="Длина" />
                          </div>
    
                          <button className="primary inventory-matrix-show-button" type="button" disabled={!inventoryMatrix.productName.trim()} onClick={buildInventoryMatrix}>
                            {inventoryMatrix.ready ? 'Обновить таблицу' : 'Показать таблицу'}
                          </button>
                        </div>
                      </section>
    
                      {inventoryMatrix.ready ? (
                        <section className="inventory-matrix-section">
                          <div className="inventory-matrix-head">
                            <div>
                              <strong>Фактический остаток</strong>
                              <small>{inventoryMatrix.productName} · {[inventoryMatrix.category === 'child' ? 'Детский' : 'Взрослый', inventoryMatrix.gender, inventoryMatrix.material, inventoryMatrix.length].filter(Boolean).join(' · ')}</small>
                            </div>
                          </div>
    
                          <div className="inventory-matrix-scroll-region">
                            <LinkedTableScroll className="inventory-matrix-table-shell" ariaLabel="Горизонтальная прокрутка точной установки">
                              <table className="inventory-matrix-table">
                                <thead>
                                  <tr>
                                    <th className="inventory-matrix-corner" aria-label="Размер / цвет"><span>Размер / цвет</span></th>
                                    {inventoryMatrixColors.map((color) => <th key={`exact-color-${color || 'empty'}`}><span className="inventory-matrix-visible-axis-label">{inventoryMatrixAxisLabel(color, 'color')}</span></th>)}
                                  </tr>
                                </thead>
                                <tbody>
                                  {inventoryMatrixSizes.map((size) => (
                                    <tr key={`exact-size-${size || 'empty'}`}>
                                      <th><span className="inventory-matrix-visible-axis-label">{inventoryMatrixAxisLabel(size, 'size')}</span></th>
                                      {inventoryMatrixColors.map((color) => {
                                        const cell = inventoryMatrixCellMap.get(inventoryMatrixCellKey(size, color))
                                        const draftItem = inventoryMatrixDraftItem(size, color)
                                        const current = cell?.current || 0
                                        return (
                                          <td key={`exact-cell-${size || 'empty'}-${color || 'empty'}`} className={draftItem?.touched ? 'is-edited' : ''}>
                                            <FriendlyNumberInput
                                              className="inventory-matrix-input"
                                              type="number"
                                              min="0"
                                              value={draftItem?.touched ? String(draftItem.quantity) : ''}
                                              placeholder={String(current)}
                                              disabled={!cell}
                                              onChange={(event) => setInventoryMatrixCell(size, color, event.target.value)}
                                              onKeyDown={handleInventoryMatrixKeyDown}
                                            />
                                            <span className="inventory-matrix-cell-meta">{cell ? `сейчас ${current}` : 'нет позиции'}</span>
                                          </td>
                                        )
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </LinkedTableScroll>
                          </div>
    
                          <div className="inventory-matrix-hint">Пустая клетка — оставить без изменений. 0 — установить ноль. Клетки, которых нет в выбранной точке, заблокированы.</div>
                        </section>
                      ) : null}
    
                      <div className="inventory-submit-bar inventory-submit-bar-v182">
                        <div>
                          <strong>Сохранить точную установку</strong>
                          <span>{inventoryMatrixSummary.edited} ячеек · {sourceLabel(inventoryDraft.source)}</span>
                        </div>
                        <div className="actions">
                          <button className="primary" type="button" disabled={inventoryMovementBusy || !isAdmin || inventoryMatrixSummary.edited === 0} onClick={() => void saveInventoryMovement()}>{inventoryMovementBusy ? 'Сохраняю…' : 'Сохранить изменения'}</button>
                          <button className="secondary" type="button" disabled={inventoryMovementBusy} onClick={() => {
                            setInventoryDraft((current) => ({ ...current, items: [createEmptyInventoryItem()], comment: '' }))
                            setInventoryMatrix(createEmptyInventoryMatrixDraft())
                            setInventoryMatrixColorToAdd('')
                            setInventoryMatrixSizeToAdd('')
                            resetInventoryOperationSelection()
                          }}>Очистить</button>
                        </div>
                      </div>
                    </div>
                  </div>
  )
}
