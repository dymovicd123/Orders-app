// Pure, server-proven dependency-graph composition. Network/CAS writes stay in App.
export type OrderExchangeCancelStep = {
    type:'exchange'|'return';id:number;reason:string;requiresManualReview:boolean;order:number;
  }
export type OrderExchangeCancelPlan = {
    mode:'last'|'all';availableExchangeIds:number[];selectedExchangeIds:number[];
    steps:OrderExchangeCancelStep[];signature:string;canExecute:boolean;
    manualReviewRequired:boolean;notice:string;
  }

export function composeOrderExchangeCancellationPlan(
  mode:'last'|'all',
  available:number[],
  selected:number[],
  previews:Array<{manualReviewRequired:boolean;steps:OrderExchangeCancelStep[]}>,
):OrderExchangeCancelPlan {
    const nodes=new Map<string,OrderExchangeCancelStep>()
    const edges=new Map<string,Set<string>>()
    let manual=false
    for(const preview of previews){
      manual ||=preview.manualReviewRequired
      for(let i=0;i<preview.steps.length;i++){
        const step=preview.steps[i]
        const key=step.type+':'+step.id
        if(step.id<=0||!['exchange','return'].includes(step.type))
          throw new Error('Неоднозначная зависимость обмена: автоматическая отмена остановлена.')
        if(!nodes.has(key))nodes.set(key,{...step})
        if(!edges.has(key))edges.set(key,new Set())
        if(i>0){
          const prior=preview.steps[i-1]
          const before=prior.type+':'+prior.id
          if(!edges.has(before))edges.set(before,new Set())
          edges.get(before)!.add(key)
        }
      }
    }
    // Merge dependency plans by a topological ordering rather than guessing
    // that numeric exchange IDs always express the complete causal graph.
    const indegree=new Map<string,number>([...nodes.keys()].map(key=>[key,0]))
    for(const children of edges.values())
      for(const child of children)indegree.set(child,(indegree.get(child)||0)+1)
    const compare=(a:string,b:string)=>{
      const ra=a.startsWith('return:'),rb=b.startsWith('return:')
      return ra===rb ? Number(b.split(':')[1])-Number(a.split(':')[1]) : ra?-1:1
    }
    const ready=[...indegree].filter(([,count])=>count===0).map(([key])=>key).sort(compare)
    const ordered:OrderExchangeCancelStep[]=[]
    while(ready.length){
      const key=ready.shift()!
      ordered.push({...nodes.get(key)!,order:ordered.length+1})
      for(const child of edges.get(key)||[]){
        const next=(indegree.get(child)||0)-1
        indegree.set(child,next)
        if(next===0)ready.push(child)
      }
      ready.sort(compare)
    }
    if(ordered.length!==nodes.size||selected.some(id=>!nodes.has('exchange:'+id)))
      throw new Error('Цепочка содержит цикл или отсутствующую операцию. Автоматическая отмена остановлена.')
    manual ||=ordered.some(step=>step.requiresManualReview)
    const signature=JSON.stringify({mode,selected,steps:ordered.map(step=>[step.type,step.id])})
    return {mode,availableExchangeIds:available,selectedExchangeIds:selected,
      steps:ordered,signature,manualReviewRequired:manual,canExecute:!manual,
      notice:manual
        ? 'В цепочке есть старый обмен или неоднозначные данные. Автоматическая отмена заблокирована.'
        : ordered.some(step=>step.type==='return')
          ? 'В цепочке есть зависимые возвраты. Они перечислены ниже и будут отменены до связанных обменов.'
          : 'Каждая операция повторно проверит финансы, склад и историю перед отменой.'}
}
