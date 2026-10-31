import type { InventoryCheckHistoryRow, InventoryCheckHistoryResponse, InventoryHistoryResponse, InventoryOperationAttempt } from '../../../app/types'
import type { InventoryReservation } from '../../../../shared/api-contracts.ts'
import { buildStockVariantTimeline, stockCheckHasDifference } from '../stockVariantTimelineModel'
import '../../../styles/w18-history-investigation.css'

type Movement = InventoryHistoryResponse['movements'][number]
type ExactVariant = {
  source: 'warehouse' | 'boutique'
  variantId: number
  productName?: string
  color?: string
  material?: string
  length?: string
  size?: string
  gender?: string
}
type Props = {
  variant: ExactVariant
  movements: Movement[]
  attempts: InventoryOperationAttempt[]
  attemptsHasMore: boolean
  attemptsBusy: boolean
  attemptsError: string
  loadMoreAttempts: () => void
  checks: InventoryCheckHistoryRow[]
  evidence: InventoryCheckHistoryResponse | null
  reservations: InventoryReservation[]
  reservationsBusy: boolean
  reservationsError: string
  reservationsTotalQuantity: number
  reservationsTotalCount: number
  reservationsHasMore: boolean
  openReserveOrder: (order: InventoryReservation) => void
  checksUnavailable: boolean
  checksHasMore: boolean
  checksPagingBusy: boolean
  checksPageError: string
  loadMoreChecks: () => void
  hasMore: boolean
  busy: boolean
  loadMore: () => void
  momentLabel: (moment: string) => string
  movementLabel: (movement: Movement) => string
}

const numeric = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const quantity = (value: number) => `${value} шт.`

