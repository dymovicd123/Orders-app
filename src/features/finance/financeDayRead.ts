import type { FinanceDayLedger, FinanceDayResponse } from '../../../shared/finance-day-contracts'
import { readJsonResponse } from '../../app/utils'

export type FinanceDayReadState = { data: FinanceDayResponse | null; busy: boolean; error: string }
export type FinanceDayFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export function createFinanceDayReader(fetcher: FinanceDayFetch, publish: (state: FinanceDayReadState) => void) {
  let current: FinanceDayReadState = { data: null, busy: false, error: '' }
  let generation = 0
  let controller: AbortController | null = null
  const emit = (state: FinanceDayReadState) => { current = state; publish(state) }
  const dispose = () => { generation++; controller?.abort(); controller = null }
  const load = async (date: string, ledger: FinanceDayLedger, append = false) => {
    if (append && (current.busy || current.data?.date !== date || current.data.ledger !== ledger || !current.data.hasMore)) return
    dispose()
    const request = generation
    const previous = append ? current.data : null
    const abort = new AbortController()
    controller = abort
    emit({ data: previous, busy: true, error: '' })
    try {
      const params = new URLSearchParams({ view: 'day', date, ledger, offset: String(previous?.events.length || 0) })
      const response = await fetcher(`/api/finance/money-history?${params}`, { signal: abort.signal, cache: 'no-store' })
      if (!response.ok || response.headers.get('X-Orders-App-Stale') === '1') throw new Error('Не удалось получить свежие данные. Повторите загрузку.')
      const data = await readJsonResponse<FinanceDayResponse>(response, 'Деньги за день')
      if (!data.ok || data.date !== date || data.ledger !== ledger || !Array.isArray(data.events)) throw new Error('Ответ не соответствует выбранному дню. Обновите данные.')
      if (request !== generation) return
      emit({ data: { ...data, events: previous ? [...previous.events, ...data.events] : data.events }, busy: false, error: '' })
    } catch (error) {
      if (request === generation) emit({ data: previous, busy: false, error: error instanceof Error ? error.message : 'Не удалось загрузить день.' })
    }
  }
  return { load, dispose }
}
