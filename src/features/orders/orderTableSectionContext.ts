import type { CSSProperties, Dispatch, SetStateAction } from 'react'
import type { AppSector, OrderPanel, OrderRecord, OrdersFinanceSummaryResponse } from '../../app/types'
import type { createOrderCorrectionsActions } from './orderCorrectionsActions'
import type { createOrderDependentCancellationActions } from './orderDependentCancellationActions'
import type { createOrderEditorActions } from './orderEditorActions'
import type { createOrderEditSessionActions } from './orderEditSessionActions'
import type { createOrderShippingHandoverActions } from './orderShippingHandoverActions'
import type { ManagerBadge } from '../../components/managers/ManagerBadge'
import type { StockResolutionPrompt } from './StockResolutionConfirmModal'
import type { formatDateShort, formatMoney, normalizeSuggestion, shippingStatusLabel, summarizeOrderItemLines, summarizeOrderPaymentLines, waitingDaysLabel } from '../../app/utils'

type Corrections = Pick<ReturnType<typeof createOrderCorrectionsActions>,
  'correctOrderMetadata' | 'correctRecordedOrderItemPrice' | 'correctRecordedOrderItemPrices'
  | 'loadRetiredExchangePriceOptions' | 'correctRetiredExchangePrice'>
type Cancellations = Pick<ReturnType<typeof createOrderDependentCancellationActions>,
  'loadExchangeCancellationPreview' | 'loadOrderExchangeCancellationPlan' | 'cancelOrderExchangeChain'
  | 'loadOrderReturnCancellationChoices' | 'cancelOrderReturnChoice'>
type Shipping = Pick<ReturnType<typeof createOrderShippingHandoverActions>,
  'openOrderStockHandover' | 'markOrderSentToClient' | 'correctMistakenOrderShipping'>
type Editor = Pick<ReturnType<typeof createOrderEditorActions>, 'correctRecordedPaymentMethod'>
type Session = Pick<ReturnType<typeof createOrderEditSessionActions>, 'expandOrderItems' | 'handleEditOrder'>

export type OrderDeleteExchangeLine = {
  id?: number
  name: string
  quantity: number
  source?: string
  color?: string
  size?: string
  material?: string
  length?: string
}

export type OrderDeletePreview = {
  orderId: number
  externalId: string
  canAttemptDelete: boolean
  canStartChain: boolean
  requiresPhysicalFact: boolean
  canPreparePhysicalCorrection?: boolean
  activeExchanges: number[]
  activeReturns: number[]
  receivedAmount: number
  returnAmount: number
  paymentCount: number
  registeredPayments: number
  recordedRefunds: number
  issuedItemCount: number
  issuedQuantity: number
  reasons: string[]
  explanations: string[]
  activeSaga: {requestId:string;status:string;nextStep:number;totalSteps:number} | null
  appliedStockReview?: {
    appliedCount: number
    allowed: boolean
    reversals: Array<{
      eventId: number
      name: string
      source: string
      bookkeepingFulfillmentOnly: boolean
      alreadyCompensated: boolean
      correctionMovementId?: number
      physicalRestore: number
      reserveRelease: number
      exchangeId: number
    }>
  }
  impact: {
    saleAmount: number
    debtAmount: number
    paymentReversal: number
    refundReversal: number
    netMoneyReversal: number
    payments: Array<{id:number;date:string;method:string;amount:number;kind:string}>
    refunds: Array<{id:number;date:string;method:string;amount:number}>
    exchanges: Array<{
      id:number
      financialAction:string
      financialAmount:number
      date?:string
      oldItems?:OrderDeleteExchangeLine[]
      newItems?:OrderDeleteExchangeLine[]
      paymentMethod?:string
      comment?:string
    }>
    reservations: Array<{orderItemId:number;name:string;source:string;quantity:number;status:string;action:string}>
    truncated: boolean
  }
  chainPlan: {
    snapshotFingerprint: string
    steps: Array<{type:'exchange'|'return';id:number;order:number;reason:string;requiresManualReview:boolean}>
    activeExchangeIds:number[]
    activeReturnIds:number[]
    generatedExchangeRefundIds:number[]
    manualReviewRequired:boolean
    canExecuteAutomatically:boolean
    blockers:string[]
  }
}

type ReadOrdersFinanceSummary = OrdersFinanceSummaryResponse & {
  overview: OrdersFinanceSummaryResponse['overview'] & {totalReceived?:number;totalReturns?:number}
}

export type OrderTableSectionContext = Corrections & Cancellations & Shipping & Editor & Session & {
  loadAdminOrderDeletePreview: (order: OrderRecord) => Promise<OrderDeletePreview>
  deleteOrderAsAdmin: (order: OrderRecord, previewAcknowledged?: boolean, expectedSnapshot?: string, physicalOutcome?: 'not_issued') => Promise<boolean>
  executeAdminDeleteChain: (order: OrderRecord, expectedSnapshot: string, onProgress?: (done:number,total:number)=>void, physicalOutcome?:'not_issued') => Promise<boolean>
  confirmAdminDeletePhysicalBeforeChain: (order: OrderRecord, expectedSnapshot:string) => Promise<OrderDeletePreview>
  expandedOrderItemCounts: Record<number, number>
  setExpandedOrderItemCounts: Dispatch<SetStateAction<Record<number,number>>>
  filters: { dateFrom:string; dateTo:string }
  formatDateShort: typeof formatDateShort
  formatMoney: typeof formatMoney
  handleOpenDebt: (order:OrderRecord)=>Promise<unknown>
  handleOpenExchange: (order:OrderRecord)=>Promise<unknown>
  handleOpenReturn: (order:OrderRecord)=>Promise<unknown>
  isAdmin: boolean
  kaspiMode?: boolean
  ManagerBadge: typeof ManagerBadge
  apiFetch: (input:RequestInfo | URL, init?:RequestInit)=>Promise<Response>
  askActionConfirmation: (text:string)=>Promise<boolean>
  askStockResolution: (prompt:StockResolutionPrompt)=>Promise<boolean>
  onShipmentChange: ()=>Promise<unknown>
  setMessage: Dispatch<SetStateAction<string|null>>
  normalizeSuggestion: typeof normalizeSuggestion
  ordinaryOrdersSeparated?:boolean
  orderFinanceBusy: boolean
  orderFinanceReport: ReadOrdersFinanceSummary|null
  orderPanel?: OrderPanel
  orderPanelStyle: (panel:OrderPanel)=>CSSProperties
  orders: OrderRecord[]
  restoreArchivedOrder: (order:OrderRecord)=>Promise<unknown>
  savingOrder: boolean
  sectorStyle: (sector:AppSector)=>CSSProperties
  selectedOrderId: number|null
  shippingStatusLabel: typeof shippingStatusLabel
  suggestionValues: {paymentMethods:string[];cities:string[];deliveryTypes:string[]}
  summarizeOrderItemLines: typeof summarizeOrderItemLines
  summarizeOrderPaymentLines: typeof summarizeOrderPaymentLines
  summary: {total:number;received:number;debt:number;debtOrders:number;returns:number;count:number;active:number;workshop:number;paid:number}
  waitingDaysLabel: typeof waitingDaysLabel
  busy: boolean
  changeOrderPage: (direction:'previous'|'next')=>Promise<unknown>
  orderPageInfo: {offset:number;limit:number;totalCount:number;hasMore:boolean;hasPrevious:boolean}
  workspaceSector?: AppSector
}
