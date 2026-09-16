import { useEffect, useMemo, useState } from 'react'
import { createFinanceDayReader } from './financeDayRead'
import type { FinanceDayFetch, FinanceDayReadState } from './financeDayRead'
import type { FinanceDayEvent, FinanceDayLedger } from '../../../shared/finance-day-contracts'
import { FinanceDayView } from './FinanceDayView'

export function FinanceDayPanel({ date, initialLedger, apiFetch, cashVersion, financeVersion, onOrder }: {
  date: string; initialLedger: FinanceDayLedger; apiFetch: FinanceDayFetch; cashVersion: unknown; financeVersion: unknown; onOrder: (event: FinanceDayEvent) => void
}) {
  const [ledger, setLedger] = useState(initialLedger)
  const [state, setState] = useState<FinanceDayReadState>({ data: null, busy: true, error: '' })
  const reader = useMemo(() => createFinanceDayReader(apiFetch, setState), [apiFetch])
  useEffect(() => {
    void reader.load(date, ledger)
    return reader.dispose
  }, [reader, date, ledger, cashVersion, financeVersion])
  const current = state.data?.date === date && state.data.ledger === ledger ? state.data : null
  if (!current) return <section className="finance-day" aria-live="polite"><strong>{state.error ? 'День не удалось загрузить' : 'Загружаю деньги за выбранный день…'}</strong>{state.error ? <><p>{state.error}</p><button className="secondary" type="button" onClick={() => void reader.load(date, ledger)}>Повторить</button></> : null}</section>
  return <FinanceDayView data={current} busy={state.busy} error={state.error} onLedger={setLedger} onMore={() => void reader.load(date, ledger, true)} onReload={() => void reader.load(date, ledger)} onOrder={onOrder} />
}
