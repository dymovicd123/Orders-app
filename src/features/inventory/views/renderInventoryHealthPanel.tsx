import type { InventoryRenderContext } from './types'

type PanelContext = Pick<InventoryRenderContext,
  | 'applyPendingInventoryWriteoffs'
  | 'autoWriteoffStopped'
  | 'inventoryAudit'
  | 'inventoryAuditBusy'
  | 'inventoryControlBusy'
  | 'inventoryHealthText'
  | 'inventoryHealthTitle'
  | 'inventoryModelVersion'
  | 'inventoryNeedsAttention'
  | 'inventoryPanelStyle'
  | 'inventoryProblemRows'
  | 'inventoryWriteoffReferenceGroups'
  | 'isAdmin'
  | 'loadInventoryAudit'
  | 'missingMovementCount'
  | 'negativeStockCount'
  | 'openInventoryPanel'
  | 'pendingWriteoffCount'
  | 'renderInventoryReferenceManager'
  | 'resolveInventoryAuditIssue'
  | 'resolvedMovementCount'
  | 'selectInventoryOperationMode'
  | 'sourceLabel'
  | 'toggleInventoryAutoWriteoff'
  | 'zeroStockCount'
>


export function renderInventoryHealthPanel(ctx: PanelContext) {
  const {
    applyPendingInventoryWriteoffs,
    autoWriteoffStopped,
    inventoryAudit,
    inventoryAuditBusy,
    inventoryControlBusy,
    inventoryHealthText,
    inventoryHealthTitle,
    inventoryModelVersion,
    inventoryNeedsAttention,
    inventoryPanelStyle,
    inventoryProblemRows,
    inventoryWriteoffReferenceGroups,
    isAdmin,
    loadInventoryAudit,
    missingMovementCount,
    negativeStockCount,
    openInventoryPanel,
    pendingWriteoffCount,
    renderInventoryReferenceManager,
    resolveInventoryAuditIssue,
    resolvedMovementCount,
    selectInventoryOperationMode,
    sourceLabel,
    toggleInventoryAutoWriteoff,
    zeroStockCount
  } = ctx

  return (
    <div className={`inventory-settings-panel inventory-health-panel ${inventoryModelVersion >= 2 ? 'human-inventory-service' : ''}`} style={inventoryPanelStyle('settings')}>
                    <div className="inventory-panel-headline inventory-health-headline">
                      <div>
                        <h3>Сервис и диагностика</h3>
                        <p>Аварийные инструменты для администратора. Они не участвуют в ежедневной работе склада.</p>
                      </div>
                      <button className="secondary compact" type="button" onClick={() => void loadInventoryAudit()} disabled={inventoryAuditBusy}>
                        {inventoryAuditBusy ? 'Проверяю…' : 'Проверить операции'}
                      </button>
                    </div>
    
                    <section className={`inventory-health-hero ${inventoryNeedsAttention ? 'needs-attention' : 'is-healthy'}`}>
                      <div className="inventory-health-hero-copy">
                        <span className="inventory-health-kicker">Общее состояние</span>
                        <strong>{inventoryHealthTitle}</strong>
                        <p>{inventoryHealthText}</p>
                      </div>
                      <div className="inventory-health-hero-badge">{inventoryNeedsAttention ? 'Нужно проверить' : 'Всё в порядке'}</div>
                    </section>
    
                    <div className="inventory-health-summary-grid">
                      <div className={`inventory-health-summary-card ${autoWriteoffStopped ? 'is-warning' : 'is-ok'}`}>
                        <span>Автоучёт</span>
                        <strong>{autoWriteoffStopped ? 'Остановлен' : 'Работает'}</strong>
                        <small>{autoWriteoffStopped ? 'Новые заказы не меняют остатки автоматически.' : 'Новые заказы автоматически меняют остатки.'}</small>
                      </div>
                      <div className={`inventory-health-summary-card ${pendingWriteoffCount > 0 ? 'is-warning' : 'is-ok'}`}>
                        <span>Ожидает списания</span>
                        <strong>{pendingWriteoffCount}</strong>
                        <small>{pendingWriteoffCount > 0 ? 'Эти заказы можно применить одной кнопкой ниже.' : 'Необработанных списаний нет.'}</small>
                      </div>
                      <div className={`inventory-health-summary-card ${negativeStockCount > 0 ? 'is-danger' : 'is-ok'}`}>
                        <span>Отрицательные остатки</span>
                        <strong>{negativeStockCount}</strong>
                        <small>{negativeStockCount > 0 ? 'Нужна сверка или корректировка.' : `Нулевых позиций: ${zeroStockCount}. Ноль не считается ошибкой.`}</small>
                      </div>
                      <div className={`inventory-health-summary-card ${missingMovementCount > 0 ? 'is-danger' : inventoryAudit ? 'is-ok' : ''}`}>
                        <span>Цепочка операций</span>
                        <strong>{inventoryAudit ? (missingMovementCount > 0 ? `${missingMovementCount} проблем` : 'В порядке') : 'Не проверялась'}</strong>
                        <small>{inventoryAudit?.checkedAt ? `Последняя проверка: ${inventoryAudit.checkedAt.slice(0, 16).replace('T', ' ')}` : 'Запускается вручную и не нагружает обычный вход в склад.'}</small>
                      </div>
                    </div>
    
                    {pendingWriteoffCount > 0 ? (
                      <section className="inventory-health-action-card is-warning">
                        <div>
                          <span className="inventory-health-action-label">Требуется действие</span>
                          <strong>Есть заказы, которые ещё не изменили остатки</strong>
                          <p>Они накопились, пока автоматический учёт был остановлен. Система может безопасно применить ожидающие списания. Повторный запуск не спишет уже учтённую позицию второй раз.</p>
                        </div>
                        <button className="primary" type="button" disabled={!isAdmin || inventoryControlBusy} onClick={() => void applyPendingInventoryWriteoffs()}>
                          {inventoryControlBusy ? 'Применяю…' : `Применить списания (${pendingWriteoffCount})`}
                        </button>
                      </section>
                    ) : null}
    
                    {negativeStockCount > 0 ? (
                      <section className="inventory-health-action-card is-danger">
                        <div>
                          <span className="inventory-health-action-label">Остаток ниже нуля</span>
                          <strong>Найдены позиции с отрицательным количеством</strong>
                          <p>Нулевой остаток — нормальное состояние «нет в наличии». Здесь показаны только настоящие минусы.</p>
                        </div>
                        <button className="secondary" type="button" onClick={() => openInventoryPanel('stocktake')}>Перейти к ревизии</button>
                        <div className="inventory-health-problem-list">
                          {inventoryProblemRows.slice(0, 8).map((row: any) => (
                            <div className="inventory-health-problem-row" key={`negative-${row.sourceLabel}-${row.id}`}>
                              <span><b>{row.productName}</b><small>{[row.sourceLabel, row.gender, row.color, row.material, row.length, row.size].filter(Boolean).join(' · ')}</small></span>
                              <strong>{row.quantity}</strong>
                            </div>
                          ))}
                          {negativeStockCount > 8 ? <small className="inventory-health-more-note">И ещё {negativeStockCount - 8} позиций. Полную сверку удобнее сделать через «Ревизию».</small> : null}
                        </div>
                      </section>
                    ) : null}
    
                    <section className={`inventory-health-action-card ${missingMovementCount > 0 ? 'is-danger' : inventoryAudit ? 'is-ok' : ''}`}>
                      <div>
                        <span className="inventory-health-action-label">Проверка цепочки операций</span>
                        <strong>{inventoryAudit
                          ? missingMovementCount > 0
                            ? 'Есть исторические операции, которые нужно сверить'
                            : resolvedMovementCount > 0
                              ? 'Все активные расхождения проверены'
                              : 'Продажи, возвраты и обмены имеют ожидаемые следы'
                          : 'Глубокая проверка ещё не запускалась'}</strong>
                        <p>{inventoryAudit
                          ? missingMovementCount > 0
                            ? 'Отсутствие записи в истории не доказывает, что фактический остаток неверен. Поэтому система не меняет количество вслепую: сначала сотрудник сверяет товар, затем подтверждает результат.'
                            : resolvedMovementCount > 0
                              ? `Подтверждено после фактической сверки: ${resolvedMovementCount}. Эти случаи сохранены и не будут снова пугать сотрудника при каждой проверке.`
                              : 'В последней проверке пропущенных следов операций не найдено.'
                          : 'Запускайте её после подозрительной операции или когда нужно убедиться, что цепочка учёта цела.'}</p>
                      </div>
                      <div className="inventory-health-inline-actions">
                        {inventoryAudit && missingMovementCount > 0 ? <button className="secondary" type="button" onClick={() => openInventoryPanel('stocktake')}>Перейти к ревизии</button> : null}
                        <button className="secondary" type="button" onClick={() => void loadInventoryAudit()} disabled={inventoryAuditBusy}>
                          {inventoryAuditBusy ? 'Проверяю…' : inventoryAudit ? 'Проверить ещё раз' : 'Запустить проверку'}
                        </button>
                      </div>
                      {inventoryAudit && missingMovementCount > 0 ? (
                        <div className="inventory-health-problem-list">
                          {inventoryAudit.missing.slice(0, 8).map((row: any, index: number) => (
                            <div className="inventory-health-problem-row inventory-health-audit-problem-row" key={row.issueKey || `missing-human-${index}`}>
                              <span>
                                <b>{row.externalOrderId ? `${row.checkType} · ${row.externalOrderId}` : row.checkType}</b>
                                <small>{[sourceLabel(row.source), row.productName, row.gender, row.color, row.material, row.length, row.size].filter(Boolean).join(' · ')}</small>
                                <small>После фактической сверки нажмите «Подтвердить проверку». Остаток этой кнопкой не меняется.</small>
                              </span>
                              <div className="inventory-health-problem-actions">
                                <strong className={row.quantityDelta < 0 ? 'text-danger' : 'text-success'}>{row.quantityDelta > 0 ? '+' : ''}{row.quantityDelta}</strong>
                                <button className="secondary compact" type="button" disabled={inventoryAuditBusy} onClick={() => void resolveInventoryAuditIssue(row, true)}>Подтвердить проверку</button>
                              </div>
                            </div>
                          ))}
                          {missingMovementCount > 8 ? <small className="inventory-health-more-note">Ещё {missingMovementCount - 8} строк доступны в техническом отчёте ниже.</small> : null}
                        </div>
                      ) : null}
                    </section>
    
                    <details className="inventory-health-details">
                      <summary>Настройки списания</summary>
                      <div className="inventory-health-details-body">
                        <p className="inventory-health-details-note">Причины списания используются в рабочих операциях склада. Обычно этот список меняют только при изменении правил предприятия.</p>
                        {renderInventoryReferenceManager(
                          inventoryWriteoffReferenceGroups,
                          'Причины списания',
                          'Эти значения появляются в форме списания и помогают сотруднику указывать понятную причину операции.',
                        )}
                      </div>
                    </details>
    
                    <details className="inventory-health-details inventory-health-advanced">
                      <summary>Расширенные настройки и восстановление</summary>
                      <div className="inventory-health-details-body">
                        <div className="inventory-health-warning-box">
                          <strong>Обычная работа не требует этих инструментов</strong>
                          <span>Используйте их только когда ревизия, обычная корректировка или повторная проверка не решают проблему.</span>
                        </div>
    
                        <div className="inventory-health-advanced-grid">
                          {inventoryModelVersion < 2 ? (
                            <div className="inventory-health-advanced-card">
                              <strong>Старый автоматический учёт заказов</strong>
                              <span>Этот переключатель нужен только если система работает на старой модели склада.</span>
                              <button className="secondary compact" type="button" disabled={!isAdmin || inventoryControlBusy} onClick={() => void toggleInventoryAutoWriteoff()}>
                                {inventoryControlBusy ? 'Сохраняю…' : autoWriteoffStopped ? 'Включить автоучёт' : 'Остановить автоучёт'}
                              </button>
                            </div>
                          ) : null}
                          <div className="inventory-health-advanced-card">
                            <strong>Расширенный просмотр</strong>
                            <span>Показывает старое подробное представление склада и бутика. Оставлено как резервный инструмент.</span>
                            <button className="secondary compact" type="button" onClick={() => openInventoryPanel('warehouse')}>Открыть просмотр</button>
                          </div>
                          <div className="inventory-health-advanced-card">
                            <strong>Точная установка</strong>
                            <span>Меняет фактическое количество существующих вариантов напрямую. Для массовой сверки сначала используйте «Ревизию».</span>
                            <button className="secondary compact" type="button" onClick={() => { selectInventoryOperationMode('manual_set'); openInventoryPanel('exact') }}>Открыть инструмент</button>
                          </div>
                        </div>
                      </div>
                    </details>
    
                    {inventoryAudit ? (
                      <details className="inventory-health-details inventory-health-technical-report">
                        <summary>Технический отчёт последней проверки</summary>
                        <div className="inventory-health-details-body">
                          <p className="inventory-health-details-note">Этот блок нужен для редких случаев и поддержки. В обычной работе достаточно подсказок выше.</p>
                          <div className="summary-grid inventory-summary-grid inventory-health-audit-summary">
                            <div className="summary-card"><span>Ожидалось записей</span><strong>{inventoryAudit.summary.totalExpectedMovements}</strong></div>
                            <div className="summary-card"><span>Найдено</span><strong>{inventoryAudit.summary.okMovements}</strong></div>
                            <div className="summary-card"><span>Подтверждено сверкой</span><strong>{resolvedMovementCount}</strong></div>
                            <div className={`summary-card ${missingMovementCount > 0 ? 'danger-card' : ''}`}><span>Требует проверки</span><strong>{missingMovementCount}</strong></div>
                            <div className="summary-card"><span>Пакетов проверки</span><strong>{inventoryAudit.summary.lookupBatches}</strong></div>
                          </div>
                          <div className="inventory-health-technical-grid">
                            <section className="mini-panel">
                              <div className="mini-panel-head"><div><h3>По типам операций</h3><p className="mini-panel-note">Показывает, в какой группе обнаружено расхождение.</p></div></div>
                              <table className="data-table compact-report-table">
                                <thead><tr><th>Операция</th><th>Всего</th><th>Подтверждено</th><th>Требует проверки</th></tr></thead>
                                <tbody>
                                  {inventoryAudit.byType.map((row: any) => (
                                    <tr key={row.checkType} className={row.missing ? 'table-row-warning' : ''}>
                                      <td>{row.checkType}</td><td>{row.total}</td><td>{row.resolved || 0}</td><td>{row.missing}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </section>
                            {inventoryAudit.missing.length ? (
                              <section className="mini-panel">
                                <div className="mini-panel-head"><div><h3>Технические детали проблем</h3><p className="mini-panel-note">Внутренние типы и идентификаторы показываются только здесь.</p></div></div>
                                <div className="inventory-health-tech-list">
                                  {inventoryAudit.missing.map((row: any, index: number) => (
                                    <div className="inventory-health-tech-row" key={`missing-tech-${index}`}>
                                      <strong>{row.checkType} · {row.externalOrderId || 'без номера заказа'}</strong>
                                      <span>{row.productName} · {sourceLabel(row.source)}</span>
                                      <code>{row.movementType} / {row.referenceType} / {row.referenceId}</code>
                                    </div>
                                  ))}
                                </div>
                              </section>
                            ) : null}
                            {inventoryAudit.resolved?.length ? (
                              <section className="mini-panel">
                                <div className="mini-panel-head"><div><h3>Подтверждённые после сверки</h3><p className="mini-panel-note">Эти исторические разрывы сотрудник уже проверил. При ошибке подтверждение можно вернуть в активную проверку.</p></div></div>
                                <div className="inventory-health-tech-list">
                                  {inventoryAudit.resolved.map((row: any, index: number) => (
                                    <div className="inventory-health-tech-row inventory-health-resolved-row" key={row.issueKey || `resolved-tech-${index}`}>
                                      <strong>{row.checkType} · {row.externalOrderId || 'без номера заказа'}</strong>
                                      <span>{row.productName} · {sourceLabel(row.source)}{row.resolvedAt ? ` · подтверждено ${row.resolvedAt.slice(0, 16).replace('T', ' ')}` : ''}</span>
                                      <button className="secondary compact" type="button" disabled={inventoryAuditBusy} onClick={() => void resolveInventoryAuditIssue(row, false)}>Вернуть в проверку</button>
                                    </div>
                                  ))}
                                </div>
                              </section>
                            ) : null}
                          </div>
                        </div>
                      </details>
                    ) : null}
                  </div>
  )
}
