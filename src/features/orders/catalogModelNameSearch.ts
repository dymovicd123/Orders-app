const text=(value:unknown)=>String(value??'')
const letters:Record<string,string>={'ё':'е','қ':'к','ө':'о','ұ':'у','ү':'у','ә':'а','і':'и','ң':'н','ғ':'г','һ':'х'}
export const foldSaleName=(value:string)=>text(value).toLocaleLowerCase('ru-RU')
 .replace(/[ёқөұүәіңғһі]/g,character=>letters[character]||character)
 .replace(/[^\p{L}\p{N}]+/gu,' ').trim()

/**
 * Search through the actual model name before interpreting a number as a size.
 * Does not alter any SKU, query selection, or the explicit variant-size filter.
 */
export function modelNameTokensMatch(modelName:string,query:string) {
 const tokens=foldSaleName(query).split(' ').filter(Boolean)
 if(!tokens.length)return false
 const words=foldSaleName(modelName).split(' ').filter(Boolean)
 return tokens.every(token=>words.some(word=>word.startsWith(token)))
}
