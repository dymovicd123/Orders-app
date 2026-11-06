/** Client3-only attachment of watch SKU and engraving to Main's
 * resumable itemized order rewrite. Invoked INSIDE the Main critical saga,
 * after canonical rows and reservations have been persisted but BEFORE
 * the saga advances past new_content_written. A retry picks up the same
 * critical_operation_entities IDs and re-verifies every association.
 */
export type WatchRewriteLine={
 orderItemId:number|null;watchVariantId:number;catalogProductId:number;
 catalogVariantId:number;source:'office'|'showcase';quantity:number;
 unitPrice:number;engravingText:string
}
export type WatchOrderRewrite={brandId:number;lines:WatchRewriteLine[]}

/** Watch SKU IDs, not display names, determine whether physical reservations change. */
export function watchRewriteChangesCanonicalSku(
 previous:ReadonlyArray<Record<string,unknown>>,
 lines:ReadonlyArray<WatchRewriteLine>,
):boolean{
 if(previous.length!==lines.length)return true
 return lines.some((line,index)=>{
   const old=previous[index]
   return !old||Number(old.id||0)!==Number(line.orderItemId||0)||
     Number(old.variantId||0)!==line.catalogVariantId||
     Number(old.productId||0)!==line.catalogProductId
 })
}

export async function attachClient3WatchRewrite(
 db:D1Database,orderId:number,requestId:string,rewrite:WatchOrderRewrite,
 preservedIndexes:number[],preservedIds:number[],
):Promise<void>{
 const preserved=new Map<number,number>(preservedIndexes.map((index,i)=>[index,preservedIds[i]]))
 if(!rewrite?.lines?.length||rewrite.lines.length>20||
    preservedIndexes.length!==preservedIds.length)
   throw new Error('Недостаточно данных для восстановления состава часов.')
 const statements:D1PreparedStatement[]=[]
 let freshIndex=0
 for(const [index,line] of rewrite.lines.entries()){
   let orderItemId=preserved.get(index)||0
   if(!orderItemId){
     freshIndex++
     const found=await db.prepare(`SELECT entity_id FROM critical_operation_entities
       WHERE request_id=? AND entity_type='order_item' AND entity_key=?`)
       .bind(requestId,'order_edit:item:'+freshIndex).first<{entity_id:number}>()
     orderItemId=Number(found?.entity_id||0)
   }
   if(!orderItemId)throw new Error('Main ещё не создал строку часов '+(index+1)+'. Повторите сохранение.')
   const source=line.source==='office'?'warehouse':'boutique'
   const actual=await db.prepare(`SELECT oi.id FROM order_items oi
     JOIN watch_variants wv ON wv.id=? AND wv.catalog_variant_id=oi.variant_id
     JOIN watch_products wp ON wp.id=wv.watch_product_id
       AND wp.catalog_product_id=oi.product_id AND wp.brand_id=?
     WHERE oi.id=? AND oi.order_id=?
       AND oi.product_id=? AND oi.variant_id=? AND oi.source_type=?
       AND oi.quantity=? AND oi.unit_price=? AND oi.is_workshop=0`)
     .bind(line.watchVariantId,rewrite.brandId,orderItemId,orderId,
       line.catalogProductId,line.catalogVariantId,source,line.quantity,line.unitPrice)
     .first<{id:number}>()
   if(!actual?.id)
     throw new Error('Позиция '+(index+1)+' после сохранения не совпала с выбранной комплектацией часов.')
   statements.push(db.prepare(`INSERT INTO watch_order_item_details(
       order_item_id,watch_variant_id,engraving_text,created_at
     ) VALUES(?,?,?,?) ON CONFLICT(order_item_id) DO NOTHING`)
     .bind(orderItemId,line.watchVariantId,line.engravingText,new Date().toISOString()))
   statements.push(db.prepare(`SELECT json('WATCH_EDIT_LINK_CONFLICT')
     WHERE NOT EXISTS(SELECT 1 FROM watch_order_item_details wi
       WHERE wi.order_item_id=? AND wi.watch_variant_id=? AND wi.engraving_text=?)`)
     .bind(orderItemId,line.watchVariantId,line.engravingText))
 }
 const results=await db.batch(statements)
 if(results.length!==statements.length)throw new Error('Не удалось сохранить все связи часов.')
}
