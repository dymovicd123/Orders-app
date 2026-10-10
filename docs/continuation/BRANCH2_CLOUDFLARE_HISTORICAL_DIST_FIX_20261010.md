# Branch2 Cloudflare Worker native build deployed historical Stage04 fixture UI (2026-10-10)

## Reproduced live regression
- At 14:48–14:55 UTC, both `orders-app-branch2.orders-clothes.workers.dev` and `branch2-orders-app.orders-clothes.workers.dev` served `/assets/index-CJAZLPOW.js` with lazy `ReferencesSection-BT86KkDI.js`. None of the new catalog/references words were present. A random nonexistent Worker returned 404.
- Cloudflare API shows **canonical Worker** `orders-app-branch2` active deployment version `25b03713-0581-498a-b934-f3d6a69b9f22`, 100% traffic, uploaded at 14:23, containing the **old bundle**. Its immutable version URL `25b03713-orders-app-branch2.orders-clothes.workers.dev` also serves old bundle.
- Its previous version `d7eddfbe-3b6c-4655-979c-076245921b99` from GitHub guarded direct fallback at 14:11 serves the **new** References UI when accessed through `d7eddfbe-orders-app-branch2.orders-clothes.workers.dev`.
- The second hostname `branch2-orders-app` does **not** correspond to a registered separate Worker. It is a version/preview alias shape for a Worker named `orders-app`. Never represent it as the isolated branch2 production endpoint.

## Root cause: CLI build sequencing, not React or users' browser cache
Cloudflare Workers Build configuration executes `npm run release:check` as the build command, followed by `npx wrangler deploy`. The cumulative `catalog-integrity-branch2-preserved-gate.mjs` intentionally swaps runtime files to **historical Stage04 source fixtures** while running `release:check:baseline`. That historical suite executes Vite build and leaves **historical `dist/client`**. The gate correctly restores *source files* but until this fix did not rebuild the final frontend. Thus Cloudflare native build (build UUID `eac3b621-1b02-4fe7-98d1-b53b7754e626`) logs a successful bundle `ReferencesSection-BT86KkDI.js` and deploys that old bundle even though it checked out a recent branch2 source and passed every regression. Native Worker deployment supersedes the correct short-lived guarded GitHub deploy.

GitHub guarded direct fallback does `npm run release:check` **then** `npm run deploy` (fresh `npm run build`), correctly generating `ReferencesSection-CTuxg5u1.js`. Therefore a deploy monitor can transiently see current assets during an overlapping rollout and then they revert.

## Preventative fix (branch2 only)
- After frozen historical tests, restore source files and verify hashes as before.
- **Delete generated `dist`** from temporary historical compilation.
- Always perform `npm run build` on the restored actual branch2 source **within** `release:check`; this is required because Cloudflare native deploy does not recompile.
- Verify exactly one current References lazy chunk exists, and it contains the latest catalog UI, reference merging and complex undo workspace marker. Fail before publishing if it doesn't.
- Strengthen public Worker UI smoke script to require `Разобрать прежнее объединение товаров` as well.
- Never change D1, historic receipts, Stage04 SQL, production main or environment identity.

## Acceptance
1. Feature PR Quality checks green, including full historic Stage04 suite and final client+Worker build.
2. Branch2 native Cloudflare Build log must emit `CURRENT BRANCH2 BUILD VERIFIED` and `ReferencesSection-` with modern UI. Not `ReferencesSection-BT86KkDI.js`.
3. Latest active immutable Worker version URL and canonical `orders-app-branch2.orders-clothes.workers.dev` must both serve the current References UI, on repeated independent checks after native deploy settles.
4. Worker subdomain `branch2-orders-app` is an unrelated preview/alias; never use it for branch2 mainline validation.
