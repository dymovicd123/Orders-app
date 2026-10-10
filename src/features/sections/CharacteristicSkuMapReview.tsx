import { useEffect, useRef, useState } from 'react'
import '../../styles/reference-characteristic-sku-map.css'

// The API from PR #353 is deliberately read-only. No SKU mapping result may
// authorize a stock merge, an order rewrite, or a reference-value deletion.
type Kind = 'color' | 'material' | 'length' | 'size' | 'child_age'
type Status = 'unique_keeper' | 'no_keeper' | 'ambiguous_keepers' | 'needs_execution_review' | 'historical'
type Place = {
  location: string
  sourcePhysical: number
  sourceReserved: number
  keeperPhysical: number | null
  keeperReserved: number | null
  sourceShortage: number
  keeperShortage: number | null
}
type MappingRow = {
  sourceVariantId: number
  productId: number
  productName: string
  category: string | null
  gender: string | null
  color: string | null
  material: string | null
  length: string | null
  size: string | null
  active: boolean
  status: Status
  candidateCount: number
  proposedKeeperId: number | null
  possibleKeeperIds: number[]
  places: Place[]
  activeReservations: number
  activeOrderLines: number
  keeperActiveReservations: number | null
  keeperActiveOrderLines: number | null
  reviewReasons: string[]
  guidance: string
  canAutomaticallyMerge: false
}
type MappingPage = {
  ok: boolean
  kind: Kind
  source: { id: number; value: string }
  target: { id: number; value: string }
  totalSourceVariants: number
  pageSize: number
  afterVariantId: number
  shownCount: number
  hasMore: boolean
  nextCursor: number | null
  rows: MappingRow[]
  canApply: false
  noChangesApplied: true
  explanation: string
}
type Props = {
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>
  kind: Kind
  sourceId: number
  targetId: number
}
const PAGE_SIZE = 20
const statusLabels: Record<Status, string> = {
  unique_keeper: 'Есть возможная пара',
  no_keeper: 'Нет основного варианта',
  ambiguous_keepers: 'Несколько вариантов',
  needs_execution_review: 'Нужно проверить исполнение',
  historical: 'Архивный вариант',
}
const placeName = (location: string) =>
  location === 'warehouse' ? 'Склад' : location === 'boutique' ? 'Бутик' : location
const textOr = (value: string | null | undefined, fallback: string) => value?.trim() || fallback
const quantity = (value: number) => Number(value).toLocaleString('ru-RU')

