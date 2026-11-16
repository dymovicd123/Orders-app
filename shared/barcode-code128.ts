const PATTERNS = '212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,221312,231212,112232,122132,122231,113222,123122,123221,223211,221132,221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,231131,213113,213311,213131,311123,311321,331121,312113,312311,332111,314111,221411,431111,111224,111422,121124,121421,141122,141221,112214,112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,111242,121142,121241,114212,124112,124211,411212,421112,421211,212141,214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,114131,311141,411131,211412,211214,211232,2331112'.split(',')
const START_B = 104
const STOP = 106
const QUIET = 10

export type Code128Bar = { x: number; width: number }

export function encodeCode128B(value: string): {
  bars: Code128Bar[]
  width: number
  checksum: number
} {
  if (!value || value.length > 80) throw new Error('Недопустимая длина штрихкода.')
  let checksum = START_B
  const symbols = [START_B]
  for (let i = 0; i < value.length; i++) {
    const ascii = value.charCodeAt(i)
    if (ascii < 32 || ascii > 126) throw new Error('Code 128 B принимает только печатные ASCII-символы.')
    const symbol = ascii - 32
    symbols.push(symbol)
    checksum += symbol * (i + 1)
  }
  checksum %= 103
  symbols.push(checksum, STOP)
  const bars: Code128Bar[] = []
  let cursor = QUIET
  for (const symbol of symbols) {
    const pattern = PATTERNS[symbol]
    if (!pattern || (symbol === STOP ? pattern.length !== 7 : pattern.length !== 6)) {
      throw new Error('Неверная таблица Code 128.')
    }
    for (let i = 0; i < pattern.length; i++) {
      const width = Number(pattern[i])
      if ((i & 1) === 0) bars.push({ x: cursor, width })
      cursor += width
    }
  }
  return { bars, width: cursor + QUIET, checksum }
}
