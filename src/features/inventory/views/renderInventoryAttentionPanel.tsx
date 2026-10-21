import type { InventoryRenderContext } from './types'
import '../../../styles/w8-3-daily-surfaces.css'
import '../../../styles/stock-attention-human-friendly.css'

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
    { value: 'shortage', label: 'Проверить товары' },
    { value: 'handover', label: 'Выдача' },
    { value: 'identify', label: 'Товар' },
  ]

  return (
    <div className="inventory-attention-panel" style={inventoryPanelStyle('attention')}>
      <div className="inventory-attention-head">
        <div>
          <h3>{isIntake ? 'Ожидают приёма' : isShortage ? 'Товары, которые нужно проверить' : 'Нужно уточнить'}</h3>
          <p>{isIntake
            ? 'Товар уже известен. Если вещь действительно уже у вас, можно завершить приёмку.'
            : isShortage
              ? 'Здесь собраны случаи, когда количество товара в системе не совпало с заказами. Посмотрите, что произошло, и выберите подходящую проверку. Отправка заказов из-за этого не останавливается.'
              : 'Здесь только вопросы о том, какой это товар или что действительно выдали.'}</p>
        </div>
        <button className="secondary compact" type="button" onClick={refreshWarehouseAttention} disabled={attentionLoading}>{attentionLoading ? 'Обновляю…' : 'Обновить'}</button>
      </div>

      {attentionError ? <div className="inventory-attention-error">{attentionError}</div> : null}
      {attentionLoading && !items ? <div className="empty-state">Загружаю складские вопросы…</div> : null}
      {warehouseAttention && !isIntake && !isShortage && clarificationTotal === 0 ? <div className="inventory-attention-clear"><strong>Уточнять ничего не нужно</strong><span>Можно продолжать обычную работу.</span></div> : null}
      {warehouseAttention && isShortage && categoryCounts.shortage === 0 ? <div className="inventory-attention-clear"><strong>Сейчас ничего проверять не нужно</strong><span>Новых расхождений по этим заказам нет.</span></div> : null}
      {warehouseAttention && isIntake && categoryCounts.intake === 0 ? <div className="inventory-attention-clear"><strong>Сейчас ничего не ждёт приёмки</strong><span>Если такая вещь появится, она будет показана здесь отдельно от вопросов по данным.</span></div> : null}

      {warehouseAttention && !isIntake && categoryCounts.shortage + clarificationTotal > 0 ? (
        <>
          <div className="inventory-attention-summary">
            <strong>Есть товары, которые нужно проверить: {categoryCounts.shortage + clarificationTotal}</strong>
            <span>До отправки: {Number(counts?.shortage || 0)} · После отправки: {Number(counts?.shippedUntracked || 0)} · Уточнить товар или выдачу: {clarificationTotal}. Выберите нужный раздел ниже.</span>
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
            <div><strong>Не хватает товара по заказам</strong><span>Товар указан в заказе, но по данным системы его недостаточно. Проверьте, всё ли правильно записано на складе.</span></div>
            <b>{Number(counts?.shortage || 0)}</b>
          </div>
          {(items.shortages || []).length ? (
            <div className="inventory-attention-list">
              {items.shortages.map((item: any) => (
                <article className="inventory-attention-task" key={`attention-shortage-${item.source}-${item.variantId}`}>
                  <div className="inventory-attention-main">
                    <span className="inventory-attention-task-kind">Проверить остаток</span>
                    <strong>{item.productName}</strong>
                    <span>{detailLine(item) || 'Характеристики не указаны'} · {sourceLabel(item.source)}</span>
                    <small>{item.orderId ? `Заказ ${item.externalId || item.orderId} · ${formatDateShort(item.orderDate)}` : 'Заказ не найден — проверьте историю товара'}</small>
                    <p className="inventory-attention-task-reason">Для заказов на этот товар по системе не хватает <strong>{Math.max(0, Number(item.countRelevantReserved || 0) - Number(item.physical || 0))} шт.</strong></p>
                    <p className="inventory-attention-task-help"><strong>Что сделать?</strong> Если товар поступил, но его не внесли — оформите приход. Если количество в системе неверное — проверьте остаток. Это поможет избежать таких расхождений в следующих заказах.</p>
                    <details className="inventory-attention-facts">
                      <summary>Посмотреть данные учёта</summary>
                      <span>В наличии по системе: {item.physical} шт. · Зарезервировано: {item.reserved} шт. · Не хватает: {Math.max(0, Number(item.countRelevantReserved || 0) - Number(item.physical || 0))} шт.</span>
                    </details>
                  </div>
                  <div className="inventory-attention-actions">
                    {item.orderId ? <button className="secondary compact" type="button" onClick={() => openAttentionOrder(item)}>Открыть заказ</button> : null}
                    {isAdmin ? <button className="secondary compact" type="button" onClick={() => openAttentionArrival(item)}>Оформить приход</button> : null}
                    <button className="secondary compact" type="button" onClick={() => openAttentionStocktake(item)}>Проверить количество</button>
                    {!isAdmin ? <small>Поступления оформляет администратор</small> : null}
                  </div>
                </article>
              ))}
            </div>
          ) : <div className="empty-state">Пока нет заказов с нехваткой товара.</div>}
          {Number(counts?.shortage || 0) > (items.shortages || []).length ? <p className="inventory-attention-hint">Показаны первые {items.shortages.length} из {Number(counts?.shortage || 0)} случаев. Обновите список после проверки.</p> : null}
        </section>
      ) : null}

      {items && attentionCategory === 'shortage' ? (
        <section className="inventory-attention-group is-shipped-untracked">
          <div className="inventory-attention-group-head">
            <div>
              <strong>Заказ уже отправлен — проверить причину</strong>
              <span>Эти заказы уже отправлены. Проверьте, почему количества в системе не хватало. Повторно отправлять или подтверждать ничего не нужно.</span>
            </div>
            <b>{Number(counts?.shippedUntracked || 0)}</b>
          </div>
          {(items.shippedUntracked || []).length ? <div className="inventory-attention-list">
            {items.shippedUntracked!.map((item) => (
              <article className="inventory-attention-task" key={`untracked-shipment-${item.evidenceId}`}>
                <div className="inventory-attention-main">
                  <span className="inventory-attention-task-kind is-shipped">Заказ отправлен</span>
                  <strong>{item.productName}</strong>
                  <span>{detailLine(item) || 'Характеристики не указаны'} · {sourceLabel(item.source)}</span>
                  <small>Заказ {item.externalId || item.orderId} · {formatDateShort(item.orderDate)} · отправлен {formatDateTime(item.occurredAt)}</small>
                  <p className="inventory-attention-task-reason">Заказ отправлен, но при выдаче в системе не хватало <strong>{item.untrackedQuantity} шт.</strong> этого товара.</p>
                  <p className="inventory-attention-task-help"><strong>Что сделать?</strong> Проверьте, почему товара не было в учёте: возможно, забыли оформить поступление или выбрали другой вариант. Если товар уже выдан клиенту, не добавляйте его повторно на склад.</p>
                  <details className="inventory-attention-facts">
                    <summary>Посмотреть данные отправки</summary>
                    <span>В наличии по системе до отправки: {item.trackedPhysicalBefore} шт. · Отправлено: {item.shippedQuantity} шт. · Не хватало в учёте: {item.untrackedQuantity} шт.</span>
                  </details>
                </div>
                <div className="inventory-attention-actions">
                  {item.orderId ? <button className="secondary compact" type="button" onClick={() => openAttentionOrder(item)}>Открыть заказ</button> : null}
                  <button className="secondary compact" type="button" onClick={() => openAttentionStocktake(item)}>Проверить количество</button>
                </div>
              </article>
            ))}
          </div> : <div className="empty-state">Нет отправленных заказов, по которым нужно уточнить остатки.</div>}
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