export function CharacteristicSkuMapReview({ apiFetch, kind, sourceId, targetId }: Props) {
  const [page, setPage] = useState<MappingPage | null>(null)
  const [rows, setRows] = useState<MappingRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const latestRequest = useRef(0)

  // The parent supplies a keyed instance per selected pair/preview, so no
  // response from a previous selection can populate a different mapping.
  useEffect(() => () => { latestRequest.current += 1 }, [])

  async function load(after = 0) {
    if (busy) return
    const request = ++latestRequest.current
    setBusy(true)
    setError('')
    try {
      const query = new URLSearchParams({
        sourceId: String(sourceId),
        targetId: String(targetId),
        afterVariantId: String(after),
        limit: String(PAGE_SIZE),
      })
      const response = await apiFetch('/api/reference-values/characteristic-sku-plan?' + query.toString(), { cache: 'no-store' })
      if (response.headers.get('X-Orders-App-Stale') === '1') {
        throw new Error('Нет свежих данных с сервера. Повторите проверку после восстановления связи.')
      }
      const data = await response.json() as MappingPage & { message?: string }
      if (!response.ok || data.ok !== true) {
        throw new Error(data.message || 'Не удалось загрузить соответствия товаров.')
      }
      const valid = data.kind === kind && data.source?.id === sourceId && data.target?.id === targetId
        && data.canApply === false && data.noChangesApplied === true
        && data.pageSize === PAGE_SIZE && data.afterVariantId === after
        && Array.isArray(data.rows) && data.shownCount === data.rows.length
        && Number.isSafeInteger(data.totalSourceVariants) && data.totalSourceVariants >= 0
        && data.rows.every((row, index) => row.canAutomaticallyMerge === false
          && Number.isSafeInteger(row.sourceVariantId)
          && row.sourceVariantId > (index ? data.rows[index - 1].sourceVariantId : after)
          && Array.isArray(row.reviewReasons)
          && Array.isArray(row.places)
          && row.places.every(place => Number.isSafeInteger(place.sourceShortage)
            && place.sourceShortage >= 0
            && (place.keeperShortage === null || (Number.isSafeInteger(place.keeperShortage)
              && place.keeperShortage >= 0))))
        && (!data.hasMore || (Number.isSafeInteger(data.nextCursor)
          && Number(data.nextCursor) > after
          && Number(data.nextCursor) === data.rows[data.rows.length - 1]?.sourceVariantId))
      if (!valid) throw new Error('Проверка вернула неполные или чужие сведения. Обновите сопоставление.')
      if (request !== latestRequest.current) return
      setPage(data)
      setRows(old => after === 0 ? data.rows : [
        ...old,
        ...data.rows.filter(row => !old.some(existing => existing.sourceVariantId === row.sourceVariantId)),
      ])
    } catch (cause) {
      if (request === latestRequest.current) {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить соответствия.')
      }
    } finally {
      if (request === latestRequest.current) setBusy(false)
    }
  }

  const next = page?.hasMore && Number.isSafeInteger(page.nextCursor) ? page.nextCursor : null
  return (
    <section className="reference-characteristic-map" aria-label="Проверка соответствий вариантов товара">
      <div className="reference-characteristic-map-heading">
        <div>
          <h4>Проверить соответствия товаров по каждой вариации</h4>
          <p>Система сопоставит все варианты с выбранным названием, включая архивные, с вариантами под новым названием. Проверка не меняет товары.</p>
        </div>
        <button type="button" className="secondary compact" disabled={busy}
          onClick={() => {
            if (!expanded) {
              setPage(null)
              setRows([])
              setExpanded(true)
              void load(0)
            } else {
              setExpanded(false)
              latestRequest.current += 1
              setBusy(false)
            }
          }}>
          {expanded ? 'Скрыть соответствия' : 'Посмотреть все соответствия'}
        </button>
      </div>
      {expanded ? (
        <div className="reference-characteristic-map-body">
          <p className="reference-characteristic-map-warning">
            Только предварительная проверка. Даже если найден один подходящий вариант, это не разрешает автоматически объединять остатки, резервы или переписывать заказы.
          </p>
          {busy ? <p role="status">Проверяю варианты…</p> : null}
          {error ? <p className="reference-merge-error" role="alert">{error}
            <button type="button" className="secondary compact" disabled={busy}
              onClick={() => void load(page?.nextCursor && page.hasMore ? page.nextCursor : 0)}>
              Повторить проверку
            </button>
          </p> : null}
          {page ? (
            <>
              <div className="reference-characteristic-map-progress" role="status">
                Показано <strong>{rows.length}</strong> из <strong>{page.totalSourceVariants}</strong> вариантов исходного названия
                {page.hasMore ? ' · есть ещё'
                  : rows.length === page.totalSourceVariants ? ' · список просмотрен полностью'
                  : ' · каталог мог измениться, проверьте заново'}
              </div>
              {rows.length === 0 ? (
                <p className="mini-panel-note">С этим названием вариантов товара не найдено. Нечего сопоставлять.</p>
              ) : (
                <div className="reference-characteristic-map-rows">
                  {rows.map(item => (
                    <article className="reference-characteristic-map-card" key={item.sourceVariantId}>
                      <div className="reference-characteristic-map-card-head">
                        <div>
                          <strong>{item.productName} · вариант #{item.sourceVariantId}</strong>
                          <span>
                            {textOr(item.color, 'Без цвета')} · {textOr(item.material, 'Без материала')}
                            {' · '}{textOr(item.length, 'Без длины')} · {textOr(item.size, 'Без размера')}
                            {' · '}{item.category === 'child' ? 'Детский' : 'Взрослый'}
                            {' · '}{textOr(item.gender, 'Пол не указан')}
                          </span>
                        </div>
                        <span className="reference-characteristic-map-status">{statusLabels[item.status] || 'Требуется проверка'}</span>
                      </div>
                      <p className="reference-characteristic-map-match">
                        {item.status === 'unique_keeper' && item.proposedKeeperId
                          ? 'Возможный основной вариант: #' + item.proposedKeeperId
                          : item.status === 'ambiguous_keepers'
                            ? 'Найдено возможных вариантов: ' + item.candidateCount
                              + '. Примеры номеров: ' + item.possibleKeeperIds.join(', ')
                            : item.status === 'no_keeper'
                              ? 'Подходящего действующего основного варианта пока нет.'
                              : item.status === 'historical'
                                ? 'Архив: сохраняем прежнюю характеристику в истории.'
                                : 'Соответствие требует отдельного разбора исполнения.'}
                      </p>
                      <div className="reference-characteristic-map-locations">
                        {item.places.map(place => (
                          <div key={place.location}>
                            <strong>{placeName(place.location)}</strong>
                            <span>Исходный: {quantity(place.sourcePhysical)} шт. · резерв {quantity(place.sourceReserved)}</span>
                            {place.sourceShortage > 0 ? (
                              <span className="reference-characteristic-map-shortage">Дефицит исходного: {quantity(place.sourceShortage)} шт.</span>
                            ) : null}
                            {place.keeperPhysical !== null && place.keeperReserved !== null ? (
                              <>
                                <span>Возможный основной: {quantity(place.keeperPhysical)} шт. · резерв {quantity(place.keeperReserved)}</span>
                                {place.keeperShortage !== null && place.keeperShortage > 0 ? (
                                  <span className="reference-characteristic-map-shortage">Дефицит основного: {quantity(place.keeperShortage)} шт.</span>
                                ) : null}
                              </>
                            ) : <span>Основной вариант не определён — его остатки неизвестны</span>}
                          </div>
                        ))}
                      </div>
                      <div className="reference-characteristic-map-obligations">
                        <span>Исходный SKU — открытые позиции заказов: <strong>{quantity(item.activeOrderLines)}</strong> · резервы: <strong>{quantity(item.activeReservations)}</strong></span>
                        {item.keeperActiveOrderLines !== null && item.keeperActiveReservations !== null ? (
                          <span>Возможный основной SKU — открытые позиции заказов: <strong>{quantity(item.keeperActiveOrderLines)}</strong> · резервы: <strong>{quantity(item.keeperActiveReservations)}</strong></span>
                        ) : null}
                      </div>
                      {item.reviewReasons.length ? (
                        <div className="reference-characteristic-map-attention">
                          <strong>Нужно урегулировать до будущего объединения:</strong>
                          <ul>{item.reviewReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
                        </div>
                      ) : null}
                      <p className="reference-characteristic-map-guidance">{item.guidance}</p>
                    </article>
                  ))}
                </div>
              )}
              {next !== null ? (
                <button className="secondary compact" type="button" disabled={busy}
                  onClick={() => void load(next)}>
                  {busy ? 'Загружаю…' : 'Показать следующие ' + PAGE_SIZE}
                </button>
              ) : null}
              <p className="reference-characteristic-map-footnote">
                Показатели относятся к моменту запроса. При просмотре нескольких страниц сотрудники могут изменить данные.
                Ни одно соответствие не является разрешением на объединение.
              </p>
            </>
          ) : !busy && !error ? (
            <button type="button" className="secondary compact" onClick={() => void load(0)}>
              Начать проверку
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
