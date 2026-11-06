import assert from 'node:assert/strict'
import fs from 'node:fs'

const read=path=>fs.readFileSync(path,'utf8')
const editor=read('src/features/client3/WatchOrderCorrections.tsx')
const composition=read('src/features/client3/WatchAdminCompositionEditor.tsx')
assert(editor.includes('Сохранить изменения'))
assert(composition.includes('WatchOrderSourcePicker'))
assert(composition.includes('WatchOrderLineEditor'))
console.log('CLIENT3_ORDER_EDITOR_REBUILD_PASS')
