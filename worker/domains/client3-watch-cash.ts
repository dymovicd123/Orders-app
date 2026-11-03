import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'

type Setup={openingAmount?:unknown;requestId?:unknown}
type Movement={direction?:unknown;amount?:unknown;comment?:unknown;requestId?:unknown;
 expectedBalance?:unknown}
type Reconcile={amount?:unknown;comment?:unknown;requestId?:unknown;
 expectedBalance?:unknown}
const error=(message:string,status=409)=>json({ok:false,message},{status})
const exact=(raw:unknown)=>typeof raw==='number'&&Number.isSafeInteger(raw)&&raw>=0&&raw<=1_000_000_000
const businessDate=()=>new Date(Date.now()+5*3600_000).toISOString().slice(0,10)
const parseRequest=(raw:unknown)=>typeof raw==='string'&&/^[a-zA-Z0-9-]{12,100}$/.test(raw)?raw:null
const methodExpr=`UPPER(TRIM(f.payment_method)) IN ('НАЛИЧНЫЕ','CASH','CASH KZT')`
type Register={brand_id:number;opening_amount:number;financial_event_watermark:number;
 initialized_at:string;initialized_by:number;auto_tracking_enabled:number;
 paused_event_id:number|null;paused_at:string|null;cash_entry_watermark:number;cycle_started_at:string|null}
const autoEventClause=`f.id>c.financial_event_watermark AND
 (c.auto_tracking_enabled=1 OR f.id<=COALESCE(c.paused_event_id,0)) AND
 NOT EXISTS (SELECT 1 FROM watch_brand_cash_skipped_events sk
   WHERE sk.brand_id=c.brand_id AND f.id BETWEEN sk.first_event_id AND sk.last_event_id)`
const cashBalanceExpr=`(SELECT c.opening_amount +
  (SELECT COALESCE(SUM(e.amount_delta),0) FROM watch_brand_cash_entries e
    WHERE e.brand_id=c.brand_id AND e.id>c.cash_entry_watermark) +
  (SELECT COALESCE(SUM(f.amount_delta),0) FROM financial_events f
    JOIN watch_order_details wd ON wd.order_id=f.order_id
    WHERE wd.brand_id=c.brand_id AND ${autoEventClause} AND ${methodExpr})
  FROM watch_brand_cash_registers c WHERE c.brand_id=?)`
async function lastBrandEvent(db:D1Database,brandId:number){
 const row=await db.prepare(`SELECT COALESCE(MAX(f.id),0) AS id FROM financial_events f
   JOIN watch_order_details wd ON wd.order_id=f.order_id
   WHERE wd.brand_id=?`).bind(brandId).first<{id:number}>()
 return Number(row?.id||0)
}

/** Main cash ledger semantics, but NEVER aggregate a global Main cash_register
 * across Client3's two physically independent watch brands.
 * Business money is read from financial_events, recorded once by Main; manual
 * entries exist in an independent idempotent watch_brand_cash_entries table.
 */
