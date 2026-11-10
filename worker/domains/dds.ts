import { activeDdsArticle, readDdsDirectory } from './dds-directory.ts'
import type { AuthUser } from '../core/types.ts'

export type DdsKind = 'funding' | 'expense' | 'reversal_funding' | 'reversal_expense'
type DdsInput = {
  amount?: unknown; businessDate?: unknown; category?: unknown; article?: unknown
  comment?: unknown; requestId?: unknown
}
type DdsRow = {
  id: number; request_id: string; kind: DdsKind; amount: number; business_date: string
  category: string; article: string; comment: string
  reverses_entry_id: number | null; created_by_user_id: number | null; created_at: string
}
function invalid(message: string, status = 400) {
  const error = new Error(message) as Error & { status: number }
  error.status = status
  return error
}
function text(value: unknown) { return typeof value === 'string' ? value.trim() : '' }
function businessToday() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date())
  const get = (type: string) => parts.find(item => item.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
function validDate(value: unknown) {
  const date = text(value)
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) throw invalid('Укажите правильную дату расхода.')
  const parsed = new Date(date + 'T00:00:00Z')
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > businessToday())
    throw invalid('Дата расхода должна быть существующей датой, не позднее сегодняшней.')
  return date
}
function requestId(value: unknown) {
  const id = text(value)
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(id)) throw invalid('Не удалось определить операцию. Обновите страницу.')
  return id
}
function amount(value: unknown) {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n <= 0 || n > 1_000_000_000)
    throw invalid('Укажите сумму целым числом тенге от 1 до 1 000 000 000.')
  return n
}
function checkRole(actor: AuthUser | null, adminOnly = false) {
  if (!actor || (actor.role !== 'admin' && actor.role !== 'manager'))
    throw invalid('Доступ к ДДС ограничен сотрудниками.', 403)
  if (adminOnly && actor.role !== 'admin') throw invalid('Пополнять и отменять записи ДДС может только администратор.', 403)
}
const rowSelect = `SELECT id, request_id, kind, amount, business_date, category, article, comment,
  reverses_entry_id, created_by_user_id, created_at FROM dds_entries`
