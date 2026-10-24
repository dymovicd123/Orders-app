import type { InventoryCheckHistoryRow, InventoryHistoryResponse } from '../../../app/types'
import { buildStockVariantTimeline, stockCheckHasDifference } from '../stockVariantTimelineModel'

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
  checksUnavailable: boolean
  hasMore: boolean
  busy: boolean
  loadMore: () => void
  momentLabel: (moment: string) => string
  movementLabel: (movement: Movement) => string
}

const numeric = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const quantity = (value: number) => `${value} шт.`

export function StockVariantTimeline({
  variant, movements, checks, checksUnavailable, hasMore, busy, loadMore, momentLabel, movementLabel,
}: Props) {
  const { events, firstObservedDifference } = buildStockVariantTimeline(movements, checks, variant.source, variant.variantId)

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

    {firstObservedDifference ? <div className="stock-variant-first-gap" role="note">
      <strong>Самое раннее расхождение среди загруженных проверок: {momentLabel(firstObservedDifference.checkedAt)}</strong>
      <p>По системе было {quantity(numeric(firstObservedDifference.expectedQuantity))}, при проверке посчитали {quantity(numeric(firstObservedDifference.countedQuantity))}.
        Это точка, где несовпадение <b>зафиксировано</b>, а не доказательство того, что ошибка возникла именно тогда.</p>
    </div> : <div className="stock-variant-no-gap" role="note">
      <strong>{checksUnavailable ? 'Данные проверок пока недоступны' : 'Подтверждённых расхождений среди загруженных проверок нет'}</strong>
      <p>{checksUnavailable
        ? 'Движения доступны, но сверки не загрузились. Повторите обновление прежде, чем делать выводы.'
        : 'Это не гарантия совпадения с фактическим количеством: возможны непроведённые операции и более старые записи.'}</p>
    </div>}

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
            Фактическая операция включала {quantity(numeric(movement.unexplainedQuantity))} сверх учтённого остатка. Проверьте связанные документы.
          </p> : null}
          <div className="stock-variant-event-meta">
            {movement.referenceId ? `Документ/заказ: ${movement.referenceId}` : 'Документ не указан'}
            {movement.comment ? ` · ${movement.comment}` : ''}
          </div>
        </li>
      })}
    </ol> : <p className="stock-variant-empty">Для этого варианта пока нет загруженных событий. Отсутствие записи не подтверждает отсутствие движения.</p>}

    {hasMore ? <div className="stock-variant-more">
      <p>Есть более ранние операции. Пока они не загружены, точку возникновения расхождения нельзя считать установленной.</p>
      <button type="button" className="secondary" disabled={busy} onClick={loadMore}>{busy ? 'Загружаю…' : 'Загрузить более ранние события'}</button>
    </div> : null}
    <p className="stock-variant-footnote">Это история <b>варианта товара</b>, не отдельной физической вещи. Изменение после сверки не обязательно объясняет причину первоначального расхождения.</p>
  </section>
}
