import type { InventoryRenderContext } from './types'
import { refineMovementPickerContext } from '../movementPickerB2B'
import '../../../styles/192b2b-movement-picker.css'

type PanelContext = Pick<InventoryRenderContext,
  | 'FriendlyNumberInput'
  | 'SmartPickerInput'
  | 'arrivalWorkspace'
  | 'changeInventoryOperationSource'
  | 'createEmptyInventoryItem'
  | 'createEmptyInventoryMatrixDraft'
  | 'getStockQuantityForVariant'
  | 'inventoryArrivalSummary'
  | 'inventoryDraft'
  | 'inventoryDraftSummary'
  | 'inventoryExistingVariantSearch'
  | 'inventoryMovementBusy'
  | 'inventoryMovementText'
  | 'inventoryOperationAllProductGroups'
  | 'inventoryOperationRowPrimary'
  | 'inventoryOperationRowSecondary'
  | 'inventoryOperationSearch'
  | 'inventoryPanelStyle'
  | 'isAdmin'
  | 'movementSourceLoadError'
  | 'movementSourceLoading'
  | 'operationDraftItem'
  | 'operationVisibleRows'
  | 'removeInventoryVariantOperationItem'
  | 'resetInventoryArrivalForm'
  | 'resetInventoryOperationSelection'
  | 'saveInventoryMovement'
  | 'selectInventoryOperationMode'
  | 'selectInventoryOperationVariant'
  | 'selectedInventoryOperationGroup'
  | 'selectedOperationDraftItems'
  | 'setInventoryCorrectionValue'
  | 'setInventoryDraft'
  | 'setInventoryExistingVariantSearch'
  | 'setInventoryMatrix'
  | 'setInventoryMatrixColorToAdd'
  | 'setInventoryMatrixSizeToAdd'
  | 'setInventoryTransferObservedQuantity'
  | 'setInventoryVariantOperationQuantity'
  | 'setMovementSourceRefreshToken'
  | 'sourceLabel'
  | 'suggestionValues'
  | 'swapInventoryTransferDirection'
  | 'updateInventoryDirectProductInput'
>

import type { InventoryDraft } from '../../../app/types'

