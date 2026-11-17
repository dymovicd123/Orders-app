import { identifyReceivingBarcode, type ReceivingBarcodeIdentity, type ReceivingBarcodeLookup } from './warehouseReceivingModel'

export async function lookupReceivingBarcode(codeInput: string): Promise<ReceivingBarcodeIdentity> {
  const code=codeInput.trim().toUpperCase()
  if (!code) throw new Error('Введите или отсканируйте штрихкод.')
  const response=await fetch('/api/barcodes/lookup?code='+encodeURIComponent(code),{
    method:'GET',credentials:'same-origin',cache:'no-store',
  })
  const result=await response.json() as ReceivingBarcodeLookup
  if (!response.ok) throw new Error(result.message || 'Не удалось проверить штрихкод.')
  return identifyReceivingBarcode(code,result)
}
