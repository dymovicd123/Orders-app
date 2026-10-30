import type { InventoryCheckHistoryRow, InventoryCheckHistoryResponse, InventoryHistoryResponse } from '../../../app/types'
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
  checks: InventoryCheckHistoryRow[]
  evidence: InventoryCheckHistoryResponse | null
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
  variant, movements, checks, evidence, checksUnavailable, checksHasMore, checksPagingBusy,
  checksPageError, loadMoreChecks, hasMore, busy, loadMore, momentLabel, movementLabel,
}: Props) {
  const { events, firstObservedDifference } = buildStockVariantTimeline(movements, checks, variant.source, variant.variantId)
  const firstConfirmedDifference = evidence?.firstConfirmedDifference === undefined
    ? firstObservedDifference : evidence.firstConfirmedDifference
  const previousMatch = evidence?.lastMatchingBeforeDifference || null
  const latestCheck = [...checks].sort((a, b) =>
    b.checkedAt.localeCompare(a.checkedAt) || Number(b.id) - Number(a.id))[0] || null

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
        {stockCheckHasDifference(latestCheck) ? ' Есть подтверждённое несовпадение.' : ' Тогда количество совпало.'}
      </p> : null}
      {checksUnavailable ? <div className="stock-variant-no-gap" role="note">
        <strong>Сверки сейчас недоступны.</strong>
        <p>Не делайте вывод об отсутствии расхождений. Обновите историю.</p>
      </div> : firstConfirmedDifference ? <div className="stock-variant-first-gap" role="note">
        <strong>{evidence ? 'Первая зафиксированная нехватка или излишек за всю доступную историю проверок' : 'Первое несовпадение среди загруженных сверок'}: {momentLabel(firstConfirmedDifference.checkedAt)}</strong>
        <p>По системе: {quantity(numeric(firstConfirmedDifference.expectedQuantity))}.
        Фактически: {quantity(numeric(firstConfirmedDifference.countedQuantity))}.
        {firstConfirmedDifference.checkedBy ? ` Проверил(а): ${firstConfirmedDifference.checkedBy}.` : ''}
        Это день <b>обнаружения</b>, не обязательно день возникновения ошибки.</p>
        {previousMatch && <p>До этого товар совпадал с учётом при сверке <b>{momentLabel(previousMatch.checkedAt)}</b>
          . Проверьте движения и связанные документы <b>между двумя проверками</b> — это наиболее полезный известный интервал.</p>}
        {!previousMatch && <p>Более ранней подтверждённой сверки с совпадением нет. Точную дату возникновения ошибки по одним записям определить нельзя.</p>}
      </div> : <div className="stock-variant-no-gap" role="note">
        <strong>Подтверждённых расхождений в сохранённых сверках нет.</strong>
        <p>Это не гарантия правильных остатков сегодня: отсутствующий приход или выдача без оформления не отражаются в журнале.</p>
      </div>}
      <details className="w18-investigation-how">
        <summary>Как найти причину расхождения?</summary>
        <p>Сначала найдите последнюю сверку, на которой товар совпадал с учётом. Затем изучите приходы, выдачи, возвраты, перемещения и корректировки до первого несовпадения. Сверьте документы и фактическое количество. Если операция отсутствует, история сама не восстановит её автоматически.</p>
        <p>Ниже показаны <b>проведённые</b> действия. Отклонённые попытки сохранения и неоформленные физические движения здесь не отображаются.</p>
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
        const movement = event.movement
        const delta = numeric(movement.quantityDelta)
        const after = numeric(movement.quantityAfter)
        const before = after - delta
        const isCancelled = Boolean(movement.reversedAt)
        return <li key={event.key} className={isCancelled ? 'is-cancelled' : ''}>
          <div className="stock-variant-event-head">
            <time>{momentLabel(movement.createdAt)}</time>
            <b>{movementLabel(movement)} {isCancelled ? '· отменено позднее' : ''}</b>
          </div>
          <div className="stock-variant-event-numbers">
            <span>Было <strong>{quantity(before)}</strong></span><span>→</span>
            <span>Стало <strong>{quantity(after)}</strong></span>
            <em className={delta < 0 ? 'is-negative' : ''}>{delta >= 0 ? '+' : ''}{delta}</em>
          </div>
          {numeric(movement.unexplainedQuantity) > 0 ? <p className="stock-variant-event-warning">
            При этой операции учётного остатка не хватало на {quantity(numeric(movement.unexplainedQuantity))}. Это исторический факт, а не свидетельство текущей недостачи. Текущее количество определяется последующими движениями и физическими сверками.
          </p> : null}
          <div className="stock-variant-event-meta">
            {movement.referenceId ? `Документ/заказ: ${movement.referenceId}` : 'Документ не указан'}
            {movement.comment ? ` · ${movement.comment}` : ''}
          </div>
        </li>
      })}
    </ol> : <p className="stock-variant-empty">Для этого варианта пока нет загруженных событий. Отсутствие записи не подтверждает отсутствие движения.</p>}

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
