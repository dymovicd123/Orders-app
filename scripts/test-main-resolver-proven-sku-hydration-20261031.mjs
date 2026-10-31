import assert from 'node:assert/strict'
import { initialDraft, canonicalizePreviewDraft, nextQuestion } from '../src/features/orders/catalogResolutionFlow.ts'

// Execute the actual production UI decision functions, not a source-string search.
// The server has already validated a canonical active SKU and hydrated its facts.
// An older order-item snapshot may omit color/size; its existing variant_id proves them.
const facts = {category:'adult',gender:'ЖЕН',material:'ШЕРСТЬ',length:'СТАНДАРТ',color:'СВЕТЛО-БЕЖЕВЫЙ',size:'52'}
const ctx = {
 product:{id:75,name:'ЭТНО КАРДИГАН',genderScope:'female'},
 facts,
 exactVariant:{id:1498,productId:75,productName:'ЭТНО КАРДИГАН',facts},
 references:{materials:['СТАНДАРТ','ШЕРСТЬ'],lengths:['СТАНДАРТ'],colors:['СВЕТЛО-БЕЖЕВЫЙ'],sizes:['52'],childAges:[]},
 unknownFields:[],isWorkshop:false,
}
const opts={remainder:'',classified:false,confirmed:{},legacy:false,editing:null}
const linked = initialDraft({productName:'ЭТНО КАРДИГАН',variantId:1498,color:'',size:''},ctx)
assert.equal(linked.color,'СВЕТЛО-БЕЖЕВЫЙ','Exact linked SKU MUST hydrate known color despite empty stale snapshot')
assert.equal(linked.size,'52','Exact linked SKU MUST hydrate known size despite empty stale snapshot')
assert.equal(nextQuestion(ctx,linked,opts).kind,'ready','Exact linked SKU cannot ask to re-enter catalog facts')
const rechecked = canonicalizePreviewDraft({...linked,color:'',size:''},ctx,1498)
assert.equal(rechecked.color,'СВЕТЛО-БЕЖЕВЫЙ','Rechecking material must not clear proven canonical color')
assert.equal(rechecked.size,'52','Rechecking material must not clear proven canonical size')
assert.equal(nextQuestion(ctx,rechecked,opts).kind,'ready')
for (const otherId of [0,1499,undefined]) {
  const unverifiable=canonicalizePreviewDraft({...linked,color:'',size:''},ctx,otherId)
  assert.equal(unverifiable.color,'','A different/unlinked SKU must not infer old missing color')
  assert.equal(unverifiable.size,'','A different/unlinked SKU must not infer old missing size')
}
const explicitlyChosen=canonicalizePreviewDraft({...linked,color:'СВЕТЛО-БЕЖЕВЫЙ',size:'52'},ctx,1499)
assert.equal(explicitlyChosen.color,'СВЕТЛО-БЕЖЕВЫЙ','Explicitly confirmed user facts should survive preview')
assert.equal(explicitlyChosen.size,'52')


// The same context without a PROVEN order-item variant cannot infer absent dimensions.
// Important: matching a default БЕЗ ЦВЕТА placeholder is not physical evidence of its identity.
for(const variantId of [0,1499,undefined]){
 const unlinked=initialDraft({productName:'ЭТНО КАРДИГАН',variantId,color:'',size:''},ctx)
 assert.equal(unlinked.color,'','Unknown/mismatched variant must NOT guess color')
 assert.equal(unlinked.size,'','Unknown/mismatched variant must NOT guess size')
 assert.equal(nextQuestion(ctx,unlinked,opts).kind,'field','Missing dimensions must remain explicit without provenance')
}
const plain=initialDraft({productName:'ЭТНО КАРДИГАН',color:'СВЕТЛО-БЕЖЕВЫЙ',size:'52'},ctx)
assert.equal(plain.color,'СВЕТЛО-БЕЖЕВЫЙ')
assert.equal(plain.size,'52')
assert.equal(plain.gender,'ЖЕН')

// Linked truly dimensionless catalogue SKU is also authoritative, only on exact ID.
const noDim={
 ...ctx,
 facts:{...facts,color:'БЕЗ ЦВЕТА',size:'БЕЗ РАЗМЕРА'},
 exactVariant:{id:1666,productId:75,productName:'ЭТНО КАРДИГАН',facts:{...facts,color:'БЕЗ ЦВЕТА',size:'БЕЗ РАЗМЕРА'}},
}
const dimensionless=initialDraft({productName:'ЭТНО КАРДИГАН',variantId:1666,color:'',size:''},noDim)
assert.equal(dimensionless.color,'БЕЗ ЦВЕТА')
assert.equal(dimensionless.size,'БЕЗ РАЗМЕРА')
console.log('MAIN_RESOLVER_PROVEN_SKU_HYDRATION_PASS: proven variant skips duplicate questions, unlinked or wrong ID never guesses')
