import type { InventoryRenderContext } from './types'
import '../../../styles/w8-3-daily-surfaces.css'
import '../../../styles/stock-attention-human-friendly.css'
import '../../../styles/w16-stock-source-attention.css'

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
  openAttentionCorrection: (item: { source: string; variantId: number; productId?: number }) => void
  openAttentionHistory: (item: { source: string; variantId: number }) => void
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
    openAttentionCorrection,
    openAttentionHistory,
    reconcileFoundInventoryStock,
    refreshWarehouseAttention,
    setAttentionCategory,
    sourceLabel,
    warehouseAttention,
  } = ctx
  const items = warehouseAttention?.items
  const counts = warehouseAttention?.counts
  const categoryCounts: Record<AttentionCategory, number> = {
    shortage: Number(counts?.shortage || 0),
    handover: Number(counts?.handover || 0),
    intake: Number(counts?.intake || 0),
    identify: Number(counts?.lifecycle || 0) + Number(counts?.catalog || 0) + Number(counts?.found || 0),
  }
  const clarificationTotal = categoryCounts.handover + categoryCounts.identify
  const isIntake = attentionCategory === 'intake'
  const isShortage = attentionCategory === 'shortage'
  const tabs: Array<{ value: Exclude<AttentionCategory, 'intake'>; label: string }> = [
    { value: 'shortage', label: 'Не хватает для заказов' },
    { value: 'handover', label: 'Уточнить выдачу' },
    { value: 'identify', label: 'Проверить данные' },
  ]

  return (
    <div className="inventory-attention-panel" style={inventoryPanelStyle('attention')}>
      <div className="inventory-attention-head">
        <div>
          <h3>{isIntake ? 'Ожидает подтверждения приёмки' : 'Что нужно проверить на складе'}</h3>
          <p>{isIntake
            ? 'Система знает товар, но не может сама подтвердить, что вещь действительно поступила.'
            : 'Здесь — конкретные вопросы по товарам и заказам. Сначала разберитесь в причине, затем подтвердите реальное действие. Старые отправки остаются в истории товара. Закрытые расхождения не должны появляться здесь повторно.'}</p>
        </div>
        <button className="secondary compact" type="button" onClick={refreshWarehouseAttention} disabled={attentionLoading}>{attentionLoading ? 'Обновляю…' : 'Обновить'}</button>
      </div>

      {attentionError ? <div className="inventory-attention-error">{attentionError}</div> : null}
      {attentionLoading && !items ? <div className="empty-state">Загружаю складские вопросы…</div> : null}
      {warehouseAttention && !isIntake && !isShortage && clarificationTotal === 0 ? <div className="inventory-attention-clear"><strong>Сейчас нет вопросов в этом разделе</strong><span>Можно продолжать работу. История выполненных действий остаётся доступна отдельно.</span></div> : null}
      {warehouseAttention && isShortage && categoryCounts.shortage === 0 ? <div className="inventory-attention-clear"><strong>Нехватки по текущим резервам нет</strong><span>Здесь сравниваются учётные остатки с активными резервами, а не последняя физическая проверка.</span></div> : null}
      {warehouseAttention && isIntake && categoryCounts.intake === 0 ? <div className="inventory-attention-clear"><strong>Сейчас ничего не ждёт приёмки</strong><span>Если такая вещь появится, она будет показана здесь отдельно от вопросов по данным.</span></div> : null}

      {warehouseAttention && !isIntake && categoryCounts.shortage + clarificationTotal > 0 ? (
        <>
          <div className="inventory-attention-summary">
            <strong>{categoryCounts.shortage + categoryCounts.handover ? `Нужно проверить по заказам: ${categoryCounts.shortage + categoryCounts.handover}` : 'Вопросов по заказам нет'}</strong>
            <span>{categoryCounts.shortage} товаров не хватает по учёту · {categoryCounts.handover} выдач требуют подтверждения.{categoryCounts.identify ? ` Отдельно ${categoryCounts.identify} вопросов о данных товара — их нельзя автоматически считать ошибками сотрудника.` : ''}</span>
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
            <div><strong>Для заказов не хватает товара по учёту</strong><span>Система сравнила записанный остаток с активными резервами. Фактическое количество нужно проверить отдельно.</span></div>
            <b>{Number(counts?.shortage || 0)}</b>
          </div>
          <p className="inventory-attention-simple-guide">Откройте историю и проверьте товар на месте. Если его действительно не хватает, выясните, была ли пропущена выдача, приёмка или другое действие. Из этого списка ничего не списывается и не прибавляется автоматически.</p>
          {(items.shortages || []).length ? (
            <div className="inventory-attention-list">
              {items.shortages.map((item: any) => (
                <article className="inventory-attention-task" key={`attention-shortage-${item.source}-${item.variantId}`}>
                  <div className="inventory-attention-main">
                    <strong>{item.productName}</strong>
                    <span>{detailLine(item) || 'Характеристики не указаны'} · {sourceLabel(item.source)}</span>
                    <p className="inventory-attention-task-reason"><strong>Для заказов не хватает {Math.max(0, Number(item.countRelevantReserved ?? item.reserved) - Number(item.physical))} шт. по учёту</strong></p>
                    <div className="inventory-attention-balance" aria-label="Сравнение учётного количества с резервами">
                      <div><span>Числится в системе</span><strong>{item.physical} шт.</strong></div>
                      <div><span>Нужно для заказов</span><strong>{item.countRelevantReserved ?? item.reserved} шт.</strong></div>
                      <div><span>Разница</span><strong>−{Math.max(0, Number(item.countRelevantReserved ?? item.reserved) - Number(item.physical))} шт.</strong></div>
                    </div>
                    {Number(item.reserved) > Number(item.countRelevantReserved ?? item.reserved) ? (
                      <small>Ещё {Number(item.reserved) - Number(item.countRelevantReserved)} шт. относятся к выдачам, которые нужно уточнить отдельно.</small>
                    ) : null}
                    <small>{item.orderId ? `Связанный заказ: ${item.externalId || item.orderId} · ${formatDateShort(item.orderDate)} (не обязательно единственный)` : 'Связанный заказ пока не определён'}</small>
                    <p className="inventory-attention-task-help">Это данные учёта, <strong>не свежий пересчёт</strong>. Проверьте историю, затем фактическое количество. Только после этого выбирайте действие.</p>
                  </div>
                  <div className="inventory-attention-actions">
                    {Number(item.variantId) > 0 ? <button className="primary compact" type="button" onClick={() => openAttentionHistory(item)}>Посмотреть историю</button> : null}
                    {item.orderId ? <button className="secondary compact" type="button" onClick={() => openAttentionOrder(item)}>Открыть заказ</button> : null}
                    <details className="inventory-attention-safe-operations">
                      <summary>После проверки — оформить действие</summary>
                      <p>Сначала убедитесь, что вещь действительно поступила или пересчитана. Не добавляйте остаток только для устранения предупреждения.</p>
                      <div>
                        {isAdmin ? <button className="secondary compact" type="button" onClick={() => openAttentionArrival(item)}>Оформить фактический приход</button> : null}
                        {Number(item.variantId) > 0 ? <button className="secondary compact" type="button" onClick={() => openAttentionCorrection(item)}>Корректировка после пересчёта</button> : null}
                      </div>
                    </details>
                  </div>
                </article>
              ))}
            </div>
          ) : <div className="empty-state">Пока нет заказов с нехваткой товара.</div>}
          {Number(counts?.shortage || 0) > (items.shortages || []).length ? <p className="inventory-attention-hint">Показаны первые {items.shortages.length} из {Number(counts?.shortage || 0)} случаев. Обновите список после проверки.</p> : null}
        </section>
      ) : null}

      {items && attentionCategory === 'handover' ? (
        <section className="inventory-attention-group is-handover">
          <div className="inventory-attention-group-head"><div><strong>Нужно подтвердить, выдавали ли товар</strong><span>После физической проверки по некоторым заказам нельзя достоверно восстановить факт выдачи. Пока никто не подтвердил действие, не будем считать его совершённым.</span></div><b>{categoryCounts.handover}</b></div>
          {items.handover.length ? <div className="inventory-attention-list">
            {items.handover.map((item: any) => (
              <article key={`attention-handover-${item.orderId}-${item.orderItemId}`}>
                <div className="inventory-attention-main">
                  <strong>{item.productName}</strong>
                  <span>{item.itemDetails || 'Без дополнительных характеристик'} · {sourceLabel(item.source)}</span>
                  <small>Заказ {item.externalId || item.orderId}{item.customerName ? ` · ${item.customerName}` : ''} · от {formatDateShort(item.orderDate)}</small>
                  <small>{item.itemCreatedAt ? `Позиция в учёте с ${formatDateTime(item.itemCreatedAt)} · ` : ''}{item.checkpointAt ? `${item.checkpointKind === 'revision' ? 'ревизия' : 'сверка'} ${formatDateShort(item.checkpointAt)}` : ''}</small>
                  <p className="inventory-attention-task-help">{item.reviewReason === 'late_entry' ? 'Позицию внесли после проверки остатков. Нужно уточнить, передавали ли её физически.' : 'После резерва была физическая проверка. Проверьте факт выдачи этой вещи.'}</p>
                </div>
                <button className="primary compact" type="button" onClick={() => openAttentionHandover(item)}>Уточнить выдачу в заказе</button>
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
          <div className="inventory-attention-group-head"><div><strong>Проверка данных о товарах</strong><span>Не все вопросы здесь требуют действий склада. Если существующий товар не распознан системой, это ошибка привязки, а не повод создавать другой товар вручную.</span></div><b>{categoryCounts.identify}</b></div>
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
              <div className="inventory-attention-subgroup-head"><div><strong>Есть незавершённые события по товарам</strong><span>Не считайте их приходом без проверки исходного документа и фактического получения. Некоторые старые события связаны с Цехом.</span></div><b>{items.lifecycle.length}</b></div>
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
              <div className="inventory-attention-subgroup-head"><div><strong>Нужно проверить связь с каталогом</strong><span>Если существующий товар уже однозначно указан в заказе, система должна привязать его сама; ошибка привязки — задача разработчика, а не склада.</span></div><b>{items.catalog.length}</b></div>
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
