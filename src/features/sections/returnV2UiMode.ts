// The only safe way to use the former return editor is an explicit V2-disabled
// response. Ineligible orders and preview failures MUST stay in the V2 screen.
export type ReturnV2UiMode='checking'|'legacy'|'v2'|'error'

export function returnV2PreviewMode(
  payload:unknown,httpOk:boolean
):ReturnV2UiMode {
  if(!httpOk||!payload||typeof payload!=='object')return 'error'
  const result=payload as {ok?:unknown;enabled?:unknown}
  if(result.ok===false)return 'error'
  if(result.enabled===true)return 'v2'
  if(result.enabled===false)return 'legacy'
  return 'error'
}

export function allowLegacyReturnEditor(
  selectedOrderId:number,checkedOrderId:number,mode:ReturnV2UiMode
):boolean {
  // Without a selected order, show only the instruction to choose an order.
  // The old editor must never appear merely because the Returns tab is open.
  return selectedOrderId>0
    &&selectedOrderId===checkedOrderId&&mode==='legacy'
}
