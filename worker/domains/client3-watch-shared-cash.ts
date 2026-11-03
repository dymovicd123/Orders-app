import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'

type Input=Record<string,unknown>
type Register={id:number;opening_amount:number;financial_event_watermark:number;
 initialized_at:string;initialized_by:number;auto_tracking_enabled:number;
 paused_event_id:number|null;paused_at:string|null;cash_entry_watermark:number;
 cycle_started_at:string}
const error=(message:string,status=409)=>json({ok:false,message},{status})
const validMoney=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=1_000_000_000
const idOk=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{12,100}$/.test(v)
const day=()=>new Date(Date.now()+5*3600_000).toISOString().slice(0,10)
const cashMethod=`UPPER(TRIM(f.payment_method)) IN ('НАЛИЧНЫЕ','CASH','CASH KZT')`
const eventPredicate=`f.id>c.financial_event_watermark
 AND (c.auto_tracking_enabled=1 OR f.id<=COALESCE(c.paused_event_id,0))
 AND NOT EXISTS (SELECT 1 FROM watch_shared_cash_skipped_events sk
   WHERE f.id BETWEEN sk.first_event_id AND sk.last_event_id)
 AND ${cashMethod}`
const balanceExpr=`(SELECT c.opening_amount +
 (SELECT COALESCE(SUM(e.amount_delta),0) FROM watch_shared_cash_entries e
   WHERE e.id>c.cash_entry_watermark) +
 (SELECT COALESCE(SUM(f.amount_delta),0) FROM financial_events f
   JOIN watch_order_details wd ON wd.order_id=f.order_id
   WHERE ${eventPredicate})
 FROM watch_shared_cash_register c WHERE c.id=1)`