export async function getWatchBrandCash(db:D1Database,actor:AuthUser,brandId:number){
 if(actor.role!=='admin')return error('Просмотр и операции кассы доступны администратору.',403)
 const setup=await db.prepare(`SELECT * FROM watch_brand_cash_registers WHERE brand_id=?`)
   .bind(brandId).first<Register>()
 if(!setup)return json({ok:true,initialized:false,entries:[],currentBalance:null,
   message:'Установите фактический начальный остаток наличных для этого бренда.'})
 const date=businessDate()
 const [automatic,manual,events,entries,cycles]=await Promise.all([
   db.prepare(`SELECT
     COALESCE(SUM(f.amount_delta),0) AS net,
     COALESCE(SUM(CASE WHEN f.amount_delta>0 THEN f.amount_delta ELSE 0 END),0) AS incoming,
     COALESCE(-SUM(CASE WHEN f.amount_delta<0 THEN f.amount_delta ELSE 0 END),0) AS outgoing,
     COALESCE(SUM(CASE WHEN f.event_date=? AND f.amount_delta>0 THEN f.amount_delta ELSE 0 END),0) AS todayIn,
     COALESCE(-SUM(CASE WHEN f.event_date=? AND f.amount_delta<0 THEN f.amount_delta ELSE 0 END),0) AS todayOut
     FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
     JOIN watch_brand_cash_registers c ON c.brand_id=wd.brand_id
     WHERE wd.brand_id=? AND ${autoEventClause} AND ${methodExpr}`)
     .bind(date,date,brandId).first<Record<string,number>>(),
   db.prepare(`SELECT
      COALESCE(SUM(amount_delta),0) AS net,
      COALESCE(SUM(CASE WHEN amount_delta>0 THEN amount_delta ELSE 0 END),0) AS incoming,
      COALESCE(-SUM(CASE WHEN amount_delta<0 THEN amount_delta ELSE 0 END),0) AS outgoing,
      COALESCE(SUM(CASE WHEN business_date=? AND amount_delta>0 THEN amount_delta ELSE 0 END),0) AS todayIn,
      COALESCE(-SUM(CASE WHEN business_date=? AND amount_delta<0 THEN amount_delta ELSE 0 END),0) AS todayOut
      FROM watch_brand_cash_entries WHERE brand_id=? AND id>?`)
      .bind(date,date,brandId,setup.cash_entry_watermark).first<Record<string,number>>(),
   db.prepare(`SELECT f.id,f.event_date AS businessDate,f.amount_delta AS amountDelta,
       f.event_type AS type,f.external_order_id AS externalOrderId,
       f.payment_method AS method,f.comment
     FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
     JOIN watch_brand_cash_registers c ON c.brand_id=wd.brand_id
     WHERE wd.brand_id=? AND ${autoEventClause} AND ${methodExpr}
     ORDER BY f.id DESC LIMIT 100`)
      .bind(brandId).all<Record<string,unknown>>(),
   db.prepare(`SELECT id,business_date AS businessDate,amount_delta AS amountDelta,
       entry_type AS type,comment,created_at AS createdAt,reverses_entry_id AS reversesEntryId
     FROM watch_brand_cash_entries WHERE brand_id=? AND id>? ORDER BY id DESC LIMIT 100`)
      .bind(brandId,setup.cash_entry_watermark).all<Record<string,unknown>>(),
   db.prepare(`SELECT id,started_at AS startedAt,finished_at AS finishedAt,
       opening_amount AS openingAmount,closing_balance AS closingBalance,comment
     FROM watch_brand_cash_cycles WHERE brand_id=?
     ORDER BY id DESC LIMIT 30`).bind(brandId).all<Record<string,unknown>>(),,
 ])
 const automaticNet=Number(automatic?.net||0),manualNet=Number(manual?.net||0)
 const opening=Number(setup.opening_amount||0)
 return json({ok:true,initialized:true,initializedAt:setup.initialized_at,
   openingAmount:opening,autoTrackingEnabled:setup.auto_tracking_enabled===1,
   cycles:cycles.results||[],cycleStartedAt:setup.cycle_started_at||setup.initialized_at,
   currentBalance:opening+automaticNet+manualNet,
   totalIn:opening+Number(automatic?.incoming||0)+Number(manual?.incoming||0),
   totalOut:Number(automatic?.outgoing||0)+Number(manual?.outgoing||0),
   todayIn:Number(automatic?.todayIn||0)+Number(manual?.todayIn||0),
   todayOut:Number(automatic?.todayOut||0)+Number(manual?.todayOut||0),
   entries:[...(events.results||[]),...(entries.results||[])]
     .sort((a,b)=>String(b.createdAt||b.businessDate||'')
       .localeCompare(String(a.createdAt||a.businessDate||''))).slice(0,150),
   cashMethods:['НАЛИЧНЫЕ','CASH','CASH KZT'],
   note:'Только реальные наличные: открытый остаток + новые финансовые события с наличным методом + ручные операции.'})
}

