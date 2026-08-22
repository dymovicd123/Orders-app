import type { InventoryRenderContext } from './types'

type AttentionCategory = 'count' | 'handover' | 'intake' | 'identify' | 'revision'

type PanelContext = Pick<InventoryRenderContext,
  | 'attentionCategory'
  | 'attentionError'
  | 'attentionIntakeBusyId'
  | 'attentionLoading'
  | 'formatDateShort'
  | 'inventoryPanelStyle'
  | 'isAdmin'
  | 'openAttentionCatalog'
  | 'openAttentionHandover'
  | 'openAttentionIntake'
  | 'openAttentionLifecycle'
  | 'openAttentionShortage'
  | 'openAttentionStocktake'
  | 'refreshWarehouseAttention'
  | 'setAttentionCategory'
  | 'sourceLabel'
  | 'warehouseAttention'
>

function detailLine(item: any) {
  return [item.color, item.size, item.material && item.material !== 'СТАНДАРТ' ? item.material : '', item.length && item.length !== 'СТАНДАРТ' ? item.length : '', item.gender].filter(Boolean).join(' · ')
}

function formatDateTime(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function renderInventoryAttentionPanel(ctx: PanelContext) {
  const {
    attentionCategory,
    attentionError,
    attentionIntakeBusyId,
    attentionLoading,
    formatDateShort,
    inventoryPanelStyle,
    isAdmin,
    openAttentionCatalog,
    openAttentionHandover,
    openAttentionIntake,
    openAttentionLifecycle,
    openAttentionShortage,
    openAttentionStocktake,
    refreshWarehouseAttention,
    setAttentionCategory,
    sourceLabel,
    warehouseAttention,
  } = ctx
  const items = warehouseAttention?.items
  const total = Number(warehouseAttention?.total || 0)
  const counts = warehouseAttention?.counts
  const categoryCounts: Record<AttentionCategory, number> = {
    count: Number(counts?.shortage || 0),
    handover: Number(counts?.handover || 0),
    intake: Number(counts?.intake || 0),
    identify: Number(counts?.lifecycle || 0) + Number(counts?.catalog || 0),
    revision: Number(counts?.stocktake || 0),
  }
  const tabs: Array<{ value: AttentionCategory; label: string }> = [
    { value: 'count', label: 'Количество' },
    { value: 'handover', label: 'Выдача' },
    { value: 'intake', label: 'Приёмка' },
    { value: 'identify', label: 'Определить товар' },
    { value: 'revision', label: 'Ревизия' },
  ]

  return (
    <div className="inventory-attention-panel" style={inventoryPanelStyle('attention')}>
      <div className="inventory-attention-head">
        <div>
          <h3>Внимание</h3>
          <p>Каждый раздел — отдельный тип вопроса. Откройте нужный и выполните одно понятное действие.</p>
        </div>
        <button className="secondary compact" type="button" onClick={refreshWarehouseAttention} disabled={attentionLoading}>{attentionLoading ? 'Обновляю…' : 'Обновить'}</button>
      </div>

      {attentionError ? <div className="inventory-attention-error">{attentionError}</div> : null}
      {!warehouseAttention && attentionLoading ? <div className="empty-state">Загружаю складские вопросы…</div> : null}
      {warehouseAttention && total === 0 ? <div className="inventory-attention-clear"><strong>Срочных вопросов нет</strong><span>Можно продолжать обычную работу.</span></div> : null}

      {warehouseAttention && total > 0 ? (
        <>
          <div className="inventory-attention-summary">
            <strong>Требует внимания: {total}</strong>
            <span>Разные причины больше не смешаны в один длинный список.</span>
          </div>
          <div className="inventory-attention-tabs" role="tablist" aria-label="Тип складского вопроса">
            {tabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={attentionCategory === tab.value}
                className={attentionCategory === tab.value ? 'is-active' : ''}
                onClick={() => setAttentionCategory(tab.value)}
              >
                <span>{tab.label}</span><b>{categoryCounts[tab.value]}</b>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {items && attentionCategory === 'count' ? (
        <section className="inventory-attention-group is-count">
          <div className="inventory-attention-group-head"><div><strong>Пересчитать количество</strong><span>Здесь только нехватка, которая остаётся даже без заказов, отдельно ожидающих уточнения выдачи.</span></div><b>{categoryCounts.count}</b></div>
          {items.shortages.length ? <div className="inventory-attention-list">
            {items.shortages.map((item: any) => {
              const relevantReserved = Number(item.countRelevantReserved ?? item.reserved ?? 0)
              const handoverReserved = Number(item.handoverReserved || 0)
              return <article key={`attention-shortage-${item.source}-${item.variantId}`}>
                <div className="inventory-attention-main"><strong>{item.productName}</strong><span>{detailLine(item) || 'Стандартный вариант'} · {sourceLabel(item.source)}</span>{handoverReserved > 0 ? <small>Ещё {handoverReserved} шт. разбираются отдельно во вкладке «Выдача».</small> : null}</div>
                <div className="inventory-attention-numbers"><span>На месте <b>{item.physical}</b></span><span>В остальных заказах <b>{relevantReserved}</b></span><strong>Не хватает {Math.max(0, relevantReserved - Number(item.physical || 0))}</strong></div>
                <button className="primary compact" type="button" onClick={() => openAttentionShortage(item)}>Пересчитать</button>
              </article>
            })}
          </div> : <div className="empty-state">Нехваток, требующих отдельного пересчёта, сейчас нет.</div>}
        </section>
      ) : null}

      {items && attentionCategory === 'handover' ? (
        <section className="inventory-attention-group is-handover">
          <div className="inventory-attention-group-head"><div><strong>Уточнить выдачу</strong><span>Это исторический вопрос по конкретному заказу. Дата заказа и момент внесения позиции показаны здесь специально.</span></div><b>{categoryCounts.handover}</b></div>
          {items.handover.length ? <div className="inventory-attention-list">
            {items.handover.map((item: any) => (
              <article key={`attention-handover-${item.orderId}-${item.orderItemId}`}>
                <div className="inventory-attention-main">
                  <strong>{item.productName}</strong>
                  <span>{item.itemDetails || 'Без дополнительных характеристик'} · {sourceLabel(item.source)}</span>
                  <small>Заказ {item.externalId || item.orderId}{item.customerName ? ` · ${item.customerName}` : ''} · от {formatDateShort(item.orderDate)}</small>
                  <small>{item.itemCreatedAt ? `Позиция в учёте с ${formatDateTime(item.itemCreatedAt)} · ` : ''}{item.checkpointAt ? `${item.checkpointKind === 'revision' ? 'ревизия' : 'сверка'} ${formatDateShort(item.checkpointAt)}` : ''}</small>
                  <small>{item.reviewReason === 'late_entry' ? 'Причина: позиция была внесена после физической проверки.' : 'Причина: смешанный заказ, после резерва была физическая проверка.'}</small>
                </div>
                <button className="secondary compact" type="button" onClick={() => openAttentionHandover(item)}>Открыть и уточнить</button>
              </article>
            ))}
          </div> : <div className="empty-state">Уточнений выдачи сейчас нет.</div>}
        </section>
      ) : null}

      {items && attentionCategory === 'intake' ? (
        <section className="inventory-attention-group is-intake">
          <div className="inventory-attention-group-head"><div><strong>Завершить приёмку</strong><span>Точный существующий товар уже распознан. Перед изменением остатка сервер ещё раз проверит ревизию и более свежие сверки.</span></div><b>{categoryCounts.intake}</b></div>
          {items.intake?.length ? <div className="inventory-attention-list">
            {items.intake.map((item: any) => (
              <article key={`attention-intake-${item.id}`}>
                <div className="inventory-attention-main"><strong>{item.productName || 'Товар'}</strong><span>{detailLine(item) || 'Стандартный вариант'} · {sourceLabel(item.source)}</span><small>{item.externalId ? `Заказ ${item.externalId} · от ${formatDateShort(item.orderDate)}` : ''}{item.createdAt ? ` · событие ${formatDateTime(item.createdAt)}` : ''}</small></div>
                <button className="primary compact" type="button" disabled={attentionIntakeBusyId !== null} onClick={() => void openAttentionIntake(item)}>{attentionIntakeBusyId === item.id ? 'Проверяю…' : 'Завершить приёмку'}</button>
              </article>
            ))}
          </div> : <div className="empty-state">Известных позиций, ожидающих завершения приёмки, сейчас нет.</div>}
        </section>
      ) : null}

      {items && attentionCategory === 'identify' ? (
        <section className="inventory-attention-group is-identify">
          <div className="inventory-attention-group-head"><div><strong>Определить товар</strong><span>Здесь только позиции, которым действительно не хватает точной идентичности.</span></div><b>{categoryCounts.identify}</b></div>
          {(items.lifecycle.length || items.catalog.length) ? <div className="inventory-attention-list">
            {(items.lifecycle || []).map((item: any) => (
              <article key={`attention-lifecycle-${item.id}`}>
                <div className="inventory-attention-main"><strong>{item.productName || 'Неизвестный товар'}</strong><span>{detailLine(item) || 'Характеристики не определены'} · {sourceLabel(item.source)}</span><small>{item.externalId ? `Заказ ${item.externalId} · от ${formatDateShort(item.orderDate)}` : ''}</small></div>
                {isAdmin ? <button className="secondary compact" type="button" onClick={() => void openAttentionLifecycle(item)}>Разобрать</button> : <span className="inventory-attention-admin-note">Нужен администратор</span>}
              </article>
            ))}
            {(items.catalog || []).map((item: any) => (
              <article key={`attention-catalog-${item.orderItemId}`}>
                <div className="inventory-attention-main"><strong>{item.productName || 'Неизвестный товар'}</strong><span>{detailLine(item) || 'Характеристики не определены'}</span><small>{item.externalId ? `Заказ ${item.externalId} · от ${formatDateShort(item.orderDate)}` : ''}{item.affectedCount > 1 ? ` · похожих позиций: ${item.affectedCount}` : ''}</small></div>
                {isAdmin ? <button className="secondary compact" type="button" onClick={() => void openAttentionCatalog(item)}>Разобрать</button> : <span className="inventory-attention-admin-note">Нужен администратор</span>}
              </article>
            ))}
          </div> : <div className="empty-state">Неопределённых товаров сейчас нет.</div>}
        </section>
      ) : null}

      {items && attentionCategory === 'revision' ? (
        <section className="inventory-attention-group is-stocktake">
          <div className="inventory-attention-group-head"><div><strong>Незавершённая ревизия</strong><span>Здесь только ревизии, которые нужно продолжить.</span></div><b>{categoryCounts.revision}</b></div>
          {items.stocktakes.length ? <div className="inventory-attention-list">
            {items.stocktakes.map((item: any) => (
              <article key={`attention-stocktake-${item.id}`}>
                <div className="inventory-attention-main"><strong>{sourceLabel(item.source)}</strong><span>Посчитано {item.countedItems} из {item.totalItems}{item.recountItems ? ` · повторно проверить: ${item.recountItems}` : ''}</span><small>Начата {formatDateShort(item.startedAt)}</small></div>
                {isAdmin ? <button className="secondary compact" type="button" onClick={() => openAttentionStocktake(item)}>Продолжить</button> : <span className="inventory-attention-admin-note">Нужен администратор</span>}
              </article>
            ))}
          </div> : <div className="empty-state">Незавершённых ревизий сейчас нет.</div>}
        </section>
      ) : null}
    </div>
  )
}
