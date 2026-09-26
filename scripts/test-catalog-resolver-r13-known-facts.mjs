import fs from 'node:fs'

const review = fs.readFileSync('worker/domains/catalog-review.ts', 'utf8')
const flow = fs.readFileSync('src/features/orders/catalogResolutionFlow.ts', 'utf8')
const workspace = fs.readFileSync('src/app/controllers/useWorkspaceViewModel.tsx', 'utf8')
const references = fs.readFileSync('worker/domains/references.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

// Known facts come from both the maintained reference lists and the live Catalog itself.
check(review.includes("SELECT 'material' AS kind, material AS value FROM catalog_stock_positions"), 'R13: Catalog materials are not part of known-value recognition')
check(review.includes("SELECT 'color' AS kind, color AS value FROM catalog_variants"), 'R13: Catalog colors are not part of known-value recognition')
check(review.includes("THEN 'child_age' ELSE 'size'"), 'R13: Catalog sizes/ages are not part of known-value recognition')

// Harmless formatting differences such as ТЕМНО-СЕРЫЙ vs ТЕМНО СЕРЫЙ canonicalize automatically.
check(review.includes("const canonicalKnownValue = (values: string[], value: unknown)"), 'R13: known-value canonicalization missing')
check(review.includes(".replace(/[‐‑‒–—-]+/g, ' ')"), 'R13: hyphen/spacing identity normalization missing')
check(review.includes("if (knownColor) facts.color = normalizeCatalogCombinationColor(knownColor)"), 'R13: recognized color is not canonicalized automatically')
check(review.includes("if (knownSize) facts.size = normalizeCatalogCombinationSize(knownSize)"), 'R13: recognized size is not canonicalized automatically')

// The resolver is no longer allowed to reject an understandable human fact because that exact SKU combination does not exist.
check(review.includes('Resolver is an anomaly guard, not a compatibility questionnaire.'), 'R13: independent-fact resolver contract missing')
check(review.includes("if (!knownMaterial) unknownFields.push('material')"), 'R13: material unknown check missing')
check(review.includes("if (!knownLength) unknownFields.push('length')"), 'R13: length unknown check missing')
check(review.includes("if (!knownColor) unknownFields.push('color')"), 'R13: color unknown check missing')
check(review.includes("if (!knownSize) unknownFields.push('size')"), 'R13: size unknown check missing')
check(!review.includes('const genderVariants = facts.gender'), 'R13: gender is still being validated against an exact SKU combination')
check(!review.includes('const colorVariants = facts.color'), 'R13: color is still being validated against an exact SKU combination')
check(!review.includes('const sizeMatches = colorVariants.some'), 'R13: size is still being validated against an exact SKU combination')

// Unknown values still reach the clarification flow; known non-exact combinations simply reach ready.
check(flow.includes("const needsCorrection = (context.unknownFields || []).includes(field)"), 'R13: unknown fields are not routed to clarification')
check(flow.includes("return { kind: options.legacy ? 'legacy' : 'ready' }"), 'R13: recognized non-exact facts cannot proceed without another question')

// Preserve the already-shipped R11 gender rule and R12 non-destructive reference guard.
check(workspace.includes('gender: enteredGender || canonicalOrderGender(selected.gender) || automaticGender'), 'R13 regressed R11 known-gender preservation')
check(references.includes("referenceValueIdentityKey(current.value) !== referenceValueIdentityKey(value)"), 'R13 regressed non-destructive reference duplicate protection')
check(!/UPDATE\s+orders\b/i.test(references) && !/UPDATE\s+order_items\b/i.test(references), 'R13 reference protection must not rewrite historical orders')

console.log('CATALOG RESOLVER R13 KNOWN FACTS PASSED — recognized human facts are accepted independently, Catalog-backed values remain valid even with stale references, harmless hyphen/spacing variants canonicalize automatically, and only genuinely unknown values are clarified')
