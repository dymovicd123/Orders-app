import { cleanText, toInt } from '../core/text.ts'
import { previewCatalogVariantConsolidation } from './catalog-variant-consolidation.ts'

type Method = 'keep_source' | 'keep_keeper' | 'physical_count'
type InventoryLocation = 'warehouse' | 'boutique'
type Decision = {
  sourceId:number;keeperId:number;location:InventoryLocation;
  method:Method;countedQuantity?:number;
  reason:string;requestId:string;expectedToken:string;
  physicallyVerified:boolean
}
type Sku = {
  id:number;product_id:number;stock_position_id:number|null;category:string|null;
  gender:string|null;color:string|null;size_label:string|null;material:string|null;
  length:string|null;is_active:number;updated_at:string
}
type Stock = {id:number;inventory_source:string;variant_id:number;quantity:number;reserved_quantity:number}
type Journal = {
  request_id:string;source_variant_id:number;keeper_variant_id:number;
  inventory_source:string;decision_method:string;keeper_quantity_after:number;
  reason:string;source_quantity_before:number;keeper_quantity_before:number
}
const safeInt=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0
const allowedMethods=new Set(['keep_source','keep_keeper','physical_count'])

async function replay(db:D1Database,input:Decision,finalQuantity:number) {
  const row=await db.prepare(
    `SELECT request_id,source_variant_id,keeper_variant_id,inventory_source,decision_method,
      keeper_quantity_after,reason,source_quantity_before,keeper_quantity_before
    FROM catalog_stock_reconciliation_journal WHERE request_id=?`
  ).bind(input.requestId).first<Journal>()
  if(!row)return null
  if(row.source_variant_id!==input.sourceId||row.keeper_variant_id!==input.keeperId
    ||row.inventory_source!==input.location||row.decision_method!==input.method
    ||row.keeper_quantity_after!==finalQuantity||row.reason!==input.reason) {
    throw new Error('Этот идентификатор действия уже использован для другой корректировки.')
  }
  return {ok:true,alreadyApplied:true,requestId:row.request_id,sourceId:input.sourceId,
    keeperId:input.keeperId,location:input.location,method:input.method,
    finalQuantity,adjustmentQuantity:finalQuantity-row.source_quantity_before-row.keeper_quantity_before}
}

