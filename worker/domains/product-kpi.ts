// Independent monthly product quota and bonus preview; never writes payroll or financial events.
import { cleanText, toInt } from '../core/text.ts'
import { mapSqlRows } from '../core/sql.ts'
import type { AuthUser } from '../core/types.ts'

type Filter = 'category' | 'gender' | 'color' | 'material' | 'length' | 'size'
const filterKeys: Filter[] = ['category','gender','color','material','length','size']
const stockColumns: Record<Filter,string> = {
  category: "UPPER(TRIM(COALESCE(oi.audience_type,'ВЗРОСЛЫЙ')))",
  gender: "UPPER(TRIM(COALESCE(oi.gender_snapshot,'')))",
  color: "UPPER(TRIM(COALESCE(oi.color_snapshot,'')))",
  material: "UPPER(TRIM(COALESCE(oi.material_snapshot,'СТАНДАРТ')))",
  length: "UPPER(TRIM(COALESCE(oi.length_snapshot,'СТАНДАРТ')))",
  size: "UPPER(TRIM(COALESCE(oi.size_snapshot,'')))",
}
const err = (message:string): never => { throw new Error(message) }
const int = (x:unknown,label:string,allowZero=false,max=10000000):number => {
  const v = Number(x)
  if (!Number.isSafeInteger(v) || v < (allowZero?0:1) || v>max) return err(label+': нужно целое допустимое число.')
  return v
}
const monthValue = (x:unknown):string => {
  const m=cleanText(x)
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return err('Выберите месяц KPI.')
  return m
}
function endOfMonth(m:string) {
  const [y,n]=m.split('-').map(Number)
  return m+'-'+String(new Date(Date.UTC(y,n,0)).getUTCDate()).padStart(2,'0')
}
function normalizedFilters(value:unknown):Record<Filter,string> {
  const o=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
  const v={} as Record<Filter,string>
  for(const k of filterKeys)v[k]=cleanText(o[k]).toUpperCase().slice(0,100)
  return v
}
function parseFilters(s:unknown) {
  try{return normalizedFilters(JSON.parse(cleanText(s)||'{}'))}
  catch{return normalizedFilters({})}
}
async function snapshot(db:D1Database,id:number) {
  const row=await db.prepare('SELECT * FROM product_kpis WHERE id=?').bind(id).first<any>()
  if(!row)return null
  const parts=mapSqlRows(await db.prepare('SELECT manager_id,quota,bonus_amount FROM product_kpi_participants WHERE kpi_id=? ORDER BY manager_id').bind(id).all<any>())
  return {...row,participants:parts}
}
export async function saveProductKpi(db:D1Database,input:any,actor:string) {
  const id=input.id?int(input.id,'KPI'):0
  const month=monthValue(input.month), productId=int(input.productId,'Товар')
  const total=int(input.targetQuantity,'Общая цель',false,100000)
  const filters=normalizedFilters(input.filters)
  const title=cleanText(input.title).slice(0,120)
  if(!Array.isArray(input.participants)||!input.participants.length||input.participants.length>60)return err('Выберите участников KPI.')
  const parts=input.participants.map((p:any)=>({
    managerId:int(p.managerId,'Менеджер'),quota:int(p.quota,'Квота',false,100000),
    bonusAmount:int(p.bonusAmount,'Бонус',true,100000000),
  }))
  if(new Set(parts.map((p:any)=>p.managerId)).size!==parts.length)return err('Менеджеры повторяются.')
  if(parts.reduce((sum:number,p:any)=>sum+p.quota,0)!==total)return err('Сумма квот не совпадает с общей целью.')
  const product=await db.prepare('SELECT name FROM catalog_products WHERE id=? AND is_active=1').bind(productId).first<any>()
  if(!product)return err('Выберите действующую модель из каталога.')
  const validManagers=mapSqlRows(await db.prepare("SELECT id FROM managers WHERE id IN (SELECT value FROM json_each(?)) AND is_active=1 AND UPPER(TRIM(COALESCE(role,''))) IN ('МЕНЕДЖЕР','MANAGER')").bind(JSON.stringify(parts.map((p:any)=>p.managerId))).all<any>())
  if(validManagers.length!==parts.length)return err('Можно назначать только активных менеджеров.')
  const specified=filterKeys.filter(k=>filters[k])
  if(specified.length){
    const variants=mapSqlRows(await db.prepare('SELECT category,gender,color,material,length,size_label FROM catalog_variants WHERE product_id=? AND is_active=1').bind(productId).all<any>())
    const matches=variants.some((v:any)=>specified.every(k=>{
      const value=k==='size'?v.size_label:k==='category'?(v.category==='child'?'ДЕТСКИЙ':'ВЗРОСЛЫЙ'):v[k]
      return cleanText(value).toUpperCase()===filters[k]
    }))
    if(!matches)return err('В каталоге не найдено ни одного действующего варианта с такими характеристиками.')
  }
  const before=id?await snapshot(db,id):null
  if(id&&!before)return err('KPI не найден.')
  if(id&&cleanText(before.updated_at)!==cleanText(input.expectedUpdatedAt))return err('KPI уже изменён. Обновите страницу.')
  const now=new Date().toISOString(), kpiTitle=title||cleanText(product.name)
  let newId=id
  if(!id){
    const inserted=await db.prepare('INSERT INTO product_kpis(month,title,product_id,filters_json,target_quantity,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(month,kpiTitle,productId,JSON.stringify(filters),total,now,now).run()
    newId=toInt(inserted.meta?.last_row_id,0)
    if(!newId)return err('KPI не удалось создать.')
  }
  try {
    const statements:D1PreparedStatement[]=[]
    if(id)statements.push(db.prepare('UPDATE product_kpis SET month=?,title=?,product_id=?,filters_json=?,target_quantity=?,updated_at=? WHERE id=? AND updated_at=?').bind(month,kpiTitle,productId,JSON.stringify(filters),total,now,id,before.updated_at))
    if(id)statements.push(db.prepare('DELETE FROM product_kpi_participants WHERE kpi_id=?').bind(id))
    for(const part of parts)statements.push(db.prepare('INSERT INTO product_kpi_participants(kpi_id,manager_id,quota,bonus_amount) VALUES(?,?,?,?)').bind(newId,part.managerId,part.quota,part.bonusAmount))
    await db.batch(statements)
  } catch(e) {
    if(!id)await db.prepare('DELETE FROM product_kpis WHERE id=?').bind(newId).run()
    throw e
  }
  try {
    await db.prepare('INSERT INTO product_kpi_audit(kpi_id,event_type,actor,before_json,after_json,created_at) VALUES(?,?,?,?,?,?)').bind(newId,id?'updated':'created',actor,before?JSON.stringify(before):null,JSON.stringify(await snapshot(db,newId)),now).run()
  } catch(e) { console.warn('KPI audit after committed write failed',e) }
  return {ok:true,id:newId}
}
export async function removeProductKpi(db:D1Database,id:number,actor:string){
  const before=await snapshot(db,id)
  if(!before)return err('KPI не найден.')
  await db.batch([
    db.prepare('INSERT INTO product_kpi_audit(kpi_id,event_type,actor,before_json,created_at) VALUES(?,?,?,?,?)').bind(id,'deleted',actor,JSON.stringify(before),new Date().toISOString()),
    db.prepare('DELETE FROM product_kpis WHERE id=?').bind(id),
  ])
  return {ok:true,id}
}
export async function listProductKpis(db:D1Database,monthParam:unknown,user:AuthUser){
  const month=monthValue(monthParam), admin=user.role==='admin', managerId=toInt(user.managerId,0)
  const rows=mapSqlRows(await db.prepare(
    'SELECT k.id,k.month,k.title,k.product_id,k.filters_json,k.target_quantity,k.updated_at,p.name AS product_name FROM product_kpis k JOIN catalog_products p ON p.id=k.product_id WHERE k.month=?'+(admin?'':' AND EXISTS(SELECT 1 FROM product_kpi_participants t WHERE t.kpi_id=k.id AND t.manager_id=?)')+' ORDER BY k.id DESC LIMIT 150'
  ).bind(...(admin?[month]:[month,managerId])).all<any>())
  const records=[]
  for(const row of rows){
    const parts=mapSqlRows(await db.prepare(
      'SELECT kp.manager_id,m.name AS manager,kp.quota,kp.bonus_amount FROM product_kpi_participants kp JOIN managers m ON m.id=kp.manager_id WHERE kp.kpi_id=?'+(admin?'':' AND kp.manager_id=?')+' ORDER BY m.name'
    ).bind(...(admin?[row.id]:[row.id,managerId])).all<any>())
    const filters=parseFilters(row.filters_json)
    const activeFilters=filterKeys.filter(k=>filters[k])
    const where=activeFilters.map(k=>stockColumns[k]+' = ?').join(' AND ')
    const sql=[
      'WITH returns_by_item AS (',
      'SELECT ri.order_item_id, SUM(ri.quantity) AS returned',
      'FROM return_items ri JOIN returns r ON r.id=ri.return_id',
      "WHERE COALESCE(r.status,'completed')<>'cancelled'",
      "AND NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.refund_return_id=r.id AND COALESCE(e.status,'completed')<>'cancelled')",
      'GROUP BY ri.order_item_id)',
      'SELECT o.manager_id AS manager_id, SUM(MAX(0,oi.quantity-COALESCE(ret.returned,0))) AS quantity',
      'FROM orders o JOIN order_items oi ON oi.order_id=o.id',
      'LEFT JOIN returns_by_item ret ON ret.order_item_id=oi.id',
      "WHERE o.shipping_status='sent' AND o.order_status<>'deleted'",
      'AND o.shipping_date BETWEEN ? AND ? AND oi.product_id=? AND oi.quantity>0',
      where?'AND '+where:'',
      'GROUP BY o.manager_id',
    ].join(' ')
    const result=mapSqlRows(await db.prepare(sql).bind(month+'-01',endOfMonth(month),row.product_id,...activeFilters.map(k=>filters[k])).all<any>())
    const sold=new Map(result.map((r:any)=>[toInt(r.manager_id,0),toInt(r.quantity,0)]))
    records.push({
      id:toInt(row.id,0),month:cleanText(row.month),title:cleanText(row.title),
      productId:toInt(row.product_id,0),productName:cleanText(row.product_name),
      filters,targetQuantity:toInt(row.target_quantity,0),updatedAt:cleanText(row.updated_at),
      participants:parts.map((p:any)=>{
        const quota=toInt(p.quota,0),soldQuantity=sold.get(toInt(p.manager_id,0))||0, bonus=toInt(p.bonus_amount,0)
        return {managerId:toInt(p.manager_id,0),manager:cleanText(p.manager),quota,sold:soldQuantity,
          bonusAmount:bonus,achieved:soldQuantity>=quota,earnedBonus:soldQuantity>=quota?bonus:0}
      }),
    })
  }
  return {ok:true,month,records,countingRule:'shipped_net_current_v1'}
}
