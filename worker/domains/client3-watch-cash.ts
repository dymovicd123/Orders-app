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
 initialized_at:string;initialized_by:number}

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
 const [automatic,manual,events,entries]=await Promise.all([
   db.prepare(`SELECT
     COALESCE(SUM(f.amount_delta),0) AS net,
     COALESCE(SUM(CASE WHEN f.amount_delta>0 THEN f.amount_delta ELSE 0 END),0) AS incoming,
     COALESCE(-SUM(CASE WHEN f.amount_delta<0 THEN f.amount_delta ELSE 0 END),0) AS outgoing,
     COALESCE(SUM(CASE WHEN f.event_date=? AND f.amount_delta>0 THEN f.amount_delta ELSE 0 END),0) AS todayIn,
     COALESCE(-SUM(CASE WHEN f.event_date=? AND f.amount_delta<0 THEN f.amount_delta ELSE 0 END),0) AS todayOut
     FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
     WHERE wd.brand_id=? AND f.id>? AND ${methodExpr}`)
     .bind(date,date,brandId,setup.financial_event_watermark).first<Record<string,number>>(),
   db.prepare(`SELECT
      COALESCE(SUM(amount_delta),0) AS net,
      COALESCE(SUM(CASE WHEN amount_delta>0 THEN amount_delta ELSE 0 END),0) AS incoming,
      COALESCE(-SUM(CASE WHEN amount_delta<0 THEN amount_delta ELSE 0 END),0) AS outgoing,
      COALESCE(SUM(CASE WHEN business_date=? AND amount_delta>0 THEN amount_delta ELSE 0 END),0) AS todayIn,
      COALESCE(-SUM(CASE WHEN business_date=? AND amount_delta<0 THEN amount_delta ELSE 0 END),0) AS todayOut
      FROM watch_brand_cash_entries WHERE brand_id=?`)
      .bind(date,date,brandId).first<Record<string,number>>(),
   db.prepare(`SELECT f.id,f.event_date AS businessDate,f.amount_delta AS amountDelta,
       f.event_type AS type,f.external_order_id AS externalOrderId,
       f.payment_method AS method,f.comment
     FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
     WHERE wd.brand_id=? AND f.id>? AND ${methodExpr}
     ORDER BY f.id DESC LIMIT 100`)
      .bind(brandId,setup.financial_event_watermark).all<Record<string,unknown>>(),
   db.prepare(`SELECT id,business_date AS businessDate,amount_delta AS amountDelta,
       entry_type AS type,comment,created_at AS createdAt
     FROM watch_brand_cash_entries WHERE brand_id=? ORDER BY id DESC LIMIT 100`)
      .bind(brandId).all<Record<string,unknown>>(),
 ])
 const automaticNet=Number(automatic?.net||0),manualNet=Number(manual?.net||0)
 const opening=Number(setup.opening_amount||0)
 return json({ok:true,initialized:true,initializedAt:setup.initialized_at,
   openingAmount:opening,autoTrackingEnabled:true,
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
 // Atomic SQL predicate on the ledger + business financial events avoids
 // double-spend during concurrent manual cash-outs on D1.
 const result=await db.prepare(`
 INSERT OR IGNORE INTO watch_brand_cash_entries(
   brand_id,request_id,entry_type,amount_delta,business_date,comment,actor_user_id,created_at)
 SELECT ?,?,?,?,?,?,?,?
 WHERE ?=(
   SELECT c.opening_amount+
     (SELECT COALESCE(SUM(e.amount_delta),0) FROM watch_brand_cash_entries e
       WHERE e.brand_id=c.brand_id)+
     (SELECT COALESCE(SUM(f.amount_delta),0)
        FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
        WHERE wd.brand_id=c.brand_id AND f.id>c.financial_event_watermark
          AND ${methodExpr})
   FROM watch_brand_cash_registers c WHERE c.brand_id=?
 ) AND (? >= 0 OR
   ? <= (
     SELECT c.opening_amount+
       (SELECT COALESCE(SUM(e.amount_delta),0) FROM watch_brand_cash_entries e
         WHERE e.brand_id=c.brand_id)+
       (SELECT COALESCE(SUM(f.amount_delta),0)
          FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
          WHERE wd.brand_id=c.brand_id AND f.id>c.financial_event_watermark
            AND ${methodExpr})
     FROM watch_brand_cash_registers c WHERE c.brand_id=?
   ))`
 ).bind(brandId,requestId,kind,delta,businessDate(),comment,actor.id,
    new Date().toISOString(),expected,brandId,delta,Math.abs(delta),brandId).run()
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