function sameEntry(old: DdsRow, expected: Omit<DdsRow,'id' | 'created_by_user_id' | 'created_at'>) {
  return old.kind === expected.kind && Number(old.amount) === expected.amount
    && old.business_date === expected.business_date && old.category === expected.category
    && old.article === expected.article && old.comment === expected.comment
    && Number(old.reverses_entry_id || 0) === Number(expected.reverses_entry_id || 0)
}
async function insertEntry(db: D1Database, input: Omit<DdsRow,'id' | 'created_by_user_id' | 'created_at'>, actor: AuthUser) {
  const query = db.prepare(rowSelect + ' WHERE request_id = ?')
  const replay = await query.bind(input.request_id).first<DdsRow>()
  if (replay) {
    if (!sameEntry(replay, input)) throw invalid('Операция с таким номером уже существует с другими данными.', 409)
    return { ok: true, id: replay.id, alreadySaved: true }
  }
  try {
    const result = await db.prepare(`INSERT INTO dds_entries
      (request_id,kind,amount,business_date,category,article,comment,reverses_entry_id,created_by_user_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(
      input.request_id, input.kind, input.amount, input.business_date,
      input.category, input.article, input.comment, input.reverses_entry_id,
      actor.id, new Date().toISOString(),
    ).run()
    return { ok: true, id: Number(result.meta?.last_row_id || 0), alreadySaved: false }
  } catch (error) {
    const existing = await query.bind(input.request_id).first<DdsRow>()
    if (existing) {
      if (!sameEntry(existing, input)) throw invalid('Операция с таким номером уже существует с другими данными.', 409)
      return { ok: true, id: existing.id, alreadySaved: true }
    }
    const reason = String(error)
    if (reason.includes('DDS_INSUFFICIENT_FUNDS')) throw invalid('Недостаточно денег в ДДС. Попросите администратора пополнить остаток.', 409)
    if (reason.includes('DDS_INVALID_ARTICLE')) throw invalid('Статья больше недоступна. Обновите справочник ДДС.', 409)
    if (input.reverses_entry_id && /unique|constraint/i.test(reason))
      throw invalid('Эта запись уже отменена. Обновите журнал.', 409)
    throw error
  }
}
export async function addDdsFunds(db: D1Database, input: DdsInput, actor: AuthUser | null) {
  checkRole(actor, true)
  const value = amount(input.amount)
  const date = validDate(input.businessDate)
  const id = requestId(input.requestId)
  const comment = text(input.comment).slice(0, 500)
  return insertEntry(db, {
    request_id: id, kind: 'funding', amount: value, business_date: date,
    category: '', article: '', comment, reverses_entry_id: null,
  }, actor!)
}
export async function addDdsExpense(db: D1Database, input: DdsInput, actor: AuthUser | null) {
  checkRole(actor)
  const value = amount(input.amount)
  const date = validDate(input.businessDate)
  const id = requestId(input.requestId)
  const category = text(input.category), article = text(input.article)
  if (!(await activeDdsArticle(db, category, article))) throw invalid('Выберите действующую статью из справочника ДДС.')
  const comment = text(input.comment).slice(0, 500)
  if ((category.startsWith('Зарплата') || article === 'Прочее') && !comment)
    throw invalid('Укажите в комментарии сотрудника или назначение расхода.')
  return insertEntry(db, {
    request_id: id, kind: 'expense', amount: value, business_date: date,
    category, article, comment, reverses_entry_id: null,
  }, actor!)
}
export async function reverseDdsEntry(db: D1Database, originId: number, input: { requestId?: unknown; comment?: unknown }, actor: AuthUser | null) {
  checkRole(actor, true)
  if (!Number.isSafeInteger(originId) || originId <= 0) throw invalid('Неверный номер записи.')
  const origin = await db.prepare(rowSelect + ' WHERE id = ?').bind(originId).first<DdsRow>()
  if (!origin || !['funding','expense'].includes(origin.kind)) throw invalid('Исходная операция не найдена.', 404)
  const id = requestId(input.requestId)
  const note = text(input.comment).slice(0, 500)
  if (note.length < 3) throw invalid('Укажите причину отмены не короче трёх символов.')
  const old = await db.prepare('SELECT id,request_id FROM dds_entries WHERE reverses_entry_id = ?').bind(originId).first<{id:number;request_id:string}>()
  if (old && old.request_id !== id) throw invalid('Эта запись уже отменена.', 409)
  return insertEntry(db, {
    request_id: id,
    kind: origin.kind === 'funding' ? 'reversal_funding' : 'reversal_expense',
    amount: origin.amount, business_date: businessToday(),
    category: '', article: '', comment: note, reverses_entry_id: originId,
  }, actor!)
}
export async function readDdsMonth(db: D1Database, monthInput: unknown, actor: AuthUser | null) {
  checkRole(actor)
  const month = text(monthInput) || businessToday().slice(0,7)
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw invalid('Выберите корректный месяц.')
  const from = month + '-01'
  const until = month === '2099-12' ? '2100-01-01' : (
    (Number(month.slice(5,7)) === 12 ? Number(month.slice(0,4))+1 : Number(month.slice(0,4))) +
    '-' + String(Number(month.slice(5,7)) === 12 ? 1 : Number(month.slice(5,7))+1).padStart(2,'0') + '-01'
  )
  const signed = `CASE kind WHEN 'funding' THEN amount WHEN 'reversal_expense' THEN amount
    WHEN 'expense' THEN -amount WHEN 'reversal_funding' THEN -amount END`
  const totals = await db.prepare(`SELECT
    COALESCE(SUM(${signed}),0) AS current_balance,
    COALESCE(SUM(CASE WHEN business_date < ? THEN ${signed} ELSE 0 END),0) AS opening_balance,
    COALESCE(SUM(CASE WHEN business_date >= ? AND business_date < ? AND kind = 'funding' THEN amount
      WHEN business_date >= ? AND business_date < ? AND kind = 'reversal_funding' THEN -amount ELSE 0 END),0) AS month_added,
    COALESCE(SUM(CASE WHEN business_date >= ? AND business_date < ? AND kind = 'expense' THEN amount
      WHEN business_date >= ? AND business_date < ? AND kind = 'reversal_expense' THEN -amount ELSE 0 END),0) AS month_spent
    FROM dds_entries`).bind(from,from,until,from,until,from,until,from,until).first<{
      current_balance:number;opening_balance:number;month_added:number;month_spent:number
    }>()
  const grouped = await db.prepare(`SELECT
      CASE WHEN e.kind='expense' THEN e.category ELSE origin.category END AS category,
      CASE WHEN e.kind='expense' THEN e.article ELSE origin.article END AS article,
      SUM(CASE WHEN e.kind='expense' THEN e.amount ELSE -e.amount END) AS amount
    FROM dds_entries e LEFT JOIN dds_entries origin ON origin.id=e.reverses_entry_id
    WHERE e.business_date >= ? AND e.business_date < ? AND e.kind IN ('expense','reversal_expense')
    GROUP BY 1,2 HAVING SUM(CASE WHEN e.kind='expense' THEN e.amount ELSE -e.amount END) != 0 ORDER BY SUM(CASE WHEN e.kind='expense' THEN e.amount ELSE -e.amount END) DESC,1,2`)
    .bind(from,until).all<{category:string;article:string;amount:number}>()
  const lines = await db.prepare(`SELECT e.id,e.kind,e.amount,e.business_date AS businessDate,
    CASE WHEN e.kind LIKE 'reversal_%' THEN origin.category ELSE e.category END AS category,
    CASE WHEN e.kind LIKE 'reversal_%' THEN origin.article ELSE e.article END AS article,
    e.comment,e.created_at AS createdAt,e.reverses_entry_id AS reversesEntryId,
    EXISTS (SELECT 1 FROM dds_entries r WHERE r.reverses_entry_id=e.id) AS reversed
    FROM dds_entries e LEFT JOIN dds_entries origin ON origin.id=e.reverses_entry_id
    WHERE e.business_date >= ? AND e.business_date < ?
    ORDER BY e.business_date DESC,e.id DESC LIMIT 2000`).bind(from,until).all()
  const directory = await readDdsDirectory(db,actor)
  const allNames = [...directory.map(item=>item.name), ...(grouped.results||[]).map(item=>item.category).filter(name=>!directory.some(dir=>dir.name===name))]
  const opening = Number(totals?.opening_balance||0), added = Number(totals?.month_added||0), spent=Number(totals?.month_spent||0)
  return {
    ok: true, month, currentBalance: Number(totals?.current_balance||0),
    openingBalance: opening, monthAdded: added, monthSpent: spent,
    closingBalance: opening+added-spent,
    categories: allNames.map(name => ({
      name,
      total: (grouped.results||[]).filter(row => row.category===name).reduce((s,row)=>s+Number(row.amount||0),0),
      articles: (grouped.results||[]).filter(row => row.category===name)
        .map(row => ({name:row.article,amount:Number(row.amount||0)})),
    })),
    directory,
    entries: lines.results || [],
  }
}