const fetchRegister=(db:D1Database)=>db.prepare('SELECT * FROM watch_shared_cash_register WHERE id=1').first<Register>()
const eventMax=async(db:D1Database)=>{
 const x=await db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM financial_events').first<{id:number}>()
 return Number(x?.id||0)
}
const entryMax=async(db:D1Database)=>{
 const x=await db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM watch_shared_cash_entries').first<{id:number}>()
 return Number(x?.id||0)
}
async function snapshot(db:D1Database,actor:AuthUser){
 if(actor.role!=='admin')return error('Касса доступна только администратору.',403)
 const c=await fetchRegister(db)
 if(!c)return json({ok:true,initialized:false,currentBalance:null,entries:[],
  legacyEntries:[],cycles:[],note:'Укажите фактический остаток общей кассы.'})
 const [events,manual,autoTotals,manualTotals,cycles,legacy]=await Promise.all([
  db.prepare(`SELECT f.id,f.event_date AS businessDate,f.amount_delta AS amountDelta,
      f.event_type AS type,f.external_order_id AS externalOrderId,f.comment,
      b.code AS brand,f.created_at AS createdAt
    FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
    JOIN watch_brands b ON b.id=wd.brand_id
    JOIN watch_shared_cash_register c ON c.id=1
    WHERE ${eventPredicate} ORDER BY f.id DESC LIMIT 150`).all<Record<string,unknown>>(),
  db.prepare(`SELECT id,business_date AS businessDate,amount_delta AS amountDelta,
      entry_type AS type,comment,created_at AS createdAt,
      reverses_entry_id AS reversesEntryId,'ОБЩАЯ' AS brand
    FROM watch_shared_cash_entries WHERE id>?
    ORDER BY id DESC LIMIT 150`).bind(c.cash_entry_watermark).all<Record<string,unknown>>(),
  db.prepare(`SELECT COALESCE(SUM(f.amount_delta),0) AS net,
      COALESCE(SUM(CASE WHEN f.amount_delta>0 THEN f.amount_delta ELSE 0 END),0) AS incoming,
      COALESCE(-SUM(CASE WHEN f.amount_delta<0 THEN f.amount_delta ELSE 0 END),0) AS outgoing,
      COALESCE(SUM(CASE WHEN f.event_date=? AND f.amount_delta>0 THEN f.amount_delta ELSE 0 END),0) AS todayIn,
      COALESCE(-SUM(CASE WHEN f.event_date=? AND f.amount_delta<0 THEN f.amount_delta ELSE 0 END),0) AS todayOut
    FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
    JOIN watch_shared_cash_register c ON c.id=1
    WHERE ${eventPredicate}`).bind(day(),day()).first<Record<string,number>>(),
  db.prepare(`SELECT COALESCE(SUM(amount_delta),0) AS net,
      COALESCE(SUM(CASE WHEN amount_delta>0 THEN amount_delta ELSE 0 END),0) AS incoming,
      COALESCE(-SUM(CASE WHEN amount_delta<0 THEN amount_delta ELSE 0 END),0) AS outgoing,
      COALESCE(SUM(CASE WHEN business_date=? AND amount_delta>0 THEN amount_delta ELSE 0 END),0) AS todayIn,
      COALESCE(-SUM(CASE WHEN business_date=? AND amount_delta<0 THEN amount_delta ELSE 0 END),0) AS todayOut
    FROM watch_shared_cash_entries WHERE id>?`).bind(day(),day(),c.cash_entry_watermark).first<Record<string,number>>(),
  db.prepare(`SELECT id,started_at AS startedAt,finished_at AS finishedAt,
      opening_amount AS openingAmount,closing_balance AS closingBalance,comment
    FROM watch_shared_cash_cycles ORDER BY id DESC LIMIT 30`).all<Record<string,unknown>>(),
  db.prepare(`SELECT e.id,e.business_date AS businessDate,e.amount_delta AS amountDelta,
      e.entry_type AS type,e.comment,e.created_at AS createdAt,b.code AS brand
    FROM watch_brand_cash_entries e JOIN watch_brands b ON b.id=e.brand_id
    ORDER BY e.id DESC LIMIT 80`).all<Record<string,unknown>>(),
 ])
 const initial=Number(c.opening_amount||0)
 const a=(autoTotals||{}) as Record<string,number>,m=(manualTotals||{}) as Record<string,number>
 const entries=[...(events.results||[]),...(manual.results||[])]
 entries.sort((x,y)=>String(y.createdAt||y.businessDate||'').localeCompare(String(x.createdAt||x.businessDate||'')))
 return json({ok:true,initialized:true,initializedAt:c.initialized_at,
   openingAmount:initial,currentBalance:initial+Number(a.net||0)+Number(m.net||0),
   todayIn:Number(a.todayIn||0)+Number(m.todayIn||0),
   todayOut:Number(a.todayOut||0)+Number(m.todayOut||0),
   totalIn:initial+Number(a.incoming||0)+Number(m.incoming||0),
   totalOut:Number(a.outgoing||0)+Number(m.outgoing||0),
   autoTrackingEnabled:c.auto_tracking_enabled===1,cycleStartedAt:c.cycle_started_at,
   entries:entries.slice(0,150),legacyEntries:legacy.results||[],cycles:cycles.results||[],
   cashMethods:['НАЛИЧНЫЕ','CASH','CASH KZT'],
   note:'Одна касса для наличных TAUWACH и WACHIZEN. Бренд указан у каждой оплаты. Предыдущие брендовые кассы сохранены в архиве.'})
}
/** One shared register; caller-selected brand is NEVER an input. */
export const getWatchSharedCash=snapshot
export async function setupWatchSharedCash(db:D1Database,actor:AuthUser,input:Input){
 if(actor.role!=='admin')return error('Только администратор может открыть кассу.',403)
 if(!validMoney(input.openingAmount))return error('Укажите целый остаток наличных от 0 до 1 млрд ₸.',400)
 const now=new Date().toISOString()
 const last=await eventMax(db)
 const r=await db.prepare(`INSERT OR IGNORE INTO watch_shared_cash_register
 (id,opening_amount,financial_event_watermark,initialized_at,initialized_by,cycle_started_at)
 VALUES(1,?,?,?,?,?)`).bind(input.openingAmount,last,now,actor.id,now).run()
 if(!r.meta?.changes)return error('Общая касса уже открыта. Обновите страницу.')
 return snapshot(db,actor)
}
export async function writeWatchSharedCash(db:D1Database,actor:AuthUser,
 action:'manual'|'reconcile',input:Input){
 if(actor.role!=='admin')return error('Операции кассы доступны только администратору.',403)
 if(!idOk(input.requestId))return error('Некорректный идентификатор операции.',400)
 const requestId=String(input.requestId)
 const already=await db.prepare('SELECT id FROM watch_shared_cash_entries WHERE request_id=?')
  .bind(requestId).first()
 if(already)return snapshot(db,actor)
 const note=typeof input.comment==='string'?input.comment.trim():''
 if(note.length<3||note.length>500)return error('Укажите причину операции (3–500 символов).',400)
 const read=await (await snapshot(db,actor)).json() as {initialized:boolean;currentBalance:number|null}
 if(!read.initialized||read.currentBalance===null)return error('Общая касса ещё не открыта.')
 const expected=input.expectedBalance
 if(!validMoney(expected)||expected!==read.currentBalance)
   return error('Касса изменилась. Обновите остаток.',409)
 let delta:number,kind:string
 if(action==='manual'){
   if(!validMoney(input.amount)||input.amount===0||
      (input.direction!=='in'&&input.direction!=='out'))
     return error('Укажите положительную сумму и направление.',400)
   delta=Number(input.amount)*(input.direction==='out'?-1:1)
   kind=input.direction==='out'?'manual_out':'manual_in'
 }else{
   if(!validMoney(input.amount))return error('Введите фактический остаток.',400)
   delta=Number(input.amount)-read.currentBalance
   kind=delta<0?'reconcile_out':'reconcile_in'
   if(delta===0)return snapshot(db,actor)
 }
 if(delta<0&&Math.abs(delta)>read.currentBalance)return error('Недостаточно наличных.',409)
 const result=await db.prepare(`INSERT OR IGNORE INTO watch_shared_cash_entries
   (request_id,entry_type,amount_delta,business_date,comment,actor_user_id,created_at)
   SELECT ?,?,?,?,?,?,? WHERE ?=${balanceExpr}
     AND (? >= 0 OR ? <= ${balanceExpr})`)
  .bind(requestId,kind,delta,day(),note,actor.id,new Date().toISOString(),
    expected,delta,Math.abs(delta)).run()
 if(!result.meta?.changes){
  const replay=await db.prepare('SELECT id FROM watch_shared_cash_entries WHERE request_id=?')
   .bind(requestId).first()
  if(!replay)return error('Остаток изменился. Повторите после обновления.',409)
 }
 return snapshot(db,actor)
}
export async function reverseWatchSharedCash(db:D1Database,actor:AuthUser,input:Input){
 if(actor.role!=='admin')return error('Отмена кассовых операций доступна администратору.',403)
 const entryId=Number(input.entryId)
 if(!Number.isSafeInteger(entryId)||entryId<=0)return error('Некорректная операция.',400)
 const source=await db.prepare(`SELECT e.id,e.entry_type,e.amount_delta,e.comment
   FROM watch_shared_cash_entries e JOIN watch_shared_cash_register c ON c.id=1
   WHERE e.id=? AND e.id>c.cash_entry_watermark`)
  .bind(entryId).first<{id:number;entry_type:string;amount_delta:number;comment:string}>()
 if(!source||!['manual_in','manual_out'].includes(source.entry_type))
  return error('Отмена доступна для ручного внесения и выдачи текущего цикла.',400)
 const exists=await db.prepare('SELECT id FROM watch_shared_cash_entries WHERE reverses_entry_id=?')
  .bind(entryId).first()
 if(exists)return snapshot(db,actor)
 const state=await (await snapshot(db,actor)).json() as {initialized:boolean;currentBalance:number|null}
 const expected=input.expectedBalance
 if(!validMoney(expected)||state.currentBalance!==expected)return error('Остаток изменился.',409)
 const delta=-source.amount_delta
 if(delta<0&&expected<Math.abs(delta))return error('Недостаточно наличных для отмены.',409)
 const res=await db.prepare(`INSERT OR IGNORE INTO watch_shared_cash_entries
 (request_id,entry_type,amount_delta,business_date,comment,actor_user_id,created_at,reverses_entry_id)
 SELECT ?,?,?,?,?,?,?,? WHERE ?=${balanceExpr}
   AND (? >= 0 OR ? <= ${balanceExpr})
   AND NOT EXISTS(SELECT 1 FROM watch_shared_cash_entries WHERE reverses_entry_id=?)`)
  .bind('shared-reverse-'+entryId,'manual_reversal',delta,day(),
    'Отмена ручной операции #'+entryId+': '+source.comment,actor.id,new Date().toISOString(),
    entryId,expected,delta,Math.abs(delta),entryId).run()
 if(!res.meta?.changes){
  const replay=await db.prepare('SELECT id FROM watch_shared_cash_entries WHERE reverses_entry_id=?')
   .bind(entryId).first()
  if(!replay)return error('Остаток изменился.',409)
 }
 return snapshot(db,actor)
}
export async function setWatchSharedCashAuto(db:D1Database,actor:AuthUser,enabled:unknown){
 if(actor.role!=='admin')return error('Управление автоучётом доступно администратору.',403)
 if(typeof enabled!=='boolean')return error('Некорректное состояние автоучёта.',400)
 const c=await fetchRegister(db)
 if(!c)return error('Касса ещё не открыта.')
 if(Boolean(c.auto_tracking_enabled)===enabled)return snapshot(db,actor)
 const now=new Date().toISOString(),latest=await eventMax(db)
 if(!enabled){
  await db.prepare(`UPDATE watch_shared_cash_register SET auto_tracking_enabled=0,
    paused_event_id=?,paused_at=? WHERE id=1 AND auto_tracking_enabled=1`)
   .bind(latest,now).run()
 }else{
  const start=Number(c.paused_event_id||0)+1
  const work:D1PreparedStatement[]=[]
  if(start<=latest)work.push(db.prepare(`INSERT INTO watch_shared_cash_skipped_events
    (first_event_id,last_event_id,started_at,ended_at)
    SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM watch_shared_cash_register
      WHERE id=1 AND auto_tracking_enabled=0 AND paused_event_id=?)`)
    .bind(start,latest,c.paused_at||now,now,c.paused_event_id))
  work.push(db.prepare(`UPDATE watch_shared_cash_register SET auto_tracking_enabled=1,
    paused_event_id=NULL,paused_at=NULL
    WHERE id=1 AND auto_tracking_enabled=0 AND paused_event_id=?`).bind(c.paused_event_id))
  await db.batch(work)
 }
 return snapshot(db,actor)
}
export async function resetWatchSharedCashCycle(db:D1Database,actor:AuthUser,input:Input){
 if(actor.role!=='admin')return error('Новый цикл кассы доступен администратору.',403)
 if(!idOk(input.requestId))return error('Некорректный идентификатор цикла.',400)
 const comment=typeof input.comment==='string'?input.comment.trim():''
 if(comment.length<3||comment.length>500)return error('Укажите причину нового цикла.',400)
 const prev=await db.prepare('SELECT id FROM watch_shared_cash_cycles WHERE request_id=?')
   .bind(input.requestId).first()
 if(prev)return snapshot(db,actor)
 const state=await (await snapshot(db,actor)).json() as {initialized:boolean;currentBalance:number|null}
 if(!state.initialized||!validMoney(input.expectedBalance)||state.currentBalance!==input.expectedBalance)
  return error('Остаток изменился. Обновите кассу.',409)
 const maxEvent=await eventMax(db),maxEntry=await entryMax(db),now=new Date().toISOString()
 const batch=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO watch_shared_cash_cycles
    (started_at,finished_at,opening_amount,financial_event_watermark,cash_entry_watermark,
      closing_balance,recorded_by,comment,request_id)
    SELECT c.cycle_started_at,?,c.opening_amount,c.financial_event_watermark,
      c.cash_entry_watermark,?,?,?,?
    FROM watch_shared_cash_register c WHERE c.id=1 AND ?=${balanceExpr}`)
   .bind(now,input.expectedBalance,actor.id,comment,input.requestId,input.expectedBalance),
  db.prepare(`UPDATE watch_shared_cash_register SET opening_amount=0,
    financial_event_watermark=?,cash_entry_watermark=?,cycle_started_at=?,
    auto_tracking_enabled=0,paused_event_id=?,paused_at=?
    WHERE id=1 AND EXISTS(SELECT 1 FROM watch_shared_cash_cycles WHERE request_id=?)`)
   .bind(maxEvent,maxEntry,now,maxEvent,now,input.requestId),
 ])
 if(!batch[0]?.meta?.changes)return error('Касса изменилась.',409)
 return snapshot(db,actor)
}