export async function setupWatchBrandCash(db:D1Database,actor:AuthUser,brandId:number,input:Setup){
 if(actor.role!=='admin')return error('Только администратор может открыть кассу.',403)
 if(!exact(input.openingAmount))return error('Укажите целый начальный остаток от 0 до 1 млрд ₸.',400)
 const existing=await db.prepare('SELECT brand_id FROM watch_brand_cash_registers WHERE brand_id=?')
   .bind(brandId).first()
 if(existing)return error('Касса уже инициализирована. Используйте сверку, а не повторное открытие.')
 const baseline=await db.prepare(`SELECT COALESCE(MAX(f.id),0) AS id
   FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
   WHERE wd.brand_id=?`).bind(brandId).first<{id:number}>()
 const done=await db.prepare(`INSERT OR IGNORE INTO watch_brand_cash_registers
   (brand_id,opening_amount,financial_event_watermark,initialized_at,initialized_by)
   VALUES (?,?,?,?,?)`)
  .bind(brandId,input.openingAmount,Number(baseline?.id||0),
    new Date().toISOString(),actor.id).run()
 if(Number(done.meta?.changes||0)!==1)return error('Касса уже открыта другим сотрудником. Обновите страницу.')
 return getWatchBrandCash(db,actor,brandId)
}

async function recorded(db:D1Database,brandId:number,requestId:string){
 return db.prepare(`SELECT id,entry_type,amount_delta,comment
   FROM watch_brand_cash_entries WHERE brand_id=? AND request_id=?`)
  .bind(brandId,requestId).first<{id:number;entry_type:string;amount_delta:number;comment:string}>()
}

async function insertMovement(db:D1Database,actor:AuthUser,brandId:number,
 requestId:string,delta:number,kind:string,comment:string,expected:number){
 // Single SQLite statement: serialized balance predicate avoids concurrent
 // double-spends and considers skipped financial events and cycle boundaries.
 const q=`INSERT OR IGNORE INTO watch_brand_cash_entries
 (brand_id,request_id,entry_type,amount_delta,business_date,comment,actor_user_id,created_at)
 SELECT ?,?,?,?,?,?,?,? WHERE ?=${cashBalanceExpr}
 AND (? >= 0 OR ? <= ${cashBalanceExpr})`
 const result=await db.prepare(q).bind(brandId,requestId,kind,delta,businessDate(),
    comment,actor.id,new Date().toISOString(),expected,brandId,delta,Math.abs(delta),brandId).run()
 return Number(result.meta?.changes||0)===1
}

export async function writeWatchBrandCash(db:D1Database,actor:AuthUser,brandId:number,
 action:'manual'|'reconcile',input:Movement|Reconcile,
){
 if(actor.role!=='admin')return error('Операции наличных разрешены только администратору.',403)
 const requestId=parseRequest(input.requestId)
 const comment=typeof input.comment==='string'?input.comment.trim():''
 if(!requestId||comment.length<3||comment.length>500)
   return error('Укажите комментарий и корректный идентификатор операции.',400)
 const existing=await recorded(db,brandId,requestId)
 if(existing)return getWatchBrandCash(db,actor,brandId)
 const before=await getWatchBrandCash(db,actor,brandId)
 const state=await before.json() as {ok:boolean;initialized:boolean;currentBalance:number|null}
 if(!state.initialized||state.currentBalance===null)return error('Сначала откройте кассу.')
 const expected=Number(input.expectedBalance)
 if(!Number.isSafeInteger(expected)||expected!==state.currentBalance)
   return error('Касса изменилась. Обновите текущий остаток перед операцией.')
 let delta=0,kind=''
 if(action==='manual'){
   const value=(input as Movement).amount
   const direction=(input as Movement).direction
   if(!exact(value)||Number(value)===0||!['in','out'].includes(String(direction)))
     return error('Укажите положительную целую сумму и направление внесения или выдачи.',400)
   delta=Number(value)*(direction==='out'?-1:1)
   kind=direction==='out'?'manual_out':'manual_in'
 }else{
   if(!exact(input.amount))return error('Укажите фактический остаток от 0 до 1 млрд ₸.',400)
   delta=Number(input.amount)-state.currentBalance
   kind=delta<0?'reconcile_out':'reconcile_in'
   if(delta===0)return getWatchBrandCash(db,actor,brandId)
 }
 if(delta<0&&-delta>state.currentBalance)return error('Недостаточно наличных для выдачи.')
 const ok=await insertMovement(db,actor,brandId,requestId,delta,kind,comment,expected)
 if(!ok){
   const replay=await recorded(db,brandId,requestId)
   if(!replay)return error('Касса была изменена другим сотрудником. Обновите и повторите.')
 }
 return getWatchBrandCash(db,actor,brandId)
}

