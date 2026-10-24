import type { InventoryCheckHistoryRow, InventoryHistoryResponse } from '../../../app/types'

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
type Event =
  | { kind: 'movement'; moment: string; key: string; movement: Movement }
  | { kind: 'check'; moment: string; key: string; check: InventoryCheckHistoryRow }

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
const isDifferent = (check: InventoryCheckHistoryRow) =>
  check.expectedQuantity !== undefined && check.countedQuantity !== undefined
    && Number(check.expectedQuantity) !== Number(check.countedQuantity)
const quantity = (value: number) => `${value} шт.`

export function StockVariantTimeline({
  variant, movements, checks, checksUnavailable, hasMore, busy, loadMore, momentLabel, movementLabel,
}: Props) {
  // The API applies exact variantId + source filters; never reconstruct identity
  // from names or fold events belonging to another location into this timeline.
  const exactChecks = checks.filter(check => check.source === variant.source
    && check.expectedQuantity !== undefined && check.countedQuantity !== undefined)
  const observedDifference = [...exactChecks].filter(isDifferent)
    .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))[0]
  const events: Event[] = [
    ...movements.map(movement => ({
      kind: 'movement' as const, moment: movement.createdAt,
      key: `m-${movement.id}`, movement,
    })),
    ...exactChecks.map(check => ({
      kind: 'check' as const, moment: check.checkedAt,
      key: `c-${check.id}`, check,
    })),
  ].sort((a, b) => a.moment.localeCompare(b.moment) || a.key.localeCompare(b.key))

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

    {observedDifference ? <div className="stock-variant-first-gap" role="note">
      <strong>Самое раннее расхождение среди загруженных проверок: {momentLabel(observedDifference.checkedAt)}</strong>
      <p>По системе было {quantity(numeric(observedDifference.expectedQuantity))}, при проверке посчитали {quantity(numeric(observedDifference.countedQuantity))}.
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
          const different = isDifferent(check)
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
