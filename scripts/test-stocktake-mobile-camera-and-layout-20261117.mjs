import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { skuBarcodeForVariantId, variantIdFromSkuBarcode } from '../shared/barcode-sku.ts'
import { encodeCode128B } from '../shared/barcode-code128.ts'
import { RGBLuminanceSource, HybridBinarizer, BinaryBitmap, Code128Reader } from '@zxing/library'

const photographed='OCS1-0001JD-Q4'
assert.equal(variantIdFromSkuBarcode(photographed),Number.parseInt('1JD',36),
  'The photographed OCS1 label checksum must be accepted by canonical SKU parser')
const examples=[photographed,skuBarcodeForVariantId(101),skuBarcodeForVariantId(999999)]
for (const code of examples) {
  const encoded=encodeCode128B(code)
  const scale=4,height=100,width=encoded.width*scale
  const rgba=new Uint8ClampedArray(width*height*4).fill(255)
  for (const bar of encoded.bars) {
    for (let x=bar.x*scale;x<(bar.x+bar.width)*scale;x++) {
      for (let y=0;y<height;y++) {
        const offset=(y*width+x)*4
        rgba[offset]=rgba[offset+1]=rgba[offset+2]=0
      }
    }
  }
  const reader=new Code128Reader()
  const image=new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(rgba,width,height)))
  assert.equal(reader.decode(image).getText(),code,'Actual ZXing must decode the label we print: '+code)
}
const scanner=readFileSync('src/features/inventory/views/StocktakeBarcodeScanner.tsx','utf8')
const cameraCss=readFileSync('src/features/inventory/views/stocktakeBarcodeScanner.css','utf8')
const mobileCss=readFileSync('src/styles/196-mobile-warehouse-20261117.css','utf8')
const section=readFileSync('src/features/sections/InventorySection.tsx','utf8')

assert(scanner.includes("width: { ideal: 1920 }")&&scanner.includes("height: { ideal: 1080 }"),
  'Camera should request HD input to decode dense 1D bars from printed paper and displays')
assert(scanner.includes("decodeFromImageUrl(url)")&&scanner.includes("URL.revokeObjectURL(url)")&&
  scanner.includes('accept="image/*"'), 'Image-based scan fallback must decode locally and free object URL')
assert(scanner.includes('setCode(scanned)')&&scanner.includes('Проверьте его и нажмите'),
  'Decoded photos or camera frames must not count items without explicit confirmation')
const capture=scanner.slice(scanner.indexOf('  function acceptDecodedCode'),scanner.indexOf('  async function scan()'))
assert(!capture.includes("method: 'POST'")&&!capture.includes('onScanned(')&&!capture.includes('onSkuFound('),
  'Camera/photo capture must not write to warehouse or change physical counts')
assert(scanner.includes('cameraStopRef.current?.()')&&scanner.includes('track.stop()'))
assert(scanner.includes('Камера работает')&&scanner.includes('Ищу штрихкод'),
  'Previously silent reader must now explain camera status')
assert(cameraCss.includes('position:fixed;inset:0')&&cameraCss.includes('object-fit:contain'),
  'On phones scanning must get a full-screen uncropped and closable preview')
assert(mobileCss.includes('.warehouse-w2-primary')&&mobileCss.includes('overflow-x:auto!important')&&
  mobileCss.includes('.stocktake-size-cell>input')&&mobileCss.includes('min-height:48px'),
  'Stocktake navigation and count fields must be touch usable on portrait and landscape phones')
assert(section.includes("import '../../styles/196-mobile-warehouse-20261117.css'"))
assert(section.includes('stocktakeFoundSkuPrintReceipt(stocktakeSession)'),
  'Mobile changes must not alter already tested post-stocktake label choices')
console.log('STOCKTAKE_PHONE_SCAN_PASS: photographed canonical SKU, real ZXing decoded printed Code128, 1080p camera, photo fallback, no automatic writes, touch layout')
