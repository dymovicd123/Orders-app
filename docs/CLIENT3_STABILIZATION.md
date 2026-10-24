# Client3 / former client — clean, isolated, support-light release

**State (2026-10-20):** third Cloudflare installation **deployed with a NEW empty D1** from isolated branch `client3/isolated-stabilization-20261020`; **first-admin bootstrap remains LOCKED until a unique Cloudflare Worker secret is provided**. Not yet approved for customer handoff. Never merge tenant-specific code into the active customer's `main`.

## Actual third-tenant deployment (2026-10-20)

- Cloudflare Worker: `orders-app-client3-old-client` at https://orders-app-client3-old-client.orders-clothes.workers.dev
- Newly created Cloudflare D1: `orders_db_client3_old_client` (not a clone of production or branch2).
- [Remote install and zero-business-data / FK verification](https://github.com/dymovicd123/Orders-app/actions/runs/39426811326): successful, including consolidated D1 migration, isolated Worker deployment, 31 regression checks and live local API flows.
- [Real public smoke](https://github.com/dymovicd123/Orders-app/actions/runs/39427236205): successful HTTP 200 for site and health; anonymous Orders/Payments/Catalog rejected with HTTP 401.
- `main` and `branch2` were not deployed or mutated by Client3 installation.
- **First-admin invitation (2026-10-23):** the exact third Worker now accepts a unique, high-entropy one-time invitation; only its SHA-256 hash is committed in the isolated configuration. The invitation itself is privately supplied to the owner, NOT included in this repository, Worker variables, build logs or artifacts. Client creates the first personal admin account; subsequent bootstrap attempts return 409. No `ADMIN_MODE_PASSWORD` secret needs to be entered for this third Worker while the hashed invitation is active. Rotate the invitation hash through a third-only deployment if exposed before use.
- **Outstanding before handoff:** create first admin, validate actual browser login and admin/manager controls, complete real remote-tenant fixture E2E, then ensure every fixture is removed or recreate only the third database. No claim of bug-free or fully accepted release.

**Activation status (2026-10-23):** deployed Worker replied `setupReady: true` and `hasUsers: false`; server-side registration invitation configured. The public application no longer permits a misleading invalid-code submission when setup is unconfigured. Only client-supplied invitation and chosen credentials are needed now. No business records were copied or modified during this fix.

## Scope and rules
- **Existing customer main:** Worker `orders-app` / D1 `orders_db_prod`. **Do not touch its data or configuration.**
- **Existing branch2:** Worker `orders-app-branch2` / D1 `orders_db_branch2`. **Do not repurpose its database.**
- **Third installation:** unique Worker named `orders-app-client3-...` and **new** D1 `orders_db_client3_...`, with an independent Cloudflare identity and no historical customer records.
- Generic cities, payment methods, colors, sizes and product characteristic dropdown references may be seeded from *public configuration defaults*; legacy manager names must not be seeded.
- No anonymized copy, clone or export of any existing client's order, customer, financial, inventory or personal data.
- Keep account sessions and one first-administrator credential. Do **not** make all admin APIs public or reenable header-based authentication.
- Third-only `CLIENT3_INSTALLATION=1` requires a strong `ADMIN_MODE_PASSWORD` Worker secret of at least 16 characters **before** first admin setup; the legacy `admin/admin` fallback must not work.
- No marketing/pricing feature reductions or changes to live business logic without acceptance tests. Prefer hiding only demonstrably unnecessary UI after requirements confirmation.

## What has been verified by direct repo review (not a blanket runtime guarantee)

| Priority | Concern | Evidence / guard | Exit criteria |
|---|---|---|---|
| P0 | Reusing main/branch2 DB or worker | main wrangler binds prod D1; branch2 has its own D1; client3 generator refuses protected IDs / names | Client3 config has exactly one unique D1 binding; no prod/branch2 mutations |
| P0 | Legacy client names in supposedly empty DB | `migrations/0002_reference_values.sql` seeds seven managers | Client3-generated copy excludes manager seed; fresh schema test finds 0 managers/orders/customers/payments/variants/stock/users |
| P0 | First-admin account takeover | Existing `getAdminModePassword` defaults to `admin` on ordinary installs | Client3 gate refuses absent/short/default bootstrap secret; live login and unauthorized 401/403 smoke |
| P1 | Catalog resolver: known SKU but absent reserve | Production #1775; PR #513 resolved empty-dialog path | Unsaved reservation recovers without inventing physical stock; no duplicate reservation; exact client3 API acceptance |
| P1 | Resolver wrong variant / retired / gender unknown | Historical male Ai-Nazik and Bayan SKU mismatch; gender-related regressions present | Explicit SKU choice, preserve actual variant and history, no phantom stock |
| P1 | Exchange / return / shipment coupled to reservations | Return #1563 with active reservation for completed returned lines; older linked-order and post-stocktake incidents | After real item return, no stale active reserve for returned qty; no double restock; repeated/cancel requests idempotent |
| P1 | Money integrity across exchange, refund, debt | Orders 1734/1974 duplicate and cascaded exchange-history incident | Payments sum and debt consistent; no double payment or refund; admin delete previews effects |
| P1 | Stale stock and mixed-source orders | Past source-switch cache, stock 0 with active reserve, issue vs revision | Counts update across warehouse/boutique; stock and reserves don't silently change on order read |
| P1 | Database fresh install from many historical migrations | 112 historical migration files, compiled offline into a single clean initial D1 baseline | Offline full-schema reconstruction + D1-safe consolidated baseline + local Worker/D1 acceptance; no failed migration |
| P2 | Operational complexity / long incident handling | Old production has extensive admin tools and customizations | Remove only objectively unused views; new client gets a short operating manual |
| P2 | E2E blind spots | Many source-level assertions, but they don't prove complete live flows | Exercise real Worker + new D1 with fixture orders before handoff |

**Important:** Production user incidents are not necessarily reproducible on an empty DB, but the same code paths are included. Empty data by itself does **not** fix logic defects. Do not claim the third installation is stable until the E2E acceptance matrix below is green.

## Verified acceptance checkpoint — 20 October 2026

- GitHub Actions **39421576623** passed after [Client3 candidate #514](https://github.com/dymovicd123/Orders-app/pull/514) was tested without deploying it.
- Exactly **112 historical migrations** were transformed into a **single fresh D1-safe baseline**. Real `wrangler d1 migrations apply --local` succeeded; fresh business tables and all core foreign keys validated; 127 generic reference values are seeded; **zero legacy managers, products, orders, customers, payments, variants, reserves or physical stock**.
- Full suite: **31 current high-risk regression checks**, plus database safety and the CI build/typecheck/dependency audits.
- Real Worker + disposable isolated D1 passed: unauthenticated APIs return 401, weak original bootstrap credential rejected, unique first admin created, duplicate setup blocked, authenticated reads work.
- Real API finance: paid order created, idempotent repeat; money-only refund and replay; unpaid order + partial payment and replay; exact total 10,000 / received 3,500 / debt 6,500; successful refund reversal without false payment.
- Real API exchange: itemized Workshop replacement with no extra money, retry-safe; exchange cancellation restored original item and unchanged debt.
- Real API warehouse: arrival **3 → 3** on replay; order reserve **1** without altering Physical; shipment **3 → 2** and reserve **1 → 0**; repeated shipment no second subtraction; physical Return **2 → 3** exactly once.
- Real API shortage: order for 4 with physical 3; shipping blocked with exact `stock_resolution_required`; after explicit operation-scoped possession confirmation shipping succeeded with physical **0 (never negative)** and no active reserve; replay was a no-op.
- Real API unknown SKU: unresolved order could be recorded but not shipped; order-scoped catalog review returned the actual problem item, avoiding the earlier empty resolver dialog.

Four **obsolete historical UI assertions** were excluded from the Client3 gate because they contradicted **current approved behavior**: the separate Kaspi order table was removed and order deletion is administrator-only. A fifth H9C assertion referred to an old full-shelf-count field intentionally replaced with issue-scoped stock confirmation; the current contract test replaces it. Current Return/Exchange cancel APIs are exercised live. This is an explicit compatibility reconciliation, not permission to skip new failing tests.

**Remaining release risks (not yet proven by this suite):** end-to-end batch exchange with multiple old/new SKUs; real concurrent multi-browser load and lost network acknowledgement; historic linked Return/Exchange chains; all navigation/mobile UI; full stocktake under simultaneous sales; third Cloudflare account/remote Worker binding and prod-like D1 performance. An empty tenant avoids old damaged customer records, **not all potential application bugs**. Do not promise a bug-free release.

## Independent installation procedure (historical first-install guide; installation now complete)

1. Check out `client3/isolated-stabilization-20261020` (do **not** deploy `main` or `branch2`).
2. Run `npm ci`, `node scripts/client3/test-fresh.mjs`, `node scripts/client3/stability-gate.mjs`, `npm run typecheck`, `npm run build`.
3. Create a **brand-new** Cloudflare D1 database named `orders_db_client3_old_client`, and record its newly assigned UUID. Do not restore or clone another D1.
4. Run `node scripts/client3/prepare.mjs --prepare-migrations` (this generates one consolidated clean baseline in .client3-migrations; historical main migrations remain untouched).
5. Run `node scripts/client3/prepare.mjs --configure orders-app-client3-old-client orders_db_client3_old_client <NEW_D1_UUID>`.
6. Run `node scripts/client3/prepare.mjs --validate`. Confirm a single DB binding and a brand new UUID distinct from main/branch2.
7. Apply **only** the isolated migrations with `npx wrangler d1 migrations apply orders_db_client3_old_client --remote --config wrangler.client3.json`. Run SELECT-only checks of empty business tables, foreign keys and expected reference counts before public access.
8. Deploy using `npx wrangler deploy --config wrangler.client3.json`. Even if an URL becomes public at this step, Client3's fail-closed bootstrap gate stops first-admin creation without its Worker secret.
9. Provision a **strong unique** `ADMIN_MODE_PASSWORD` via Cloudflare Worker secret (never put it in Git, PR descriptions or logs). Create the first administrator through the initial setup flow; log out/in and confirm manager/admin separation.
10. Run complete E2E fixture acceptance on third DB only. **Before handoff**, delete only the known fixture orders using supported business deletion, then SELECT-verify every affected orders/payments/reservations/movement table is clean. If this cannot be proven, discard and recreate the entire isolated third D1; never manually wipe a live/customer DB.

The above commands are operational documentation; scripts provided here do not create databases, deploy anything, or mutate the two existing installations. **No third Cloudflare worker or D1 is presumed to exist.**

## Minimum E2E acceptance before handoff

- New D1 is genuinely empty: managers and users 0, products and stock 0, customers and orders 0, payments 0; first admin only after secret bootstrap.
- Anonymous request to `/api/orders`, `/api/payments` denied; admin protected operations deny manager role.
- Create standard order with a precise variant and payment; totals, ledger and debt match.
- New unrecognized variant: resolver shows affected item; user chooses exact SKU; no unrelated SKU learned, physical stock not fabricated.
- Known exact SKU but missing pending reservation: recovery creates exactly one reserve; reattempt doesn't duplicate it; physical stock unchanged until legitimate movement.
- Warehouse and boutique switch immediately refreshes physical/reserved/available without silently merging sources.
- Order shipped with sufficient stock (one subtraction only); shortage confirmation (no fabricated arrival); repeated send cannot double decrement.
- Complete / partial exchange, return to physical stock, cancellation and repeat request; correct reserved_quantity and no over-restock.
- Change price before/after exchange; payments, refunds and debt remain internally consistent and traceable.
- Stocktake after an older order, negative availability, and historical issued-before/after checkpoint; no duplicate physical movement.
- Refresh, navigation, timeout and retry after successful write: no double payment, reserve, stock subtraction or duplicate exchanged item.
- Role changes, first admin password change, session expiry; error messages identify the **actual** failed step.

## Release / rollback

- Gate failures: **no deployment**.
- Deployment errors: restore previous Worker version, preserving independent third D1; never point third Worker at another customer DB.
- Data corruption or unexplainable finance / stock results during fixture acceptance: recreate fresh third database instead of force-adjusting balances.
- Launch with a known date/version; freeze third release except high-priority patches and test them on an independent scratch DB first.
