import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {previewExchangeCancellationChain} from './exchange-cancel-chain.ts'

type Step={type:'exchange'|'return';id:number;order:number;
 reason:string;requiresManualReview:boolean}
type Mode='last'|'all'
const fail=(message:string,status=409)=>json({ok:false,message},{status})

/** Main's topo-sorted, read-only cancellation graph, scoped to exactly one
 * Client3 brand. No Return/Exchange status or physical stock is mutated here. */
export async function previewClient3WatchExchangeCancellationPlan(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,mode:Mode,
):Promise<Response>{
 if(!actor?.id||['Логист','Упаковщик','Завсклад'].includes(actor.employeeRole||'')&&actor.role!=='admin')
   return fail('Отмена обменов доступна менеджеру или администратору.',403)
 if(!Number.isSafeInteger(orderId)||orderId<1||!['last','all'].includes(mode))
   return fail('Укажите заказ и способ отмены.',400)
 const own=await db.prepare(`SELECT o.id FROM orders o
   JOIN watch_order_details wd ON wd.order_id=o.id
   WHERE o.id=? AND wd.brand_id=? AND o.order_status NOT IN ('archived','deleted')`)
   .bind(orderId,brandId).first<{id:number}>()
 if(!own)return fail('Заказ не найден в выбранном бренде.',404)
 try{
   const active=await db.prepare(`SELECT id FROM exchanges
     WHERE order_id=? AND COALESCE(status,'completed')<>'cancelled'
     ORDER BY id ASC LIMIT 201`).bind(orderId).all<{id:number}>()
   const ids=(active.results||[]).map(x=>Number(x.id))
   if(ids.length>200)return fail('Обменов слишком много для автоматической отмены.')
   if(!ids.length)return json({ok:true,mode,availableExchangeIds:[],selectedExchangeIds:[],
     steps:[],canExecute:false,manualReviewRequired:false,
     signature:'',notice:'Активных обменов нет.'})
   const selected=mode==='last'?[ids[ids.length-1]]:ids
   const previews=await Promise.all(selected.map(id=>previewExchangeCancellationChain(db,orderId,id)))
   const nodes=new Map<string,Step>(),edges=new Map<string,Set<string>>()
   let manual=false
   for(const p of previews){
     manual ||=p.manualReviewRequired
     for(let i=0;i<p.steps.length;i++){
       const step=p.steps[i],key=step.type+':'+step.id
       if(step.id<=0||!['exchange','return'].includes(step.type))
         return fail('Неоднозначная связь операций — остановлено.')
       if(!nodes.has(key))nodes.set(key,{...step})
       if(!edges.has(key))edges.set(key,new Set())
       if(i>0){
         const prev=p.steps[i-1],before=prev.type+':'+prev.id
         if(!edges.has(before))edges.set(before,new Set())
         edges.get(before)!.add(key)
       }
     }
   }
   const indegree=new Map<string,number>([...nodes.keys()].map(key=>[key,0] as [string,number]))
   for(const children of edges.values())for(const k of children)
     indegree.set(k,(indegree.get(k)||0)+1)
   const compare=(a:string,b:string)=>{
     const ra=a.startsWith('return:'),rb=b.startsWith('return:')
     return ra===rb?Number(b.split(':')[1])-Number(a.split(':')[1]):ra?-1:1
   }
   const ready=[...indegree].filter(([,n])=>n===0).map(([k])=>k).sort(compare)
   const ordered:Step[]=[]
   while(ready.length){
     const k=ready.shift()!
     ordered.push({...nodes.get(k)!,order:ordered.length+1})
     for(const child of edges.get(k)||[]){
       const n=(indegree.get(child)||0)-1
       indegree.set(child,n)
       if(n===0)ready.push(child)
     }
     ready.sort(compare)
   }
   if(ordered.length!==nodes.size||selected.some(id=>!nodes.has('exchange:'+id)))
     return fail('Цепочка обменов повреждена или содержит цикл.')
   manual ||=ordered.some(s=>s.requiresManualReview)
   const signature=JSON.stringify({mode,selected,
     steps:ordered.map(s=>[s.type,s.id])})
   return json({ok:true,mode,availableExchangeIds:ids,selectedExchangeIds:selected,
     steps:ordered,signature,manualReviewRequired:manual,canExecute:!manual,
     notice:manual
       ?'Есть старая или неоднозначная операция. Автоматическая отмена недоступна.'
       :ordered.some(x=>x.type==='return')
         ?'Сначала отменяются зависимые возвраты, затем обмены. Каждый шаг заново проверяет деньги и склад.'
         :'Каждый обмен перед отменой повторно проверяет деньги, склад и отправку. Отправка исправляется только в логистике.'})
 }catch(e){return fail(e instanceof Error?e.message:'Не удалось проверить цепочку обменов.')}
}
