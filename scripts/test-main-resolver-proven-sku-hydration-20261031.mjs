import assert from 'node:assert/strict'
import { initialDraft, canonicalizePreviewDraft, nextQuestion, needsReference, sameReferenceValue } from '../src/features/orders/catalogResolutionFlow.ts'

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
// Task 1.4: a catalog-backed reference with harmless punctuation differences
// is not a new color. Do not ask staff to create or confirm it again.
const aliasContext = {
 ...ctx, exactVariant:null, existingVariantId:null,
 references:{...ctx.references,colors:['ТЕМНО СЕРЫЙ']},
 facts:{...facts,color:'ТЕМНО-СЕРЫЙ'},
}
const aliasDraft={...linked,color:'ТЕМНО-СЕРЫЙ'}
assert.equal(sameReferenceValue('ТЕМНО-СЕРЫЙ','ТЕМНО СЕРЫЙ'),true)
assert.equal(sameReferenceValue('ТЕМНО—СЕРЫЙ','ТЕМНО СЕРЫЙ'),true)
assert.equal(needsReference(aliasContext,aliasDraft,'color'),false,'Known catalog color is not a new reference')
assert.equal(nextQuestion(aliasContext,aliasDraft,opts).kind,'ready','Alias-only formatting cannot block resolver')
assert.equal(needsReference(aliasContext,{...aliasDraft,color:'ТЕМНО СИНИЙ'},'color'),true,'Different color is NOT a known alias')
assert.deepEqual(nextQuestion(aliasContext,{...aliasDraft,color:'ТЕМНО СИНИЙ'},opts),{kind:'reference',field:'color'})
assert.equal(sameReferenceValue('ТЕМНО СЕРИЙ','ТЕМНО СЕРЫЙ'),false,'Fuzzy typos must not auto-confirm a reference')
assert.equal(sameReferenceValue('100% ХЛОПОК','100 ХЛОПОК'),false,'Meaningful material punctuation is not an alias')
assert.equal(sameReferenceValue('4/6','4-6'),false,'A slash is not a safe age-range hyphen alias')
// A preview is not proof of identity. A tentative server candidate must NEVER
// overwrite an explicit, different field from an unlinked order or an employee edit.
const staleCandidate={
 ...ctx, facts:{...facts,color:'ЧЕРНЫЙ',size:'44'},
 exactVariant:{id:2400,productId:75,productName:'ЭТНО КАРДИГАН',
  facts:{...facts,color:'ЧЕРНЫЙ',size:'44'}},
}
const stale={productName:'ЭТНО КАРДИГАН',variantId:0,color:'БЕЖЕВЫЙ',size:'46'}
const original=initialDraft(stale,staleCandidate)
assert.equal(original.color,'БЕЖЕВЫЙ','Unlinked explicit color is not replaced by a tentative candidate')
assert.equal(original.size,'46','Unlinked explicit size is not replaced by a tentative candidate')
const afterPreview=canonicalizePreviewDraft({...original,color:'КРАСНЫЙ',size:'50'},staleCandidate,null)
assert.equal(afterPreview.color,'КРАСНЫЙ','Manager changed color must survive server preview')
assert.equal(afterPreview.size,'50','Manager changed size must survive server preview')
assert.equal(canonicalizePreviewDraft({...original,color:'',size:''},staleCandidate,0).color,'')
const trusted=initialDraft({...stale,variantId:2400},staleCandidate)
assert.equal(trusted.color,'ЧЕРНЫЙ','Only original exact canonical SKU may supersede contradictory legacy snapshots')
assert.equal(trusted.size,'44')
console.log('MAIN_RESOLVER_PROVEN_SKU_HYDRATION_PASS: proven variant skips duplicate questions, unlinked or wrong ID never guesses')
