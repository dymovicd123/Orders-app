import type { InventoryRenderContext } from './types'
import '../../../styles/w8-3-daily-surfaces.css'

type AttentionCategory = 'shortage' | 'handover' | 'intake' | 'identify'

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
  | 'openAttentionFoundCatalog'
  | 'reconcileFoundInventoryStock'
  | 'refreshWarehouseAttention'
  | 'setAttentionCategory'
  | 'sourceLabel'
  | 'warehouseAttention'
> & {
  openAttentionOrder: (item: { orderId?: number | null; externalId?: string; orderDate?: string }) => void
  openAttentionArrival: (item: { source: string }) => void
  openAttentionStocktake: (item: { source: string }) => void
}

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
    openAttentionFoundCatalog,
    openAttentionOrder,
    openAttentionArrival,
    openAttentionStocktake,
    reconcileFoundInventoryStock,
    refreshWarehouseAttention,
    setAttentionCategory,
    sourceLabel,
    warehouseAttention,
  } = ctx
  const items = warehouseAttention?.items
  const counts = warehouseAttention?.counts
  const categoryCounts: Record<AttentionCategory, number> = {
    shortage: Number(counts?.shortage || 0) + Number(counts?.shippedUntracked || 0),
    handover: Number(counts?.handover || 0),
    intake: Number(counts?.intake || 0),
    identify: Number(counts?.lifecycle || 0) + Number(counts?.catalog || 0) + Number(counts?.found || 0),
  }
  const clarificationTotal = categoryCounts.handover + categoryCounts.identify
  const isIntake = attentionCategory === 'intake'
  const isShortage = attentionCategory === 'shortage'
  const tabs: Array<{ value: Exclude<AttentionCategory, 'intake'>; label: string }> = [
    { value: 'shortage', label: 'Проверить остаток' },
    { value: 'handover', label: 'Выдача' },
    { value: 'identify', label: 'Товар' },
  ]

  return (
    <div className="inventory-attention-panel" style={inventoryPanelStyle('attention')}>
      <div className="inventory-attention-head">
        <div>
          <h3>{isIntake ? 'Ожидают приёма' : isShortage ? 'Проверить остатки заказов' : 'Нужно уточнить'}</h3>
          <p>{isIntake
            ? 'Товар уже известен. Если вещь действительно уже у вас, можно завершить приёмку.'
            : isShortage
              ? 'Показываем нехватки активных резервов и уже отправленные товары, которых не было в учтённом физическом остатке. Отправка из-за этого не блокируется.'
              : 'Здесь только вопросы о том, какой это товар или что действительно выдали.'}</p>
        </div>
        <button className="secondary compact" type="button" onClick={refreshWarehouseAttention} disabled={attentionLoading}>{attentionLoading ? 'Обновляю…' : 'Обновить'}</button>
      </div>

      {attentionError ? <div className="inventory-attention-error">{attentionError}</div> : null}
      {attentionLoading && !items ? <div className="empty-state">Загружаю складские вопросы…</div> : null}
      {warehouseAttention && !isIntake && !isShortage && clarificationTotal === 0 ? <div className="inventory-attention-clear"><strong>Уточнять ничего не нужно</strong><span>Можно продолжать обычную работу.</span></div> : null}
      {warehouseAttention && isShortage && categoryCounts.shortage === 0 ? <div className="inventory-attention-clear"><strong>Нет складских расхождений по этим проверкам</strong><span>Это не заменяет физический пересчёт товара.</span></div> : null}
      {warehouseAttention && isIntake && categoryCounts.intake === 0 ? <div className="inventory-attention-clear"><strong>Сейчас ничего не ждёт приёмки</strong><span>Если такая вещь появится, она будет показана здесь отдельно от вопросов по данным.</span></div> : null}

      {warehouseAttention && !isIntake && categoryCounts.shortage + clarificationTotal > 0 ? (
        <>
          <div className="inventory-attention-summary">
            <strong>Складские вопросы: {categoryCounts.shortage + clarificationTotal}</strong>
            <span>{Number(counts?.shortage || 0)} — нехватка по резервам; {Number(counts?.shippedUntracked || 0)} — уже отправлено без учтённого остатка; {clarificationTotal} — уточнить товар или выдачу. Отправка при известном SKU не блокируется.</span>
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

      {items && attentionCategory === 'shortage' ? (
        <section className="inventory-attention-group is-shortage">
          <div className="inventory-attention-group-head">
            <div><strong>Нехватка учтённого товара</strong><span>Список меняется по фактическим данным, а не по отметкам «прочитано». Кнопки открывают проверку, но сами не изменяют склад.</span></div>
            <b>{Number(counts?.shortage || 0)}</b>
          </div>
          {(items.shortages || []).length ? (
            <div className="inventory-attention-list">
              {items.shortages.map((item: any) => (
                <article key={`attention-shortage-${item.source}-${item.variantId}`}>
                  <div className="inventory-attention-main">
                    <strong>{item.productName}</strong>
                    <span>{detailLine(item) || 'Характеристики не указаны'} · {sourceLabel(item.source)}</span>
                    <small>{item.orderId ? `Заказ ${item.externalId || item.orderId} от ${formatDateShort(item.orderDate)} · связан с активным резервом` : 'Связанный заказ не определён — проверьте историю резерва'}</small>
                    <small><strong>Физический остаток: {item.physical} шт., активный резерв: {item.reserved} шт.</strong> Не покрыто учтённым остатком: {Math.max(0, item.countRelevantReserved - item.physical)} шт.</small>
                    <small>Если вещь поступила — оформите приход. Если количество записано ошибочно — пересчитайте. Не создавайте фиктивный приход ради закрытия уведомления.</small>
                  </div>
                  <div className="inventory-attention-actions">
                    {item.orderId ? <button className="secondary compact" type="button" onClick={() => openAttentionOrder(item)}>Открыть заказ</button> : null}
                    {isAdmin ? <button className="secondary compact" type="button" onClick={() => openAttentionArrival(item)}>Оформить приход</button> : null}
                    <button className="secondary compact" type="button" onClick={() => openAttentionStocktake(item)}>Проверить количество</button>
                    {!isAdmin ? <small>Приход оформляет администратор</small> : null}
                  </div>
                </article>
              ))}
            </div>
          ) : <div className="empty-state">Нехваток по резервам сейчас нет.</div>}
          {Number(counts?.shortage || 0) > (items.shortages || []).length ? <p className="inventory-attention-hint">Показаны первые {items.shortages.length} из {Number(counts?.shortage || 0)} случаев. Обновите список после проверки.</p> : null}
        </section>
      ) : null}

      {items && attentionCategory === 'shortage' ? (
        <section className="inventory-attention-group is-shipped-untracked">
          <div className="inventory-attention-group-head">
            <div>
              <strong>Уже отправлено без учтённого остатка</strong>
              <span>Заказ отправлен — дополнительного подтверждения или фиктивного прихода не требуется. Сохраняем причину расхождения для последующей проверки; запись не исчезает после закрытия резерва.</span>
            </div>
            <b>{Number(counts?.shippedUntracked || 0)}</b>
          </div>
          {(items.shippedUntracked || []).length ? <div className="inventory-attention-list">
            {items.shippedUntracked!.map((item) => (
              <article key={`untracked-shipment-${item.evidenceId}`}>
                <div className="inventory-attention-main">
                  <strong>{item.productName}</strong>
                  <span>{detailLine(item)} · {sourceLabel(item.source)}</span>
                  <small>Отправлено по заказу {item.externalId || item.orderId} от {formatDateShort(item.orderDate)} · выдача {formatDateTime(item.occurredAt)}</small>
                  <small><strong>До отправки на месте по системе: {item.trackedPhysicalBefore} шт.; передано: {item.shippedQuantity} шт.; не объяснено учётом: {item.untrackedQuantity} шт.</strong></small>
                  <small>Проверьте, не забыли ли приход и верно ли указан вариант. Если нужно исправить количество — выполните ревизию. Эти действия не являются условием отправки.</small>
                </div>
                <div className="inventory-attention-actions">
                  {item.orderId ? <button className="secondary compact" type="button" onClick={() => openAttentionOrder(item)}>Открыть заказ</button> : null}
                  {isAdmin ? <button className="secondary compact" type="button" onClick={() => openAttentionArrival(item)}>Оформить приход</button> : null}
                  <button className="secondary compact" type="button" onClick={() => openAttentionStocktake(item)}>Проверить количество</button>
                </div>
              </article>
            ))}
          </div> : <div className="empty-state">Неподтверждённых учётом отправок пока нет.</div>}
          {Number(counts?.shippedUntracked || 0) > (items.shippedUntracked || []).length ? <p className="inventory-attention-hint">Показаны последние {(items.shippedUntracked || []).length} случаев из {Number(counts?.shippedUntracked || 0)}. Исторические события сохраняются.</p> : null}
        </section>
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
          {((items.found?.length || 0) || items.lifecycle.length || items.catalog.length) ? <div className="inventory-attention-list">
            {items.found?.length ? <section className="inventory-attention-subgroup">
              <div className="inventory-attention-subgroup-head"><div><strong>Найдено при проверке</strong><span>Физический факт уже сохранён. Осталось связать вещь с точным вариантом товара.</span></div><b>{items.found.length}</b></div>
              <div className="inventory-attention-sublist">
            {(items.found || []).map((item: any) => (
              <article className="w5-found-attention-card" key={`attention-found-${item.stockId}`}>
                <div className="inventory-attention-main">
                  <strong>{item.productName || 'Найденная вещь'}</strong>
                  <span>{detailLine(item) || 'Характеристики требуют уточнения'} · {sourceLabel(item.source)}</span>
                  <small>Физически учтено: {item.physical}</small>
                  <div className="w5-found-attention-warning"><strong>Вариант товара ещё не определён</strong><span>Физически вещь учтена, но пока не появилась среди обычных вариантов этого товара. Определите её, чтобы она стала доступна в остатках, перемещениях и заказах.</span></div>
                </div>
                {item.exactKnown
                  ? <button className="primary compact" type="button" onClick={() => void reconcileFoundInventoryStock(item)}>Связать с вариантом</button>
                  : isAdmin
                    ? <button className="secondary compact" type="button" onClick={() => openAttentionFoundCatalog(item)}>Разобрать</button>
                    : <span className="inventory-attention-admin-note">Требуется администратор</span>}
              </article>
            ))}
              </div>
            </section> : null}
            {items.lifecycle.length ? <section className="inventory-attention-subgroup">
              <div className="inventory-attention-subgroup-head"><div><strong>Приёмка требует определения</strong><span>Есть физически значимое событие, но точный вариант товара пока неизвестен.</span></div><b>{items.lifecycle.length}</b></div>
              <div className="inventory-attention-sublist">
            {(items.lifecycle || []).map((item: any) => (
              <article key={`attention-lifecycle-${item.id}`}>
                <div className="inventory-attention-main"><strong>{item.productName || 'Неизвестный товар'}</strong><span>{detailLine(item) || 'Характеристики не определены'} · {sourceLabel(item.source)}</span><small>{item.externalId ? `Заказ ${item.externalId} · от ${formatDateShort(item.orderDate)}` : ''}</small></div>
                {isAdmin ? <button className="secondary compact" type="button" onClick={() => void openAttentionLifecycle(item)}>Разобрать</button> : <span className="inventory-attention-admin-note">Требуется администратор</span>}
              </article>
            ))}
              </div>
            </section> : null}
            {items.catalog.length ? <section className="inventory-attention-subgroup">
              <div className="inventory-attention-subgroup-head"><div><strong>Позиция заказа не определена</strong><span>Нужно уточнить характеристики позиции заказа, не меняя уже известный физический остаток.</span></div><b>{items.catalog.length}</b></div>
              <div className="inventory-attention-sublist">
            {(items.catalog || []).map((item: any) => (
              <article key={`attention-catalog-${item.orderItemId}`}>
                <div className="inventory-attention-main"><strong>{item.productName || 'Неизвестный товар'}</strong><span>{detailLine(item) || 'Характеристики не определены'}</span><small>{item.externalId ? `Заказ ${item.externalId} · от ${formatDateShort(item.orderDate)}` : ''}{item.affectedCount > 1 ? ` · похожих позиций: ${item.affectedCount}` : ''}</small></div>
                {isAdmin ? <button className="secondary compact" type="button" onClick={() => void openAttentionCatalog(item)}>Разобрать</button> : <span className="inventory-attention-admin-note">Требуется администратор</span>}
              </article>
            ))}
              </div>
            </section> : null}
          </div> : <div className="empty-state">Неопределённых товаров сейчас нет.</div>}
        </section>
      ) : null}
    </div>
  )
}