/** Main cash auto tracking with a deliberate no-catchup gap:
 * order cash movements posted while paused will NEVER be imported on resume.
 * Cash is brand-scoped and preserves the last already counted event.
 */
export async function setWatchBrandCashAuto(db:D1Database,actor:AuthUser,
 brandId:number,enabled:unknown){
 if(actor.role!=='admin')return error('Управлять автоучётом может только администратор.',403)
 if(typeof enabled!=='boolean')return error('Укажите состояние автоучёта.',400)
 const before=await db.prepare('SELECT * FROM watch_brand_cash_registers WHERE brand_id=?')
   .bind(brandId).first<Register>()
 if(!before)return error('Сначала откройте кассу.')
 if(Boolean(before.auto_tracking_enabled)===enabled)return getWatchBrandCash(db,actor,brandId)
 const now=new Date().toISOString()
 if(!enabled){
  const watermark=await lastBrandEvent(db,brandId)
  await db.prepare(`UPDATE watch_brand_cash_registers
     SET auto_tracking_enabled=0,paused_event_id=?,paused_at=?
     WHERE brand_id=? AND auto_tracking_enabled=1`)
   .bind(watermark,now,brandId).run()
 }else{
  const last=await lastBrandEvent(db,brandId)
  const from=Number(before.paused_event_id||0)+1
  const statements:D1PreparedStatement[]=[]
  if(from<=last)statements.push(db.prepare(`INSERT INTO watch_brand_cash_skipped_events
    (brand_id,first_event_id,last_event_id,started_at,ended_at)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM watch_brand_cash_registers
      WHERE brand_id=? AND auto_tracking_enabled=0 AND paused_event_id=?)`)
      .bind(brandId,from,last,before.paused_at||now,now,brandId,before.paused_event_id))
  statements.push(db.prepare(`UPDATE watch_brand_cash_registers
    SET auto_tracking_enabled=1,paused_event_id=NULL,paused_at=NULL
    WHERE brand_id=? AND auto_tracking_enabled=0 AND paused_event_id=?`)
    .bind(brandId,before.paused_event_id))
  await db.batch(statements)
 }
 return getWatchBrandCash(db,actor,brandId)
}
export async function reverseWatchBrandManualCash(
 db:D1Database,actor:AuthUser,brandId:number,input:{
  entryId?:unknown;expectedBalance?:unknown
 }){
 if(actor.role!=='admin')return error('Отменять ручные операции может только администратор.',403)
 const id=Number(input.entryId),expected=Number(input.expectedBalance)
 if(!Number.isSafeInteger(id)||id<=0||!Number.isSafeInteger(expected))
  return error('Укажите операцию и обновлённый остаток.',400)
 const initial=await db.prepare(`SELECT e.id,e.entry_type,e.amount_delta,e.comment,
   e.reverses_entry_id FROM watch_brand_cash_entries e
   JOIN watch_brand_cash_registers c ON c.brand_id=e.brand_id
   WHERE e.id=? AND e.brand_id=? AND e.id>c.cash_entry_watermark`)
   .bind(id,brandId).first<{id:number;entry_type:string;amount_delta:number;
     comment:string;reverses_entry_id:number|null}>()
 if(!initial||!['manual_in','manual_out'].includes(initial.entry_type)||
    initial.reverses_entry_id!==null)
  return error('Отменять можно только ручную операцию текущего цикла.',400)
 const existing=await db.prepare(`SELECT id FROM watch_brand_cash_entries
   WHERE brand_id=? AND reverses_entry_id=?`).bind(brandId,id).first()
 if(existing)return getWatchBrandCash(db,actor,brandId)
 const current=await (await getWatchBrandCash(db,actor,brandId)).json() as {
   initialized:boolean;currentBalance:number
 }
 if(!current.initialized||current.currentBalance!==expected)
  return error('Остаток изменился. Обновите кассу.',409)
 const delta=-Number(initial.amount_delta)
 if(delta<0&&expected<Math.abs(delta))return error('Отмена превышает наличный остаток.',409)
 const kind=delta>0?'manual_in':'manual_out'
 const query=`INSERT OR IGNORE INTO watch_brand_cash_entries
  (brand_id,request_id,entry_type,amount_delta,business_date,comment,actor_user_id,
   created_at,reverses_entry_id)
  SELECT ?,?,?,?,?,?,?,?,? WHERE ?=${cashBalanceExpr}
    AND (? >= 0 OR ? <= ${cashBalanceExpr})
    AND NOT EXISTS(SELECT 1 FROM watch_brand_cash_entries
      WHERE brand_id=? AND reverses_entry_id=?)`
 const res=await db.prepare(query).bind(brandId,'cash-reverse-'+id,kind,delta,businessDate(),
   'Отмена ручной операции #'+id+': '+initial.comment,actor.id,new Date().toISOString(),
   id,expected,brandId,delta,Math.abs(delta),brandId,brandId,id).run()
 if(!res.meta?.changes){
  const duplicate=await db.prepare(`SELECT id FROM watch_brand_cash_entries
    WHERE brand_id=? AND reverses_entry_id=?`).bind(brandId,id).first()
  if(!duplicate)return error('Остаток изменился. Обновите кассу.',409)
 }
 return getWatchBrandCash(db,actor,brandId)
}
export async function resetWatchBrandCashCycle(
 db:D1Database,actor:AuthUser,brandId:number,input:{
 comment?:unknown;requestId?:unknown;expectedBalance?:unknown
 }){
 if(actor.role!=='admin')return error('Новый цикл кассы может начать только администратор.',403)
 const requestId=parseRequest(input.requestId),comment=typeof input.comment==='string'?input.comment.trim():''
 const expected=Number(input.expectedBalance)
 if(!requestId||comment.length<3||comment.length>500||!Number.isSafeInteger(expected))
  return error('Подтвердите остаток и укажите причину нового цикла.',400)
 const exists=await db.prepare('SELECT id FROM watch_brand_cash_cycles WHERE brand_id=? AND request_id=?')
   .bind(brandId,requestId).first()
 if(exists)return getWatchBrandCash(db,actor,brandId)
 const state=await (await getWatchBrandCash(db,actor,brandId)).json() as {
  initialized:boolean;currentBalance:number
 }
 if(!state.initialized||state.currentBalance!==expected)
  return error('Остаток изменился, обновите страницу.',409)
 const current=await db.prepare('SELECT * FROM watch_brand_cash_registers WHERE brand_id=?')
   .bind(brandId).first<Register>()
 if(!current)return error('Сначала откройте кассу.')
 const currentEvent=await lastBrandEvent(db,brandId)
 const lastEntry=await db.prepare(`SELECT COALESCE(MAX(id),0) AS id FROM watch_brand_cash_entries
   WHERE brand_id=?`).bind(brandId).first<{id:number}>()
 const now=new Date().toISOString()
 // Atomic archived cycle record + watermark reset; all historical entries,
 // financial events and reversal links remain available for audit.
 const batch=await db.batch([
  db.prepare(`INSERT INTO watch_brand_cash_cycles
    (brand_id,started_at,finished_at,opening_amount,financial_event_watermark,
      cash_entry_watermark,closing_balance,recorded_by,comment,request_id)
    SELECT c.brand_id,COALESCE(c.cycle_started_at,c.initialized_at),?,c.opening_amount,
      c.financial_event_watermark,c.cash_entry_watermark,?,?,?,?
    FROM watch_brand_cash_registers c WHERE c.brand_id=? AND ?=${cashBalanceExpr}`)
      .bind(now,expected,actor.id,comment,requestId,
        brandId,expected,brandId),
  db.prepare(`UPDATE watch_brand_cash_registers SET opening_amount=0,
    financial_event_watermark=?,cash_entry_watermark=?,cycle_started_at=?,
    auto_tracking_enabled=0,paused_event_id=?,paused_at=?
    WHERE brand_id=? AND EXISTS(SELECT 1 FROM watch_brand_cash_cycles
      WHERE brand_id=? AND request_id=?)`).bind(currentEvent,Number(lastEntry?.id||0),
      now,currentEvent,now,brandId,brandId,requestId),
 ])
 if(!batch[0]?.meta?.changes)return error('Касса изменилась. Повторите после обновления.',409)
 return getWatchBrandCash(db,actor,brandId)
}
