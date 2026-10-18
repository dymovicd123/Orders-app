import { cleanText, normalizeSourceType, toInt } from '../core/text.ts';
type Row=Record<string,unknown>;
type Input={orderId:number;itemId:number;oldVariantId:number;newVariantId:number;
 quantity:number;oldPrice:number;newPrice:number;oldTotal:number;actor:string};
function error(s:string):never { throw new Error(s); }
const n=(v:unknown)=>Number.isSafeInteger(Number(v)) ? Number(v) : -1;
async function row(db:D1Database,orderId:number,itemId:number) {
 const data=await db.prepare(`SELECT oi.*,o.external_id,o.order_status,o.archived_at,
 o.shipping_status,o.total_amount,o.received_amount,o.debt_amount,o.return_amount,
 v.is_active AS old_active,sp.is_active AS execution_active,
 (SELECT COALESCE(SUM(line_total),0) FROM order_items WHERE order_id=o.id AND quantity>0) AS sum_lines
 FROM order_items oi JOIN orders o ON o.id=oi.order_id
 LEFT JOIN catalog_variants v ON v.id=oi.variant_id
 LEFT JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id
 WHERE oi.order_id=? AND oi.id=? LIMIT 1`).bind(orderId,itemId).first<Row>();
 if(!data)error('Позиция заказа не найдена. Обновите заказ.');
 if(cleanText(data.order_status)!=='active'||cleanText(data.archived_at)
  ||cleanText(data.shipping_status)==='sent'||cleanText(data.stock_writeoff_status)!=='catalog_retired'
  ||toInt(data.is_workshop,0)!==0||(toInt(data.old_active,0)!==0&&toInt(data.execution_active,0)!==0))
  error('Исправление возможно только для неотправленной позиции удалённого исполнения.');
 return data;
}
async function blockers(db:D1Database,orderId:number,itemId:number){
 const r=await db.prepare(`SELECT
  (SELECT COUNT(*) FROM exchanges WHERE order_id=? AND COALESCE(status,'completed')<>'cancelled') AS ex,
  (SELECT COUNT(*) FROM returns WHERE order_id=? AND COALESCE(status,'completed')<>'cancelled') AS ret,
  (SELECT COUNT(*) FROM inventory_reservations WHERE order_id=? AND status='fulfilled') AS issued,
  (SELECT COUNT(*) FROM inventory_reservations WHERE order_item_id=? AND status NOT IN ('released')) AS reserved,
  (SELECT COUNT(*) FROM retired_order_item_issues WHERE order_item_id=?) AS physically_issued
 `).bind(orderId,orderId,orderId,itemId,itemId).first<Row>();
 if(Object.values(r||{}).some(v=>toInt(v,0)>0))
  error('У заказа есть выдача, обмен, возврат или незавершённый резерв. Требуется администратор.');
}
function safePrice(r:Row){
 return n(r.sum_lines)===n(r.total_amount)&&n(r.total_amount)===n(r.received_amount)+n(r.debt_amount)
 &&n(r.line_total)===n(r.quantity)*n(r.unit_price);
}
async function options(db:D1Database,r:Row) {
 const source=normalizeSourceType(r.source_type);
 const rows=await db.prepare(`SELECT v.id AS variantId,v.product_id AS productId,p.name AS productName,
  COALESCE(v.category,p.category,'adult') AS category,v.gender,v.color,v.material,v.length,v.size_label AS size,
  COALESCE(s.quantity,0) AS physical,COALESCE(s.reserved_quantity,0) AS reserved,
  s.id AS stockId
  FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id AND p.is_active=1
  JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id AND sp.is_active=1
  LEFT JOIN inventory_stock s ON s.variant_id=v.id AND s.inventory_source=?
  WHERE v.product_id=? AND v.is_active=1 AND v.id<>?
  ORDER BY v.material,v.length,v.color,v.size_label,v.id LIMIT 150`
 ).bind(source,toInt(r.product_id,0),toInt(r.variant_id,0)).all<Row>();
 return (rows.results||[]).map(x=>({
  variantId:toInt(x.variantId,0),productId:toInt(x.productId,0),
  productName:cleanText(x.productName),category:cleanText(x.category),
  gender:cleanText(x.gender),color:cleanText(x.color),material:cleanText(x.material),
  length:cleanText(x.length),size:cleanText(x.size),stockId:toInt(x.stockId,0),
  physical:toInt(x.physical,0),reserved:toInt(x.reserved,0),
  free:toInt(x.physical,0)-toInt(x.reserved,0)
 }));
}
export async function previewRetiredItemCorrection(db:D1Database,orderId:number,itemId:number){
 const r=await row(db,orderId,itemId);
 await blockers(db,orderId,itemId);
 if(await db.prepare('SELECT 1 FROM retired_order_item_corrections WHERE order_item_id=?').bind(itemId).first())
  error('Эта позиция уже исправлена. Обновите заказ.');
 return {ok:true,oldVariantId:toInt(r.variant_id,0),quantity:toInt(r.quantity,0),
  oldPrice:toInt(r.unit_price,0),oldTotal:toInt(r.total_amount,0),
  received:toInt(r.received_amount,0),canEditPrice:safePrice(r),
  variants:await options(db,r)};
}
export async function correctRetiredItem(db:D1Database,input:Input) {
 const {orderId,itemId,oldVariantId,newVariantId,quantity,oldPrice,newPrice,oldTotal}=input;
 const actor=cleanText(input.actor);
 if([orderId,itemId,oldVariantId,newVariantId,quantity].some(x=>!Number.isSafeInteger(x)||x<=0)
 ||[oldPrice,newPrice,oldTotal].some(x=>!Number.isSafeInteger(x)||x<0)||!actor)
  error('Неверные данные исправления. Обновите заказ.');
 const previous=await db.prepare('SELECT * FROM retired_order_item_corrections WHERE order_item_id=?').bind(itemId).first<Row>();
 if(previous){
  if(toInt(previous.order_id,0)===orderId&&toInt(previous.old_variant_id,0)===oldVariantId
  &&toInt(previous.new_variant_id,0)===newVariantId&&toInt(previous.new_price,-1)===newPrice
  &&cleanText(previous.status)==='completed')
   return {ok:true,alreadyCorrected:true};
  error('Другое исправление уже записано для этой позиции. Обновите заказ.');
 }
 const r=await row(db,orderId,itemId);
 await blockers(db,orderId,itemId);
 if(n(r.variant_id)!==oldVariantId||n(r.quantity)!==quantity||n(r.unit_price)!==oldPrice
  ||n(r.total_amount)!==oldTotal)
  error('Данные заказа изменились или цена строки некорректна. Обновите заказ.');
 const delta=(newPrice-oldPrice)*quantity, nextTotal=oldTotal+delta;
 if(!Number.isSafeInteger(delta)||!Number.isSafeInteger(nextTotal)||nextTotal<0)
  error('Некорректный пересчёт цены.');
 if(delta!==0&&!safePrice(r))error('В этом старом заказе цена не совпадает с финансовыми итогами. Исправьте товар без смены цены либо обратитесь к администратору.');
 if(nextTotal<n(r.received_amount))error('Новая цена меньше уже оплаченной суммы. Менеджер не может менять платежи.');
 const target=(await options(db,r)).find(x=>x.variantId===newVariantId);
 if(!target)
  error('Выбранное исполнение больше не доступно. Обновите каталог.');
 const source=normalizeSourceType(r.source_type), now=new Date().toISOString();
 const originalLineTotal=n(r.line_total);
 if(originalLineTotal<0)error('Неверная историческая сумма позиции. Требуется администратор.');
 const newLineTotal=delta===0?originalLineTotal:newPrice*quantity;
 const snapshotOld=JSON.stringify({variantId:oldVariantId,productName:r.product_name_snapshot,
  gender:r.gender_snapshot,color:r.color_snapshot,material:r.material_snapshot,length:r.length_snapshot,
  size:r.size_snapshot,unitPrice:oldPrice,lineTotal:originalLineTotal,total:oldTotal,quantity});
 const snapshotNew=JSON.stringify({variantId:newVariantId,productName:target.productName,
  gender:target.gender,color:target.color,material:target.material,length:target.length,
  size:target.size,unitPrice:newPrice,lineTotal:newLineTotal,total:nextTotal,quantity});
 // The first journal INSERT is the per-line claim. All changes are a single
 // Cloudflare D1 atomic batch. Subsequent statements only run while pending.
 const changes=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO retired_order_item_corrections(
   order_item_id,order_id,old_variant_id,new_variant_id,quantity,
   old_price,new_price,old_total,new_total,previous_snapshot,next_snapshot,actor,recorded_at,status)
   SELECT oi.id,oi.order_id,oi.variant_id,?,oi.quantity,oi.unit_price,?,?,?,?,?,?,?,'pending'
   FROM order_items oi JOIN orders o ON o.id=oi.order_id
   JOIN catalog_variants old ON old.id=oi.variant_id
   JOIN catalog_stock_positions osp ON osp.id=old.stock_position_id
   JOIN catalog_variants newer ON newer.id=? AND newer.product_id=oi.product_id AND newer.is_active=1
   JOIN catalog_products cp ON cp.id=newer.product_id AND cp.is_active=1
   JOIN catalog_stock_positions nsp ON nsp.id=newer.stock_position_id AND nsp.is_active=1
   WHERE oi.id=? AND oi.order_id=? AND oi.variant_id=? AND oi.quantity=? AND oi.unit_price=?
   AND (?=0 OR oi.line_total=oi.unit_price*oi.quantity) AND oi.is_workshop=0
   AND oi.stock_writeoff_status='catalog_retired' AND (old.is_active=0 OR osp.is_active=0)
   AND o.total_amount=? AND o.received_amount<=?
   AND COALESCE(o.order_status,'active')='active' AND COALESCE(o.archived_at,'')=''
   AND COALESCE(o.shipping_status,'not_sent')<>'sent'
   AND (SELECT COUNT(*) FROM inventory_stock t
        WHERE t.inventory_source=oi.source_type AND t.variant_id=newer.id)<=1
   -- Snapshot-based legacy unique stock index must not silently bind a
   -- different variant to the same stock row.
   AND NOT EXISTS(SELECT 1 FROM inventory_stock t
     WHERE t.inventory_source=oi.source_type AND t.product_name_snapshot=cp.name
       AND COALESCE(t.gender_snapshot,'')=COALESCE(newer.gender,'')
       AND COALESCE(t.color_snapshot,'')=COALESCE(newer.color,'')
       AND COALESCE(t.material_snapshot,'')=COALESCE(newer.material,'')
       AND COALESCE(t.length_snapshot,'')=COALESCE(newer.length,'')
       AND COALESCE(t.size_snapshot,'')=COALESCE(newer.size_label,'')
       AND COALESCE(t.variant_id,0)<>newer.id)
   AND NOT EXISTS(SELECT 1 FROM retired_order_item_issues i WHERE i.order_item_id=oi.id)
   AND NOT EXISTS(SELECT 1 FROM inventory_reservations ir WHERE ir.order_item_id=oi.id AND ir.status<>'released')
   AND NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.order_id=o.id AND COALESCE(e.status,'completed')<>'cancelled')
   AND NOT EXISTS(SELECT 1 FROM returns ret WHERE ret.order_id=o.id AND COALESCE(ret.status,'completed')<>'cancelled')
   AND NOT EXISTS(SELECT 1 FROM inventory_reservations used WHERE used.order_id=o.id AND used.status='fulfilled')
  `).bind(newVariantId,newPrice,oldTotal,nextTotal,snapshotOld,snapshotNew,actor,now,newVariantId,
   itemId,orderId,oldVariantId,quantity,oldPrice,delta,oldTotal,nextTotal),
  // Match ordinary order creation: reserve even when physical stock is
  // temporarily reported as zero. Do NOT fabricate any physical quantity.
  // The operation only inserts the missing zero-balance stock row.
  db.prepare(`INSERT OR IGNORE INTO inventory_stock(
    inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,
    color_snapshot,material_snapshot,length_snapshot,size_snapshot,
    quantity,reserved_quantity,last_action,last_source_ref,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,0,0,?,?,?,?
    WHERE NOT EXISTS (SELECT 1 FROM inventory_stock existing
                      WHERE existing.inventory_source=? AND existing.variant_id=?)
      AND EXISTS (SELECT 1 FROM retired_order_item_corrections j
                  WHERE j.order_item_id=? AND j.status='pending')`
  ).bind(source,target.productId,newVariantId,target.productName,target.gender,target.color,
    target.material,target.length,target.size,'Создана позиция для резерва',
    'order-item:'+itemId,now,now,source,newVariantId,itemId),
  db.prepare(`UPDATE inventory_stock
    SET reserved_quantity=COALESCE(reserved_quantity,0)+?,
        last_action='Резерв после исправления удалённого товара',
        last_source_ref=?,updated_at=?
    WHERE inventory_source=? AND variant_id=?
      AND EXISTS (SELECT 1 FROM retired_order_item_corrections j
                  WHERE j.order_item_id=? AND j.status='pending')`
  ).bind(quantity,'order-item:'+itemId,now,source,newVariantId,itemId),
  db.prepare(`UPDATE inventory_reservations SET
     inventory_source=?,product_id=?,variant_id=?,quantity=?,status='active',
     released_at=NULL,unresolved_reason=NULL,updated_at=?
     WHERE order_item_id=? AND status='released' AND EXISTS
     (SELECT 1 FROM retired_order_item_corrections j WHERE j.order_item_id=? AND j.status='pending')`
  ).bind(source,target.productId,newVariantId,quantity,now,itemId,itemId),
  db.prepare(`INSERT INTO inventory_reservations(order_id,order_item_id,
    inventory_source,product_id,variant_id,quantity,status,reference_type,reference_id,created_at,updated_at)
    SELECT ?,?,?,?,?,?,'active','order',?,?,?
    WHERE NOT EXISTS(SELECT 1 FROM inventory_reservations r WHERE r.order_item_id=?)
    AND EXISTS(SELECT 1 FROM retired_order_item_corrections j WHERE j.order_item_id=? AND j.status='pending')`
  ).bind(orderId,itemId,source,target.productId,newVariantId,quantity,
    cleanText(r.external_id),now,now,itemId,itemId),
  db.prepare(`UPDATE order_items SET product_id=?,variant_id=?,product_name_snapshot=?,
   audience_type=?,gender_snapshot=?,color_snapshot=?,material_snapshot=?,length_snapshot=?,
   size_snapshot=?,unit_price=?,line_total=?,stock_writeoff_status='reserved',
   stock_quantity_before=NULL,stock_quantity_after=NULL
   WHERE id=? AND order_id=? AND variant_id=? AND stock_writeoff_status='catalog_retired'
   AND EXISTS(SELECT 1 FROM retired_order_item_corrections j WHERE j.order_item_id=? AND j.status='pending')`
  ).bind(target.productId,newVariantId,target.productName,target.category,target.gender,
   target.color,target.material,target.length,target.size,newPrice,newLineTotal,
   itemId,orderId,oldVariantId,itemId),
  db.prepare(`UPDATE orders SET total_amount=?,debt_amount=?-received_amount,updated_at=?
   WHERE id=? AND total_amount=? AND received_amount<=? AND EXISTS
   (SELECT 1 FROM retired_order_item_corrections j WHERE j.order_item_id=? AND j.status='pending')`
  ).bind(nextTotal,nextTotal,now,orderId,oldTotal,nextTotal,itemId),
  db.prepare(`UPDATE retired_order_item_corrections SET status='completed'
   WHERE order_item_id=? AND status='pending'`).bind(itemId)
 ]);
 if(toInt(changes[0]?.meta?.changes,0)!==1
   ||toInt(changes[2]?.meta?.changes,0)!==1
   ||toInt(changes[3]?.meta?.changes,0)+toInt(changes[4]?.meta?.changes,0)!==1
   ||toInt(changes[5]?.meta?.changes,0)!==1
   ||toInt(changes[6]?.meta?.changes,0)!==1||toInt(changes[7]?.meta?.changes,0)!==1)
    error('Не все шаги исправления завершились. Проверьте журнал и обновите заказ.');
 return {ok:true,alreadyCorrected:false,orderItemId:itemId,
  totalAmount:nextTotal,debtAmount:nextTotal-toInt(r.received_amount,0)};
}
