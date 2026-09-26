import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const createUi = read('src/features/sections/CreateOrderSection.tsx')
const reportUi = read('src/features/renderers/FinanceReportContentRenderer.tsx')
const review = read('worker/domains/catalog-review.ts')
const flow = read('src/features/orders/catalogResolutionFlow.ts')
const modal = read('src/features/orders/OrderCatalogResolutionModal.tsx')
const references = read('worker/domains/references.ts')
const workspace = read('src/app/controllers/useWorkspaceViewModel.tsx')

check(createUi.includes('Укажите цену, по которой товар реально продаётся.'), 'R12 user-facing sold-price explanation missing')
check(!createUi.includes('Эта цена сохранится как историческая цена продажи.'), 'R12 internal historical-price wording still visible in Create')
check(reportUi.includes('Старые заказы без цены по позиции в расчёт не входят.'), 'R12 product report explanation is not user-facing')
check(!reportUi.includes('legacy-заказы') && !reportUi.includes('точной построчной исторической ценой'), 'R12 technical legacy/history jargon still visible in product report')
check(reportUi.includes('Данные для средней цены'), 'R12 average-price coverage heading missing')

check(review.includes('Values already used by the Catalog are valid even when the auxiliary reference list is stale.'), 'R12 resolver does not treat Catalog values as valid facts')
check(review.includes('const productVariants = product?.id'), 'R12 resolver does not load product variants for consistency checks')
check(review.includes("unknownFields.push('size')"), 'R12 resolver cannot identify a size conflict')
check(review.includes("unknownFields.push('color')"), 'R12 resolver cannot identify a color conflict')
check(review.includes('const colorVariants = facts.color'), 'R12 resolver does not validate color before size')
check(review.includes('const sizeMatches = colorVariants.some'), 'R12 resolver does not validate size inside the chosen color/gender combination')
check(review.includes('addReference(references.colors, normalizeCatalogCombinationColor(row.color))'), 'R12 Catalog colors are not added to resolver choices')
check(review.includes('addReference(references.sizes, normalizeCatalogCombinationSize(row.size_label))'), 'R12 Catalog sizes are not added to resolver choices')
check(review.includes('const referenceIdentity = (value: unknown)'), 'R12 resolver suggestion de-duplication missing')

check(flow.includes('const needsCorrection = (context.unknownFields || []).includes(field)'), 'R12 frontend does not ask about the actual conflicting field')
check(flow.includes('if (needsCorrection || missing)'), 'R12 non-empty conflicting fields can still be skipped')
check(modal.includes('Проверьте '), 'R12 correction question is not user-facing')
check(modal.includes('Есть в каталоге'), 'R12 valid Catalog alternatives are not shown directly')
check(modal.includes('В заказе:'), 'R12 resolver does not show the value being corrected')

check(references.includes('referenceValueIdentityKey'), 'R12 reference duplicate identity guard missing')
check(references.includes(".replace(/[‐‑‒–—-]+/g, ' ')"), 'R12 hyphen/space duplicate normalization missing')
check(references.includes('Такое значение уже есть:'), 'R12 duplicate reference error is not user-facing')
check(references.includes("referenceValueIdentityKey(current.value) !== referenceValueIdentityKey(value)"), 'R12 existing reference rows would be blocked even without changing their identity')
check(references.includes('await assertNoEquivalentReferenceValue(db, dbKind, value, 0)'), 'R12 new reference duplicate guard missing')
check(!/UPDATE\\s+orders\\b/i.test(references) && !/UPDATE\\s+order_items\\b/i.test(references) && !/UPDATE\\s+retained_order_summaries\\b/i.test(references), 'R12 reference protection must never rewrite historical order data')
check(!/UPDATE\\s+catalog_variants\\b/i.test(references), 'R12 duplicate protection must not silently normalize existing Catalog variants')
check(references.includes('await assertNoEquivalentReferenceValue(db, dbKind, value, id)'), 'R12 duplicate guard is not enforced on changed existing reference values')

check(workspace.includes('const enteredGender = canonicalOrderGender(currentItem.gender)'), 'R12 regressed R11 entered gender preservation')
check(workspace.includes('gender: enteredGender || canonicalOrderGender(selected.gender) || automaticGender'), 'R12 regressed R11 selected SKU gender preservation')
check(!workspace.includes("gender: automaticGender ? (selected.gender || automaticGender) : ''"), 'R12 restored the old unisex gender-erasure path')

console.log('RESOLVER / REFERENCES R12 PASSED — Catalog facts no longer depend on a stale auxiliary reference list, conflicting SKU dimensions are diagnosed directly, duplicate reference spellings are blocked, and UI wording is user-facing')
