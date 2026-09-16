export type FinanceDayLedger = 'money' | 'cash'
export type FinanceDayEvent = {
  id: number
  orderId: number | null
  externalOrderId: string
  customer: string
  actor: string
  businessDate: string
  recordedAt: string | null
  recordedLater: boolean
  originalRecordedAtUnknown: boolean
  eventTimeKnown: boolean
  operation: string
  amount: number
  method: string
  methodKind: 'cash' | 'noncash' | 'unknown'
  comment: string
  correction: boolean
}
export type FinanceDayResponse = {
  ok: true
  date: string
  ledger: FinanceDayLedger
  payments: { total: number; cash: number; methods: Array<{ method: string; kind: FinanceDayEvent['methodKind']; total: number; count: number }> }
  cash: { in: number; out: number; net: number; correctionIn: number; correctionOut: number; opening: number }
  reconciliation: { status: 'matched' | 'different' | 'limited'; paymentsCash: number; historyIn: number; historyOut: number; registerIn: number; registerOut: number }
  count: number
  lateCount: number
  offset: number
  hasMore: boolean
  events: FinanceDayEvent[]
}
