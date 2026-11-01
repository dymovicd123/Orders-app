import fs from 'node:fs'

const workspace = fs.readFileSync('src/app/controllers/useWorkspaceViewModel.tsx', 'utf8')
const resolver = fs.readFileSync('worker/domains/order-reservations.ts', 'utf8')
const review = fs.readFileSync('worker/domains/catalog-review.ts', 'utf8')
const modal = fs.readFileSync('src/features/orders/OrderCatalogResolutionModal.tsx', 'utf8')

const check = (condition, message) => {
  if (!condition) throw new Error(message)
}

// Frontend product pick: known human gender wins, otherwise the exact selected SKU gender wins,
// and only then may a fixed product scope provide a fallback.
check(workspace.includes("const enteredGender = canonicalOrderGender(currentItem.gender)"), 'R11: product pick does not preserve an already-entered concrete gender')
check(workspace.includes("const preferredGender = enteredGender || automaticGender"), 'R11: product pick does not prefer explicit/fixed gender when selecting an existing group')
check(workspace.includes("if (preferredGender) {"), 'R11: group selection ignores known gender')
check(workspace.includes("=== preferredGender ? 0 : 1"), 'R11: group ranking does not prefer the known gender')
check(workspace.includes("gender: enteredGender || canonicalOrderGender(selected.gender) || automaticGender"), 'R11: unisex product pick still erases selected concrete SKU gender')
check(!workspace.includes("gender: automaticGender ? (selected.gender || automaticGender) : ''"), 'R11: old unisex gender-erasure path still exists')

// Server resolver: an explicit human/catalog gender remains authoritative and bypasses scope guessing.
check(resolver.includes("const enteredGender = normalizeCatalogCombinationGender(item.gender)"), 'R11: server no longer reads explicit order-item gender')
check(resolver.includes("let gender = enteredGender"), 'R11: explicit order-item gender is not authoritative on server')
check(resolver.indexOf("let gender = enteredGender") < resolver.indexOf("const productGenderScope = await getCatalogProductGenderScope"), 'R11: server reads product scope before honoring explicit gender')

// Review flow: linked canonical SKU and saved snapshot hydrate the resolver before a question is chosen.
check(review.includes("gender_snapshot: cleanText(linked.gender)"), 'R11: linked exact SKU gender is not hydrated into catalog review')
check(review.includes("gender: normalizeCatalogCombinationGender(preview.gender ?? anchor.gender_snapshot)"), 'R11: saved order-item gender is not used by catalog review')
check(modal.includes("canonicalizePreviewDraft(next, data, item.variantId)"), 'R11: preview must use canonical review facts')
const {canonicalizePreviewDraft} = await import('../src/features/orders/catalogResolutionFlow.ts')
const initial={gender:'МУЖ',genderScope:'unisex',color:'ЧЕРНЫЙ',size:'46',material:'СТАНДАРТ',length:'СТАНДАРТ'}
const restored=canonicalizePreviewDraft(initial,{product:{genderScope:'unisex'},facts:{gender:'ЖЕН'},exactVariant:{id:41}},41)
check(restored.gender==='ЖЕН', 'R11: review of linked exact SKU must preserve server-proven gender')
const fallback=canonicalizePreviewDraft(initial,{product:{genderScope:'unisex'},facts:{},exactVariant:null},null)
check(fallback.gender==='МУЖ', 'R11: missing canonical fact must preserve already entered manager gender')

console.log('CATALOG RESOLVER R11 PRESERVE KNOWN GENDER PASSED — explicit manager gender and concrete selected SKU gender survive unisex product picks; resolver asks only when gender is genuinely unknown')