export function StockVariantTimeline({
  variant, movements, attempts, attemptsHasMore, attemptsBusy, attemptsError, loadMoreAttempts, checks, evidence, reservations, reservationsBusy, reservationsError,
  reservationsTotalQuantity, reservationsTotalCount, reservationsHasMore,
  openReserveOrder, checksUnavailable, checksHasMore, checksPagingBusy,
  checksPageError, loadMoreChecks, hasMore, busy, loadMore, momentLabel, movementLabel,
}: Props) {
  const { events, firstObservedDifference } = buildStockVariantTimeline(movements, checks, variant.source, variant.variantId, attempts)
  const firstConfirmedDifference = evidence?.firstConfirmedDifference === undefined
    ? firstObservedDifference : evidence.firstConfirmedDifference
  const latestCheck = evidence?.latestCheck || [...checks].sort((a, b) =>
    b.checkedAt.localeCompare(a.checkedAt) || Number(b.id) - Number(a.id))[0] || null
  const latestCheckDiffers = Boolean(latestCheck
    && Number(latestCheck.expectedQuantity) !== Number(latestCheck.countedQuantity))
  const currentEpisode = evidence?.currentEpisodeFirstDifference === undefined
    ? (latestCheckDiffers ? firstObservedDifference : null) : evidence.currentEpisodeFirstDifference
  const previousMatch = evidence?.currentEpisodeLastMatchingCheck
    || (evidence?.currentEpisodeFirstDifference === undefined ? evidence?.lastMatchingBeforeDifference : null)
    || null
  const activeOrders = reservations.filter(order =>
    order.status === 'active' && order.source === variant.source && Number(order.variantId) === variant.variantId)
  const totalCommitted = reservationsTotalCount > activeOrders.length
    ? reservationsTotalQuantity
    : activeOrders.reduce((sum, order) => sum + Math.max(0, Number(order.quantity) || 0), 0)

  const identity = [variant.color, variant.material && variant.material !== 'СТАНДАРТ' ? variant.material : '',
    variant.length && variant.length !== 'СТАНДАРТ' ? variant.length : '',
    variant.gender, variant.size ? `Размер ${variant.size}` : ''].filter(Boolean).join(' · ')

  return <section className="stock-variant-timeline" data-stock-variant-timeline={variant.variantId}>
    <div className="stock-variant-timeline-intro">
      <div>
        <span>История одного варианта · {variant.source === 'boutique' ? 'Бутик' : 'Склад'}</span>
        <h4>{variant.productName || 'Товар'}{identity ? <small> · {identity}</small> : null}</h4>
        <p>Хронология снизу начинается с более ранних записей. Каждая запись показывает, что система зафиксировала, но не заменяет физический пересчёт.</p>
      </div>
      <strong className="stock-variant-identity">Вариант #{variant.variantId}</strong>
    </div>

    <section className="w18-investigation-summary" aria-label="Сводка расследования по варианту">
      <div className="w18-investigation-title">
        <strong>Что известно об этом варианте</strong>
        <span>Только подтверждённые записи учёта, без догадок</span>
      </div>
      <div className="w18-investigation-metrics">
        <div><span>Сверок в истории</span><strong>{checksUnavailable ? 'Недоступно' : evidence?.totalChecks ?? checks.length}</strong></div>
        <div><span>С расхождением</span><strong>{checksUnavailable ? '—' : evidence?.differenceCount ?? checks.filter(stockCheckHasDifference).length}</strong></div>
        <div><span>Движений загружено</span><strong>{movements.length}{hasMore ? '+' : ''}</strong></div>
      </div>
      {latestCheck && !checksUnavailable ? <p className="w18-last-count">
        Последняя загруженная физическая сверка: <b>{momentLabel(latestCheck.checkedAt)}</b>.
        По системе <b>{quantity(numeric(latestCheck.expectedQuantity))}</b>,
        посчитано <b>{quantity(numeric(latestCheck.countedQuantity))}</b>.
        {latestCheckDiffers ? ' На той проверке было несовпадение; это не текущий физический остаток.' : ' Тогда количество совпало.'}
      </p> : null}
      <section className="w18-active-reservations" aria-label="Текущие резервы по конкретному варианту">
        <strong>Для каких заказов сейчас отложен этот товар</strong>
        {reservationsBusy ? <p>Проверяю текущие резервы…</p>
          : reservationsError ? <p role="alert">{reservationsError}</p>
          : activeOrders.length ? <>
              <p>В активных резервах: <b>{quantity(totalCommitted)}</b> по {reservationsTotalCount || activeOrders.length} {reservationsTotalCount === 1 || (!reservationsTotalCount && activeOrders.length === 1) ? 'записи' : 'записям'} на этом источнике и SKU. Это обязательства по заказам, а не результат физического пересчёта.</p>
              {reservationsHasMore ? <p role="note">Ниже показаны только первые {activeOrders.length} резервов из {reservationsTotalCount}. Общее количество выше посчитано по всем действующим резервам.</p> : null}
              <ul className="w18-reservation-orders">{activeOrders.map(order => (
                <li key={order.id}>
                  <span>Заказ {order.externalOrderId || order.orderId} · {quantity(Number(order.quantity))}</span>
                  <button type="button" className="secondary compact" onClick={() => openReserveOrder(order)}>Открыть заказ</button>
                </li>
              ))}</ul>
            </> : <p>Сейчас активных резервов по этому варианту и источнику не найдено. Это не означает, что физический остаток проверен.</p>}
      </section>
      {checksUnavailable ? <div className="stock-variant-no-gap" role="note">
        <strong>Сверки сейчас недоступны.</strong>
        <p>Не делайте вывод об отсутствии расхождений. Обновите историю.</p>
      </div> : currentEpisode ? <div className="stock-variant-first-gap" role="note">
        <strong>Последний незакрытый по сверкам период расхождения — обнаружен {momentLabel(currentEpisode.checkedAt)}</strong>
        <p>На той проверке: по системе {quantity(numeric(currentEpisode.expectedQuantity))},
        сотрудник насчитал {quantity(numeric(currentEpisode.countedQuantity))}.
        {currentEpisode.checkedBy ? ` Проверил(а): ${currentEpisode.checkedBy}.` : ''}
        Это день <b>обнаружения</b>, а не доказанная дата возникновения расхождения.</p>
        {previousMatch ? <p>Последняя предыдущая совпавшая сверка: <b>{momentLabel(previousMatch.checkedAt)}</b>.
          Изучите операции и документы между ней и обнаружением расхождения.</p>
          : <p>До расхождения нет подтверждённой совпавшей сверки. Начало периода по записям установить нельзя.</p>}
        <p>После последней загруженной сверки остаток мог измениться. Без новой проверки нельзя утверждать, что расхождение сохраняется физически прямо сейчас.</p>
      </div> : firstConfirmedDifference ? <div className="stock-variant-no-gap" role="note">
        <strong>Ранее было расхождение, но последняя сохранённая сверка совпала с учётом.</strong>
        <p>Исторический пример: {momentLabel(firstConfirmedDifference.checkedAt)}.
          Это не текущая проблема склада. Новое расхождение может выявить только следующая проверка.</p>
      </div> : <div className="stock-variant-no-gap" role="note">
        <strong>Подтверждённых расхождений в сохранённых сверках нет.</strong>
        <p>Это не гарантия правильных остатков сегодня: отсутствующий приход или выдача без оформления не отражаются в журнале.</p>
      </div>}
      <details className="w18-investigation-how">
        <summary>Как найти причину расхождения?</summary>
        <p>Сначала найдите последнюю сверку, на которой товар совпадал с учётом. Затем изучите приходы, выдачи, возвраты, перемещения и корректировки до первого несовпадения. Сверьте документы и фактическое количество. Если операция отсутствует, история сама не восстановит её автоматически.</p>
        <p>Ниже отдельно показаны проведённые движения, сохранённые сверки и записанные попытки (отказы, повторы и неопределённые ответы). Попытка не означает физическое движение.</p>
      </details>
    </section>

    {events.length ? <ol className="stock-variant-events">
      {events.map(event => {
        if (event.kind === 'check') {
          const check = event.check
          const different = stockCheckHasDifference(check)
          return <li key={event.key} className={different ? 'is-difference' : 'is-check'}>
            <div className="stock-variant-event-head"><time>{momentLabel(check.checkedAt)}</time><b>{different ? 'Расхождение при сверке' : 'Сверка количества'}</b></div>
            <div className="stock-variant-event-numbers">
              <span>По системе <strong>{quantity(numeric(check.expectedQuantity))}</strong></span>
              <span>→</span><span>Посчитано <strong>{quantity(numeric(check.countedQuantity))}</strong></span>
            </div>
            <div className="stock-variant-event-meta">
              {check.checkedBy ? `Проверил(а): ${check.checkedBy}` : 'Сотрудник не указан'}
              {check.referenceId ? ` · Проверка ${check.referenceId}` : ''}
            </div>
          </li>
        }
        if (event.kind === 'attempt') {
          const attempt = event.attempt
          const label = attempt.outcome === 'rejected' ? 'Запрос отклонён'
            : attempt.outcome === 'replayed' ? 'Повтор запроса без нового движения'
              : 'Результат запроса не подтверждён'
          return <li key={event.key} className="is-attempt">
            <div className="stock-variant-event-head">
              <time>{momentLabel(attempt.recordedAt)}</time><b>{label}</b>
            </div>
            <p className="stock-variant-event-warning">
              {attempt.outcome === 'uncertain'
                ? 'Ответ сервера не подтверждает, была ли операция проведена. Проверьте движения и документ перед новым действием.'
                : attempt.outcome === 'replayed'
                  ? 'Новой физической операции при повторе не выполнялось.'
                  : 'Эта запись фиксирует отказ в запросе, а не складское движение.'}
            </p>
            <div className="stock-variant-event-meta">
              {attempt.operationType} · {attempt.requestId ? 'Запрос: ' + attempt.requestId : 'ID запроса не указан'}
              {' · '}{attempt.actor ? 'Запросил(а): ' + attempt.actor : 'Исполнитель не зафиксирован'}
              {attempt.reasonMessage ? ' · ' + attempt.reasonMessage : ''}
            </div>
          </li>
        }
        const movement = event.movement
        const delta = numeric(movement.quantityDelta)
        const after = numeric(movement.quantityAfter)
        const derivedBefore = after - delta
        // Some pre-baseline stocktake rows keep a zero "after" snapshot and
        // positive difference. Their reverse arithmetic would imply negative
        // quantities, which is NOT reliable evidence of physical stock.
        const before = derivedBefore >= 0 ? quantity(derivedBefore) : 'не установлен по этой записи'
        const isCancelled = Boolean(movement.reversedAt)
        return <li key={event.key} className={isCancelled ? 'is-cancelled' : ''}>
          <div className="stock-variant-event-head">
            <time>{momentLabel(movement.createdAt)}</time>
            <b>{movementLabel(movement)} {isCancelled ? '· отменено позднее' : ''}</b>
          </div>
          <div className="stock-variant-event-numbers">
            <span>Было <strong>{before}</strong></span><span>→</span>
            <span>Стало <strong>{quantity(after)}</strong></span>
            <em className={delta < 0 ? 'is-negative' : ''}>{delta >= 0 ? '+' : ''}{delta}</em>
          </div>
          {derivedBefore < 0 ? <p className="stock-variant-event-warning">
            У этой исторической записи изменение и итог не позволяют достоверно восстановить остаток «до». Это несогласованность записей, а не доказательство ошибки сотрудника или отрицательного физического остатка.
          </p> : null}
          {numeric(movement.unexplainedQuantity) > 0 ? <p className="stock-variant-event-warning">
            При этой операции учётного остатка не хватало на {quantity(numeric(movement.unexplainedQuantity))}. Это исторический факт, а не свидетельство текущей недостачи. Текущее количество определяется последующими движениями и физическими сверками.
          </p> : null}
          <div className="stock-variant-event-meta">
            {movement.referenceId ? `Документ/заказ: ${movement.referenceId}` : 'Документ не указан'}
            {movement.referenceType === 'manual' ? ` · Исполнитель: ${movement.performedBy || 'не зафиксирован'}` : ''}
            {movement.comment ? ` · ${movement.comment}` : ''}
          </div>
        </li>
      })}
    </ol> : <p className="stock-variant-empty">Для этого варианта пока нет загруженных событий. Отсутствие записи не подтверждает отсутствие движения.</p>}

    {attemptsError ? <p className="stock-variant-event-warning" role="alert">{attemptsError}</p> : null}
    {attemptsBusy && !attempts.length ? <p>Загружаю сохранённые попытки операций…</p> : null}
    {attemptsHasMore ? <div className="stock-variant-more">
      <p>Есть более ранние запросы. Их отсутствие в загруженном списке не доказывает, что попыток не было.</p>
      <button type="button" className="secondary" disabled={attemptsBusy} onClick={loadMoreAttempts}>
        {attemptsBusy ? 'Загружаю…' : 'Загрузить более ранние попытки'}
      </button>
    </div> : null}
    {checksHasMore && <div className="stock-variant-more w18-older-checks">
      <p>Есть более ранние физические сверки. Загрузите их, чтобы увидеть полную хронологию проверок рядом с движениями.</p>
      {checksPageError && <p role="alert">{checksPageError}</p>}
      <button className="secondary" type="button" disabled={checksPagingBusy} onClick={loadMoreChecks}>
        {checksPagingBusy ? 'Загружаю проверки…' : 'Показать более ранние сверки'}
      </button>
    </div>}
        {hasMore ? <div className="stock-variant-more">
      <p>Есть более ранние операции. Пока они не загружены, точку возникновения расхождения нельзя считать установленной.</p>
      <button type="button" className="secondary" disabled={busy} onClick={loadMore}>{busy ? 'Загружаю…' : 'Загрузить более ранние события'}</button>
    </div> : null}
    <p className="stock-variant-footnote">Это история <b>варианта товара</b>, не отдельной физической вещи. Изменение после сверки не обязательно объясняет причину первоначального расхождения.</p>
  </section>
}