export async function applyCatalogStockReconciliation(
  db:D1Database,input:Decision,actor:string,
) {
  if(!Number.isSafeInteger(input.sourceId)||input.sourceId<=0
    ||!Number.isSafeInteger(input.keeperId)||input.keeperId<=0||input.sourceId===input.keeperId
    ||!['warehouse','boutique'].includes(input.location)
    ||!allowedMethods.has(input.method))throw new Error('Укажите два совместимых варианта, место хранения и способ сверки.')
  if(!/^[A-Za-z0-9._:-]{12,96}$/.test(input.requestId||'')) {
    throw new Error('Требуется уникальный идентификатор подтверждённой сверки.')
  }
  const reason=cleanText(input.reason)
  const user=cleanText(actor)
  if(reason.length<12||reason.length>500||!user){
    throw new Error('Укажите причину корректировки (не менее 12 символов) и ответственного администратора.')
  }
  if(input.physicallyVerified!==true||!input.expectedToken) {
    throw new Error('Требуется фактическая проверка и новый предпросмотр остатков.')
  }
  if(input.method==='physical_count') {
    if(!safeInt(input.countedQuantity))throw new Error('Фактическое количество должно быть целым неотрицательным числом.')
  }else if(input.countedQuantity!==undefined){
    throw new Error('Фактическое число используется только при выборе физического пересчёта.')
  }
  // Replays must not reapply stock changes; first resolve by the immutable journal.
  // For a physical count we know the final quantity before loading current stock.
  const old=await db.prepare(
    'SELECT * FROM catalog_stock_reconciliation_journal WHERE request_id=?'
  ).bind(input.requestId).first<Journal>()
  if(old) {
    const finalFromRequest=input.method==='physical_count'?input.countedQuantity!:old.keeper_quantity_after
    return await replay(db,{...input,reason},finalFromRequest)
  }

  const preview=await previewCatalogVariantConsolidation(db,input.sourceId,input.keeperId)
  if(input.expectedToken!==preview.stateToken){
    throw new Error('Склад или заказы изменились после предпросмотра. Получите актуальные количества.')
  }
  if(preview.blockers.length)throw new Error('Корректировка пока невозможна: '+preview.blockers.join('; '))
  // First conservative stage: never adjust a balance while it supports a
  // customer promise or either SKU has a reversible operational dependency.
  const reasons:string[]=[]
  for(const impact of [preview.sourceImpact,preview.targetImpact]) {
    if(impact.activeOrders||impact.activeReservations||impact.reserved){
      reasons.push('Есть открытые заказы или действующие резервы.')
    }
    if(impact.activeWorkshop||impact.pendingLifecycle||impact.appliedLifecycle
      ||impact.activeStocktake||impact.appliedTransfers
      ||impact.reversibleMovements||impact.returnExchangeLinks){
      reasons.push('Есть незавершённая либо обратимая операция склада, цеха, обмена или возврата.')
    }
  }
  if(reasons.length)throw new Error('Сначала урегулируйте связи: '+[...new Set(reasons)].join(' '))
  const balances=await db.prepare(
    `SELECT id,inventory_source,variant_id,quantity,reserved_quantity
     FROM inventory_stock
     WHERE variant_id IN (?,?) AND inventory_source=?
     ORDER BY id`
  ).bind(input.sourceId,input.keeperId,input.location).all<Stock>()
  const rows=balances.results||[]
  const source=rows.find(r=>r.variant_id===input.sourceId)
  const keeper=rows.find(r=>r.variant_id===input.keeperId)
  if(rows.length!==2||!source||!keeper||source.id===keeper.id) {
    throw new Error('Нужно отдельно сверить эту точку: отсутствует одна из двух складских записей.')
  }
  if([source.quantity,keeper.quantity,source.reserved_quantity,keeper.reserved_quantity]
    .some(n=>!safeInt(n)))throw new Error('Отрицательные или повреждённые остатки требуют отдельной ревизии.')
  if(source.quantity===0)throw new Error('У лишнего варианта здесь уже нулевой остаток. Корректировка не требуется.')
  if(source.reserved_quantity!==0||keeper.reserved_quantity!==0){
    throw new Error('Нельзя корректировать остатки, пока существуют резервы.')
  }
  const finalQuantity=input.method==='keep_source'?source.quantity
    :input.method==='keep_keeper'?keeper.quantity:input.countedQuantity!
  if(!safeInt(finalQuantity))throw new Error('Фактическое количество выходит за безопасные пределы.')
  if(!safeInt(source.quantity+keeper.quantity)){
    throw new Error('Сумма остатков превышает безопасный диапазон.')
  }
  const snapshots=await db.prepare(
    `SELECT id,product_id,stock_position_id,category,gender,color,size_label,material,
      length,is_active,updated_at FROM catalog_variants WHERE id IN (?,?)`
  ).bind(input.sourceId,input.keeperId).all<Sku>()
  const v=(snapshots.results||[]).find(row=>row.id===input.sourceId)
  const k=(snapshots.results||[]).find(row=>row.id===input.keeperId)
  if(!v||!k||!v.is_active||!k.is_active){
    throw new Error('Одна из вариаций стала неактивной. Обновите предпросмотр.')
  }
  const current=await replay(db,{...input,reason},finalQuantity)
  if(current)return current
  const stamp=new Date().toISOString()
  const journalCheck=`EXISTS (SELECT 1 FROM catalog_stock_reconciliation_journal j
    WHERE j.request_id=? AND j.source_variant_id=? AND j.keeper_variant_id=? AND j.inventory_source=?)`
  const operationalBlock=`
    AND NOT EXISTS (SELECT 1 FROM inventory_reservations r WHERE r.variant_id IN (v.id,k.id)
      AND r.status='active')
    AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
      WHERE oi.variant_id IN (v.id,k.id) AND COALESCE(o.order_status,'active')='active'
        AND COALESCE(o.shipping_status,'not_sent')<>'sent' AND oi.quantity>0)
    AND NOT EXISTS (SELECT 1 FROM workshop_tasks wt WHERE wt.variant_id IN (v.id,k.id) AND wt.status='active')
    AND NOT EXISTS (SELECT 1 FROM inventory_lifecycle_events e
      WHERE e.variant_id IN (v.id,k.id) AND e.status IN ('pending','applied'))
    AND NOT EXISTS (SELECT 1 FROM inventory_stocktake_sessions sess
      WHERE sess.inventory_source=s.inventory_source AND sess.status='active')
    AND NOT EXISTS (SELECT 1 FROM inventory_stocktake_items i
      JOIN inventory_stocktake_sessions sess ON sess.id=i.session_id
      WHERE i.variant_id IN (v.id,k.id) AND sess.status='active')
    AND NOT EXISTS (SELECT 1 FROM inventory_transfer_items i
      JOIN inventory_transfer_documents d ON d.id=i.transfer_id
      WHERE i.variant_id IN (v.id,k.id) AND d.status='applied')
    AND NOT EXISTS (SELECT 1 FROM inventory_movements m
      WHERE m.variant_id IN (v.id,k.id)
        AND LOWER(TRIM(COALESCE(m.reference_type,''))) IN ('manual','transfer_in','transfer_out')
        AND NOT EXISTS (SELECT 1 FROM inventory_movement_reversals rev WHERE rev.original_movement_id=m.id))
    AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.variant_id IN (v.id,k.id) AND (
      EXISTS(SELECT 1 FROM return_items ri WHERE ri.order_item_id=oi.id)
      OR EXISTS(SELECT 1 FROM exchanges e WHERE e.old_order_item_id=oi.id OR e.new_order_item_id=oi.id)
      OR EXISTS(SELECT 1 FROM exchange_items ei WHERE ei.order_item_id=oi.id)))
  `
  const fields=(alias:string)=>[
    'product_id','stock_position_id','category','gender','color','size_label','material',
    'length','is_active','updated_at',
  ].map(name=>alias+'.'+name+' IS ?').join(' AND ')
  const asValues=(row:Sku)=>[row.product_id,row.stock_position_id,row.category,row.gender,
    row.color,row.size_label,row.material,row.length,row.is_active,row.updated_at]
  const guard=db.prepare(
    `INSERT INTO catalog_stock_reconciliation_journal (
      request_id,source_variant_id,keeper_variant_id,inventory_source,decision_method,
      source_stock_id,keeper_stock_id,source_quantity_before,keeper_quantity_before,
      keeper_quantity_after,source_reserved_before,keeper_reserved_before,
      adjustment_quantity,reason,created_by,created_at)
    SELECT ?,v.id,k.id,s.inventory_source,?,s.id,t.id,s.quantity,t.quantity,?,
      s.reserved_quantity,t.reserved_quantity,?-s.quantity-t.quantity,?,?,?
    FROM inventory_stock s
    JOIN inventory_stock t ON t.id=? AND t.variant_id=? AND t.inventory_source=s.inventory_source
    JOIN catalog_variants v ON v.id=s.variant_id
    JOIN catalog_variants k ON k.id=t.variant_id
    WHERE s.id=? AND s.inventory_source=? AND s.quantity=? AND t.quantity=?
      AND s.reserved_quantity=0 AND t.reserved_quantity=0
      AND s.quantity>0 AND v.is_active=1 AND k.is_active=1
      AND v.product_id=k.product_id AND v.stock_position_id=k.stock_position_id
      AND ${fields('v')} AND ${fields('k')}
      ${operationalBlock}`
  ).bind(input.requestId,input.method,finalQuantity,finalQuantity,reason,user,stamp,
    keeper.id,input.keeperId,source.id,input.location,source.quantity,keeper.quantity,
    ...asValues(v),...asValues(k))
  const sourceUpdate=db.prepare(
    `UPDATE inventory_stock SET quantity=0,last_action='Корректировка при объединении',
      last_source_ref=?,updated_at=?
     WHERE id=? AND variant_id=? AND inventory_source=? AND quantity=? AND reserved_quantity=0
       AND ${journalCheck}`
  ).bind('catalog-stock-reconcile:'+input.requestId,stamp,source.id,input.sourceId,input.location,
    source.quantity,input.requestId,input.sourceId,input.keeperId,input.location)
  const keeperUpdate=db.prepare(
    `UPDATE inventory_stock SET quantity=?,last_action='Корректировка при объединении',
      last_source_ref=?,updated_at=?
     WHERE id=? AND variant_id=? AND inventory_source=? AND quantity=? AND reserved_quantity=0
       AND ${journalCheck}`
  ).bind(finalQuantity,'catalog-stock-reconcile:'+input.requestId,stamp,keeper.id,
    input.keeperId,input.location,keeper.quantity,input.requestId,input.sourceId,input.keeperId,input.location)
  // Both changes are revision-type evidence, not fictitious lost stock.
  const movement=(side:'source'|'keeper')=>db.prepare(
    `INSERT INTO inventory_movements (
      inventory_source,movement_type,product_id,variant_id,product_name_snapshot,
      gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,
      quantity_delta,quantity_after,reference_type,reference_id,comment,created_at)
     SELECT j.inventory_source,'revision',v.product_id,v.id,p.name,
       v.gender,v.color,v.material,v.length,v.size_label,
       ${side==='source'?'-j.source_quantity_before':'j.keeper_quantity_after-j.keeper_quantity_before'},
       ${side==='source'?'0':'j.keeper_quantity_after'},
       'catalog_stock_reconciliation',j.request_id,
       'Уточнение задвоенного учёта: '||j.decision_method||'. '||j.reason,j.created_at
     FROM catalog_stock_reconciliation_journal j JOIN catalog_variants v
       ON v.id=${side==='source'?'j.source_variant_id':'j.keeper_variant_id'}
     JOIN catalog_products p ON p.id=v.product_id WHERE j.request_id=?`
  ).bind(input.requestId)
  const stockCheck=(side:'source'|'keeper')=>db.prepare(
    `INSERT INTO inventory_stock_checks(
      check_key,inventory_source,product_id,variant_id,expected_quantity,counted_quantity,
      difference_quantity,reserved_quantity,check_type,reference_type,reference_id,
      checked_by,checked_at,created_at)
    SELECT 'catalog-stock-reconcile:'||j.request_id||':${side}',j.inventory_source,v.product_id,v.id,
      ${side==='source'?'j.source_quantity_before':'j.keeper_quantity_before'},
      ${side==='source'?'0':'j.keeper_quantity_after'},
      ${side==='source'?'-j.source_quantity_before':'j.keeper_quantity_after-j.keeper_quantity_before'},
      0,'catalog_merge_correction','catalog_stock_reconciliation',j.request_id,
      j.created_by,j.created_at,j.created_at
    FROM catalog_stock_reconciliation_journal j JOIN catalog_variants v
      ON v.id=${side==='source'?'j.source_variant_id':'j.keeper_variant_id'}
    WHERE j.request_id=?`
  ).bind(input.requestId)
  // Constraint CHECK(passed=1) forces full D1 batch rollback if any postcondition fails.
  const validation=db.prepare(
    `INSERT INTO catalog_stock_reconciliation_validations(request_id,passed,checked_at)
     SELECT j.request_id,CASE WHEN
       EXISTS(SELECT 1 FROM inventory_stock s
         WHERE s.id=j.source_stock_id AND s.quantity=0 AND s.reserved_quantity=0)
       AND EXISTS(SELECT 1 FROM inventory_stock t
         WHERE t.id=j.keeper_stock_id AND t.quantity=j.keeper_quantity_after AND t.reserved_quantity=0)
       AND (SELECT COUNT(*) FROM inventory_movements m
         WHERE m.reference_type='catalog_stock_reconciliation' AND m.reference_id=j.request_id)=2
       AND (SELECT COUNT(*) FROM inventory_stock_checks c
         WHERE c.reference_type='catalog_stock_reconciliation' AND c.reference_id=j.request_id)=2
       THEN 1 ELSE 0 END,?
     FROM catalog_stock_reconciliation_journal j WHERE j.request_id=?`
  ).bind(stamp,input.requestId)
  let results:D1Result[]
  try{
    results=await db.batch([guard,sourceUpdate,keeperUpdate,movement('source'),movement('keeper'),
      stockCheck('source'),stockCheck('keeper'),validation])
  }catch(error){
    const applied=await replay(db,{...input,reason},finalQuantity)
    if(applied)return applied
    throw new Error('Корректировка отменена целиком: склад или заказы изменились. Обновите предпросмотр.', {cause:error})
  }
  if(results.some(x=>toInt(x.meta?.changes,0)!==1)) {
    throw new Error('Корректировка не применена: изменилась связанная запись. Проверьте журнал перед повтором.')
  }
  return {
    ok:true,applied:true,requestId:input.requestId,sourceId:input.sourceId,
    keeperId:input.keeperId,location:input.location,method:input.method,
    sourceQuantityBefore:source.quantity,keeperQuantityBefore:keeper.quantity,
    finalQuantity,adjustmentQuantity:finalQuantity-source.quantity-keeper.quantity,
    nextStep:'Сверка выполнена. После проверки всех точек отдельно объедините нулевой SKU.',
  }
}

export async function recentCatalogStockReconciliations(db:D1Database) {
  const result=await db.prepare(
    `SELECT request_id,source_variant_id AS sourceId,keeper_variant_id AS keeperId,
      inventory_source AS location,decision_method AS method,source_quantity_before AS sourceBefore,
      keeper_quantity_before AS keeperBefore,keeper_quantity_after AS finalQuantity,
      adjustment_quantity AS adjustment,reason,created_by AS createdBy,created_at AS createdAt
    FROM catalog_stock_reconciliation_journal ORDER BY created_at DESC,request_id DESC LIMIT 40`
  ).all()
  return {ok:true,items:result.results||[]}
}