export function renderInventoryMovementPanel(ctx: PanelContext) {
  // STEP 192B2B: refine only the read/UX context; the accepted JSX and transfer mutation runtime stay unchanged.
  const movementCtx = refineMovementPickerContext(ctx)
  const {
    FriendlyNumberInput,
    SmartPickerInput,
    arrivalWorkspace,
    changeInventoryOperationSource,
    createEmptyInventoryItem,
    createEmptyInventoryMatrixDraft,
    getStockQuantityForVariant,
    inventoryArrivalSummary,
    inventoryDraft,
    inventoryDraftSummary,
    inventoryExistingVariantSearch,
    inventoryMovementBusy,
    inventoryMovementText,
    inventoryOperationAllProductGroups,
    inventoryOperationRowPrimary,
    inventoryOperationRowSecondary,
    inventoryOperationSearch,
    inventoryPanelStyle,
    isAdmin,
    movementSourceLoadError,
    movementSourceLoading,
    operationDraftItem,
    operationVisibleRows,
    removeInventoryVariantOperationItem,
    resetInventoryArrivalForm,
    resetInventoryOperationSelection,
    saveInventoryMovement,
    selectInventoryOperationMode,
    selectInventoryOperationVariant,
    selectedInventoryOperationGroup,
    selectedOperationDraftItems,
    setInventoryCorrectionValue,
    setInventoryDraft,
    setInventoryExistingVariantSearch,
    setInventoryMatrix,
    setInventoryMatrixColorToAdd,
    setInventoryMatrixSizeToAdd,
    setInventoryTransferObservedQuantity,
    setInventoryVariantOperationQuantity,
    setMovementSourceRefreshToken,
    sourceLabel,
    suggestionValues,
    swapInventoryTransferDirection,
    updateInventoryDirectProductInput
  } = movementCtx

  return (
    <div className="inventory-movement-panel inventory-operations-v182" style={inventoryPanelStyle('movement')} data-step182-operations="human-workflow">
                    <div className="inventory-panel-headline inventory-operations-headline">
                      <div>
                        <h3>Операции</h3>
                        <p>Сначала выберите действие. Дальше останутся только поля, которые нужны именно для него.</p>
                      </div>
                    </div>
    
                    <div className="inventory-operation-mode-tabs" role="tablist" aria-label="Тип складской операции">
                      {([
                        ['arrival', 'Приход'],
                        ['writeoff', 'Списание'],
                        ['transfer', 'Перемещение'],
                        ['manual_set', 'Корректировка'],
                      ] as Array<[InventoryDraft['movementType'], string]>).map(([mode, title]) => (
                        <button
                          key={mode}
                          type="button"
                          className={inventoryDraft.movementType === mode ? 'is-active' : ''}
                          disabled={inventoryMovementBusy}
                          onClick={() => selectInventoryOperationMode(mode)}
                        >
                          {title}
                        </button>
                      ))}
                    </div>
    
                    <div className={`mini-panel inventory-operation-card inventory-operation-card-${inventoryDraft.movementType}`}>
                      <div className="mini-panel-head inventory-operation-clean-head">
                        <div>
                          <h3>{inventoryMovementText.title}</h3>
                          {inventoryDraft.movementType === 'manual_set' ? (
                            <p className="mini-panel-note">Для большого пересчёта используйте «Проверку». Здесь удобно исправить несколько конкретных позиций.</p>
                          ) : null}
                        </div>
                        <div className="inventory-operation-counter">
                          <strong>{inventoryDraft.movementType === 'arrival' ? inventoryArrivalSummary.rows : inventoryDraftSummary.rows}</strong>
                          <span>{inventoryDraft.movementType === 'manual_set' ? 'изменений' : 'строк'}</span>
                        </div>
                      </div>
    
                      {inventoryDraft.movementType === 'arrival' ? (
                        <>
                          <div className="inventory-operation-context-row">
                            <div className="inventory-operation-source-control">
                              <span>Куда приходит</span>
                              <div>
                                <button type="button" className={inventoryDraft.source === 'warehouse' ? 'is-active' : ''} onClick={() => changeInventoryOperationSource('warehouse')}>Склад</button>
                                <button type="button" className={inventoryDraft.source === 'boutique' ? 'is-active' : ''} onClick={() => changeInventoryOperationSource('boutique')}>Бутик</button>
                              </div>
                            </div>
                            <label className="inventory-operation-comment-field">
                              <span>Комментарий</span>
                              <input
                                value={inventoryDraft.comment}
                                onChange={(event) => setInventoryDraft((current) => ({ ...current, comment: event.target.value }))}
                                placeholder="Например: новая партия"
                              />
                            </label>
                          </div>
                        {arrivalWorkspace}
                        </>
                      ) : (
                        <div className="inventory-direct-operation-v182">
                          <div className="inventory-operation-context-row">
                            {inventoryDraft.movementType === 'transfer' ? (
                              <div className="inventory-transfer-direction">
                                <span>Направление</span>
                                <div className="inventory-transfer-direction-line">
                                  <strong>{sourceLabel(inventoryDraft.source)}</strong>
                                  <button type="button" className="inventory-transfer-swap" disabled={inventoryMovementBusy} onClick={swapInventoryTransferDirection} aria-label="Поменять направление перемещения">⇄</button>
                                  <strong>{sourceLabel(inventoryDraft.targetSource)}</strong>
                                </div>
                                <small className="inventory-transfer-direction-hint">Фиксируется фактическое перемещение. Резервы заказов остаются в своей точке.</small>
                              </div>
                            ) : (
                              <div className="inventory-operation-source-control">
                                <span>Точка</span>
                                <div>
                                  <button type="button" className={inventoryDraft.source === 'warehouse' ? 'is-active' : ''} onClick={() => changeInventoryOperationSource('warehouse')}>Склад</button>
                                  <button type="button" className={inventoryDraft.source === 'boutique' ? 'is-active' : ''} onClick={() => changeInventoryOperationSource('boutique')}>Бутик</button>
                                </div>
                              </div>
                            )}
    
                            <label className="inventory-operation-comment-field">
                              <span>{inventoryDraft.movementType === 'writeoff' ? 'Причина списания *' : inventoryDraft.movementType === 'manual_set' ? 'Причина корректировки *' : 'Комментарий'}</span>
                              {inventoryDraft.movementType === 'writeoff' ? (
                                <SmartPickerInput
                                  value={inventoryDraft.comment}
                                  options={suggestionValues.writeoffReasons}
                                  onChange={(value) => setInventoryDraft((current) => ({ ...current, comment: value }))}
                                  ariaLabel="Причина списания"
                                />
                              ) : (
                                <input
                                  value={inventoryDraft.comment}
                                  onChange={(event) => setInventoryDraft((current) => ({ ...current, comment: event.target.value }))}
                                />
                              )}
                            </label>
                          </div>
    
                          <section className="inventory-operation-product-block">
                            <div className="inventory-picker-field inventory-operation-product-picker">
                              <span>Товар</span>
                              <SmartPickerInput
                                value={inventoryOperationSearch}
                                options={inventoryOperationAllProductGroups.map((group) => group.productName)}
                                onChange={updateInventoryDirectProductInput}
                                onPick={updateInventoryDirectProductInput}
                                ariaLabel="Товар для складской операции"
                                disabled={movementSourceLoading || inventoryOperationAllProductGroups.length === 0}
                              />
                            </div>
    
                            {movementSourceLoading ? (
                              <div className="inventory-movement-source-status">Обновляю товары точки «{sourceLabel(inventoryDraft.source)}»…</div>
                            ) : movementSourceLoadError ? (
                              <div className="inventory-movement-source-status is-error">
                                <span>{movementSourceLoadError}</span>
                                <button className="ghost compact" type="button" onClick={() => setMovementSourceRefreshToken((current) => current + 1)}>Повторить</button>
                              </div>
                            ) : inventoryOperationAllProductGroups.length === 0 ? (
                              <div className="inventory-movement-source-status is-empty">
                                <span>Список точки «{sourceLabel(inventoryDraft.source)}» пуст по текущим данным.{inventoryDraft.movementType === 'writeoff' ? ' Для списания показываются только позиции, где «На месте» больше нуля.' : ''}</span>
                                <button className="ghost compact" type="button" onClick={() => setMovementSourceRefreshToken((current) => current + 1)}>Обновить список</button>
                              </div>
                            ) : null}
    
                            {selectedInventoryOperationGroup ? (
                              <>
                                <div className="inventory-operation-selected-product">
                                  <div>
                                    <strong>{selectedInventoryOperationGroup.productName}</strong>
                                    <span>{selectedInventoryOperationGroup.rows.length} вариантов в точке «{sourceLabel(inventoryDraft.source)}»</span>
                                  </div>
                                  <strong>{selectedInventoryOperationGroup.totalQuantity} на месте</strong>
                                </div>
    
                                {selectedInventoryOperationGroup.rows.length > 10 ? (
                                  <label className="inventory-operation-variant-filter">
                                    <span>Быстро найти вариант</span>
                                    <input
                                      value={inventoryExistingVariantSearch}
                                      onChange={(event) => setInventoryExistingVariantSearch(event.target.value)}
                                    />
                                  </label>
                                ) : null}
    
                                <div className="inventory-operation-variants-table-shell">
                                  <table className="inventory-operation-variants-table">
                                    <thead>
                                      <tr>
                                        <th>Вариант</th>
                                        {inventoryDraft.movementType === 'transfer' ? (
                                          <>
                                            <th>На месте</th>
                                            <th>Свободно</th>
                                            <th>{sourceLabel(inventoryDraft.targetSource)}</th>
                                          </>
                                        ) : (
                                          <>
                                            <th>{inventoryDraft.movementType === 'manual_set' ? 'По системе' : 'На месте'}</th>
                                            {inventoryDraft.movementType === 'writeoff' ? <th>В заказах</th> : null}
                                          </>
                                        )}
                                        <th>{inventoryDraft.movementType === 'manual_set' ? 'Фактически' : inventoryDraft.movementType === 'writeoff' ? 'Списать' : 'Переместить'}</th>
                                        <th>{inventoryDraft.movementType === 'manual_set' ? 'Разница' : 'После'}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {operationVisibleRows.map((row: any) => {
                                        const draftItem = operationDraftItem(row.variantId)
                                        const entered = inventoryDraft.movementType === 'manual_set'
                                          ? (draftItem?.touched ? String(draftItem.quantity) : '')
                                          : (Number(draftItem?.quantity || 0) > 0 ? String(draftItem.quantity) : '')
                                        const currentQuantity = Number(row.quantity || 0)
                                        const reservedQuantity = Math.max(0, Number(row.reservedQuantity || 0))
                                        const freeQuantity = Number(row.availableQuantity ?? (currentQuantity - reservedQuantity))
                                        const operationQuantity = Number(draftItem?.quantity || 0)
                                        const destinationQuantity = inventoryDraft.movementType === 'transfer'
                                          ? Number(getStockQuantityForVariant(inventoryDraft.targetSource, row.variantId) || 0)
                                          : 0
                                        const observedPhysical = draftItem?.observedPhysicalQuantity === null || draftItem?.observedPhysicalQuantity === undefined
                                          ? null
                                          : Math.max(0, Number(draftItem.observedPhysicalQuantity || 0))
                                        const physicalBeforeOperation = (inventoryDraft.movementType === 'transfer' || inventoryDraft.movementType === 'writeoff') && observedPhysical !== null ? observedPhysical : currentQuantity
                                        const needsPhysicalObservation = (inventoryDraft.movementType === 'transfer' || inventoryDraft.movementType === 'writeoff') && operationQuantity > Math.max(0, currentQuantity)
                                        const physicalObservationValid = observedPhysical !== null && observedPhysical >= operationQuantity
                                        const correctionDelta = draftItem?.touched ? Number(draftItem.quantity || 0) - currentQuantity : null
                                        const afterPhysical = inventoryDraft.movementType === 'manual_set'
                                          ? Number(draftItem?.quantity || 0)
                                          : inventoryDraft.movementType === 'transfer' || inventoryDraft.movementType === 'writeoff'
                                            ? physicalBeforeOperation - operationQuantity
                                            : currentQuantity - operationQuantity
                                        const shortageAfter = Math.max(0, reservedQuantity - afterPhysical)
                                        const transferFreeAfter = afterPhysical - reservedQuantity
                                        return (
                                          <tr data-transfer-variant={inventoryDraft.movementType === 'transfer' ? row.variantId : undefined} key={`operation-v182-${inventoryDraft.movementType}-${row.variantId}`} className={`${draftItem?.touched || operationQuantity > 0 ? 'is-edited' : ''}${needsPhysicalObservation && !physicalObservationValid ? ' needs-transfer-observation' : ''}`}>
                                            <td>
                                              <strong>{inventoryOperationRowPrimary(row)}</strong>
                                              <span>{inventoryOperationRowSecondary(row)}</span>
                                            </td>
                                            {inventoryDraft.movementType === 'transfer' ? (
                                              <>
                                                <td><strong>{currentQuantity}</strong><small>{reservedQuantity ? `${reservedQuantity} в заказах` : ''}</small></td>
                                                <td><strong className={freeQuantity < 0 ? 'text-danger' : ''}>{freeQuantity}</strong></td>
                                                <td><strong>{destinationQuantity}</strong></td>
                                              </>
                                            ) : (
                                              <>
                                                <td><strong className={currentQuantity < 0 ? 'text-danger' : ''}>{currentQuantity}</strong></td>
                                                {inventoryDraft.movementType === 'writeoff' ? <td><strong>{reservedQuantity}</strong></td> : null}
                                              </>
                                            )}
                                            <td className="inventory-operation-quantity-cell">
                                              <FriendlyNumberInput
                                                type="number"
                                                min="0"
                                                max={inventoryDraft.movementType === 'manual_set' || inventoryDraft.movementType === 'transfer' || inventoryDraft.movementType === 'writeoff' ? undefined : Math.max(0, currentQuantity)}
                                                value={entered}
                                                onChange={(event) => {
                                                  if (inventoryDraft.movementType === 'manual_set') setInventoryCorrectionValue(row, event.target.value)
                                                  else setInventoryVariantOperationQuantity(row, Number(event.target.value || 0))
                                                }}
                                              />
                                              {needsPhysicalObservation ? (
                                                <div className={`inventory-transfer-observation ${physicalObservationValid ? 'is-valid' : ''}`}>
                                                  <span>По учёту на месте {currentQuantity}. Если физически есть больше:</span>
                                                  <label>
                                                    <em>Фактически на месте</em>
                                                    <FriendlyNumberInput
                                                      type="number"
                                                      min="0"
                                                      value={observedPhysical ?? ''}
                                                      onChange={(event) => setInventoryTransferObservedQuantity(row, event.target.value)}
                                                    />
                                                  </label>
                                                  {observedPhysical !== null && observedPhysical < operationQuantity ? <small>Для {inventoryDraft.movementType === 'transfer' ? 'перемещения' : 'списания'} нужно минимум {operationQuantity} шт.</small> : null}
                                                  {inventoryDraft.movementType === 'writeoff' ? <small>Сверка и списание сохранятся одной операцией; резервы заказов не переписываются.</small> : null}
                                                </div>
                                              ) : null}
                                            </td>
                                            <td className="inventory-operation-after-cell">
                                              {inventoryDraft.movementType === 'manual_set' ? (
                                                correctionDelta === null ? <span>—</span> : <span className={shortageAfter > 0 ? 'inventory-operation-shortage' : ''}><strong className={correctionDelta === 0 ? '' : correctionDelta < 0 ? 'text-danger' : 'text-success'}>{correctionDelta > 0 ? '+' : ''}{correctionDelta}</strong>{shortageAfter > 0 ? <small>После сверки не хватит {shortageAfter} шт. для заказов</small> : null}</span>
                                              ) : inventoryDraft.movementType === 'transfer' ? (
                                                <span className={shortageAfter > 0 ? 'inventory-transfer-after has-shortage' : 'inventory-transfer-after'}>
                                                  <b>{transferFreeAfter}</b> свободно · <b>{destinationQuantity + operationQuantity}</b> на месте назначения
                                                  {shortageAfter > 0 ? <small>После перемещения не хватит {shortageAfter} шт. для заказов. Перемещение не блокируется, резервы сохраняются.</small> : null}
                                                </span>
                                              ) : (
                                                <span className={shortageAfter > 0 ? 'inventory-operation-shortage' : ''}><strong>{Math.max(0, afterPhysical)}</strong>{shortageAfter > 0 ? <small>Не хватит {shortageAfter} шт. для заказов</small> : null}</span>
                                              )}
                                            </td>
                                          </tr>
                                        )
                                      })}
                                      {!operationVisibleRows.length ? (
                                        <tr><td colSpan={inventoryDraft.movementType === 'transfer' ? 6 : inventoryDraft.movementType === 'writeoff' ? 5 : 4} className="empty-state">Подходящих вариантов нет.</td></tr>
                                      ) : null}
                                    </tbody>
                                  </table>
                                </div>
                              </>
                            ) : (
                              <div className="inventory-operation-empty-product">
                                <strong>Выберите товар из списка</strong>
                                <span>После выбора сразу появятся все существующие варианты этой точки. Характеристики вручную собирать не нужно.</span>
                              </div>
                            )}
                          </section>
    
                          {selectedOperationDraftItems.length ? (
                            <>
                              <div className="inventory-operation-selection-summary">
                                <div>
                                  <strong>{inventoryDraft.movementType === 'manual_set' ? 'Готово к корректировке' : inventoryDraft.movementType === 'transfer' ? 'Состав перемещения' : 'Добавлено к операции'}</strong>
                                  <span>{selectedOperationDraftItems.length} поз. {inventoryDraft.movementType === 'manual_set' ? '' : `· ${inventoryDraftSummary.totalQuantity} шт.`}</span>
                                </div>
                                <button className="ghost compact" type="button" onClick={() => setInventoryDraft((current) => ({ ...current, items: [createEmptyInventoryItem()] }))}>Очистить выбранное</button>
                              </div>
                              {inventoryDraft.movementType === 'transfer' ? (
                                <>
                                  <div className="inventory-transfer-cart" aria-label="Выбранные позиции перемещения">
                                    {selectedOperationDraftItems.map(({ item, row }: any) => {
                                      const physical = Number(row?.quantity ?? item.expectedQuantity ?? 0)
                                      const reserved = Math.max(0, Number(row?.reservedQuantity || 0))
                                      const observed = item.observedPhysicalQuantity === null || item.observedPhysicalQuantity === undefined ? physical : Number(item.observedPhysicalQuantity || 0)
                                      const shortage = Math.max(0, reserved - (observed - Number(item.quantity || 0)))
                                      return <div className="inventory-transfer-cart-row" key={`transfer-cart-${item.variantId}`}>
                                        <button
                                          className="inventory-transfer-cart-open"
                                          type="button"
                                          disabled={!row}
                                          onClick={() => {
                                            if (!row) return
                                            selectInventoryOperationVariant(row)
                                            window.requestAnimationFrame(() => document.querySelector('.inventory-operation-product-block')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
                                          }}
                                          title="Открыть позицию для изменения"
                                        >
                                          <strong>{item.productName}</strong>
                                          <span>{[item.color, item.size, item.material, item.length].filter(Boolean).join(' · ')}</span>
                                        </button>
                                        <b>{item.quantity} шт.</b>
                                        {shortage > 0 ? <small>нехватка {shortage}</small> : <span className="inventory-transfer-cart-ok">готово</span>}
                                        <button className="ghost compact" type="button" onClick={() => removeInventoryVariantOperationItem(item.variantId)} aria-label={`Убрать ${item.productName}`}>×</button>
                                      </div>
                                    })}
                                  </div>
                                  <div className="inventory-transfer-add-more">
                                    <button
                                      className="secondary compact"
                                      type="button"
                                      onClick={() => {
                                        resetInventoryOperationSelection()
                                        window.requestAnimationFrame(() => {
                                          const input = document.querySelector<HTMLInputElement>('.inventory-operation-product-picker input')
                                          input?.focus()
                                          input?.select()
                                        })
                                      }}
                                    >
                                      + Добавить ещё товар
                                    </button>
                                    <small>Уже выбранные позиции сохранятся. Можно собрать всё перемещение одной операцией.</small>
                                  </div>
                                </>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      )}
    
                      <div className="inventory-submit-bar inventory-submit-bar-v182">
                        <div>
                          <strong>{inventoryMovementText.button}</strong>
                          <span>{inventoryDraft.movementType === 'arrival'
                            ? `${inventoryArrivalSummary.positions} позиций · ${inventoryArrivalSummary.rows} вариантов · ${inventoryArrivalSummary.totalQuantity} шт. · ${sourceLabel(inventoryDraft.source)}`
                            : inventoryDraft.movementType === 'manual_set'
                              ? `${inventoryDraftSummary.rows} позиций · ${sourceLabel(inventoryDraft.source)}`
                              : `${inventoryDraftSummary.rows} позиций · ${inventoryDraftSummary.totalQuantity} шт. · ${sourceLabel(inventoryDraft.source)}${inventoryDraft.movementType === 'transfer' ? ` → ${sourceLabel(inventoryDraft.targetSource)}` : ''}`}</span>
                        </div>
                        <div className="actions">
                          <button
                            className="primary"
                            type="button"
                            disabled={inventoryMovementBusy || !isAdmin || (inventoryDraft.movementType === 'arrival' ? inventoryArrivalSummary.rows === 0 : inventoryDraftSummary.rows === 0)}
                            onClick={() => void saveInventoryMovement()}
                          >
                            {inventoryMovementBusy ? 'Сохраняю…' : inventoryMovementText.button}
                          </button>
                          <button className="secondary" type="button" disabled={inventoryMovementBusy} onClick={() => {
                            setInventoryDraft((current) => ({ ...current, items: [createEmptyInventoryItem()], comment: '' }))
                            if (inventoryDraft.movementType === 'arrival') resetInventoryArrivalForm()
                            resetInventoryOperationSelection()
                            setInventoryMatrix(createEmptyInventoryMatrixDraft())
                            setInventoryMatrixColorToAdd('')
                            setInventoryMatrixSizeToAdd('')
                          }}>
                            Очистить форму
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
  )
}
