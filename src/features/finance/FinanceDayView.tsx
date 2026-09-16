import type { FinanceDayEvent, FinanceDayLedger, FinanceDayResponse } from '../../../shared/finance-day-contracts'
import './finance-day.css'

export function financeDayDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('.') : 'Дата не указана'
}
export function financeRecordedAt(value: string | null) {
  if (!value) return 'Время ввода не сохранено'
  // SQLite timestamps without an explicit offset are UTC, not the browser's local zone.
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? 'Время ввода не сохранено' : new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date)
}
type Props = {
  data: FinanceDayResponse
  busy: boolean
  error: string
  onReload: () => void
  onMore: () => void
  onLedger: (ledger: FinanceDayLedger) => void
  onOrder: (event: FinanceDayEvent) => void
}
export function FinanceDayView({ data, busy, error, onReload, onMore, onLedger, onOrder }: Props) {
  const money = (amount: number) => `${new Intl.NumberFormat('ru-RU').format(amount)} ₸`
  const signed = (amount: number) => `${amount < 0 ? '−' : '+'} ${money(Math.abs(amount))}`
  const check = data.reconciliation
  return <section className="finance-day" aria-label={`Деньги за ${financeDayDate(data.date)}`} aria-busy={busy}>
    <div className="finance-day-heading"><div><h3>Деньги за {financeDayDate(data.date)}</h3><p>Оплаты, наличные и история исправлений — отдельно. Время показано по Казахстану.</p></div><button type="button" className="secondary compact" disabled={busy} onClick={onReload}>{busy ? 'Загружаю…' : 'Обновить день'}</button></div>
    <div className="finance-day-totals">
      <article><span>Оплаты за день — все способы</span><strong>{money(data.payments.total)}</strong><small>с учётом исправлений; без ручных внесений в кассу</small></article>
      <article><span>Наличные: поступления</span><strong>{signed(data.cash.in)}</strong><small>оплаты и ручные внесения по журналу</small></article>
      <article><span>Наличные: выдачи и возвраты</span><strong>− {money(data.cash.out)}</strong><small>передача денег и возвраты клиентам</small></article>
      <article><span>Изменение наличных по учёту</span><strong>{signed(data.cash.net)}</strong><small>с учётом отмен и корректировок; не остаток в кассе</small></article>
    </div>
    {data.cash.correctionIn || data.cash.correctionOut ? <p className="finance-day-note">Отдельные отмены и корректировки наличных: + {money(data.cash.correctionIn)}, − {money(data.cash.correctionOut)}. Это изменения учёта, а не подтверждение повторного получения или выдачи денег.</p> : null}
    {data.cash.opening !== 0 ? <p className="finance-day-note">Начальный остаток {money(data.cash.opening)} показан в истории и не включён в поступления за день.</p> : null}
    <div className="finance-day-methods" aria-label="Оплаты по способам">
      {data.payments.methods.map(method => <div key={method.method}><span className={`finance-day-kind ${method.kind}`}>{method.kind === 'cash' ? 'Наличные' : method.kind === 'noncash' ? 'Безналичные' : 'Способ не указан'}</span><span>{method.method}</span><strong>{money(method.total)}</strong></div>)}
      {!data.payments.methods.length ? <p>Оплат, относящихся к этому дню, нет.</p> : null}
    </div>
    <div className={`finance-day-check ${check.status === 'different' ? 'needs-review' : ''}`}>
      <strong>{check.status === 'matched' ? 'Итоги наличных по оплатам и истории совпадают' : check.status === 'different' ? 'Есть различия в учёте наличных' : 'Есть исправления или перенесённые записи'}</strong>
      <p>Наличные оплаты за день: {money(check.paymentsCash)}. В истории оплат: + {money(check.historyIn)}, возвраты − {money(check.historyOut)}. В кассовом журнале по заказам: + {money(check.registerIn)}, − {money(check.registerOut)}.</p>
      <p>{check.status === 'matched' ? 'Сопоставлены поступления и возвраты по каждому заказу. Ручные внесения и выдачи учтены отдельно в карточках выше.' : 'Это не доказательство пропажи денег. Сравните даты, способы оплаты и отдельные исправления в журналах ниже; ничего не меняйте только ради совпадения сумм.'}</p>
    </div>
    <div className="finance-day-journal-heading"><div className="finance-day-switch" role="group" aria-label="Журнал за день">
      <button type="button" className="secondary compact" aria-pressed={data.ledger === 'money'} onClick={() => onLedger('money')}>Оплаты, возвраты, исправления</button>
      <button type="button" className="secondary compact" aria-pressed={data.ledger === 'cash'} onClick={() => onLedger('cash')}>Все движения наличных</button>
    </div><p>Записей: {data.count}. Внесено позже выбранного дня: {data.lateCount}.</p></div>
    <p className="finance-day-note">{data.ledger === 'money' ? 'История сохраняет исходные оплаты и их исправления. Суммировать только положительные строки нельзя — актуальные оплаты показаны выше.' : 'Здесь только наличные, включая ручные выдачи и прошлые циклы. Наличные оплаты из первого журнала не являются вторым поступлением.'} Сначала записи со временем выбранного дня, затем записи другого или неизвестного времени.</p>
    <div className="finance-day-events" tabIndex={0} role="region" aria-label="Операции выбранного дня">
      {data.events.map(event => <article className={`finance-day-event ${event.correction ? 'is-correction' : ''}`} key={`${data.ledger}:${event.id}`}>
        <div><strong>{event.operation}</strong><span>Относится к {financeDayDate(event.businessDate)}</span>
          {event.originalRecordedAtUnknown ? <small>Перенесено из старого учёта. Время первоначального ввода неизвестно.</small> : <small>Внесено в систему {financeRecordedAt(event.recordedAt)}</small>}
          {event.recordedLater ? <span className="finance-day-late">Внесено позже</span> : null}
        </div>
        <div><strong>{event.externalOrderId || 'Без заказа'}</strong>{event.customer ? <span>{event.customer}</span> : null}
          {event.actor ? <small>{data.ledger === 'money' ? 'Менеджер заказа' : 'Записал'}: {event.actor}</small> : null}
          {event.comment ? <small>{event.comment}</small> : null}
          {event.orderId ? <button type="button" className="secondary compact" onClick={() => onOrder(event)}>Открыть заказ</button> : null}
        </div>
        <div className="finance-day-event-amount"><span className={`finance-day-kind ${event.methodKind}`}>{event.methodKind === 'cash' ? 'Наличные' : event.methodKind === 'noncash' ? 'Безналичные' : 'Способ не указан'}</span><span>{event.method}</span><strong>{signed(event.amount)}</strong></div>
      </article>)}
      {!data.events.length ? <p className="empty-state">В этом журнале за выбранный день записей нет.</p> : null}
    </div>
    {error ? <p role="alert">{error} <button type="button" className="secondary compact" disabled={busy} onClick={onMore}>Повторить загрузку продолжения</button></p> : null}
    {data.hasMore ? <button type="button" className="secondary" disabled={busy} onClick={onMore}>{busy ? 'Загружаю…' : `Показать ещё · загружено ${data.events.length} из ${data.count}`}</button> : null}
  </section>
}
