// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
type SectionContext = Record<string, any>

export function ReferencesSection({ ctx }: { ctx: SectionContext }) {
  const {
    filteredReferenceItems,
    formatDateShort,
    FriendlyNumberInput,
    isAdmin,
    loadReferenceItems,
    normalizeSuggestion,
    referenceBusy,
    referenceDraft,
    referenceGroups,
    referenceItems,
    referenceKind,
    referenceSearch,
    referenceStats,
    referenceStatusFilter,
    removeReferenceEntry,
    resetReferenceDraft,
    saveReferenceEntry,
    sectorStyle,
    selectedReferenceKindConfig,
    selectReferenceKind,
    setReferenceDraft,
    setReferenceSearch,
    setReferenceStatusFilter,
  } = ctx

  return (
    <section className="card wide sector-references" id="references" style={sectorStyle('references')}>
              <div className="references-hero">
                <div className="references-hero-main">
                  <div className="card-label">Справочники</div>
                  <h2>Чистые вспомогательные списки</h2>
                  <p>
                    Здесь остались только общие списки заказов: города, доставка и причины возврата.
                    Характеристики одежды теперь редактируются там, где ими пользуются: «Склад → Товары».
                  </p>
                  <div className="reference-hero-badges">
                    <span className="status-pill status-online">Активных: {referenceStats.active}</span>
                    <span className="status-pill status-offline">Отключённых: {referenceStats.inactive}</span>
                    <span className="status-pill">Всего: {referenceStats.total}</span>
                    <span className="status-pill">Списков: {referenceStats.kinds}</span>
                  </div>
                </div>
                <div className="references-hero-aside">
                  <div className="references-hero-aside-title">Текущий раздел</div>
                  <strong>{selectedReferenceKindConfig.label}</strong>
                  <span>{selectedReferenceKindConfig.help}</span>
                  <button
                    className="secondary compact"
                    type="button"
                    onClick={() => selectReferenceKind(referenceKind)}
                  >
                    Обновить список
                  </button>
                </div>
              </div>
    
              <div className="reference-routing-note">
                <span><strong>Команда</strong> управляет менеджерами.</span>
                <span><strong>Склад → Товары</strong> управляет товарами, цветами, материалами, длинами и размерами.</span>
                <span><strong>Финансы</strong> управляют способами оплаты.</span>
              </div>
    
              <div className="reference-kind-grid">
                {referenceGroups.map((group) => (
                  <button
                    key={group.kind}
                    type="button"
                    className={`reference-kind-card ${referenceKind === group.kind ? 'is-active' : ''}`}
                    onClick={() => selectReferenceKind(group.kind)}
                  >
                    <span className="reference-kind-card-top">
                      <strong>{group.label}</strong>
                      <span>{group.count}</span>
                    </span>
                    <small>{group.help}</small>
                  </button>
                ))}
              </div>
    
              <div className="references-toolbar">
                <label className="inventory-search">
                  <span>Поиск</span>
                  <div className="references-search-shell">
                    <input
                      value={referenceSearch}
                      onChange={(event) => setReferenceSearch(event.target.value)}
                      placeholder="Поиск по значению, порядку или статусу"
                    />
                    {referenceSearch ? (
                      <button
                        className="secondary compact reference-clear-btn"
                        type="button"
                        onClick={() => setReferenceSearch('')}
                      >
                        Очистить
                      </button>
                    ) : null}
                  </div>
                </label>
    
                <div className="reference-status-filters">
                  <button
                    type="button"
                    className={`secondary compact ${referenceStatusFilter === 'all' ? 'is-active' : ''}`}
                    onClick={() => setReferenceStatusFilter('all')}
                  >
                    Все
                  </button>
                  <button
                    type="button"
                    className={`secondary compact ${referenceStatusFilter === 'active' ? 'is-active' : ''}`}
                    onClick={() => setReferenceStatusFilter('active')}
                  >
                    Активные
                  </button>
                  <button
                    type="button"
                    className={`secondary compact ${referenceStatusFilter === 'inactive' ? 'is-active' : ''}`}
                    onClick={() => setReferenceStatusFilter('inactive')}
                  >
                    Отключённые
                  </button>
                </div>
    
                <button className="secondary compact" type="button" onClick={() => void loadReferenceItems(referenceKind, true)}>
                  {referenceBusy ? 'Загружаю...' : 'Обновить'}
                </button>
              </div>
    
              <div className="references-layout">
                <section className="mini-panel reference-list-panel">
                  <div className="mini-panel-head">
                    <div>
                      <h3>{selectedReferenceKindConfig.label}</h3>
                      <p className="mini-panel-note">
                        Показано {referenceStats.filtered} из {referenceStats.total}. Здесь доступны и активные, и отключённые значения.
                      </p>
                    </div>
                    <button
                      className="secondary compact"
                      type="button"
                      onClick={() => resetReferenceDraft()}
                    >
                      Новый элемент
                    </button>
                  </div>
    
                  <div className="reference-list">
                    {referenceBusy && !referenceItems.length ? (
                      <div className="empty-state">Загружаю значения...</div>
                    ) : filteredReferenceItems.length ? (
                      filteredReferenceItems.map((item) => (
                        <div
                          key={item.id}
                          className={`reference-row ${item.isActive ? '' : 'is-disabled'} ${referenceDraft.id === item.id ? 'is-selected' : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            setReferenceDraft({
                              id: item.id,
                              value: item.value,
                              sortOrder: String(item.sortOrder ?? 0),
                              isActive: item.isActive,
                            })
                          }
                        >
                          <div className="reference-row-main">
                            <div className="reference-row-title">
                              <strong>{item.value}</strong>
                              <span className={`status-pill ${item.isActive ? 'status-online' : 'status-offline'}`}>
                                {item.isActive ? 'Активно' : 'Отключено'}
                              </span>
                            </div>
                            <span>
                              Порядок: {item.sortOrder ?? 0} · Обновлено: {formatDateShort(item.updatedAt || item.createdAt || '')}
                            </span>
                          </div>
                          <div className="reference-row-side">
                            <span className="reference-row-order">#{item.sortOrder ?? 0}</span>
                            {isAdmin ? (
                              <div className="reference-row-actions">
                                <button
                                  className="secondary compact"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setReferenceDraft({
                                      id: item.id,
                                      value: item.value,
                                      sortOrder: String(item.sortOrder ?? 0),
                                      isActive: item.isActive,
                                    })
                                  }}
                                >
                                  Править
                                </button>
                                <button
                                  className="ghost danger compact"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void removeReferenceEntry(item.id)
                                  }}
                                >
                                  Убрать
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="empty-state">По запросу ничего не найдено.</div>
                    )}
                  </div>
                </section>
    
                <section className="mini-panel reference-editor-panel">
                  <div className="mini-panel-head">
                    <div>
                      <h3>{referenceDraft.id ? 'Редактирование' : 'Добавление'}</h3>
                      <p className="mini-panel-note">
                        Значение сохранится в верхнем регистре и сразу попадёт в списки формы.
                      </p>
                    </div>
                  </div>
    
                  <div className="reference-editor-preview">
                    <span className="status-pill status-online">Раздел: {selectedReferenceKindConfig.label}</span>
                    <strong>{normalizeSuggestion(referenceDraft.value) || selectedReferenceKindConfig.placeholder}</strong>
                    <p>{selectedReferenceKindConfig.help}</p>
                  </div>
    
                  <div className="subgrid reference-form-grid">
                    <label className="wide-field">
                      <span>Значение</span>
                      <input
                        value={referenceDraft.value}
                        onChange={(event) => setReferenceDraft((current) => ({ ...current, value: normalizeSuggestion(event.target.value) }))}
                        placeholder={selectedReferenceKindConfig.placeholder}
                      />
                    </label>
                    <label>
                      <span>Порядок</span>
                      <FriendlyNumberInput
                        type="number"
                        value={referenceDraft.sortOrder}
                        onChange={(event) => setReferenceDraft((current) => ({ ...current, sortOrder: event.target.value }))}
                        placeholder="0"
                      />
                    </label>
                    <label className="checkbox-row reference-active-toggle">
                      <input
                        type="checkbox"
                        checked={referenceDraft.isActive}
                        onChange={(event) => setReferenceDraft((current) => ({ ...current, isActive: event.target.checked }))}
                      />
                      Активно
                    </label>
                  </div>
    
                  <div className="actions">
                    <button className="primary" type="button" disabled={!isAdmin} onClick={() => void saveReferenceEntry()}>
                      {referenceDraft.id ? 'Сохранить изменения' : 'Добавить значение'}
                    </button>
                    <button className="secondary" type="button" onClick={() => resetReferenceDraft()}>
                      Сбросить
                    </button>
                  </div>
                </section>
              </div>
            </section>
  )
}
