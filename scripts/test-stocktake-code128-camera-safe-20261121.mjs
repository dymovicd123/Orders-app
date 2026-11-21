import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { StocktakeCameraScanGate } from '../src/features/inventory/stocktakeCameraScanGate.ts'
import { skuBarcodeForVariantId } from '../shared/barcode-sku.ts'
import { encodeCode128B } from '../shared/barcode-code128.ts'
import { RGBLuminanceSource, HybridBinarizer, BinaryBitmap, Code128Reader } from '@zxing/library'

const sku=skuBarcodeForVariantId(101)
const other=skuBarcodeForVariantId(102)
const gate=new StocktakeCameraScanGate()
assert.equal(gate.detected(sku,100),true)
for(let t=200;t<2600;t+=125) {
  gate.missing(t)
  if(t<1900)assert.equal(gate.detected(sku,t+10),false,'Single blurry frame cannot rearm the same label')
}
assert.equal(gate.detected(sku,2600),false,'Successfully detected stationary label resets the absence streak')
gate.missing(2800)
assert.equal(gate.detected(sku,3000),false,'A missed frame is insufficient evidence of physical movement')
assert.equal(gate.detected(other,3100),true,'Different barcode is a different piece without waiting')
assert.equal(gate.detected(other,3200),false,'No repeated scans of stationary second label')
for(let t=3300;t<=5500;t+=200)gate.missing(t)
assert.equal(gate.detected(other,5550),true,'Same SKU may be counted after sustained disappearance and multiple misses')
assert.equal(gate.detected(other,5600),false,'Immediately repeated frame is blocked')
gate.nextPhysicalItem()
assert.equal(gate.detected(other,5650),true,'Operator explicitly rearmed identical SKU for a different physical piece')
gate.reset()
assert.equal(gate.detected(sku,5700),true)
assert.equal(gate.detected('',5850),false)

for(const code of [sku,other]) {
  const print=encodeCode128B(code),scale=5,height=90,width=print.width*scale
  const pixels=new Uint8ClampedArray(width*height).fill(255)
  for(const bar of print.bars)
    for(let x=bar.x*scale;x<(bar.x+bar.width)*scale;x++)
      for(let y=0;y<height;y++)pixels[y*width+x]=0
  const bitmap=new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels,width,height)))
  assert.equal(new Code128Reader().decode(bitmap).getText(),code,'Rendered Code128 must be readable by ZXing')
}

const scanner=readFileSync('src/features/inventory/views/StocktakeBarcodeScanner.tsx','utf8')
const css=readFileSync('src/features/inventory/views/stocktakeBarcodeScanner.css','utf8')
assert(scanner.includes('BrowserMultiFormatOneDReader'))
assert(scanner.includes('BarcodeFormat.CODE_128'))
assert(scanner.includes("facingMode: { ideal: 'environment' }"))
assert(scanner.includes('getCapabilities?.()')&&scanner.includes("focusMode: 'continuous'")&&
  scanner.includes("setCameraTrackOption('zoom'")&&scanner.includes("setCameraTrackOption('torch'"),
  'Supported hardware may use autofocus, zoom and torch; unsupported hardware stays usable')
assert(scanner.includes('gateRef.current.detected(found, now)')&&
  scanner.includes('gateRef.current.missing(now)')&&
  scanner.includes('gateRef.current.nextPhysicalItem()'))
assert(!scanner.includes('decodeFromImageUrl')&&!scanner.includes('accept="image/*"')&&
  !scanner.includes('scanPhoto')&&!scanner.includes('photoBusy'),
  'Do not restore user-rejected photo upload fallback')
assert(scanner.includes("origin: 'camera' | 'usb' | 'manual'")&&
  scanner.includes('requestId: crypto.randomUUID()'),
  'Manual and HID entry remain available and idempotency must not change')
assert(scanner.includes('onScannedRef.current(result)')&&
  scanner.includes('countedQuantity')&&scanner.includes('setCameraFeedback'),
  'Server confirmation must determine counts and visual feedback')
assert(css.includes('.stocktake-camera-controls')&&css.includes('position:fixed;inset:0'))
console.log('STOCKTAKE_CODE128_CAMERA_SAFE_PASS: printed Code128 decoded; stable camera anti-duplicate; explicit next piece; hardware zoom/torch optional; no photos; HID/manual retained')
