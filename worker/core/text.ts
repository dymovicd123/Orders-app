// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import type { ExchangeFinancialAction, ExchangeReturnSource, OrderItemSourceType, ReturnRestockSource, SourceType } from './types.ts'

export function cleanText(value: unknown) {
  return String(value ?? '').trim();
}



export function isTechnicalWorkshopComment(value: unknown) {
  const text = cleanText(value);
  if (!text) return false;
  const lower = text.toLowerCase();
  if (/^создан[ао]?\s+обменом/i.test(text)) return true;
  if (/^создан[ао]?\s+по\s+обмену/i.test(text)) return true;
  if (/^добавлен[ао]?\s+обменом/i.test(text)) return true;
  if (/^создан[ао]?\s+из\s+обмена/i.test(text)) return true;
  if (/^created\s+by\s+exchange/i.test(text)) return true;
  if (/^exchange\s+generated/i.test(text)) return true;
  if (/exc-\d{8}-\d{4,6}-\d+/i.test(text) && (lower.includes('обмен') || lower.includes('exchange'))) return true;
  return false;
}


export function workshopOnlyComment(value: unknown) {
  const text = cleanText(value);
  return isTechnicalWorkshopComment(text) ? '' : text;
}


export function isEnabledFlag(value: unknown) {
  const text = cleanText(value).toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}


export function upperText(value: unknown) {
  return cleanText(value).toUpperCase();
}


export function canonicalPaymentMethodName(value: unknown) {
  const method = upperText(value).replace(/\s+/g, ' ');
  if (!method) return '—';
  if (method === 'КАСПИЙ МАГАЗИН' || method === 'KASPI МАГАЗИН') return 'КАСПИ МАГАЗИН';
  return method;
}


export function normalizeImportConfirmText(value: unknown) {
  return cleanText(value).replace(/\u00a0/g, ' ').trim().replace(/\s+/g, ' ').toUpperCase();
}


export function normalizeEmployeeRole(value: unknown) {
  const text = upperText(value);
  return text.includes('АДМИН') || text.includes('ADMIN') ? 'Админ' : 'Менеджер';
}


export function normalizePhone(value: unknown) {
  return cleanText(value).replace(/\D+/g, '');
}


export function toInt(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}


export function normalizeDate(value: unknown) {
  const text = cleanText(value);
  if (!text) return new Date().toISOString().slice(0, 10);
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const ru = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (ru) {
    const year = ru[3].length === 2 ? `20${ru[3]}` : ru[3];
    return `${year}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}`;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}


export function normalizeSourceType(value: unknown): 'warehouse' | 'boutique' {
  return cleanText(value).toLowerCase() === 'boutique' ? 'boutique' : 'warehouse';
}


export function normalizeReturnRestockSource(value: unknown): ReturnRestockSource {
  const text = cleanText(value).toLowerCase();
  if (text === 'warehouse' || text === 'склад') return 'warehouse';
  if (text === 'boutique' || text === 'бутик') return 'boutique';
  return 'none';
}


export function normalizeExchangeReturnSource(value: unknown): ExchangeReturnSource {
  return normalizeReturnRestockSource(value);
}


export function normalizeExchangeFinancialAction(value: unknown): ExchangeFinancialAction {
  const text = cleanText(value).toLowerCase();
  if (text === 'extra_payment' || text === 'extra' || text === 'доплата') return 'extra_payment';
  if (text === 'refund' || text === 'return' || text === 'возврат') return 'refund';
  return 'none';
}


export function normalizeOrderItemSourceType(value: unknown, fallback: SourceType): OrderItemSourceType {
  const text = cleanText(value).toLowerCase();
  if (text === 'workshop' || text === 'цех') return 'workshop';
  if (text === 'boutique' || text === 'бутик') return 'boutique';
  if (text === 'warehouse' || text === 'склад') return 'warehouse';
  return fallback;
}


export function normalizeAudienceCategory(value: unknown, size: unknown): 'adult' | 'child' {
  const text = cleanText(value).toLowerCase();
  if (text === 'child' || text === 'детский' || text.includes('дет')) return 'child';
  const sizeText = cleanText(size);
  const sizeNumber = Number(sizeText);
  if (Number.isInteger(sizeNumber) && sizeNumber >= 1 && sizeNumber <= 12) return 'child';
  return 'adult';
}


export function canonicalStockPositionValue(value: unknown) {
  return upperText(value) || 'СТАНДАРТ';
}


export function normalizeWorkshopStatus(value: unknown): 'in_workshop' | 'ready' | 'shipped' | 'cancelled' {
  const text = cleanText(value).toLowerCase();
  if (text === 'ready' || text === 'готово') return 'ready';
  if (text === 'shipped' || text === 'отгружен') return 'shipped';
  if (text === 'cancelled' || text === 'отменён' || text === 'отменен') return 'cancelled';
  return 'in_workshop';
}



export function normalizeOrderStatus(value: unknown): 'active' | 'closed' | 'archived' | 'deleted' {
  const text = cleanText(value).toLowerCase();
  if (text === 'closed' || text === 'закрыт') return 'closed';
  if (text === 'archived' || text === 'архив') return 'archived';
  if (text === 'deleted' || text === 'удалён' || text === 'удален') return 'deleted';
  return 'active';
}


export function normalizeShippingStatus(value: unknown): 'not_sent' | 'sent' {
  const text = cleanText(value).toLowerCase();
  if (text === 'sent' || text === 'отправлено' || text === 'отправлен') return 'sent';
  return 'not_sent';
}


export function normalizeCatalogCategory(value: unknown) {
  return cleanText(value).toLowerCase() === 'child' || cleanText(value).toLowerCase() === 'детский'
    ? 'child'
    : 'adult';
}


export function normalizeStatusFilter(value: unknown) {
  const text = cleanText(value).toLowerCase();
  if (['active', 'активные', 'активен'].includes(text)) return 'active';
  if (['closed', 'закрытые', 'закрыт'].includes(text)) return 'closed';
  if (['archived', 'архив'].includes(text)) return 'archived';
  if (['returned', 'возврат'].includes(text)) return 'returned';
  return 'all';
}


export function normalizeShippingFilter(value: unknown) {
  const text = cleanText(value).toLowerCase();
  if (['sent', 'отправлено', 'отправлен'].includes(text)) return 'sent';
  if (['not_sent', 'not sent', 'не отправлено', 'не отправлен'].includes(text)) return 'not_sent';
  return 'all';
}


export function normalizeArchiveMode(value: unknown): 'active' | 'archived' | 'all' {
  const text = cleanText(value).toLowerCase();
  if (text === 'archived' || text === 'archive' || text === 'архив') return 'archived';
  if (text === 'all' || text === 'все' || text === 'all_with_archive') return 'all';
  return 'active';
}


export function isArchivedOrder(order: unknown) {
  const anyOrder = order as Record<string, unknown> | null;
  return cleanText(anyOrder?.order_status).toLowerCase() === 'archived';
}
