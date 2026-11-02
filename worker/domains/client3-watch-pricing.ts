import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'

const bad=(code:string,message:string,status=400)=>json({ok:false,code,message},{status})
export async function updateClient3WatchCatalogPrice(
 db:D1Database,actor:AuthUser,brandId:number,
 input:{watchVariantId?:unknown;salePrice?:unknown;expectedPrice?:unknown},
){
 if(actor.role!=='admin')return bad('WATCH_PRICE_ADMIN_ONLY','Цена каталога изменяется только администратором.',403)
 const watchVariantId=Number(input.watchVariantId)
 const price=input.salePrice
 const expected=input.expectedPrice
 if(!Number.isSafeInteger(watchVariantId)||watchVariantId<=0||
    typeof price!=='number'||!Number.isSafeInteger(price)||price<0||price>1000000000||
    !(expected===null||(typeof expected==='number'&&Number.isSafeInteger(expected)&&expected>=0)))
   return bad('WATCH_PRICE_INVALID','Укажите цену и предыдущее значение из каталога.')
 const sku=await db.prepare(
   `SELECT cv.stock_position_id AS position_id,cv.category,
     wp.model_name,wp.brand_id,wv.id
    FROM watch_variants wv JOIN watch_products wp ON wp.id=wv.watch_product_id
    JOIN catalog_variants cv ON cv.id=wv.catalog_variant_id AND cv.product_id=wp.catalog_product_id
    JOIN catalog_stock_positions sp ON sp.id=cv.stock_position_id AND sp.product_id=wp.catalog_product_id
    WHERE wv.id=? AND wp.brand_id=? AND wv.is_active=1 AND wp.is_active=1
      AND cv.is_active=1 AND sp.is_active=1 LIMIT 1`,
 ).bind(watchVariantId,brandId).first<Record<string,unknown>>()
 if(!sku?.position_id)return bad('WATCH_PRICE_SKU_UNLINKED','Сначала подготовьте складской SKU.',409)
 const position=Number(sku.position_id),category=String(sku.category||'adult')
 const prior=await db.prepare(
   'SELECT sale_price FROM catalog_execution_prices WHERE stock_position_id=? AND category=?',
 ).bind(position,category).first<{sale_price:number|null}>()
 const previous=prior?.sale_price==null?null:Number(prior.sale_price)
 if(previous===price)return json({ok:true,watchVariantId,salePrice:price,alreadySet:true})
 if(previous!==expected)return bad('WATCH_PRICE_STALE','Цена уже изменилась. Обновите каталог перед сохранением.',409)
 const now=new Date().toISOString()
 const applied=await db.prepare(
   `INSERT INTO catalog_execution_prices
     (stock_position_id,category,sale_price,created_at,updated_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(stock_position_id,category) DO UPDATE SET
      sale_price=excluded.sale_price,updated_at=excluded.updated_at
    WHERE catalog_execution_prices.sale_price IS ?`,
 ).bind(position,category,price,now,now,expected).run()
 if(Number(applied.meta?.changes||0)!==1)
   return bad('WATCH_PRICE_CONCURRENT','Цену изменили одновременно. Обновите каталог.',409)
 return json({ok:true,watchVariantId,salePrice:price,previousPrice:previous})
}
