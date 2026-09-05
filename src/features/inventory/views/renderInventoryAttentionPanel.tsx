import type { InventoryRenderContext } from './types'

type AttentionCategory = 'handover' | 'intake' | 'identify'

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
    refreshWarehouseAttention,
    setAttentionCategory,
    sourceLabel,
    warehouseAttention,
  } = ctx
  const items = warehouseAttention?.items
  const counts = warehouseAttention?.counts
  const categoryCounts: Record<AttentionCategory, number> = {
    handover: Number(counts?.handover || 0),
    intake: Number(counts?.intake || 0),
    identify: Number(counts?.lifecycle || 0) + Number(counts?.catalog || 0),
  }
  const clarificationTotal = categoryCounts.handover + categoryCounts.identify
  const isIntake = attentionCategory === 'intake'
  const tabs: Array<{ value: Exclude<AttentionCategory, 'intake'>; label: string }> = [
    { value: 'handover', label: 'Выдача' },
    { value: 'identify', label: 'Товар' },
  ]

  return (
    <div className="inventory-attention-panel" style={inventoryPanelStyle('attention')}>
      <div className="inventory-attention-head">
        <div>
          <h3>{isIntake ? 'Ожидают приёма' : 'Нужно уточнить'}</h3>
          <p>{isIntake
            ? 'Товар уже известен. Если вещь действительно уже у вас, можно завершить приёмку; если вы сейчас не рядом со складом или не уверены — просто оставьте её как есть.'
            : 'Здесь остаются только вопросы, где системе действительно не хватает факта: что именно выдали или какой это товар. Нехватка и ревизии решаются в своих обычных разделах.'}</p>
        </div>
        <button className="secondary compact" type="button" onClick={refreshWarehouseAttention} disabled={attentionLoading}>{attentionLoading ? 'Обновляю…' : 'Обновить'}</button>
      </div>

      {attentionError ? <div className="inventory-attention-error">{attentionError}</div> : null}
      {attentionLoading && !items ? <div className="empty-state">Загружаю складские вопросы…</div> : null}
      {warehouseAttention && !isIntake && clarificationTotal === 0 ? <div className="inventory-attention-clear"><strong>Уточнять ничего не нужно</strong><span>Можно продолжать обычную работу.</span></div> : null}
      {warehouseAttention && isIntake && categoryCounts.intake === 0 ? <div className="inventory-attention-clear"><strong>Сейчас ничего не ждёт приёмки</strong><span>Если такая вещь появится, она будет показана здесь отдельно от вопросов по данным.</span></div> : null}

      {warehouseAttention && !isIntake && clarificationTotal > 0 ? (
        <>
          <div className="inventory-attention-summary">
            <strong>Нужно уточнить: {clarificationTotal}</strong>
            <span>Только вопросы, которые нельзя надёжно закрыть по уже известным данным или свежему физическому факту.</span>
          </div>
          <div className="inventory-attention-tabs" role="tablist" aria-label="Что нужно уточнить">
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

      {items && attentionCategory === 'handover' ? (
        <section className="inventory-attention-group is-handover">
          <div className="inventory-attention-group-head"><div><strong>Уточнить выдачу</strong><span>Исторический вопрос по конкретному заказу. Если сейчас нет возможности проверить его — заказ можно оставить и вернуться позже.</span></div><b>{categoryCounts.handover}</b></div>
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
                <button className="secondary compact" type="button" onClick={() => openAttentionHandover(item)}>Открыть заказ</button>
              </article>
            ))}
          </div> : <div className="empty-state">Уточнений выдачи сейчас нет.</div>}
        </section>
      ) : null}

      {items && attentionCategory === 'intake' ? (
        <section className="inventory-attention-group is-intake">
          <div className="inventory-attention-group-head"><div><strong>Вещь уже можно определить точно</strong><span>Принимайте только если вещь действительно находится у вас. Ничего подтверждать заранее или удалённо не требуется.</span></div><b>{categoryCounts.intake}</b></div>
          {items.intake?.length ? <div className="inventory-attention-list">
            {items.intake.map((item: any) => (
              <article key={`attention-intake-${item.id}`}>
                <div className="inventory-attention-main"><strong>{item.productName || 'Товар'}</strong><span>{detailLine(item) || 'Стандартный вариант'} · {sourceLabel(item.source)}</span><small>{item.externalId ? `Заказ ${item.externalId} · от ${formatDateShort(item.orderDate)}` : ''}{item.createdAt ? ` · событие ${formatDateTime(item.createdAt)}` : ''}</small></div>
                <button className="primary compact" type="button" disabled={attentionIntakeBusyId !== null} onClick={() => void openAttentionIntake(item)}>{attentionIntakeBusyId === item.id ? 'Проверяю…' : 'Принять в остаток'}</button>
              </article>
            ))}
          </div> : <div className="empty-state">Известных позиций, ожидающих приёмки, сейчас нет.</div>}
        </section>
      ) : null}

      {items && attentionCategory === 'identify' ? (
        <section className="inventory-attention-group is-identify">
          <div className="inventory-attention-group-head"><div><strong>Определить товар</strong><span>Здесь только позиции, которым действительно не хватает точной идентичности.</span></div><b>{categoryCounts.identify}</b></div>
          {(items.lifecycle.length || items.catalog.length) ? <div className="inventory-attention-list">
            {(items.lifecycle || []).map((item: any) => (
              <article key={`attention-lifecycle-${item.id}`}>
                <div className="inventory-attention-main"><strong>{item.productName || 'Неизвестный товар'}</strong><span>{detailLine(item) || 'Характеристики не определены'} · {sourceLabel(item.source)}</span><small>{item.externalId ? `Заказ ${item.externalId} · от ${formatDateShort(item.orderDate)}` : ''}</small></div>
                {isAdmin ? <button className="secondary compact" type="button" onClick={() => void openAttentionLifecycle(item)}>Разобрать</button> : <span className="inventory-attention-admin-note">Требуется администратор</span>}
              </article>
            ))}
            {(items.catalog || []).map((item: any) => (
              <article key={`attention-catalog-${item.orderItemId}`}>
                <div className="inventory-attention-main"><strong>{item.productName || 'Неизвестный товар'}</strong><span>{detailLine(item) || 'Характеристики не определены'}</span><small>{item.externalId ? `Заказ ${item.externalId} · от ${formatDateShort(item.orderDate)}` : ''}{item.affectedCount > 1 ? ` · похожих позиций: ${item.affectedCount}` : ''}</small></div>
                {isAdmin ? <button className="secondary compact" type="button" onClick={() => void openAttentionCatalog(item)}>Разобрать</button> : <span className="inventory-attention-admin-note">Требуется администратор</span>}
              </article>
            ))}
          </div> : <div className="empty-state">Неопределённых товаров сейчас нет.</div>}
        </section>
      ) : null}
    </div>
  )
}
